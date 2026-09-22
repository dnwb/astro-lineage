import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateDailyRadarPayload } from "./daily-radar.mjs";

const DEFAULT_ARCHIVE_ROOT = resolve(fileURLToPath(new URL("../src/data/arxiv-archives", import.meta.url)));
const DEFAULT_DAILY_FEED = resolve(fileURLToPath(new URL("../src/data/arxiv-daily.json", import.meta.url)));
const DEFAULT_DAILY_RADAR = resolve(fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url)));
const DEFAULT_WEEKLY_FILE = resolve(fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url)));
const DEFAULT_DAILY_CACHE = resolve(fileURLToPath(new URL("../.cache/arxiv-daily/generations", import.meta.url)));
const DEFAULT_WEEKLY_CACHE = resolve(fileURLToPath(new URL("../.cache/arxiv-weekly/archives", import.meta.url)));

export function getIsoWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

export function getWeekMondayAndSunday(weekId) {
  const [yearStr, weekStr] = weekId.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = (jan4.getUTCDay() + 6) % 7;
  const mondayWeek1 = new Date(jan4.valueOf() - day * 86400000);
  const mondayTarget = new Date(mondayWeek1.valueOf() + (week - 1) * 7 * 86400000);
  const sundayTarget = new Date(mondayTarget.valueOf() + 6 * 86400000);
  return {
    monday: mondayTarget.toISOString().slice(0, 10),
    sunday: sundayTarget.toISOString().slice(0, 10),
  };
}

export async function readJsonSafe(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function syncArxivArchives({
  archiveRoot = DEFAULT_ARCHIVE_ROOT,
  currentFeedPath = DEFAULT_DAILY_FEED,
  currentRadarPath = DEFAULT_DAILY_RADAR,
  currentWeeklyPath = DEFAULT_WEEKLY_FILE,
  dailyCacheDir = DEFAULT_DAILY_CACHE,
  weeklyCacheDir = DEFAULT_WEEKLY_CACHE,
} = {}) {
  const dailyArchiveDir = join(archiveRoot, "daily");
  const weeklyArchiveDir = join(archiveRoot, "weekly");
  await mkdir(dailyArchiveDir, { recursive: true });
  await mkdir(weeklyArchiveDir, { recursive: true });

  const discoveredDaily = new Map();

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
            if (date && /^\d{4}-\d{2}-\d{2}$/u.test(date)) {
              discoveredDaily.set(date, { feed, radar, date, source: `cache:${ent.name}` });
            }
          }
        }
      }
    } catch (err) {
      console.warn("[Archive Sync] Warning reading daily cache:", err.message);
    }
  }

  // 2. Scan current active src/data/arxiv-daily.json & daily-radar.json (authoritative for latest date)
  if (existsSync(currentFeedPath) && existsSync(currentRadarPath)) {
    const curFeed = await readJsonSafe(currentFeedPath);
    const curRadar = await readJsonSafe(currentRadarPath);
    if (curFeed && curRadar) {
      const curDate = curFeed.window?.announcement_date || curRadar.edition?.window?.announcement_date;
      if (curDate) {
        discoveredDaily.set(curDate, { feed: curFeed, radar: curRadar, date: curDate, source: "current" });
      }
    }
  }

  // 3. Scan existing archived daily files in case some were manually created or preserved
  if (existsSync(dailyArchiveDir)) {
    try {
      const archivedFiles = await readdir(dailyArchiveDir);
      for (const file of archivedFiles) {
        if (!file.endsWith(".json")) continue;
        const date = file.slice(0, -5);
        if (!discoveredDaily.has(date)) {
          const content = await readJsonSafe(join(dailyArchiveDir, file));
          if (content?.feed && content?.radar) {
            discoveredDaily.set(date, { feed: content.feed, radar: content.radar, date, source: "archived" });
          }
        }
      }
    } catch {}
  }

  // Process and write individual daily archives
  const processedDays = [];
  for (const [date, item] of discoveredDaily.entries()) {
    const { feed, radar } = item;
    const weekId = getIsoWeek(date);
    const window = feed.window || radar.edition?.window || {};
    const weekday = window.announcement_weekday || new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short" });
    const batchId = window.batch_id || `announcement-${date}`;

    const validation = validateDailyRadarPayload(feed, radar, { visibleWorkIds: [] });
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
      batch_id: batchId,
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

    const dailyDest = join(dailyArchiveDir, `${date}.json`);
    await writeFile(dailyDest, `${JSON.stringify(dailyArchivePayload, null, 2)}\n`, "utf8");

    processedDays.push({
      date,
      weekday,
      week_id: weekId,
      batch_id: batchId,
      total_papers: counts.total,
      analyzed_count: counts.analyzed,
      must_read_count: model.groups?.must_read?.length || 0,
      worth_knowing_count: model.groups?.worth_knowing?.length || 0,
      skip_count: model.groups?.skip?.length || 0,
      pending_count: model.pending?.length || 0,
      brief_status: model.opening_brief?.status || "unavailable",
      brief_intro: model.opening_brief?.intro || (highlights[0] ? `重点关注 ${highlights[0].title}` : "常规高能天体物理监测批次"),
      highlights: highlights.slice(0, 3),
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
  if (existsSync(currentWeeklyPath)) {
    const curWeekly = await readJsonSafe(currentWeeklyPath);
    if (curWeekly?.week_id) {
      discoveredWeekly.set(curWeekly.week_id, curWeekly);
    }
  }

  // Save weekly archives
  for (const [weekId, wData] of discoveredWeekly.entries()) {
    const weeklyDest = join(weeklyArchiveDir, `${weekId}.json`);
    await writeFile(weeklyDest, `${JSON.stringify(wData, null, 2)}\n`, "utf8");
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

  const weeksSummary = sortedWeekIds.map((weekId) => {
    const daysInWeek = (weekMap.get(weekId) || []).sort((a, b) => b.date.localeCompare(a.date));
    const weeklyObj = discoveredWeekly.get(weekId);
    const range = getWeekMondayAndSunday(weekId);
    const dateRangeStr = weeklyObj?.date_range || `${range.monday} ~ ${range.sunday}`;

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
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  syncArxivArchives().then((manifest) => {
    console.log(`[Archive Sync] ✓ 成功同步归档数据：共 ${manifest.total_weeks} 周，${manifest.total_daily_editions} 个每日批次。`);
    console.log(`  - 归档清单: src/data/arxiv-archives/manifest.json`);
    console.log(`  - 最新周次: ${manifest.latest_week_id}，最新日期: ${manifest.latest_daily_date}`);
  }).catch((err) => {
    console.error("[Archive Sync] 同步失败:", err);
    process.exit(1);
  });
}
