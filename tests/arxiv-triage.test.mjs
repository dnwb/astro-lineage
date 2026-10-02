import test from "node:test";
import assert from "node:assert/strict";
import { deterministicTriageFilter } from "../scripts/arxiv-triage-filter.mjs";
import { buildTriagePrompt, buildBatchTriagePrompt, normalizeTriageOutput, triagePaper, triageBatch } from "../scripts/arxiv-triage.mjs";

test("deterministicTriageFilter filters obvious off-domain papers without HE category", () => {
  const exoplanetEntry = {
    arxiv_id: "2609.11111",
    revision: 1,
    title: "Atmospheric transmission spectra of hot Jupiter WASP-121b",
    categories: ["astro-ph.EP"],
    abstract: "We observe the transmission spectra of WASP-121b and detect water vapor absorption.",
  };

  const solarEntry = {
    arxiv_id: "2609.22222",
    revision: 1,
    title: "Helioseismology constraints on solar corona heating",
    categories: ["astro-ph.SR"],
    abstract: "We use SDO data to analyze solar corona oscillations and wave dissipation.",
  };

  const cosmologyEntry = {
    arxiv_id: "2609.33333",
    revision: 1,
    title: "Baryon acoustic oscillations from dark energy survey year 6",
    categories: ["astro-ph.CO"],
    abstract: "We measure the BAO peak scale using galaxy clustering data.",
  };

  const filteredExoplanet = deterministicTriageFilter(exoplanetEntry);
  assert.ok(filteredExoplanet);
  assert.equal(filteredExoplanet.priority, "skip");
  assert.equal(filteredExoplanet.filter_source, "deterministic_rule");
  assert.ok(filteredExoplanet.evidence[0].quote.length >= 15);
  assert.ok(exoplanetEntry.abstract.includes(filteredExoplanet.evidence[0].quote));

  const filteredSolar = deterministicTriageFilter(solarEntry);
  assert.ok(filteredSolar);
  assert.equal(filteredSolar.priority, "skip");

  const filteredCosmo = deterministicTriageFilter(cosmologyEntry);
  assert.ok(filteredCosmo);
  assert.equal(filteredCosmo.priority, "skip");
});

test("deterministicTriageFilter never filters papers with astro-ph.HE", () => {
  const transientEntry = {
    arxiv_id: "2609.44444",
    revision: 1,
    title: "Exoplanet-like periodic modulation in a magnetar candidate",
    categories: ["astro-ph.HE", "astro-ph.EP"],
    abstract: "We report periodic timing variations in a newly discovered magnetar.",
  };

  assert.equal(deterministicTriageFilter(transientEntry), null);
});

test("buildTriagePrompt builds asymmetric prompt with metadata and criteria", () => {
  const entry = {
    arxiv_id: "2609.55555",
    revision: 2,
    title: "Shock Breakout in Type II Supernovae",
    authors: ["Jane Doe", "John Smith"],
    primary_category: "astro-ph.HE",
    categories: ["astro-ph.HE", "astro-ph.SR"],
    abstract: "We simulate relativistic shock breakout through a dense circumstellar medium.",
  };

  const prompt = buildTriagePrompt(entry);
  assert.ok(prompt.includes("2609.55555"));
  assert.ok(prompt.includes("Shock Breakout"));
  assert.ok(prompt.includes("非对称返回规范"));
  assert.ok(prompt.includes("must_read"));
  assert.ok(prompt.includes("skip"));
});

test("normalizeTriageOutput populates defaults for compact skip responses", () => {
  const entry = {
    arxiv_id: "2609.66666",
    revision: 1,
    abstract: "A study of globular cluster chemical abundance.",
  };

  const rawSkip = {
    priority: "skip",
    reason: "球状星团化学丰度研究，与高能瞬变天体物理无实质联系。",
    evidence: [
      {
        section: "Abstract",
        quote: "A study of globular cluster chemical abundance.",
        supports: ["reason"],
      },
    ],
  };

  const normalized = normalizeTriageOutput(rawSkip, entry);
  assert.equal(normalized.priority, "skip");
  assert.equal(normalized.result, "unknown");
  assert.equal(normalized.problem, "unknown");
  assert.equal(normalized.method, "unknown");
  assert.deepEqual(normalized.assumptions, []);
  assert.deepEqual(normalized.limits, []);
  assert.deepEqual(normalized.inspected_sections, ["Abstract"]);
  assert.ok(normalized.evidence[0].supports.includes("reason"));
  assert.ok(normalized.evidence[0].supports.includes("result"));
});

