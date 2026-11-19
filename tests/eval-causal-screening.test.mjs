import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadCausalCatalog } from "../src/domain/causal-graph-catalog.mjs";
import { triageBatch } from "../scripts/arxiv-triage.mjs";
import {
  createLooCausalContextBuilder,
  evaluateArms,
} from "../scripts/eval-causal-screening-cli.mjs";

test("evaluateArms passes only when recall improves without false-positive regression", () => {
  const items = [
    { arxiv_id: "p1", expected_group: "positive", source: "s1", title: "Pos 1" },
    { arxiv_id: "p2", expected_group: "positive", source: "s2", title: "Pos 2" },
    { arxiv_id: "n1", expected_group: "negative", source: "n1", title: "Neg 1" },
  ];

  const armA = new Map([
    ["p1", { priority: "must_read" }],
    ["p2", { priority: "skip" }],
    ["n1", { priority: "skip" }],
  ]);
  const armBImproved = new Map([
    ["p1", { priority: "must_read" }],
    ["p2", { priority: "worth_knowing" }],
    ["n1", { priority: "skip" }],
  ]);
  const armBFpRegressed = new Map([
    ["p1", { priority: "must_read" }],
    ["p2", { priority: "worth_knowing" }],
    ["n1", { priority: "worth_knowing" }],
  ]);

  const passReport = evaluateArms(items, armA, armBImproved);
  assert.equal(passReport.gatePassed, true);
  assert.equal(passReport.diffs.length, 1);

  const failReport = evaluateArms(items, armA, armBFpRegressed);
  assert.equal(failReport.gatePassed, false);
  assert.equal(failReport.armB.negFpSelected, 1);

  const errorReport = evaluateArms(
    items,
    new Map([
      ["p1", { error: new Error("503") }],
      ["p2", { priority: "skip" }],
      ["n1", { priority: "skip" }],
    ]),
    armBImproved
  );
  assert.equal(errorReport.gatePassed, false);
  assert.equal(errorReport.armA.errors, 1);
});

test("createLooCausalContextBuilder excludes self work_slug for LOO canonical items", () => {
  const catalog = loadCausalCatalog();
  const fixture = JSON.parse(readFileSync(resolve("tests/fixtures/causal-eval-set.json"), "utf8"));
  assert.ok(fixture.items.some((i) => i.expected_group === "positive"));
  assert.ok(fixture.items.some((i) => i.expected_group === "negative"));

  const looItem = fixture.items.find((i) => i.exclude_work_slug);
  assert.ok(looItem, "fixture should contain at least one LOO canonical item");

  const ctxFn = createLooCausalContextBuilder(fixture.items, catalog);
  const ctx = ctxFn(looItem);
  assert.ok(ctx.length > 0, "LOO item should still match neighbor works");
  assert.equal(
    ctx.includes(`(${looItem.exclude_work_slug})`),
    false,
    `LOO context must not leak excluded work ${looItem.exclude_work_slug}`
  );
});

test("triageBatch injects causalContextFor into batch prompt when batchSize > 1", async () => {
  const capturedPrompts = [];
  const entries = [
    {
      arxiv_id: "2611.00001",
      revision: 1,
      title: "Magnetar-powered supernova light curves",
      abstract: "We study magnetar spin-down energy injection into supernova ejecta.",
      categories: ["astro-ph.HE"],
    },
    {
      arxiv_id: "2611.00002",
      revision: 1,
      title: "Fast radio burst dispersion measure evolution",
      abstract: "We analyze DM variations in a repeating fast radio burst source.",
      categories: ["astro-ph.HE"],
    },
  ];

  const results = await triageBatch(entries, {
    batchSize: 4,
    causalContextFor: (entry) => `CAUSAL_MARKER_${entry.arxiv_id}`,
    modelCall: async ({ prompt }) => {
      capturedPrompts.push(prompt);
      return JSON.stringify(
        entries.map((e) => ({
          arxiv_id: e.arxiv_id,
          priority: "worth_knowing",
          reason: "Relevant high-energy transient study.",
          quote: e.abstract.slice(0, 30),
        }))
      );
    },
  });

  assert.equal(capturedPrompts.length, 1);
  assert.ok(capturedPrompts[0].includes("CAUSAL_MARKER_2611.00001"));
  assert.ok(capturedPrompts[0].includes("CAUSAL_MARKER_2611.00002"));
  assert.equal(results.get("2611.00001")?.priority, "worth_knowing");
  assert.equal(results.get("2611.00002")?.priority, "worth_knowing");
});
