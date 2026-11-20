import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
  process.loadEnvFile();
}

import {
  formatCausalContext,
  loadCausalCatalog,
  selectRelevantCausalWorks,
} from "../src/domain/causal-graph-catalog.mjs";
import { callChatCompletion } from "./agent-core.mjs";
import { triageBatch } from "./arxiv-triage.mjs";

const DEFAULT_FIXTURE = resolve("tests/fixtures/causal-eval-set.json");

/**
 * Computes screening accuracy metrics and A/B gate verdict from two triage result maps.
 */
export function evaluateArms(items, promptOnlyResults, causalResults, options = {}) {
  const modelStats = options.modelStats || null;
  const scoreArm = (results) => {
    let posTotal = 0;
    let posMustRead = 0;
    let posSelected = 0;
    let negTotal = 0;
    let negFpSelected = 0;
    let negFpMustRead = 0;
    let errors = 0;

    for (const item of items) {
      const res = results.get(item.arxiv_id);
      const hasError = !res || Boolean(res.error) || !res.priority;
      if (hasError) errors += 1;
      const priority = hasError ? null : res.priority;

      if (item.expected_group === "positive") {
        posTotal += 1;
        if (priority === "must_read") posMustRead += 1;
        if (priority === "must_read" || priority === "worth_knowing") posSelected += 1;
      } else {
        negTotal += 1;
        if (priority === "must_read") negFpMustRead += 1;
        if (priority === "must_read" || priority === "worth_knowing") negFpSelected += 1;
      }
    }

    return {
      posTotal,
      posMustRead,
      posSelected,
      posMustReadRecall: posTotal ? posMustRead / posTotal : 0,
      posSelectedRecall: posTotal ? posSelected / posTotal : 0,
      negTotal,
      negFpSelected,
      negFpMustRead,
      negFpRate: negTotal ? negFpSelected / negTotal : 0,
      negMustReadFpRate: negTotal ? negFpMustRead / negTotal : 0,
      errors,
    };
  };

  const armA = scoreArm(promptOnlyResults);
  const armB = scoreArm(causalResults);

  const diffs = [];
  for (const item of items) {
    const resA = promptOnlyResults.get(item.arxiv_id);
    const resB = causalResults.get(item.arxiv_id);
    const a = resA && !resA.error ? resA.priority || null : null;
    const b = resB && !resB.error ? resB.priority || null : null;
    if (a !== b) {
      diffs.push({
        arxiv_id: item.arxiv_id,
        expected_group: item.expected_group,
        source: item.source,
        prompt_only: a ?? "error",
        with_causal: b ?? "error",
        title: item.title,
      });
    }
  }

  const recallImproved =
    armB.posMustReadRecall > armA.posMustReadRecall ||
    armB.posSelectedRecall > armA.posSelectedRecall;
  const recallNotRegressed =
    armB.posMustReadRecall >= armA.posMustReadRecall &&
    armB.posSelectedRecall >= armA.posSelectedRecall;
  const fpNotWorsened =
    armB.negFpRate <= armA.negFpRate && armB.negMustReadFpRate <= armA.negMustReadFpRate;

  const modelsConsistent =
    !modelStats ||
    !modelStats.armA ||
    !modelStats.armB ||
    (modelStats.armA.dominantModel === modelStats.armB.dominantModel &&
      modelStats.armA.models.size <= 1 &&
      modelStats.armB.models.size <= 1);

  const gatePassed =
    armA.errors === 0 &&
    armB.errors === 0 &&
    modelsConsistent &&
    recallImproved &&
    recallNotRegressed &&
    fpNotWorsened;

  return {
    armA,
    armB,
    diffs,
    modelsConsistent,
    gatePassed,
  };
}

/**
 * Builds a Leave-One-Out safe causal context builder for benchmark evaluation.
 */