test("triagePaper routes via deterministic filter or LLM call", async () => {
  const offDomain = {
    arxiv_id: "2609.77777",
    revision: 1,
    title: "Exoplanets atmospheric survey",
    categories: ["astro-ph.EP"],
    abstract: "Survey of exoplanets in the nearby solar neighborhood.",
  };

  let modelCalled = false;
  const decision1 = await triagePaper(offDomain, {
    modelCall: async () => {
      modelCalled = true;
      return "{}";
    },
  });

  assert.equal(decision1.priority, "skip");
  assert.equal(decision1.filter_source, "deterministic_rule");
  assert.equal(modelCalled, false);

  const coreDomain = {
    arxiv_id: "2609.88888",
    revision: 1,
    title: "Fast Radio Burst repeating source localized to a magnetar",
    categories: ["astro-ph.HE"],
    abstract: "We localize a new repeating FRB to an active magnetar.",
  };

  const decision2 = await triagePaper(coreDomain, {
    modelCall: async ({ stage, prompt }) => {
      assert.equal(stage, "abstract");
      assert.ok(prompt.includes("Fast Radio Burst"));
      return JSON.stringify({ priority: "must_read", reason: "FRB 关键发现" });
    },
  });

  assert.ok(decision2.includes("must_read"));
});

test("deterministicTriageFilter filters pure instrumentation papers without HE category", () => {
  const imEntry = {
    arxiv_id: "2609.99901",
    revision: 1,
    title: "Wavefront sensing and pointing accuracy calibration for adaptive optics",
    categories: ["astro-ph.IM"],
    abstract: "We evaluate the wavefront sensor pointing accuracy under dynamic atmospheric turbulence.",
  };

  const filtered = deterministicTriageFilter(imEntry);
  assert.ok(filtered);
  assert.equal(filtered.priority, "skip");
  assert.equal(filtered.filter_source, "deterministic_rule");
});

test("buildBatchTriagePrompt formats multi-paper indexed prompt with JSON array contract", () => {
  const entries = [
    { arxiv_id: "2609.00001", revision: 1, title: "Paper One", categories: ["astro-ph.HE"], abstract: "Abstract 1" },
    { arxiv_id: "2609.00002", revision: 1, title: "Paper Two", categories: ["astro-ph.HE"], abstract: "Abstract 2" },
  ];

  const prompt = buildBatchTriagePrompt(entries);
  assert.ok(prompt.includes("--- 论文 [1/2] ---"));
  assert.ok(prompt.includes("--- 论文 [2/2] ---"));
  assert.ok(prompt.includes("2609.00001"));
  assert.ok(prompt.includes("2609.00002"));
  assert.ok(prompt.includes("合法的 JSON 数组"));
});

test("triageBatch processes mixed entries with deterministic shortcuts and micro-batched model calls", async () => {
  const entries = [
    {
      arxiv_id: "2609.00011",
      revision: 1,
      title: "Atmospheric transmission of exoplanets",
      categories: ["astro-ph.EP"],
      abstract: "Transmission spectra analysis of a warm Neptune exoplanet atmosphere.",
    },
    {
      arxiv_id: "2609.00012",
      revision: 1,
      title: "Repeating Fast Radio Burst from a magnetar wind nebula",
      categories: ["astro-ph.HE"],
      abstract: "We report radio observations of a repeating Fast Radio Burst embedded in a magnetar nebula.",
    },
    {
      arxiv_id: "2609.00013",
      revision: 1,
      title: "Supernova Shock Breakout in dense circumstellar matter",
      categories: ["astro-ph.HE"],
      abstract: "Numerical simulations of shock breakout radiation in dense circumstellar matter.",
    },
  ];

  let batchModelCallCount = 0;
  const results = await triageBatch(entries, {
    batchSize: 2,
    concurrency: 2,
    modelCall: async ({ stage, prompt: _prompt }) => {
      assert.equal(stage, "abstract");
      batchModelCallCount++;
      return JSON.stringify([
        {
          arxiv_id: "2609.00012",
          priority: "must_read",
          reason: "FRB 磁星风云宿主环境重要突破",
          quote: "We report radio observations of a repeating Fast Radio Burst embedded in a magnetar nebula.",
        },
        {
          arxiv_id: "2609.00013",
          priority: "worth_knowing",
          reason: "激波破越数值模拟重要工作",
          quote: "Numerical simulations of shock breakout radiation in dense circumstellar matter.",
        },
      ]);
    },
  });

  // Paper 1 was filtered deterministically without calling LLM
  assert.equal(batchModelCallCount, 1);
  assert.equal(results.size, 3);

  const res1 = results.get("2609.00011");
  assert.equal(res1.priority, "skip");
  assert.equal(res1.filter_source, "deterministic_rule");

  const res2 = results.get("2609.00012");
  assert.equal(res2.priority, "must_read");
  assert.ok(res2.reason.includes("FRB"));
  assert.equal(res2.evidence[0].quote, "We report radio observations of a repeating Fast Radio Burst embedded in a magnetar nebula.");

  const res3 = results.get("2609.00013");
  assert.equal(res3.priority, "worth_knowing");
  assert.ok(res3.reason.includes("激波破越"));
});

