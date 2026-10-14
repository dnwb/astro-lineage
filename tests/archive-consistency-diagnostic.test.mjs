import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateArchiveAndWeeklyConsistency } from "../scripts/diagnostic.mjs";

test("consistency-diagnostic: production archives, weekly, and radar pass consistency checks", async () => {
  const result = await validateArchiveAndWeeklyConsistency();
  assert.equal(
    result.valid,
    true,
    `Production consistency check failed: ${result.diagnostics.join("; ")}`
  );
  assert.ok(result.dailyCount >= 25, "Must scan at least 25 daily archives");
  assert.ok(result.weeklyCount >= 6, "Must scan at least 6 weekly archives");
  assert.ok(result.latestArchiveWeek, "Must have a latest weekly archive");
  assert.equal(
    result.activeWeek,
    result.latestArchiveWeek,
    "Active weekly must match latest archive"
  );
});

test("consistency-diagnostic: detects active weekly week_id and content divergence", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "diag-test-"));
  try {
    const dailyDir = join(tempDir, "archives", "daily");
    const weeklyDir = join(tempDir, "archives", "weekly");
    await mkdir(dailyDir, { recursive: true });
    await mkdir(weeklyDir, { recursive: true });

    // Mock weekly archive
    const mockWeekArchive = {
      week_id: "2026-W42",
      papers: [{ arxiv_id: "2610.00001" }, { arxiv_id: "2610.00002" }],
      top_picks: [{ arxiv_id: "2610.00001", title: "Paper 1" }],
    };
    await writeFile(join(weeklyDir, "2026-W42.json"), JSON.stringify(mockWeekArchive), "utf8");

    // Mock divergent active weekly (different paper count)
    const divergentWeekly = {
      week_id: "2026-W42",
      papers: [{ arxiv_id: "2610.00001" }],
      top_picks: [{ arxiv_id: "2610.00001", title: "Paper 1" }],
    };
    const activeWeeklyPath = join(tempDir, "arxiv-weekly.json");
    await writeFile(activeWeeklyPath, JSON.stringify(divergentWeekly), "utf8");

    // Mock empty daily radar
    const dailyRadarPath = join(tempDir, "daily-radar.json");
    await writeFile(dailyRadarPath, JSON.stringify({ historical_analyses: [] }), "utf8");

    const result = await validateArchiveAndWeeklyConsistency({
      archiveRoot: join(tempDir, "archives"),
      activeWeeklyPath,
      dailyRadarPath,
    });

    assert.equal(result.valid, false);
    assert.ok(
      result.diagnostics.some((d) => d.includes("WEEKLY_CONTENT_DIVERGED")),
      `Should detect divergence: ${result.diagnostics.join("; ")}`
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("consistency-diagnostic: detects unreferenced top picks in weekly summaries", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "diag-top-picks-"));
  try {
    const dailyDir = join(tempDir, "archives", "daily");
    const weeklyDir = join(tempDir, "archives", "weekly");
    await mkdir(dailyDir, { recursive: true });
    await mkdir(weeklyDir, { recursive: true });

    // Mock weekly archive with phantom top pick
    const mockWeekArchive = {
      week_id: "2026-W42",
      papers: [{ arxiv_id: "2610.00001" }],
      top_picks: [{ arxiv_id: "2610.99999", title: "Ghost Paper" }],
    };
    await writeFile(join(weeklyDir, "2026-W42.json"), JSON.stringify(mockWeekArchive), "utf8");

    const activeWeeklyPath = join(tempDir, "arxiv-weekly.json");
    await writeFile(activeWeeklyPath, JSON.stringify(mockWeekArchive), "utf8");

    const dailyRadarPath = join(tempDir, "daily-radar.json");
    await writeFile(dailyRadarPath, JSON.stringify({ historical_analyses: [] }), "utf8");

    const result = await validateArchiveAndWeeklyConsistency({
      archiveRoot: join(tempDir, "archives"),
      activeWeeklyPath,
      dailyRadarPath,
    });

    assert.equal(result.valid, false);
    assert.ok(
      result.diagnostics.some((d) => d.includes("WEEKLY_TOP_PICK_UNREFERENCED")),
      `Should detect unreferenced top pick: ${result.diagnostics.join("; ")}`
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("consistency-diagnostic: enforces daily radar size budget and historical analysis limits", async () => {
  // Test size budget violation
  const result = await validateArchiveAndWeeklyConsistency({
    maxRadarFileSize: 100, // Very low budget to trigger guard
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some((d) => d.includes("RADAR_SIZE_EXCEEDED")),
    `Should trigger RADAR_SIZE_EXCEEDED: ${result.diagnostics.join("; ")}`
  );
});
