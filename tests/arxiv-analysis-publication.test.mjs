import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishAnalyzedArxivEdition, readPublishedArxivEdition, refreshArxivFeed, readArxivRunState } from "../scripts/arxiv-daily.mjs";

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "arxiv-analysis-publish-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { output: join(dir, "feed.json"), radarOutput: join(dir, "radar.json"), artifactRoot: join(dir, "cache") };
  const entry = { arxiv_id: "2609.00001", revision: 1, title: "Synthetic publication fixture", abstract: "Not a scientific claim", authors: ["Fixture"], published: "2026-09-07T12:00:00Z", updated: "2026-09-07T12:00:00Z", url: "https://arxiv.org/abs/2609.00001v1" };
  await refreshArxivFeed({ ...options, announcementDate: "2026-09-07", manualSnapshot: { entries: [entry] } });
  return options;
}

test("analysis publication creates a new generation and preserves immutable source/run state", async (t) => {
  const options = await setup(t);
  const before = await readPublishedArxivEdition(options);
  const marker = join(options.artifactRoot, before.pointer.generation_path, "generation.json");
  const bytes = await readFile(marker, "utf8");
  const state = await readArxivRunState(options);
  const radar = { ...before.radar, opening_brief: { status: "unavailable", reason: "Pending scientific reading" } };
  await publishAnalyzedArxivEdition({ ...options, expectedFeed: before.feed, expectedRadar: before.radar, radar });
  const after = await readPublishedArxivEdition(options);
  assert.notEqual(after.generation_id, before.generation_id);
  assert.deepEqual(after.feed, before.feed);
  assert.deepEqual(after.radar, radar);
  assert.equal(await readFile(marker, "utf8"), bytes);
  assert.deepEqual(await readArxivRunState(options), state);
  await assert.rejects(publishAnalyzedArxivEdition({ ...options, expectedFeed: before.feed, expectedRadar: before.radar, radar }), { code: "ARXIV_ANALYSIS_STALE" });
});

test("invalid analysis, active refresh lock and empty batch preserve last-good publication", async (t) => {
  const options = await setup(t);
  const before = await readPublishedArxivEdition(options);
  const pointer = join(options.artifactRoot, "current-generation.json");
  const bytes = await readFile(pointer, "utf8");
  const args = { ...options, expectedFeed: before.feed, expectedRadar: before.radar };
  await assert.rejects(publishAnalyzedArxivEdition({ ...args, radar: { analyses: null } }), { code: "ARXIV_RADAR_INVALID" });
  await assert.rejects(refreshArxivFeed({ ...options, announcementDate: "2026-09-08", manualSnapshot: { entries: [] }, rejectEmpty: true }), { code: "ARXIV_EMPTY_BATCH" });
  assert.equal(await readFile(pointer, "utf8"), bytes);
  await writeFile(`${options.output}.lock`, JSON.stringify({ pid: process.pid }));
  await assert.rejects(publishAnalyzedArxivEdition({ ...args, radar: before.radar }), { code: "ARXIV_REFRESH_IN_PROGRESS" });
  assert.equal(await readFile(pointer, "utf8"), bytes);
});

test("pointer-write failure and changed feed leave current edition intact", async (t) => {
  const options = await setup(t);
  const before = await readPublishedArxivEdition(options);
  const radar = { ...before.radar, opening_brief: { status: "unavailable", reason: "Awaiting reading" } };
  const args = { ...options, expectedFeed: before.feed, expectedRadar: before.radar, radar };
  await assert.rejects(publishAnalyzedArxivEdition({ ...args, renameImpl: async (from, to) => {
    if (to === join(options.artifactRoot, "current-generation.json")) throw new Error("Injected pointer failure");
    return rename(from, to);
  } }), /Injected pointer failure/);
  assert.equal((await readPublishedArxivEdition(options)).generation_id, before.generation_id);
  await assert.rejects(publishAnalyzedArxivEdition({ ...args, expectedFeed: { ...before.feed, generated_at: "changed" } }), { code: "ARXIV_ANALYSIS_STALE" });
  assert.deepEqual((await readPublishedArxivEdition(options)).radar, before.radar);
});
