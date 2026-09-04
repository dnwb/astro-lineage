import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { AXIS_IDS, loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  evaluateActorCapability,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";

const productionContent = new URL("../content/", import.meta.url);

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket04-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  return { contentRoot };
}

async function readArnett(contentRoot) {
  const workRoot = join(contentRoot, "works", "work:arnett-1982");
  const files = {};
  for (const fileName of ["evidence.yaml", "annotations.yaml"]) {
    files[fileName] = parse(await readFile(join(workRoot, fileName), "utf8"));
  }
  return {
    workRoot,
    evidence: files["evidence.yaml"],
    annotations: files["annotations.yaml"],
  };
}

test("Ticket 04A production slice has governed actors, 16 assessments, evidence, and a method annotation", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === "work:arnett-1982");
  const agent = snapshot.actors.actors.find(({ id }) => id === "actor:agent-curator");

  assert.equal(result.valid, true);
  assert(agent);
  assert.equal(agent.kind, "agent");
  assert.deepEqual(
    [...new Set(agent.capability_events.map(({ capability }) => capability))],
    ["draft_records"],
  );
  assert.equal(work.files["statements.yaml"].statements.length, 0);
  assert.equal(work.files["physical-account.yaml"].stages.length, 0);
  assert.equal(work.files["physical-account.yaml"].links.length, 0);

  const annotations = work.files["annotations.yaml"].annotations;
  assert.equal(annotations.length, AXIS_IDS.length);
  assert.deepEqual(
    annotations.map(({ axis }) => axis).sort(),
    [...AXIS_IDS].sort(),
  );
  for (const annotation of annotations) {
    assert.notEqual(annotation.assessment.state, "not_assessed");
    if (["central_object", "environment"].includes(annotation.axis)) {
      assert.equal(annotation.assessment.state, "unknown");
      assert.deepEqual(annotation.assessment.values, []);
    } else {
      assert.equal(annotation.assessment.state, "present");
      assert(annotation.assessment.values.length > 0);
    }
  }
  const observable = annotations.find(({ axis }) => axis === "observable");
  assert(!observable.assessment.values.some(({ term_id }) => /temperature/i.test(term_id)));

  const evidence = work.files["evidence.yaml"].evidence;
  assert(evidence.length >= 5);
  assert(evidence.every(({ version_id }) => version_id === "version:arnett-1982-journal"));
  assert(evidence.some(({ curation_provenance: provenance }) => provenance.actor_id === "actor:agent-curator"));
  assert(evidence.every(({ review_state }) => review_state === "reviewed"));
  const methodAnnotations = work.files["annotations.yaml"].method_annotations;
  assert(methodAnnotations.some(({ review_state, basis }) => review_state === "reviewed" && basis === "explicit"));
});

test("actor capability authorization is evaluated at action time", () => {
  const actors = {
    actors: [
      {
        id: "actor:test-human",
        kind: "human",
        label: "Test Human",
        capability_events: [
          {
            capability: "review_records",
            action: "grant",
            effective_at: "2026-01-02T00:00:00Z",
            reason: "grant",
          },
          {
            capability: "review_records",
            action: "revoke",
            effective_at: "2026-01-04T00:00:00Z",
            reason: "revoke",
          },
        ],
      },
    ],
  };

  assert.equal(evaluateActorCapability(actors, "actor:test-human", "review_records", "2026-01-01T00:00:00Z"), false);
  assert.equal(evaluateActorCapability(actors, "actor:test-human", "review_records", "2026-01-03T00:00:00Z"), true);
  assert.equal(evaluateActorCapability(actors, "actor:test-human", "review_records", "2026-01-05T00:00:00Z"), false);
  assert.equal(evaluateActorCapability(actors, "actor:test-human", "review_records", "2026-01-03T00:00:00Z"), true);
});

test("assessment state and value cardinality are explicit", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, annotations } = await readArnett(contentRoot);
  annotations.annotations[0].assessment = { state: "unknown", values: [{ term_id: "term:invalid" }] };
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));

  const result = await validateCanonicalContent(contentRoot);
  const codes = new Set(result.diagnostics.map(({ code }) => code));
  assert(codes.has("ANNOTATION_VALUES_FORBIDDEN"));
});

test("risk escalation requires reason and evidence and risk cannot be downgraded", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, annotations } = await readArnett(contentRoot);
  const annotation = annotations.annotations.find(({ axis }) => axis === "inference_target");
  assert(annotation);
  annotation.interpretive_risk = "interpretive";
  delete annotation.risk_escalation;
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));

  const missingReason = await validateCanonicalContent(contentRoot);
  assert(missingReason.diagnostics.some(({ code }) => code === "ANNOTATION_RISK_ESCALATION_REASON_REQUIRED"));

  const axisPath = join(contentRoot, "ontology", "axes", "inference_target.yaml");
  const axis = parse(await readFile(axisPath, "utf8"));
  axis.default_risk = "interpretive";
  await writeFile(axisPath, stringify(axis));
  annotation.interpretive_risk = "descriptive";
  annotation.risk_escalation = { reason: "This is less demanding." };
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));
  const downgraded = await validateCanonicalContent(contentRoot);
  assert(downgraded.diagnostics.some(({ code }) => code === "ANNOTATION_RISK_DOWNGRADE_FORBIDDEN"));
});

