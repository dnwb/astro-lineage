import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { buildDailyRadarModel } from "../scripts/daily-radar.mjs";
import { derivePaperTitleCandidate, cleanMathInTitle } from "../scripts/channel-title-policy.mjs";

test("2610.04282 title does not get truncated by thin space into dangling dollar sign", async () => {
  const data = JSON.parse(await readFile("src/data/arxiv-archives/daily/2026-10-05.json", "utf8"));
  const model = buildDailyRadarModel(data.feed, data.radar);
  const paper = model.groups.worth_knowing.find((x) => x.arxiv_id === "2610.04282");

  const title = derivePaperTitleCandidate(paper);
  // Current bug: produces "20% 模型在该质量下达到约 $88"
  assert.doesNotMatch(
    title,
    /\$\d+/u,
    "Title must not contain dangling unclosed dollar formula prefix"
  );
  assert.doesNotMatch(title, /\$/u, "Title must not contain unclosed dollar sign");
  assert.doesNotMatch(
    title,
    /达到约\s*\$88$/u,
    "Title must not cut off in the middle of a measurement"
  );
  assert.ok(Array.from(title).length <= 35, "Title must fit within 35 characters");
});

test("2610.07424 title does not get truncated into dangling dollar sign and raw LaTeX macros", async () => {
  const data = JSON.parse(await readFile("src/data/arxiv-archives/daily/2026-10-06.json", "utf8"));
  const model = buildDailyRadarModel(data.feed, data.radar);
  const paper = model.groups.worth_knowing.find((x) => x.arxiv_id === "2610.07424");

  const title = derivePaperTitleCandidate(paper);
  // Current bug: produces "σKrm sym 几乎保持在 $114"
  assert.doesNotMatch(title, /\$/u, "Title must not contain unclosed dollar sign");
  assert.doesNotMatch(title, /rm\s*sym/u, "Title must not contain unhandled \\rm macro fragment");
  assert.doesNotMatch(
    title,
    /保持在\s*\$114$/u,
    "Title must not cut off in the middle of a measurement"
  );
  assert.ok(Array.from(title).length <= 35, "Title must fit within 35 characters");
});

test("2610.05720 title does not crash with CHANNEL_TITLE_TOO_LONG", async () => {
  const data = JSON.parse(await readFile("src/data/arxiv-archives/daily/2026-10-05.json", "utf8"));
  const model = buildDailyRadarModel(data.feed, data.radar);
  const paper = model.groups.worth_knowing.find((x) => x.arxiv_id === "2610.05720");

  let title;
  assert.doesNotThrow(() => {
    title = derivePaperTitleCandidate(paper);
  }, "Must derive title without CHANNEL_TITLE_TOO_LONG exception");
  assert.ok(title);
  assert.ok(Array.from(title).length <= 35, "Title must fit within 35 characters");
});

test("cleanMathInTitle cleans complex LaTeX macros without leaving dangling words or dollar signs", () => {
  assert.equal(cleanMathInTitle("$\\mathrm{H}\\alpha$ 辐射"), "Hα 辐射");
  assert.equal(cleanMathInTitle("占比为 $\\gtrsim 95\\%$"), "占比为 ≳ 95%");
  assert.equal(cleanMathInTitle("$\\sigma_{K_{\\rm sym}}$"), "σK,sym");
  assert.equal(cleanMathInTitle("$88\\,\\mathrm{km}$"), "88 km");
});
