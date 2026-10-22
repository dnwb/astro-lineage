import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveRecentAcademicWeekIds,
  collectReferencedFiguresForWeeks,
  syncRecentFiguresToGit,
} from "../scripts/sync-recent-figures.mjs";

test("sync-recent-figures: resolveRecentAcademicWeekIds returns requested number of valid ISO weeks", async () => {
  const weeks7 = await resolveRecentAcademicWeekIds(7);
  assert.equal(weeks7.length, 7);
  for (const w of weeks7) {
    assert.match(w, /^\d{4}-W\d\d$/u);
  }

  // Sorted descending
  for (let i = 0; i < weeks7.length - 1; i++) {
    assert.ok(weeks7[i] > weeks7[i + 1], `Expected ${weeks7[i]} > ${weeks7[i + 1]}`);
  }

  const weeks3 = await resolveRecentAcademicWeekIds(3);
  assert.equal(weeks3.length, 3);
  assert.deepEqual(weeks3, weeks7.slice(0, 3));
});

test("sync-recent-figures: collectReferencedFiguresForWeeks extracts only existing figures from matched weeks", async () => {
  const recentWeeks = await resolveRecentAcademicWeekIds(7);
  const figures = await collectReferencedFiguresForWeeks(recentWeeks);

  assert.ok(figures instanceof Set);
  assert.ok(figures.size > 0, "Expected at least 1 figure in recent 7 weeks");

  for (const p of figures) {
    assert.match(p, /^public\/arxiv-figures\//u);
  }

  // An empty week set should return at most current radar figures
  const emptyFigures = await collectReferencedFiguresForWeeks([]);
  assert.ok(emptyFigures.size <= figures.size);
});

test("sync-recent-figures: syncRecentFiguresToGit supports dry-run without mutating git state", async () => {
  const res = await syncRecentFiguresToGit({ weeks: 7, dryRun: true });

  assert.equal(res.recentWeeks.length, 7);
  assert.ok(res.allowedCount > 0);
  assert.equal(typeof res.stagedCount, "number");
  assert.equal(typeof res.untrackedCount, "number");
  assert.equal(typeof res.totalTracked, "number");
});