test("synthetic Physics Annotations require multiple Evidence records and independent Human review", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, annotations } = await readArnett(contentRoot);
  const annotation = annotations.annotations.find(({ axis }) => axis === "inference_target");
  assert(annotation);
  annotation.interpretive_risk = "synthetic";
  annotation.reason = "The target is synthesized by combining model and observation evidence.";
  annotation.evidence_ids = ["evidence:arnett-intrinsic-luminosity", "evidence:arnett-photometric-bands"];
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));

  const valid = await validateCanonicalContent(contentRoot);
  assert.equal(valid.valid, true);

  annotation.review_provenance.actor_id = "actor:agent-curator";
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));
  const invalid = await validateCanonicalContent(contentRoot);
  assert(invalid.diagnostics.some(({ code }) => code === "CURATION_INDEPENDENT_REVIEW_REQUIRED"));
});

test("active controlled terms require complete activation and independent Human review", async () => {
  const { contentRoot } = await copyContent();
  const axisPath = join(contentRoot, "ontology", "axes", "phenomenon.yaml");
  const axis = parse(await readFile(axisPath, "utf8"));
  delete axis.terms[0].definition;
  axis.terms[0].review_provenance.actor_id = "actor:agent-curator";
  await writeFile(axisPath, stringify(axis));

  const result = await validateCanonicalContent(contentRoot);
  assert(result.diagnostics.some(({ code }) => code === "TERM_DEFINITION_REQUIRED"));
  assert(result.diagnostics.some(({ code }) => code === "CURATION_HUMAN_REVIEW_REQUIRED"));
});

test("Agent-created Evidence cannot self-review and must pass a Human gate", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, evidence } = await readArnett(contentRoot);
  const agentEvidence = evidence.evidence.find(
    ({ curation_provenance: provenance }) => provenance.actor_id === "actor:agent-curator",
  );
  assert(agentEvidence);
  agentEvidence.review_provenance.actor_id = "actor:agent-curator";
  await writeFile(join(workRoot, "evidence.yaml"), stringify(evidence));

  const result = await validateCanonicalContent(contentRoot);
  assert(result.diagnostics.some(({ code }) => code === "CURATION_HUMAN_REVIEW_REQUIRED"));
});

test("inferred Method Annotations require a normalized reason and distinct Human reviewer", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, annotations } = await readArnett(contentRoot);
  const method = annotations.method_annotations[0];
  method.basis = "inferred";
  delete method.reason;
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));

  const result = await validateCanonicalContent(contentRoot);
  assert(result.diagnostics.some(({ code }) => code === "METHOD_INFERRED_REASON_REQUIRED"));
});

test("Evidence requires a typed page locator and exact Work-local Version", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, evidence } = await readArnett(contentRoot);
  evidence.evidence[0].version_id = "version:other-work";
  delete evidence.evidence[0].locator.page;
  await writeFile(join(workRoot, "evidence.yaml"), stringify(evidence));

  const result = await validateCanonicalContent(contentRoot);
  const codes = new Set(result.diagnostics.map(({ code }) => code));
  assert(codes.has("REFERENTIAL_VERSION_MISSING"));
  assert(codes.has("EVIDENCE_LOCATOR_PAGE_INVALID"));
});

test("deprecated Controlled Terms require a reason and preserve optional successor semantics", async () => {
  const { contentRoot } = await copyContent();
  const axisPath = join(contentRoot, "ontology", "axes", "phenomenon.yaml");
  const axis = parse(await readFile(axisPath, "utf8"));
  axis.terms[0].status = "deprecated";
  delete axis.terms[0].deprecation_reason;
  await writeFile(axisPath, stringify(axis));

  const missingReason = await validateCanonicalContent(contentRoot);
  assert(missingReason.diagnostics.some(({ code }) => code === "TERM_DEPRECATION_REASON_REQUIRED"));

  axis.terms[0].deprecation_reason = "Replaced by a more specific phenomenon term.";
  axis.terms[0].successor_id = "term:missing-successor";
  await writeFile(axisPath, stringify(axis));
  const missingSuccessor = await validateCanonicalContent(contentRoot);
  assert(missingSuccessor.diagnostics.some(({ code }) => code === "REFERENTIAL_TERM_SUCCESSOR_MISSING"));
});

test("Agent actors cannot receive a capability beyond draft_records", async () => {
  const { contentRoot } = await copyContent();
  const actorsPath = join(contentRoot, "actors.yaml");
  const actors = parse(await readFile(actorsPath, "utf8"));
  actors.actors.find(({ id }) => id === "actor:agent-curator").capability_events.push({
    capability: "review_records",
    action: "grant",
    effective_at: "2026-09-04T04:00:00Z",
    reason: "Invalid isolated fixture",
  });
  await writeFile(actorsPath, stringify(actors));

  const result = await validateCanonicalContent(contentRoot);
  assert(result.diagnostics.some(({ code }) => code === "ACTOR_AGENT_CAPABILITY_FORBIDDEN"));
});
