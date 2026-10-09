import { readFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildOpeningBrief,
  editionFingerprint,
  normalizeArxivId,
  sourceFingerprint,
  validateDailyRadarPayload,
} from "./daily-radar.mjs";
import {
  acquireRefreshLock,
  readPublishedArxivEdition,
  releaseRefreshLock,
  writeJsonAtomically,
} from "./arxiv-daily.mjs";

const DEFAULT_ARCHIVE_ROOT = resolve(
  fileURLToPath(new URL("../src/data/arxiv-archives", import.meta.url))
);
const DEFAULT_DAILY_FEED = resolve(
  fileURLToPath(new URL("../src/data/arxiv-daily.json", import.meta.url))
);
const DEFAULT_DAILY_RADAR = resolve(
  fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url))
);
const DEFAULT_WEEKLY_FILE = resolve(
  fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url))
);
const DEFAULT_DAILY_CACHE = resolve(
  fileURLToPath(new URL("../.cache/arxiv-daily/generations", import.meta.url))
);
const DEFAULT_WEEKLY_CACHE = resolve(
  fileURLToPath(new URL("../.cache/arxiv-weekly/archives", import.meta.url))
);
import {
  getDirtyWeeks as ledgerGetDirtyWeeks,
  markWeekDirty as ledgerMarkWeekDirty,
  clearDirtyWeek as ledgerClearDirtyWeek,
  clearAllDirtyWeeks as ledgerClearAllDirtyWeeks,
} from "./edition-ledger.mjs";

export const DEFAULT_DIRTY_WEEKS_PATH = resolve(
  fileURLToPath(new URL("../.cache/dirty-weeks.json", import.meta.url))
);

export async function getDirtyWeeks(path = DEFAULT_DIRTY_WEEKS_PATH) {
  return await ledgerGetDirtyWeeks({ dirtyWeeksPath: path });
}

export async function markWeekDirty(weekId, path = DEFAULT_DIRTY_WEEKS_PATH) {
  return await ledgerMarkWeekDirty(weekId, { dirtyWeeksPath: path });
}

export async function clearDirtyWeek(weekId, path = DEFAULT_DIRTY_WEEKS_PATH) {
  return await ledgerClearDirtyWeek(weekId, { dirtyWeeksPath: path });
}

export async function clearAllDirtyWeeks(path = DEFAULT_DIRTY_WEEKS_PATH) {
  return await ledgerClearAllDirtyWeeks({ dirtyWeeksPath: path });
}

export function getIsoWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

export function getAnnouncementWeekId(dateStr, weekday) {
  const d = new Date(dateStr + "T12:00:00Z");
  const isSunday = weekday === "Sun" || d.getUTCDay() === 0;
  // arXiv announcements released on Sunday evening (20:00 US EDT) arrive on Monday morning (08:00 BJT),
  // which belongs to the incoming academic week (W+1), not the closed preceding week.
  if (isSunday) {
    const nextDay = new Date(d.valueOf() + 86400000).toISOString().slice(0, 10);
    return getIsoWeek(nextDay);
  }
  return getIsoWeek(dateStr);
}

export { getNaturalWeekBounds } from "../src/domain/academic-domain.mjs";
import { getNaturalWeekBounds } from "../src/domain/academic-domain.mjs";

export function getWeekMondayAndSunday(weekId) {
  const { monday, sunday } = getNaturalWeekBounds(weekId);
  return { monday, sunday };
}

function batchIdFor(feed, radar, date) {
  return feed?.window?.batch_id ?? radar?.edition?.window?.batch_id ?? `announcement-${date}`;
}

function eligibleAnalysisMap(feed, radar) {
  const { model } = validateDailyRadarPayload(feed, radar);
  return new Map(
    ["must_read", "worth_knowing", "skip"].flatMap((priority) =>
      model.groups[priority].map((item) => [
        `${normalizeArxivId(item.arxiv_id)}@${item.revision}`,
        item.analysis,
      ])
    )
  );
}

function analysisStrength(analysis) {
  const coverage =
    { abstract_only: 0, body_partial: 1, full_body: 2 }[analysis?.coverage?.level] ?? -1;
  const priority = { skip: 0, worth_knowing: 1, must_read: 2 }[analysis?.priority] ?? -1;
  return coverage * 3 + priority;
}

