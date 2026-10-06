import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readDailyEdition,
  commitDailyPaper,
  getDirtyWeeks,
  markWeekDirty,
  clearDirtyWeek,
  acquireLedgerLock,
  releaseLedgerLock,
  writeJsonAtomically
} from "../scripts/edition-ledger.mjs";

test("commitDailyPaper applies functional optimistic mutator under lock without lost updates", async () => {
  const testDir = await mkdtemp(join(tmpdir(), "axv-test-ledger-"));
  const radarPath = join(testDir, "daily-radar.json");

  try {
    const initialData = {
      version: 1,
      target_date: "2026-10-06",
      announcement_date: "2026-10-06",
      papers: [
        { arxiv_id: "2609.00001", title: "Paper 1", status: "pending" }
      ]
    };
    await writeFile(radarPath, JSON.stringify(initialData, null, 2), "utf8");

    // Two concurrent functional mutators
    const mutator1 = async () => {
      return await commitDailyPaper("2026-10-06", "2609.00001", (paper) => ({
        ...paper,
        status: "must_read",
        recommendation_reason: "High priority"
      }), { radarPath });
    };

    const mutator2 = async () => {
      return await commitDailyPaper("2026-10-06", "2609.00002", (paper) => ({
        arxiv_id: "2609.00002",
        title: "Paper 2",
        status: "worth_knowing"
      }), { radarPath });
    };

    const [res1, res2] = await Promise.all([mutator1(), mutator2()]);
    assert.equal(res1.success, true);
    assert.equal(res2.success, true);

    const saved = JSON.parse(await readFile(radarPath, "utf8"));
    assert.equal(saved.papers.length, 2);
    const p1 = saved.papers.find(p => p.arxiv_id === "2609.00001");
    const p2 = saved.papers.find(p => p.arxiv_id === "2609.00002");
    assert.equal(p1.status, "must_read");
    assert.equal(p1.recommendation_reason, "High priority");
    assert.equal(p2.status, "worth_knowing");
  } finally {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("markWeekDirty and clearDirtyWeek manage dirty weeks transactionally", async () => {
  const testDir = await mkdtemp(join(tmpdir(), "axv-test-dirty-"));
  const dirtyPath = join(testDir, "dirty-weeks.json");

  try {
    const initialWeeks = await getDirtyWeeks({ dirtyWeeksPath: dirtyPath });
    assert.deepEqual(initialWeeks, []);

    await markWeekDirty("2026-W39", { dirtyWeeksPath: dirtyPath });
    await markWeekDirty("2026-W40", { dirtyWeeksPath: dirtyPath });
    await markWeekDirty("2026-W39", { dirtyWeeksPath: dirtyPath }); // deduplicate

    const marked = await getDirtyWeeks({ dirtyWeeksPath: dirtyPath });
    assert.deepEqual(marked, ["2026-W39", "2026-W40"]);

    await clearDirtyWeek("2026-W39", { dirtyWeeksPath: dirtyPath });
    const remaining = await getDirtyWeeks({ dirtyWeeksPath: dirtyPath });
    assert.deepEqual(remaining, ["2026-W40"]);
  } finally {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("stale lock is detected and recovered automatically to avoid deadlocks", async () => {
  const testDir = await mkdtemp(join(tmpdir(), "axv-test-lock-"));
  const lockPath = join(testDir, "edition.lock");

  try {
    // Write an artificial stale lockfile (older than stale threshold)
    await writeFile(lockPath, JSON.stringify({ pid: 9999999, started_at: new Date(Date.now() - 600000).toISOString() }), "utf8");

    // Acquire lock should succeed by clearing stale lock
    await acquireLedgerLock(lockPath, { staleAfterMs: 5000, retryAttempts: 2 });
    // Release lock
    await releaseLedgerLock(lockPath);
    assert.ok(true, "Successfully recovered from stale lock");
  } finally {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  }
});
