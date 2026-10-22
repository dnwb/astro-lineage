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

test("2610.13062 single paper title does not get truncated inside parentheses", async () => {
  const data = JSON.parse(await readFile("src/data/arxiv-archives/daily/2026-10-11.json", "utf8"));
  const model = buildDailyRadarModel(data.feed, data.radar);
  const paper = model.groups.must_read.find((x) => x.arxiv_id === "2610.13062");

  const title = derivePaperTitleCandidate(paper);
  assert.doesNotMatch(
    title,
    /未发现针对侧向（edge-on$/u,
    "Title must not be cut off inside parentheses"
  );
  assert.doesNotMatch(title, /（[^）]*$/u, "Title must not have unclosed opening parenthesis");
  assert.doesNotMatch(title, /\([^)]*$/u, "Title must not have unclosed ASCII opening parenthesis");
  assert.match(title, /^\[2610\.13062\]/u, "Title should begin with [arxiv_id]");
  assert.match(title, /FRB/u, "Title should preserve physical acronym FRB");
});

test("2610.12356 single paper title does not get cut off inside probability parentheses", async () => {
  const data = JSON.parse(await readFile("src/data/arxiv-archives/daily/2026-10-08.json", "utf8"));
  const model = buildDailyRadarModel(data.feed, data.radar);
  const paper = model.groups.worth_knowing.find((x) => x.arxiv_id === "2610.12356");

  const title = derivePaperTitleCandidate(paper);
  assert.doesNotMatch(title, /（期望 1\.3 个$/u, "Title must not be cut off inside parentheses");
  assert.doesNotMatch(title, /（[^）]*$/u, "Title must not have unclosed opening parenthesis");
});

test("2610.13926 single paper title does not get cut off into standalone subordinate condition", async () => {
  const data = JSON.parse(await readFile("src/data/arxiv-archives/daily/2026-10-11.json", "utf8"));
  const model = buildDailyRadarModel(data.feed, data.radar);
  const paper = model.groups.worth_knowing.find((x) => x.arxiv_id === "2610.13926");

  const title = derivePaperTitleCandidate(paper);
  assert.doesNotMatch(title, /^1\.\s*/u, "Title must not start with bullet or list numbering");
  assert.doesNotMatch(
    title,
    /条件下$/u,
    "Title must not be a dangling conditional clause ending with 条件下"
  );
  assert.doesNotMatch(
    title,
    /零温非旋转（T=0）条件下$/u,
    "Title must not be truncated to the leading condition"
  );
  assert.match(title, /^\[2610\.13926\]/u, "Title should begin with [arxiv_id]");
  assert.match(title, /中子星/u, "Title should preserve astrophysics subject");
  assert.ok(Array.from(title).length <= 35, "Title must fit within 35 characters");
});

test("2610.00459 single paper title does not split on thousands separator comma", async () => {
  const data = JSON.parse(await readFile("src/data/arxiv-archives/daily/2026-10-01.json", "utf8"));
  const model = buildDailyRadarModel(data.feed, data.radar);
  const paper = model.groups.worth_knowing.find((x) => x.arxiv_id === "2610.00459");

  const title = derivePaperTitleCandidate(paper);
  assert.doesNotMatch(title, /^374个源/u, "Title must not split 11,374 across thousands comma");
  assert.doesNotMatch(
    title,
    /五折交叉验证中$/u,
    "Title must not be a dangling subordinate clause ending with 中"
  );
  assert.ok(Array.from(title).length <= 35, "Title must fit within 35 characters");
});