export function createLooCausalContextBuilder(items, catalog) {
  const excludeById = new Map(items.map((item) => [item.arxiv_id, item.exclude_work_slug || null]));
  return (entry) => {
    const excludeSlug = excludeById.get(entry.arxiv_id);
    const filteredCatalog = excludeSlug
      ? { ...catalog, works: catalog.works.filter((w) => w.slug !== excludeSlug) }
      : catalog;
    return formatCausalContext(selectRelevantCausalWorks(entry, filteredCatalog, { maxWorks: 5 }));
  };
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function runCli(argv = process.argv.slice(2)) {
  const dryRun = argv.includes("--dry-run");
  const strictModel = !argv.includes("--allow-fallback");
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : null;
  const fixtureIdx = argv.indexOf("--fixture");
  const fixturePath = fixtureIdx >= 0 ? resolve(argv[fixtureIdx + 1]) : DEFAULT_FIXTURE;

  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  const items = limit && Number.isFinite(limit) ? raw.items.slice(0, limit) : raw.items;
  const catalog = loadCausalCatalog();

  console.log(`[Causal Eval] Loaded ${items.length} items from ${fixturePath}`);
  if (dryRun) {
    const ctxFn = createLooCausalContextBuilder(items, catalog);
    for (const item of items) {
      const ctx = ctxFn(item);
      console.log(
        `  - ${item.arxiv_id} (${item.expected_group}, LOO=${item.exclude_work_slug || "none"}): context=${ctx.length} chars`
      );
    }
    console.log("[Causal Eval] Dry-run complete.");
    return;
  }

  const armAModels = new Map();
  const armBModels = new Map();

  const createModelCaller = (modelsTracker) => {
    return async ({ prompt, systemPrompt }) => {
      return await callChatCompletion({
        prompt,
        systemPrompt,
        model: process.env.AI_MODEL_TRIAGE || process.env.AI_MODEL || "agy/gemini-3.8-flash-medium",
        fallbackModels: strictModel ? [] : undefined,
        onAttemptSuccess: ({ model, provider }) => {
          const key = `${model} (${provider})`;
          modelsTracker.set(key, (modelsTracker.get(key) || 0) + 1);
        },
      });
    };
  };

  console.log("[Causal Eval] Running Arm A (Prompt-only)...");
  const armAResults = await triageBatch(items, {
    modelCall: createModelCaller(armAModels),
    batchSize: 4,
    concurrency: 3,
    causalContextFor: null,
  });

  console.log("[Causal Eval] Running Arm B (Prompt + Top-5 LOO Causal Context)...");
  const armBResults = await triageBatch(items, {
    modelCall: createModelCaller(armBModels),
    batchSize: 4,
    concurrency: 3,
    causalContextFor: createLooCausalContextBuilder(items, catalog),
  });

  const summarizeModelStats = (tracker) => {
    const models = new Set([...tracker.keys()].map((k) => k.split(" ")[0]));
    let maxCount = -1;
    let dominantModel = null;
    for (const [k, count] of tracker) {
      if (count > maxCount) {
        maxCount = count;
        dominantModel = k.split(" ")[0];
      }
    }
    return { models, dominantModel, counts: Object.fromEntries(tracker) };
  };

  const modelStats = {
    armA: summarizeModelStats(armAModels),
    armB: summarizeModelStats(armBModels),
  };

  const report = evaluateArms(items, armAResults, armBResults, { modelStats });

  console.log("\n=== A/B Screening Evaluation Report ===");
  console.log(
    `Arm A (Prompt-only): pos_must_read=${report.armA.posMustRead}/${report.armA.posTotal} (${formatPct(report.armA.posMustReadRecall)}), pos_selected=${report.armA.posSelected}/${report.armA.posTotal} (${formatPct(report.armA.posSelectedRecall)}), neg_fp=${report.armA.negFpSelected}/${report.armA.negTotal} (${formatPct(report.armA.negFpRate)}), neg_must_read_fp=${report.armA.negFpMustRead}/${report.armA.negTotal}`
  );
  console.log(`  Models: ${JSON.stringify(modelStats.armA.counts)}`);
  console.log(
    `Arm B (+Causal LOO): pos_must_read=${report.armB.posMustRead}/${report.armB.posTotal} (${formatPct(report.armB.posMustReadRecall)}), pos_selected=${report.armB.posSelected}/${report.armB.posTotal} (${formatPct(report.armB.posSelectedRecall)}), neg_fp=${report.armB.negFpSelected}/${report.armB.negTotal} (${formatPct(report.armB.negFpRate)}), neg_must_read_fp=${report.armB.negFpMustRead}/${report.armB.negTotal}`
  );
  console.log(`  Models: ${JSON.stringify(modelStats.armB.counts)}`);
  console.log(`Disagreements: ${report.diffs.length}`);
  for (const d of report.diffs) {
    console.log(
      `  * [${d.expected_group}] ${d.arxiv_id} (${d.source}): ${d.prompt_only} -> ${d.with_causal} | ${d.title.slice(0, 70)}`
    );
  }
  const hasErrors = report.armA.errors > 0 || report.armB.errors > 0;
  const inconsistent = !report.modelsConsistent;
  let verdictText;
  if (hasErrors) {
    verdictText = `INCONCLUSIVE (API errors: Arm A=${report.armA.errors}, Arm B=${report.armB.errors})`;
  } else if (inconsistent) {
    verdictText = `INCONCLUSIVE (Model disparity detected between arms: Arm A dominant=${modelStats.armA.dominantModel}, Arm B dominant=${modelStats.armB.dominantModel})`;
  } else if (report.gatePassed) {
    verdictText = "PASS (causal context improves recall without FP regression)";
  } else {
    verdictText =
      "FAIL (do not keep causal context in Stage 1 triage; demote to Stage 2 post-hoc tagging)";
  }
  console.log(`\nGate Verdict: ${verdictText}`);
}

const isDirectMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isDirectMain) {
  runCli().catch((err) => {
    console.error("[Causal Eval] Error:", err.message);
    process.exit(1);
  });
}