function addMatchingAnalysis(feed, radar, candidate, eligibleOnly = false) {
  const analysis = candidate?.coverage ? candidate : (candidate?.analysis ?? candidate);
  if (!analysis?.arxiv_id || !Number.isInteger(Number(analysis.revision))) return radar;
  const entry = (feed.entries || []).find(
    (item) =>
      normalizeArxivId(item.arxiv_id) === normalizeArxivId(analysis.arxiv_id) &&
      Number(item.revision) === Number(analysis.revision)
  );
  if (!entry || analysis.source_fingerprint !== sourceFingerprint(entry)) return radar;

  const key = `${normalizeArxivId(entry.arxiv_id)}@${entry.revision}`;
  const existing = (Array.isArray(radar.analyses) ? radar.analyses : []).find(
    (item) => `${normalizeArxivId(item.arxiv_id)}@${item.revision}` === key
  );
  if (existing && analysisStrength(existing) >= analysisStrength(analysis)) return radar;

  const analyses = (Array.isArray(radar.analyses) ? radar.analyses : []).filter(
    (item) => `${normalizeArxivId(item.arxiv_id)}@${item.revision}` !== key
  );
  const mergedRadar = { ...radar, analyses: [...analyses, analysis] };
  const validation = validateDailyRadarPayload(feed, mergedRadar, { visibleWorkIds: [] });
  if (validation.fatalDiagnostics.length > 0) return radar;
  return !eligibleOnly || eligibleAnalysisMap(feed, mergedRadar).has(key) ? mergedRadar : radar;
}

function projectHistoricalAnalyses(feed, radar, records, date) {
  const batchId = batchIdFor(feed, radar, date);
  const fingerprint = editionFingerprint(feed);
  return records.reduce((current, record) => {
    if (
      record?.historical_edition !== batchId ||
      record?.historical_edition_fingerprint !== fingerprint
    )
      return current;
    return addMatchingAnalysis(feed, current, record, true);
  }, radar);
}

