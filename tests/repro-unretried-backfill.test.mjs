import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";
import {
  runScheduledArxivRefresh,
  reconcilePreviousEdition,
  readLedger,
  assertContinuousBatchIntervals,
} from "../scripts/arxiv-daily-scheduler.mjs";
import { runAiAnalyzer } from "../scripts/arxiv-ai-analyzer.mjs";
import { sourceFingerprint } from "../scripts/daily-radar.mjs";

test("failed dates reconciled without valid data must remain retryable and not be marked successful", async (t) => {
  const { path: directory } = await createTemporaryWorkspace("astro-lineage-repro-", t);
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const archiveRoot = join(directory, "archives");

  // 1. Day 1: 2026-09-07 fails during refresh
  const day1Result = await runScheduledArxivRefresh({
    output,
    artifactRoot,
    archiveRoot,
    now: new Date("2026-09-08T01:00:00Z"), // through: 2026-09-07
    fromDate: "2026-09-07",
    maxBatchesPerRun: 1,
    refreshImpl: async () => {
      throw new Error("Temporary arXiv 429 error");
    },
  });

  assert.deepEqual(day1Result.failed_dates, ["2026-09-07"]);

  // 2. Reconcile runs for 2026-09-07, but upstream probe also fails
  await reconcilePreviousEdition({
    output,
    artifactRoot,
    archiveRoot,
    announcementDate: "2026-09-07",
    refreshImpl: async () => {
      throw new Error("Upstream probe failure");
    },
  });

  const ledgerAfterFail = JSON.parse(
    await readFile(join(artifactRoot, "scheduler-ledger.json"), "utf8")
  );

  assert.equal(
    ledgerAfterFail.successful_dates.includes("2026-09-07"),
    false,
    "failed date without valid feed must not be marked successful in ledger"
  );
  assert.equal(
    ledgerAfterFail.failed_dates.includes("2026-09-07"),
    true,
    "failed date must remain in failed_dates"
  );

  // 3. Reconcile runs with empty feed (entries: []) - must also remain failed
  await reconcilePreviousEdition({
    output,
    artifactRoot,
    archiveRoot,
    announcementDate: "2026-09-07",
    refreshImpl: async () => ({
      window: { announcement_date: "2026-09-07" },
      entries: [],
    }),
  });

  const ledgerAfterEmpty = JSON.parse(
    await readFile(join(artifactRoot, "scheduler-ledger.json"), "utf8")
  );

  assert.equal(
    ledgerAfterEmpty.successful_dates.includes("2026-09-07"),
    false,
    "empty feed during reconcile must not be marked successful"
  );
  assert.equal(
    ledgerAfterEmpty.failed_dates.includes("2026-09-07"),
    true,
    "empty feed must remain in failed_dates"
  );

  // 4. Day 2: Next run on 2026-09-08 must retry 2026-09-07
  let retriedDates = [];
  await runScheduledArxivRefresh({
    output,
    artifactRoot,
    archiveRoot,
    now: new Date("2026-09-09T01:00:00Z"), // through: 2026-09-08
    fromDate: "2026-09-07",
    maxBatchesPerRun: 5,
    refreshImpl: async (opts) => {
      retriedDates.push(opts.announcementDate);
      return {
        window: { announcement_date: opts.announcementDate },
        entries: [{ arxiv_id: "2609.00001", title: "Test Paper" }],
      };
    },
  });

  assert.ok(retriedDates.includes("2026-09-07"), "2026-09-07 must be retried on subsequent run");
});

test("reconcilePreviousEdition must not corrupt screening-queue with invalid completed items", async (t) => {
  const { path: directory } = await createTemporaryWorkspace("astro-lineage-repro-", t);
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const archiveRoot = join(directory, "archives");
  const queuePath = join(artifactRoot, "screening-queue.json");

  const testEntry = {
    id: "http://arxiv.org/abs/2610.20026v1",
    arxiv_id: "2610.20026",
    revision: 1,
    title: "Test Paper",
    abstract: "Abstract",
    authors: ["Author A"],
    categories: ["astro-ph.HE"],
    primary_category: "astro-ph.HE",
    published: "2026-10-14T00:00:00Z",
    updated: "2026-10-14T00:00:00Z",
  };
  const fp = sourceFingerprint(testEntry);
  const queueData = {
    schema_version: "arxiv-ai-screening-queue-v1",
    updated_at: new Date().toISOString(),
    items: [
      {
        key: `2610.20026@v1#${fp}`,
        entry: testEntry,
        source_fingerprint: fp,
        state: "complete", // Corrupted state: marked complete but analysis failed
        reading_status: "pending",
        attempts: 1,
        screening_attempts: 1,
        reading_attempts: 1,
        analysis: {
          arxiv_id: "2610.20026",
          revision: 1,
          source_fingerprint: fp,
          status: "failed",
          failure_reason: "API error HTTP 500",
          priority: "worth_knowing",
        },
      },
    ],
  };

  await mkdir(artifactRoot, { recursive: true });
  await writeFile(queuePath, JSON.stringify(queueData, null, 2));

  // Run reconcile
  await reconcilePreviousEdition({
    output,
    artifactRoot,
    archiveRoot,
    announcementDate: "2026-10-14",
    refreshImpl: async () => ({
      window: { announcement_date: "2026-10-14" },
      entries: [testEntry],
    }),
  });

  // Validating queue MUST NOT throw ARXIV_ANALYZER_STATE_INVALID; parseQueue must self-heal
  const radarPath = join(directory, "radar.json");
  await writeFile(
    output,
    JSON.stringify({
      window: { announcement_date: "2026-10-14" },
      entries: [testEntry],
    })
  );
  await writeFile(
    radarPath,
    JSON.stringify({
      window: { announcement_date: "2026-10-14" },
      analyses: [],
    })
  );
  await runAiAnalyzer({
    feed: output,
    radar: radarPath,
    artifactRoot,
    archiveRoot,
    modelRunner: async () => "{}",
  });
});

