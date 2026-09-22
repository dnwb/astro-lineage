import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getIsoWeek, getWeekMondayAndSunday } from "../scripts/arxiv-archive.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const manifestUrl = new URL("../src/data/arxiv-archives/manifest.json", import.meta.url);
const distDailyHtmlUrl = new URL("../dist/arxiv-daily/index.html", import.meta.url);
const distWeeklyHtmlUrl = new URL("../dist/arxiv-weekly/index.html", import.meta.url);

test("ISO week and date range calculations conform to astronomical announcement standards", () => {
  assert.equal(getIsoWeek("2026-09-15"), "2026-W38");
  assert.equal(getIsoWeek("2026-09-16"), "2026-W38");
  assert.equal(getIsoWeek("2026-01-01"), "2026-W01");

  const range = getWeekMondayAndSunday("2026-W38");
  assert.equal(range.monday, "2026-09-14");
  assert.equal(range.sunday, "2026-09-20");
});

test("archive manifest conforms to schema and indexes daily editions grouped by week", async () => {
  const content = await readFile(manifestUrl, "utf8");
  const manifest = JSON.parse(content);

  assert.equal(manifest.schema_version, "astrolineage-arxiv-archive-manifest-v1");
  assert.ok(manifest.total_weeks >= 1, "must contain at least one week");
  assert.ok(manifest.total_daily_editions >= 2, "must contain at least two daily editions");
  assert.ok(manifest.weeks.length > 0, "weeks array must not be empty");

  // Verify weeks structure
  for (const week of manifest.weeks) {
    assert.ok(/^\d{4}-W\d{2}$/u.test(week.week_id), `week_id ${week.week_id} must match YYYY-Www`);
    assert.ok(typeof week.title === "string", "week title must be a string");
    assert.ok(Array.isArray(week.days) && week.days.length > 0, "week must have non-empty days list");

    for (const day of week.days) {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/u.test(day.date), `day date ${day.date} must match YYYY-MM-DD`);
      assert.equal(getIsoWeek(day.date), week.week_id, `day ${day.date} must belong to week ${week.week_id}`);
      assert.ok(typeof day.total_papers === "number" && day.total_papers > 0, "day total_papers must be positive");
      assert.ok(typeof day.analyzed_count === "number", "analyzed_count must be a number");
      assert.ok(existsSync(join(projectRoot, "src/data/arxiv-archives", day.data_file)), `data file ${day.data_file} must exist`);
    }
  }
});

test("every archived daily edition file contains valid feed and radar data", async () => {
  const content = await readFile(manifestUrl, "utf8");
  const manifest = JSON.parse(content);

  for (const week of manifest.weeks) {
    for (const day of week.days) {
      const filePath = join(projectRoot, "src/data/arxiv-archives", day.data_file);
      assert.ok(existsSync(filePath), `file ${filePath} must exist`);
      const dailyData = JSON.parse(await readFile(filePath, "utf8"));
      assert.equal(dailyData.schema_version, "astrolineage-daily-archive-v1");
      assert.equal(dailyData.date, day.date);
      assert.equal(dailyData.week_id, week.week_id);
      assert.ok(Array.isArray(dailyData.feed?.entries), "feed must contain entries");
      assert.ok(Array.isArray(dailyData.radar?.analyses), "radar must contain analyses");
    }
  }
});

test("arXiv daily HTML exposes weekly archive navigator and historical editions", async () => {
  if (existsSync(fileURLToPath(distDailyHtmlUrl))) {
    const html = await readFile(distDailyHtmlUrl, "utf8");
    assert.match(html, /历史日报归档 · 按周索引/u);
    assert.match(html, /2026-W38/u);
    assert.match(html, /2026-09-15/u);
    assert.match(html, /2026-09-16/u);
    assert.match(html, /#archive-2026-09-15/u);
  }
});

test("arXiv weekly HTML exposes daily breakdown section with links to daily editions", async () => {
  if (existsSync(fileURLToPath(distWeeklyHtmlUrl))) {
    const html = await readFile(distWeeklyHtmlUrl, "utf8");
    assert.match(html, /本周每日批次与日报归档/u);
    assert.match(html, /href="\/arxiv-daily\/"/u);
    const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), "utf8"));
    const currentWeek = manifest.weeks?.[0];
    if (currentWeek?.days?.length > 0) {
      assert.match(html, new RegExp(currentWeek.days[0].date, "u"));
    }
  }
});