export async function readJsonSafe(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function syncArxivArchivesWithLockHeld({
  archiveRoot = DEFAULT_ARCHIVE_ROOT,
  currentFeedPath = DEFAULT_DAILY_FEED,
  currentRadarPath = DEFAULT_DAILY_RADAR,
  currentWeeklyPath = DEFAULT_WEEKLY_FILE,
  dailyCacheDir = DEFAULT_DAILY_CACHE,
  weeklyCacheDir = DEFAULT_WEEKLY_CACHE,
  dirtyWeeksPath = DEFAULT_DIRTY_WEEKS_PATH,
} = {}) {
  const dailyArchiveDir = join(archiveRoot, "daily");
  const weeklyArchiveDir = join(archiveRoot, "weekly");
  await mkdir(dailyArchiveDir, { recursive: true });
  await mkdir(weeklyArchiveDir, { recursive: true });

  const discoveredDaily = new Map();
  const allHistoricalAnalyses = [];
  const allAnalyses = new Map();

  function considerDaily(feed, radar, date, source) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(date ?? "") ||
      !Array.isArray(feed?.entries) ||
      feed.entries.length === 0
    )
      return;
    const validation = validateDailyRadarPayload(feed, radar, { visibleWorkIds: [] });
    if (!validation.valid) {
      console.warn(
        `[Archive Sync] Skipping invalid ${source} for ${date}: ${validation.diagnostics.join(", ")}`
      );
      return;
    }
    if (Array.isArray(radar.historical_analyses))
      allHistoricalAnalyses.push(...radar.historical_analyses);
    if (!allAnalyses.has(date)) allAnalyses.set(date, []);
    allAnalyses.get(date).push(
      ...radar.analyses.map((analysis) => ({
        batchId: batchIdFor(feed, radar, date),
        analysis,
      }))
    );
    const generatedAt = Date.parse(feed.generated_at ?? "") || 0;
    const sourceRank = source === "current" ? 2 : source === "archived" ? 1 : 0;
    const previous = discoveredDaily.get(date);
    if (
      !previous ||
      generatedAt > previous.generatedAt ||
      (generatedAt === previous.generatedAt && sourceRank >= previous.sourceRank)
    ) {
      discoveredDaily.set(date, { feed, radar, date, source, generatedAt, sourceRank });
    }
  }

  // 1. Scan .cache/arxiv-daily/generations
  if (existsSync(dailyCacheDir)) {
    try {
      const genDirs = await readdir(dailyCacheDir, { withFileTypes: true });
      for (const ent of genDirs) {
        if (!ent.isDirectory() || !ent.name.startsWith("generation-")) continue;
        const genPath = join(dailyCacheDir, ent.name);
        const file0 = join(genPath, "files", "0000.json");
        const file1 = join(genPath, "files", "0001.json");
        if (existsSync(file0) && existsSync(file1)) {
          const feed = await readJsonSafe(file0);
          const radar = await readJsonSafe(file1);
          if (feed && radar) {
            const date = feed.window?.announcement_date || radar.edition?.window?.announcement_date;
            considerDaily(feed, radar, date, `cache:${ent.name}`);
          }
        }
      }
    } catch (err) {
      console.warn("[Archive Sync] Warning reading daily cache:", err.message);
    }
  }

  // 2. Read the active pair through its published pointer, not potentially
  // mixed compatibility mirrors left behind by an interrupted publication.
  try {
    const current = await readPublishedArxivEdition({
      output: currentFeedPath,
      radarOutput: currentRadarPath,
    });
    const curFeed = current?.feed;
    const curRadar = current?.radar;
    const curDate =
      curFeed?.window?.announcement_date || curRadar?.edition?.window?.announcement_date;
    if (curFeed && curRadar) considerDaily(curFeed, curRadar, curDate, "current");
  } catch (err) {
    console.warn("[Archive Sync] Warning reading current published edition:", err.message);
  }

  // 3. Scan existing archived daily files in case some were manually created or preserved
  if (existsSync(dailyArchiveDir)) {
    try {
      const archivedFiles = await readdir(dailyArchiveDir);
      for (const file of archivedFiles) {
        if (!file.endsWith(".json")) continue;
        const date = file.slice(0, -5);
        const content = await readJsonSafe(join(dailyArchiveDir, file));
        if (content?.feed && content?.radar)
          considerDaily(content.feed, content.radar, date, "archived");
      }
    } catch {}
  }
  // 4. Ingest completed analyses from persistent screening queue
  const queuePath = resolve(".cache/arxiv-daily/screening-queue.json");
  if (existsSync(queuePath)) {
    try {
      const queue = await readJsonSafe(queuePath);
      if (Array.isArray(queue?.items)) {
        for (const item of queue.items) {
          if (item?.state === "complete" && item.analysis?.status === "ready") {
            for (const edition of item.editions || []) {
              allHistoricalAnalyses.push({
                ...item.analysis,
                historical_edition: edition.historical_edition,
                historical_edition_fingerprint: edition.historical_edition_fingerprint,
              });
            }
          }
        }
      }
    } catch {}
  }

  const historicalAnalyses = [
    ...new Map(
      allHistoricalAnalyses.map((analysis) => [
        `${analysis.historical_edition}\u0000${analysis.historical_edition_fingerprint}\u0000${normalizeArxivId(analysis.arxiv_id)}@${analysis.revision}\u0000${analysis.source_fingerprint}`,
        analysis,
      ])
    ).values(),
  ];

  // Process and write individual daily archives
  const processedDays = [];
  for (const [date, item] of discoveredDaily.entries()) {
    const { feed } = item;
    let radar = item.radar;
    const dailyDest = join(dailyArchiveDir, `${date}.json`);
    const batchId = batchIdFor(feed, radar, date);
    for (const candidate of allAnalyses.get(date) ?? []) {
      if (candidate.batchId === batchId)
        radar = addMatchingAnalysis(feed, radar, candidate.analysis);
    }
    radar = projectHistoricalAnalyses(feed, radar, historicalAnalyses, date);
    radar.opening_brief = buildOpeningBrief(feed, radar);
    const window = feed.window || radar.edition?.window || {};
    const weekday =
      window.announcement_weekday ||
      new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short" });
    const weekId = getAnnouncementWeekId(date, weekday);
    const archiveBatchId = batchId;

    const validation = validateDailyRadarPayload(feed, radar, { visibleWorkIds: [] });
    if (!validation.valid) {
      throw new Error(`ARXIV_ARCHIVE_INVALID: ${date}: ${validation.diagnostics.join(", ")}`);
    }
    const model = validation.model;
    const counts = model.counts || {
      total: feed.entries?.length || 0,
      analyzed: radar.analyses?.length || 0,
      must_read: model.groups?.must_read?.length || 0,
      worth_knowing: model.groups?.worth_knowing?.length || 0,
      skip: model.groups?.skip?.length || 0,
    };

    const highlights = [
      ...(model.groups?.must_read || []).map((m) => ({
        arxiv_id: m.arxiv_id,
        priority: "must_read",
        title: m.title || m.arxiv_id,
        reason: m.analysis?.analysis?.reason || "",
      })),
      ...(model.groups?.worth_knowing || []).map((m) => ({
        arxiv_id: m.arxiv_id,
        priority: "worth_knowing",
        title: m.title || m.arxiv_id,
        reason: m.analysis?.analysis?.reason || "",
      })),
    ];

    const dailyArchivePayload = {
      schema_version: "astrolineage-daily-archive-v1",
      date,
      week_id: weekId,
      weekday,
      batch_id: archiveBatchId,
      generated_at: feed.generated_at || radar.edition?.generated_at || new Date().toISOString(),
      counts: {
        total: counts.total,
        analyzed: counts.analyzed,
        must_read: model.groups?.must_read?.length || 0,
        worth_knowing: model.groups?.worth_knowing?.length || 0,
        skip: model.groups?.skip?.length || 0,
        pending: model.pending?.length || 0,
      },
      opening_brief: model.opening_brief || null,
      highlights,
      feed,
      radar,
    };

    let fileChanged = true;
    if (existsSync(dailyDest)) {
      try {
        const existingData = await readJsonSafe(dailyDest);
        if (
          existingData &&
          existingData.counts?.analyzed === dailyArchivePayload.counts?.analyzed &&
          existingData.counts?.pending === dailyArchivePayload.counts?.pending &&
          existingData.counts?.must_read === dailyArchivePayload.counts?.must_read &&
          existingData.counts?.worth_knowing === dailyArchivePayload.counts?.worth_knowing &&
          JSON.stringify(existingData.highlights) === JSON.stringify(dailyArchivePayload.highlights)
        ) {
          fileChanged = false;
        }
      } catch {}
    }

    await writeJsonAtomically(dailyDest, dailyArchivePayload);

    if (fileChanged) {
      await markWeekDirty(weekId, dirtyWeeksPath);
    }

    processedDays.push({
      date,
      weekday,
      week_id: weekId,
      batch_id: archiveBatchId,
      total_papers: counts.total,
      analyzed_count: counts.analyzed,
      must_read_count: model.groups?.must_read?.length || 0,
      worth_knowing_count: model.groups?.worth_knowing?.length || 0,
      skip_count: model.groups?.skip?.length || 0,
      pending_count: model.pending?.length || 0,
      brief_status: model.opening_brief?.status || "unavailable",
      brief_intro:
        model.opening_brief?.intro ||
        (highlights[0] ? `重点关注 ${highlights[0].title}` : "常规高能天体物理监测批次"),
      highlights: highlights.filter((h) => h.priority === "must_read"),
      data_file: `daily/${date}.json`,
    });
  }

  // 4. Scan weekly summaries
  const discoveredWeekly = new Map();
  if (existsSync(weeklyCacheDir)) {
    try {
      const files = await readdir(weeklyCacheDir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const weekId = f.slice(0, -5);
        const data = await readJsonSafe(join(weeklyCacheDir, f));
        if (data?.week_id) discoveredWeekly.set(weekId, data);
      }
    } catch {}
  }
  if (existsSync(weeklyArchiveDir)) {
    try {
      const files = await readdir(weeklyArchiveDir);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const weekId = f.slice(0, -5);
        if (!discoveredWeekly.has(weekId)) {
          const data = await readJsonSafe(join(weeklyArchiveDir, f));
          if (data?.week_id) discoveredWeekly.set(weekId, data);
        }
      }
    } catch {}
  }
  if (existsSync(currentWeeklyPath)) {
    const curWeekly = await readJsonSafe(currentWeeklyPath);
    if (curWeekly?.week_id) {
      if (!discoveredWeekly.has(curWeekly.week_id)) {
        discoveredWeekly.set(curWeekly.week_id, curWeekly);
      }
    }
  }

  // Save weekly archives
  for (const [weekId, wData] of discoveredWeekly.entries()) {
    const weeklyDest = join(weeklyArchiveDir, `${weekId}.json`);
    await writeJsonAtomically(weeklyDest, wData);
  }

  // Group days by week_id
  const weekMap = new Map();
  for (const day of processedDays) {
    if (!weekMap.has(day.week_id)) {
      weekMap.set(day.week_id, []);
    }
    weekMap.get(day.week_id).push(day);
  }

  // Ensure all discovered weekly keys are in weekMap
  for (const weekId of discoveredWeekly.keys()) {
    if (!weekMap.has(weekId)) {
      weekMap.set(weekId, []);
    }
  }

  // Sort weeks in descending order (newest first)
  const sortedWeekIds = Array.from(weekMap.keys()).sort().reverse();

  // Single Source of Truth (SSOT): Ensure currentWeeklyPath reflects the newest available weekly summary
  const latestWeekWithData = sortedWeekIds.find((id) => discoveredWeekly.has(id));
  if (latestWeekWithData && currentWeeklyPath) {
    const latestWeeklyData = discoveredWeekly.get(latestWeekWithData);
    await writeJsonAtomically(currentWeeklyPath, latestWeeklyData);
  }

  const weeksSummary = sortedWeekIds.map((weekId) => {
    const daysInWeek = (weekMap.get(weekId) || []).sort((a, b) => b.date.localeCompare(a.date));
    const weeklyObj = discoveredWeekly.get(weekId);
    const bounds = getNaturalWeekBounds(weekId);
    const dateRangeStr = weeklyObj?.date_range || bounds.dateRange;

    return {
      week_id: weekId,
      title: weeklyObj?.title || `高能天体物理 arXiv 每周学术脉络 (${weekId})`,
      date_range: dateRangeStr,
      has_weekly_summary: Boolean(weeklyObj),
      executive_summary: weeklyObj?.executive_summary || "本周暂未生成宏观脉络总结。",
      statistics: weeklyObj?.statistics || {
        total_analyzed: daysInWeek.reduce((sum, d) => sum + d.analyzed_count, 0),
        must_read_count: daysInWeek.reduce((sum, d) => sum + d.must_read_count, 0),
        worth_knowing_count: daysInWeek.reduce((sum, d) => sum + d.worth_knowing_count, 0),
        skip_count: daysInWeek.reduce((sum, d) => sum + d.skip_count, 0),
      },
      top_picks_count: weeklyObj?.top_picks?.length || 0,
      days: daysInWeek,
      weekly_data_file: weeklyObj ? `weekly/${weekId}.json` : null,
    };
  });

  const manifest = {
    schema_version: "astrolineage-arxiv-archive-manifest-v1",
    updated_at: new Date().toISOString(),
    total_weeks: weeksSummary.length,
    total_daily_editions: processedDays.length,
    latest_week_id: weeksSummary[0]?.week_id || null,
    latest_daily_date: processedDays.sort((a, b) => b.date.localeCompare(a.date))[0]?.date || null,
    weeks: weeksSummary,
  };

  const manifestPath = join(archiveRoot, "manifest.json");
  await writeJsonAtomically(manifestPath, manifest);

  return manifest;
}

