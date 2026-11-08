import test from "node:test";
import assert from "node:assert/strict";
import { loadCausalCatalog, CAUSAL_ANCHOR_RELATIONS } from "../src/domain/causal-graph-catalog.mjs";

test("causal-graph-catalog: loads all 41 works and exact stages", () => {
  const catalog = loadCausalCatalog();
  assert.equal(catalog.works.length, 41);
  assert.equal(catalog.total_stages, 276);
  assert.ok(catalog.hasStage("stage:arnett-radioactive-decay"));
});

test("causal-graph-catalog: validates correct causal anchor", () => {
  const catalog = loadCausalCatalog();
  const sample = catalog.getStage("stage:bromberg-head-propagation");
  assert.ok(sample);

  const res = catalog.validateAnchor({
    primary_axis: "dynamics",
    anchored_stages: [
      {
        stage_id: sample.id,
        work_slug: sample.work_slug,
        relation: "constrains",
        reason: "Validates jet head deceleration timescale",
      },
    ],
  });
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.data.review_state, "unreviewed_machine_inference");
});

test("causal-graph-catalog: catches hallucinated stage IDs and mismatched work_slug", () => {
  const catalog = loadCausalCatalog();
  const resBadId = catalog.validateAnchor({
    primary_axis: "dynamics",
    anchored_stages: [
      {
        stage_id: "stage:fake-non-existent-hallucination",
        work_slug: "bromberg-2011",
        relation: "supports",
        reason: "Fake reason test",
      },
    ],
  });
  assert.equal(resBadId.valid, false);
  assert.match(resBadId.errors[0], /not found in 41-work catalog/);

  const sample = catalog.getStage("stage:bromberg-head-propagation");
  const resBadWork = catalog.validateAnchor({
    primary_axis: "dynamics",
    anchored_stages: [
      {
        stage_id: sample.id,
        work_slug: "wrong-slug-not-bromberg",
        relation: "supports",
        reason: "Mismatched slug test",
      },
    ],
  });
  assert.equal(resBadWork.valid, false);
  assert.match(resBadWork.errors[0], /Mismatched work_slug/);
});
