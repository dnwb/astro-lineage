import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getNaturalWeekBounds as getWeeklyNaturalWeekBounds } from "../scripts/arxiv-weekly-summary.mjs";
import { getAnnouncementWeekId } from "../scripts/arxiv-archive.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("Beijing academic week maps exactly 5 arXiv announcement batches (Sun-Thu ET -> Mon-Fri BJT)", () => {
  // For 2026-W41 (Beijing academic week: 2026-10-05 Mon through 2026-10-09 Fri):
  // Mon BJT (10-05) <- 2026-10-04 (Sun ET)
  // Tue BJT (10-06) <- 2026-10-05 (Mon ET)
  // Wed BJT (10-07) <- 2026-10-06 (Tue ET)
  // Thu BJT (10-08) <- 2026-10-07 (Wed ET)
  // Fri BJT (10-09) <- 2026-10-08 (Thu ET)
  const bounds = getWeeklyNaturalWeekBounds("2026-W41");
  assert.deepEqual(
    bounds.academicAnnouncementDates,
    ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"],
    "W41 academic announcement batches must exactly equal the 5 batches (Sun-Thu ET)"
  );
  assert.equal(
    bounds.announcementDates.length,
    7,
    "ISO announcementDates maintains length 7 for backwards compatibility"
  );
});

test("Announcement week ID correctly assigns Sunday ET batch to incoming week across all academic weeks", () => {
  assert.equal(
    getAnnouncementWeekId("2026-09-13", "Sun"),
    "2026-W38",
    "2026-09-13 Sun ET must map to W38 (Mon BJT 09-14)"
  );
  assert.equal(
    getAnnouncementWeekId("2026-09-27", "Sun"),
    "2026-W40",
    "2026-09-27 Sun ET must map to W40 (Mon BJT 09-28)"
  );
  assert.equal(
    getAnnouncementWeekId("2026-10-04", "Sun"),
    "2026-W41",
    "2026-10-04 Sun ET must map to W41 (Mon BJT 10-05)"
  );
  assert.equal(
    getAnnouncementWeekId("2026-10-08", "Thu"),
    "2026-W41",
    "2026-10-08 Thu ET must map to W41 (Fri BJT 10-09)"
  );
  assert.equal(
    getAnnouncementWeekId("2026-10-01", "Thu"),
    "2026-W40",
    "2026-10-01 Thu ET must map to W40 (Fri BJT 10-02)"
  );
});

test("Active weekly summary contains papers from Monday morning (Sunday ET batch 2026-10-04)", async () => {
  const weekly = JSON.parse(
    await readFile(resolve(projectRoot, "src/data/arxiv-weekly.json"), "utf8")
  );
  if (weekly.week_id === "2026-W41") {
    const dates = new Set((weekly.papers || []).map((p) => p.announcement_date));
    assert.ok(
      dates.has("2026-10-04"),
      "Active 2026-W41 weekly synthesis must include papers from Sunday ET (2026-10-04 / Mon BJT)"
    );
  }
});

test("Weekly archives and manifest have strictly disjoint batches across all historical weeks (no overlap)", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(projectRoot, "src/data/arxiv-archives/manifest.json"), "utf8")
  );
  const seenDates = new Map();
  for (const week of manifest.weeks) {
    for (const day of week.days) {
      assert.ok(
        !seenDates.has(day.date),
        `Date ${day.date} appears in both ${seenDates.get(day.date)} and ${week.week_id}`
      );
      seenDates.set(day.date, week.week_id);
    }
  }

  // Verify weekly archive files do not share announcement dates:
  const w38 = JSON.parse(
    await readFile(resolve(projectRoot, "src/data/arxiv-archives/weekly/2026-W38.json"), "utf8")
  );
  const w39 = JSON.parse(
    await readFile(resolve(projectRoot, "src/data/arxiv-archives/weekly/2026-W39.json"), "utf8")
  );
  const w38Dates = new Set(w38.papers.map((p) => p.announcement_date));
  const w39Dates = new Set(w39.papers.map((p) => p.announcement_date));
  for (const d of w38Dates) {
    assert.ok(
      !w39Dates.has(d),
      `Date ${d} is present in both 2026-W38 and 2026-W39 weekly summaries`
    );
  }
});
