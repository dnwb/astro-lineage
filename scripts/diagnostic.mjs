export const DIAGNOSTIC_FIELDS = Object.freeze([
  "severity",
  "code",
  "dataset",
  "file",
  "record_id",
  "field_path",
  "message",
  "related_ids",
]);

export function createDiagnostic({
  severity = "error",
  code,
  dataset = "production",
  file,
  recordId = null,
  fieldPath = null,
  message,
  relatedIds = [],
}) {
  return {
    severity,
    code,
    dataset,
    file,
    record_id: recordId,
    field_path: fieldPath,
    message,
    related_ids: [...relatedIds],
  };
}

import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDailyRadarModel } from "./daily-radar.mjs";

const ARCHIVE_ROOT = resolve(fileURLToPath(new URL("../src/data/arxiv-archives", import.meta.url)));
const DEFAULT_WEEKLY_PATH = resolve(
  fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url))
);
const DEFAULT_RADAR_PATH = resolve(
  fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url))
);

export async function runDiagnostic({ archiveRoot = ARCHIVE_ROOT, strict = false } = {}) {
  const dailyDir = join(archiveRoot, "daily");
  const weeklyDir = join(archiveRoot, "weekly");
  const files = (await readdir(dailyDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();

  console.log(`[Diagnostic] Scanning ${files.length} daily archives in ${dailyDir}...`);

  let totalEntries = 0;
  let totalMustRead = 0;
  let totalWorthKnowing = 0;
  let totalSkip = 0;
  let totalPending = 0;
  let totalCoverageInsufficient = 0;
  const issues = [];

  for (const file of files) {
    const date = file.replace(".json", "");
    const raw = await readFile(join(dailyDir, file), "utf8");
    const data = JSON.parse(raw);
    const feed = data.feed;
    const radar = data.radar || { analyses: [] };

    const model = buildDailyRadarModel(feed, radar);
    const mr = model.groups.must_read.length;
    const wk = model.groups.worth_knowing.length;
    const sk = model.groups.skip.length;
    const pending = (model.pending || []).length;

    totalEntries += feed.entries?.length || 0;
    totalMustRead += mr;
    totalWorthKnowing += wk;
    totalSkip += sk;
    totalPending += pending;

    const coverageInsufficient = (model.pending || []).filter(
      (item) =>
        item.pending_reason === "coverage_insufficient_must_read" ||
        item.pending_reason === "coverage_insufficient_worth_knowing"
    );

    if (coverageInsufficient.length > 0) {
      totalCoverageInsufficient += coverageInsufficient.length;
      issues.push({
        date,
        type: "coverage_insufficient",
        count: coverageInsufficient.length,
        papers: coverageInsufficient.map((p) => `${p.arxiv_id} (${p.pending_reason})`),
      });
    }

    const flag =
      coverageInsufficient.length > 0
        ? "❌ COVERAGE_INSUFFICIENT"
        : pending > 0
          ? "⚠️ pending"
          : "✅ healthy";
    console.log(
      `  ${date}: MR=${mr.toString().padStart(2)} | WK=${wk.toString().padStart(2)} | Skim=${sk.toString().padStart(2)} | Pending=${pending.toString().padStart(2)}  [${flag}]`
    );
  }

  // Scan weekly archives
  let weeklyFiles = [];
  try {
    weeklyFiles = (await readdir(weeklyDir)).filter((f) => /^\d{4}-W\d{2}\.json$/.test(f)).sort();
  } catch {}

  console.log(`\n[Diagnostic] Scanning ${weeklyFiles.length} weekly archives in ${weeklyDir}...`);
  for (const wFile of weeklyFiles) {
    const raw = await readFile(join(weeklyDir, wFile), "utf8");
    const weekData = JSON.parse(raw);
    const topPicks = weekData.top_picks?.length || 0;
    const highlights = weekData.thematic_highlights?.length || 0;
    const totalPapers = weekData.papers?.length || 0;
    console.log(
      `  ${wFile.replace(".json", "")}: Papers=${totalPapers} | TopPicks=${topPicks} | Highlights=${highlights}`
    );
  }

  // Run comprehensive consistency diagnostics across archives, active weekly, and daily radar
  const consistency = await validateArchiveAndWeeklyConsistency({
    archiveRoot,
    activeWeeklyPath: DEFAULT_WEEKLY_PATH,
    dailyRadarPath: DEFAULT_RADAR_PATH,
  });

  let weeklyMismatch = consistency.valid ? null : consistency.diagnostics.join("; ");

  console.log("\n=================== Diagnostic Summary ===================");
  console.log(`Total Editions: ${files.length}`);
  console.log(`Total Papers:   ${totalEntries}`);
  console.log(`Total Screened: MR=${totalMustRead}, WK=${totalWorthKnowing}, Skim=${totalSkip}`);
  console.log(`Total Pending:  ${totalPending}`);
  console.log(`Coverage Insufficient (Illegal Gatekeeper State): ${totalCoverageInsufficient}`);

  if (!consistency.valid) {
    console.warn(`\n❌ ARCHIVE_CONSISTENCY_FAILED:`);
    for (const diag of consistency.diagnostics) {
      console.warn(`  - ${diag}`);
    }
  } else {
    console.log("✅ Weekly active edition and archives passed consistency diagnostics.");
  }

  if (issues.length > 0) {
    console.warn(`\n⚠️ Found ${issues.length} dates with coverage_insufficient papers:`);
    for (const issue of issues) {
      console.warn(`  - ${issue.date}: ${issue.count} papers (${issue.papers.join(", ")})`);
    }
  } else {
    console.log("\n✅ ZERO coverage_insufficient gatekeeper issues detected across all archives!");
  }
  console.log("==========================================================\n");

  if (strict && (totalCoverageInsufficient > 0 || !consistency.valid)) {
    process.exit(1);
  }
  return {
    totalEntries,
    totalMustRead,
    totalWorthKnowing,
    totalSkip,
    totalPending,
    totalCoverageInsufficient,
    weeklyMismatch,
    consistency,
    issues,
  };
}

export async function validateArchiveAndWeeklyConsistency({
  archiveRoot = ARCHIVE_ROOT,
  activeWeeklyPath = DEFAULT_WEEKLY_PATH,
  dailyRadarPath = DEFAULT_RADAR_PATH,
  maxDailyFileSize = 1.5 * 1024 * 1024,
  maxRadarFileSize = 1.5 * 1024 * 1024,
  maxHistoricalAnalyses = 300,
} = {}) {
  const diagnostics = [];
  const dailyDir = join(archiveRoot, "daily");
  const weeklyDir = join(archiveRoot, "weekly");

  // 1. Daily archives hygiene & size budget
  let dailyFiles = [];
  try {
    dailyFiles = (await readdir(dailyDir))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
  } catch (err) {
    diagnostics.push(`ARCHIVE_DAILY_DIR_MISSING: ${err.message}`);
  }

  for (const file of dailyFiles) {
    const fullPath = join(dailyDir, file);
    try {
      const stats = await stat(fullPath);
      if (stats.size > maxDailyFileSize) {
        diagnostics.push(
          `ARCHIVE_DAILY_SIZE_EXCEEDED: ${file} is ${(stats.size / 1024).toFixed(0)}KB (budget ${(maxDailyFileSize / 1024).toFixed(0)}KB)`
        );
      }
      const raw = await readFile(fullPath, "utf8");
      const data = JSON.parse(raw);
      const hist = data?.radar?.historical_analyses;
      if (Array.isArray(hist) && hist.length > 0) {
        diagnostics.push(
          `ARCHIVE_HISTORICAL_ANALYSES_POLLUTED: ${file} contains ${hist.length} redundant historical records`
        );
      }
    } catch (err) {
      diagnostics.push(`ARCHIVE_DAILY_READ_ERROR: ${file}: ${err.message}`);
    }
  }

  // 2. Weekly archives & top picks referential integrity
  let weeklyFiles = [];
  try {
    weeklyFiles = (await readdir(weeklyDir)).filter((f) => /^\d{4}-W\d{2}\.json$/.test(f)).sort();
  } catch (err) {
    diagnostics.push(`ARCHIVE_WEEKLY_DIR_MISSING: ${err.message}`);
  }

  let latestArchiveData = null;
  let latestArchiveWeek = null;

  for (const wFile of weeklyFiles) {
    const fullPath = join(weeklyDir, wFile);
    try {
      const raw = await readFile(fullPath, "utf8");
      const weekData = JSON.parse(raw);
      const wid = wFile.replace(".json", "");
      if (weekData.week_id !== wid) {
        diagnostics.push(
          `WEEKLY_ID_MISMATCH: ${wFile} internal week_id "${weekData.week_id}" !== filename "${wid}"`
        );
      }
      const paperIds = new Set((weekData.papers || []).map((p) => p.arxiv_id).filter(Boolean));
      for (const pick of weekData.top_picks || []) {
        if (!pick?.arxiv_id) {
          diagnostics.push(`WEEKLY_TOP_PICK_INVALID: ${wFile} has top pick missing arxiv_id`);
        } else if (!paperIds.has(pick.arxiv_id)) {
          diagnostics.push(
            `WEEKLY_TOP_PICK_UNREFERENCED: ${wFile} top pick ${pick.arxiv_id} not in week's papers list`
          );
        }
      }
      latestArchiveData = weekData;
      latestArchiveWeek = wid;
    } catch (err) {
      diagnostics.push(`ARCHIVE_WEEKLY_READ_ERROR: ${wFile}: ${err.message}`);
    }
  }

  // 3. Active weekly alignment with latest archive
  let activeWeeklyData = null;
  try {
    const activeWeeklyRaw = await readFile(activeWeeklyPath, "utf8");
    activeWeeklyData = JSON.parse(activeWeeklyRaw);
    if (!latestArchiveWeek) {
      diagnostics.push(
        `WEEKLY_ARCHIVE_EMPTY: No weekly archives found to validate active weekly file`
      );
    } else if (activeWeeklyData.week_id !== latestArchiveWeek) {
      diagnostics.push(
        `WEEKLY_ARCHIVE_MISMATCH: Active weekly file (${activeWeeklyData.week_id}) does not match latest archive (${latestArchiveWeek})`
      );
    } else if (latestArchiveData) {
      const activePapers = activeWeeklyData.papers?.length || 0;
      const archivePapers = latestArchiveData.papers?.length || 0;
      if (activePapers !== archivePapers) {
        diagnostics.push(
          `WEEKLY_CONTENT_DIVERGED: Active weekly papers count (${activePapers}) !== archive papers count (${archivePapers})`
        );
      }
      const activePicks = (activeWeeklyData.top_picks || [])
        .map((p) => p.arxiv_id)
        .sort()
        .join(",");
      const archivePicks = (latestArchiveData.top_picks || [])
        .map((p) => p.arxiv_id)
        .sort()
        .join(",");
      if (activePicks !== archivePicks) {
        diagnostics.push(
          `WEEKLY_CONTENT_DIVERGED: Active weekly top_picks do not match archive top_picks`
        );
      }
    }
  } catch (err) {
    diagnostics.push(
      `WEEKLY_ACTIVE_READ_ERROR: Could not read active weekly file at ${activeWeeklyPath}: ${err.message}`
    );
  }

  // 4. Daily radar size & rolling window hygiene
  try {
    const radarStats = await stat(dailyRadarPath);
    if (radarStats.size > maxRadarFileSize) {
      diagnostics.push(
        `RADAR_SIZE_EXCEEDED: ${dailyRadarPath} is ${(radarStats.size / 1024).toFixed(0)}KB (budget ${(maxRadarFileSize / 1024).toFixed(0)}KB)`
      );
    }
    const radarRaw = await readFile(dailyRadarPath, "utf8");
    const radarData = JSON.parse(radarRaw);
    const radarHist = radarData.historical_analyses || [];
    if (radarHist.length > maxHistoricalAnalyses) {
      diagnostics.push(
        `RADAR_HISTORICAL_ANALYSES_OVERFLOW: daily-radar contains ${radarHist.length} historical records (max allowed: ${maxHistoricalAnalyses})`
      );
    }
  } catch (err) {
    diagnostics.push(`RADAR_READ_ERROR: ${dailyRadarPath}: ${err.message}`);
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
    dailyCount: dailyFiles.length,
    weeklyCount: weeklyFiles.length,
    latestArchiveWeek,
    activeWeek: activeWeeklyData?.week_id ?? null,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const strict = process.argv.includes("--strict");
  runDiagnostic({ strict }).catch((err) => {
    console.error("[Diagnostic] Error:", err);
    process.exit(1);
  });
}