export async function syncArxivArchives(options = {}) {
  const archiveRoot = resolve(options.archiveRoot ?? DEFAULT_ARCHIVE_ROOT);
  const lockPath = join(archiveRoot, ".sync.lock");
  await acquireRefreshLock(lockPath);
  try {
    const dirtyWeeksPath =
      options.dirtyWeeksPath ??
      (archiveRoot !== resolve(DEFAULT_ARCHIVE_ROOT)
        ? join(archiveRoot, "dirty-weeks.json")
        : DEFAULT_DIRTY_WEEKS_PATH);
    return await syncArxivArchivesWithLockHeld({ ...options, archiveRoot, dirtyWeeksPath });
  } finally {
    await releaseRefreshLock(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  syncArxivArchives()
    .then((manifest) => {
      console.log(
        `[Archive Sync] ✓ 成功同步归档数据：共 ${manifest.total_weeks} 周，${manifest.total_daily_editions} 个每日批次。`
      );
      console.log(`  - 归档清单: src/data/arxiv-archives/manifest.json`);
      console.log(
        `  - 最新周次: ${manifest.latest_week_id}，最新日期: ${manifest.latest_daily_date}`
      );
    })
    .catch((err) => {
      console.error("[Archive Sync] 同步失败:", err);
      process.exit(1);
    });
}