test("readLedger sanitizes successful_dates and finalized_dates against failed_dates", async (t) => {
  const { path: directory } = await createTemporaryWorkspace("astro-lineage-repro-", t);
  const artifactRoot = join(directory, "artifacts");
  await mkdir(artifactRoot, { recursive: true });

  const rawLedger = {
    schema_version: "arxiv-daily-scheduler-ledger-v1",
    scope: "cat:astro-ph.HE",
    start_date: "2026-09-07",
    successful_dates: ["2026-09-07", "2026-09-08"],
    finalized_dates: ["2026-09-07", "2026-09-08"],
    failed_dates: ["2026-09-07"],
    attempt_sequence: 2,
    date_attempts: {
      "2026-09-07": { attempts: 1, last_attempt_sequence: 1 },
      "2026-09-08": { attempts: 1, last_attempt_sequence: 2 },
    },
  };
  await writeFile(join(artifactRoot, "scheduler-ledger.json"), JSON.stringify(rawLedger, null, 2));

  const clean = await readLedger({
    artifactRoot,
    timeZone: "Asia/Shanghai",
    query: "cat:astro-ph.HE",
  });

  assert.equal(
    clean.successful_dates.includes("2026-09-07"),
    false,
    "failed date must be stripped from successful_dates"
  );
  assert.equal(
    clean.finalized_dates.includes("2026-09-07"),
    false,
    "failed date must be stripped from finalized_dates"
  );
  assert.equal(clean.successful_dates.includes("2026-09-08"), true);
  assert.equal(clean.finalized_dates.includes("2026-09-08"), true);
  assert.deepEqual(clean.failed_dates, ["2026-09-07"]);
});

test("assertContinuousBatchIntervals detects discontinuities and rejects gaps", () => {
  const previousFeed = {
    window: {
      submitted_date_range: { from: "202610111800", to: "202610121800" },
    },
    entries: [{ arxiv_id: "2610.00001", published: "2026-10-12T00:00:00Z" }],
  };

  const gappedFeed = {
    window: {
      submitted_date_range: { from: "202610131800", to: "202610141800" },
    },
    entries: [{ arxiv_id: "2610.00002", published: "2026-10-14T00:00:00Z" }],
  };

  assert.throws(
    () => assertContinuousBatchIntervals(gappedFeed, previousFeed),
    /BATCH_TIME_GAP_DETECTED/
  );
});

test("reconcilePreviousEdition resolves previous scheduled date across weekend boundary", async (t) => {
  const { path: directory } = await createTemporaryWorkspace("astro-lineage-repro-", t);
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const archiveRoot = join(directory, "archives");
  const dailyArchiveDir = join(archiveRoot, "daily");

  await mkdir(dailyArchiveDir, { recursive: true });

  // Thursday 2026-10-15 archive
  const thursdayFeed = {
    window: {
      announcement_date: "2026-10-15",
      submitted_date_range: { from: "202610141800", to: "202610151800" },
    },
    entries: [{ arxiv_id: "2610.15001", published: "2026-10-15T00:00:00Z" }],
  };
  await writeFile(join(dailyArchiveDir, "2026-10-15.json"), JSON.stringify({ feed: thursdayFeed }));

  // Sunday 2026-10-18 continuous feed
  const sundayFeed = {
    window: {
      announcement_date: "2026-10-18",
      submitted_date_range: { from: "202610151800", to: "202610181800" },
    },
    entries: [{ arxiv_id: "2610.18001", published: "2026-10-18T00:00:00Z" }],
  };

  const result = await reconcilePreviousEdition({
    output,
    artifactRoot,
    archiveRoot,
    announcementDate: "2026-10-18",
    refreshImpl: async () => sundayFeed,
  });

  assert.equal(result.target_date, "2026-10-18");
  assert.equal(result.finalized, true);
});
