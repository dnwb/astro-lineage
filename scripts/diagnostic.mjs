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

import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDailyRadarModel } from "./daily-radar.mjs";

const ARCHIVE_ROOT = resolve(fileURLToPath(new URL("../src/data/arxiv-archives", import.meta.url)));
const DEFAULT_WEEKLY_PATH = resolve(
  fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url))
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

  let weeklyMismatch = null;
  if (weeklyFiles.length > 0) {
    const latestArchiveWeek = weeklyFiles[weeklyFiles.length - 1].replace(".json", "");
    try {
      const activeWeeklyRaw = await readFile(DEFAULT_WEEKLY_PATH, "utf8");
      const activeWeekly = JSON.parse(activeWeeklyRaw);
      if (activeWeekly.week_id !== latestArchiveWeek) {
        weeklyMismatch = `Active weekly file (${activeWeekly.week_id}) does not match latest archive (${latestArchiveWeek})`;
      }
    } catch (err) {
      weeklyMismatch = `Could not read active weekly file: ${err.message}`;
    }
  }

  console.log("\n=================== Diagnostic Summary ===================");
  console.log(`Total Editions: ${files.length}`);
  console.log(`Total Papers:   ${totalEntries}`);
  console.log(`Total Screened: MR=${totalMustRead}, WK=${totalWorthKnowing}, Skim=${totalSkip}`);
  console.log(`Total Pending:  ${totalPending}`);
  console.log(`Coverage Insufficient (Illegal Gatekeeper State): ${totalCoverageInsufficient}`);

  if (weeklyMismatch) {
    console.warn(`\n❌ WEEKLY_ARCHIVE_MISMATCH: ${weeklyMismatch}`);
  } else {
    console.log("✅ Weekly active edition aligned with latest archive.");
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

  if (strict && (totalCoverageInsufficient > 0 || weeklyMismatch)) {
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
    issues,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const strict = process.argv.includes("--strict");
  runDiagnostic({ strict }).catch((err) => {
    console.error("[Diagnostic] Error:", err);
    process.exit(1);
  });
}
