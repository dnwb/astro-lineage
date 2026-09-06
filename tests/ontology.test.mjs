import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const temporaryRoot = await mkdtemp(join(tmpdir(), "astro-lineage-ontology-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  await rm(join(contentRoot, "learning-paths"), { recursive: true, force: true });
  const workPath = join(contentRoot, "works", "arnett-1982", "work.yaml");
  const brombergWorkPath = join(contentRoot, "works", "bromberg-2011", "work.yaml");
  const zhuWorkPath = join(contentRoot, "works", "zhu-2021", "work.yaml");
  const transfitWorkPath = join(contentRoot, "works", "transfit-2025", "work.yaml");
  const longYuWorkPath = join(contentRoot, "works", "long-yu-2026", "work.yaml");
  const linePath = join(contentRoot, "research-lines", "central-engines", "line.yaml");
  const denseLinePath = join(
    contentRoot,
    "research-lines",
    "dense-environment-multimessenger",
    "line.yaml",
  );
  const explosiveLinePath = join(
    contentRoot,
    "research-lines",
    "explosive-transients-csm",
    "line.yaml",
  );
  const work = parse(await readFile(workPath, "utf8"));
  const brombergWork = parse(await readFile(brombergWorkPath, "utf8"));
  const zhuWork = parse(await readFile(zhuWorkPath, "utf8"));
  const transfitWork = parse(await readFile(transfitWorkPath, "utf8"));
  const longYuWork = parse(await readFile(longYuWorkPath, "utf8"));
  const line = parse(await readFile(linePath, "utf8"));
  const denseLine = parse(await readFile(denseLinePath, "utf8"));
  const explosiveLine = parse(await readFile(explosiveLinePath, "utf8"));
  work.reader_state = "draft";
  work.visibility_approvals = [];
  brombergWork.reader_state = "draft";
  brombergWork.visibility_approvals = [];
  zhuWork.reader_state = "draft";
  zhuWork.visibility_approvals = [];
  transfitWork.reader_state = "draft";
  transfitWork.visibility_approvals = [];
  longYuWork.reader_state = "draft";
  longYuWork.visibility_approvals = [];
  line.reader_state = "draft";
  line.visibility_approvals = [];
  denseLine.reader_state = "draft";
  denseLine.visibility_approvals = [];
  explosiveLine.reader_state = "draft";
  explosiveLine.visibility_approvals = [];
  await Promise.all([
    writeFile(workPath, stringify(work), "utf8"),
    writeFile(brombergWorkPath, stringify(brombergWork), "utf8"),
    writeFile(zhuWorkPath, stringify(zhuWork), "utf8"),
    writeFile(transfitWorkPath, stringify(transfitWork), "utf8"),
    writeFile(longYuWorkPath, stringify(longYuWork), "utf8"),
    writeFile(linePath, stringify(line), "utf8"),
    writeFile(denseLinePath, stringify(denseLine), "utf8"),
    writeFile(explosiveLinePath, stringify(explosiveLine), "utf8"),
  ]);
  return { contentRoot };
}

async function readArnett(contentRoot) {
  const workRoot = join(contentRoot, "works", "arnett-1982");
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

test("the production ontology has governed actors, 16 assessments, evidence, and a method annotation", async () => {
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

test("Evidence permits a typed section locator without fabricated page precision", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, evidence } = await readArnett(contentRoot);
  evidence.evidence[0].version_id = "version:other-work";
  delete evidence.evidence[0].locator.page;
  await writeFile(join(workRoot, "evidence.yaml"), stringify(evidence));

  const result = await validateCanonicalContent(contentRoot);
  const codes = new Set(result.diagnostics.map(({ code }) => code));
  assert(codes.has("REFERENTIAL_VERSION_MISSING"));
  assert.equal(codes.has("EVIDENCE_LOCATOR_PAGE_INVALID"), false);
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
  axis.terms[0].deprecation_provenance = {
    actor_id: "actor:human-curator",
    recorded_at: "2026-09-04T05:00:00Z",
  };
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

test("malformed Method children are diagnosed and quarantined from dependent checks", async () => {
  const { contentRoot } = await copyContent();
  const methodsPath = join(contentRoot, "methods", "taxonomy.yaml");
  const methods = parse(await readFile(methodsPath, "utf8"));
  methods.method_families[0] = { id: "method-family:malformed" };
  methods.techniques[0] = null;
  await writeFile(methodsPath, stringify(methods));

  const result = await validateCanonicalContent(contentRoot);
  const codes = result.diagnostics.map(({ code }) => code);

  assert(codes.includes("TERM_LABEL_INVALID"));
  assert(codes.includes("TERM_STATUS_INVALID"));
  assert(codes.includes("TERM_INVALID_SHAPE"));
  assert(!codes.includes("REFERENTIAL_METHOD_FAMILY_MISSING"));
  assert.equal(result.valid, false);
});

test("non-array Annotation assessment values are diagnosed without dependent value cascades", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, annotations } = await readArnett(contentRoot);
  annotations.annotations[0].assessment.values = { term_id: "term:not-an-array" };
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));

  const result = await validateCanonicalContent(contentRoot);
  const codes = result.diagnostics.map(({ code }) => code);

  assert(codes.includes("ANNOTATION_VALUES_INVALID"));
  assert(!codes.includes("ANNOTATION_VALUE_INVALID"));
  assert(!codes.includes("REFERENTIAL_TERM_MISSING"));
  assert.equal(result.valid, false);
});

test("an invalid Actor Registry reports its root error without actor-dependent cascades", async () => {
  const { contentRoot } = await copyContent();
  await writeFile(join(contentRoot, "actors.yaml"), "actors: null\n");

  const result = await validateCanonicalContent(contentRoot);
  const codes = result.diagnostics.map(({ code }) => code);

  assert(codes.includes("STRUCTURE_ACTORS_COLLECTION_INVALID"));
  assert(!codes.some((code) => code === "REFERENTIAL_ACTOR_MISSING" || code.startsWith("CURATION_")));
  assert(codes.includes("METHOD_REVIEWED_TECHNIQUE_REQUIRED") === false);
  assert.equal(result.valid, false);
});

test("invalid Actor children quarantine actor-dependent governance checks", async () => {
  const mutations = [
    {
      rootCode: "ACTOR_KIND_INVALID",
      apply(actors) {
        actors.actors[0].kind = "service";
      },
    },
    {
      rootCode: "ACTOR_CAPABILITY_EVENTS_INVALID",
      apply(actors) {
        actors.actors[0].capability_events = null;
      },
    },
  ];

  for (const { rootCode, apply } of mutations) {
    const { contentRoot } = await copyContent();
    const actorsPath = join(contentRoot, "actors.yaml");
    const actors = parse(await readFile(actorsPath, "utf8"));
    apply(actors);
    await writeFile(actorsPath, stringify(actors));

    const result = await validateCanonicalContent(contentRoot);
    const codes = result.diagnostics.map(({ code }) => code);

    assert(codes.includes(rootCode));
    assert(!codes.includes("REFERENTIAL_ACTOR_MISSING"));
    assert(!codes.some((code) => code.startsWith("CURATION_")));
    assert(!codes.includes("METHOD_REVIEWED_TECHNIQUE_REQUIRED"));
  }
});

test("duplicate Controlled Terms emit one global root-cause diagnostic", async () => {
  const { contentRoot } = await copyContent();
  const axisPath = join(contentRoot, "ontology", "axes", "energy_reservoir.yaml");
  const axis = parse(await readFile(axisPath, "utf8"));
  axis.terms.push({ ...axis.terms[0] });
  await writeFile(axisPath, stringify(axis));

  const result = await validateCanonicalContent(contentRoot);
  const duplicateDiagnostics = result.diagnostics.filter(({ code, record_id }) =>
    code === "TERM_ID_DUPLICATE" && record_id === axis.terms[0].id,
  );

  assert.equal(duplicateDiagnostics.length, 1);
});

test("deprecated Controlled Terms remain valid historical Annotation and Method Annotation references", async () => {
  const { contentRoot } = await copyContent();
  const axisPath = join(contentRoot, "ontology", "axes", "energy_reservoir.yaml");
  const axis = parse(await readFile(axisPath, "utf8"));
  axis.terms[0].status = "deprecated";
  axis.terms[0].deprecation_reason = "Retained for historical Version attestations.";
  axis.terms[0].deprecation_provenance = {
    actor_id: "actor:human-curator",
    recorded_at: "2026-09-04T05:00:00Z",
  };
  await writeFile(axisPath, stringify(axis));

  const methodsPath = join(contentRoot, "methods", "taxonomy.yaml");
  const methods = parse(await readFile(methodsPath, "utf8"));
  methods.techniques[0].status = "deprecated";
  methods.techniques[0].deprecation_reason = "Retained for the historical method assignment.";
  methods.techniques[0].deprecation_provenance = {
    actor_id: "actor:human-curator",
    recorded_at: "2026-09-04T05:00:10Z",
  };
  const successor = {
    ...methods.techniques[0],
    id: "technique:successor",
    label: "Successor technique",
    status: "active",
  };
  delete successor.deprecation_reason;
  delete successor.deprecation_provenance;
  methods.techniques.push(successor);
  await writeFile(methodsPath, stringify(methods));

  const { workRoot, annotations } = await readArnett(contentRoot);
  annotations.method_annotations.push({
    ...annotations.method_annotations[0],
    id: "annotation:arnett-method-successor",
    technique_id: "technique:successor",
  });
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));

  const result = await validateCanonicalContent(contentRoot);
  const codes = result.diagnostics.map(({ code }) => code);

  assert(!codes.includes("ANNOTATION_TERM_NOT_ACTIVE"));
  assert(!codes.includes("METHOD_TECHNIQUE_NOT_ACTIVE"));
});

test("deprecated Controlled Terms reject assignments created after deprecation", async () => {
  const { contentRoot } = await copyContent();
  const axisPath = join(contentRoot, "ontology", "axes", "energy_reservoir.yaml");
  const axis = parse(await readFile(axisPath, "utf8"));
  axis.terms[0].status = "deprecated";
  axis.terms[0].deprecation_reason = "Retained only for historical assignments.";
  axis.terms[0].deprecation_provenance = {
    actor_id: "actor:human-curator",
    recorded_at: "2026-09-04T05:00:00Z",
  };
  await writeFile(axisPath, stringify(axis));

  const methodsPath = join(contentRoot, "methods", "taxonomy.yaml");
  const methods = parse(await readFile(methodsPath, "utf8"));
  methods.techniques[0].status = "deprecated";
  methods.techniques[0].deprecation_reason = "Retained only for historical assignments.";
  methods.techniques[0].deprecation_provenance = {
    actor_id: "actor:human-curator",
    recorded_at: "2026-09-04T05:00:00Z",
  };
  await writeFile(methodsPath, stringify(methods));

  const { workRoot, annotations } = await readArnett(contentRoot);
  annotations.annotations.find(({ axis: axisId }) => axisId === "energy_reservoir")
    .curation_provenance.recorded_at = "2026-09-04T05:00:01Z";
  annotations.method_annotations[0].curation_provenance.recorded_at = "2026-09-04T05:00:01Z";
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));

  const result = await validateCanonicalContent(contentRoot);
  const codes = result.diagnostics.map(({ code }) => code);

  assert(codes.includes("ANNOTATION_TERM_DEPRECATED_FOR_NEW_ASSIGNMENT"));
  assert(codes.includes("METHOD_TECHNIQUE_DEPRECATED_FOR_NEW_ASSIGNMENT"));
});

test("proposed and deprecated Controlled Terms carry governed lifecycle records", async () => {
  const { contentRoot } = await copyContent();
  const axisPath = join(contentRoot, "ontology", "axes", "energy_reservoir.yaml");
  const axis = parse(await readFile(axisPath, "utf8"));
  axis.terms[0].status = "proposed";
  delete axis.terms[0].curation_provenance;
  delete axis.terms[0].review_state;
  await writeFile(axisPath, stringify(axis));

  const proposed = await validateCanonicalContent(contentRoot);
  const proposedCodes = proposed.diagnostics.map(({ code }) => code);
  assert(proposedCodes.includes("CURATION_PROVENANCE_INVALID_SHAPE"));
  assert(proposedCodes.includes("REVIEW_STATE_INVALID"));

  axis.terms[0].status = "deprecated";
  axis.terms[0].curation_provenance = {
    actor_id: "actor:agent-curator",
    recorded_at: "2026-09-04T05:01:00Z",
  };
  axis.terms[0].review_state = "unreviewed";
  axis.terms[0].deprecation_reason = "Retained for historical references.";
  delete axis.terms[0].deprecation_provenance;
  await writeFile(axisPath, stringify(axis));

  const deprecated = await validateCanonicalContent(contentRoot);
  assert(deprecated.diagnostics.some(({ code }) => code === "TERM_DEPRECATION_PROVENANCE_REQUIRED"));
});

test("reviewed Method Annotation bindings reject material edits but ignore formatting-only reason changes", async () => {
  const mutations = [
    (annotation) => {
      annotation.technique_id = "technique:changed";
    },
    (annotation) => {
      annotation.basis = "inferred";
      annotation.reason = "The source explicitly supports this technique.";
    },
    (annotation) => {
      annotation.reason = "A materially different curation reason.";
    },
    (annotation) => {
      annotation.evidence_ids = ["evidence:arnett-abstract"];
    },
  ];

  for (const mutate of mutations) {
    const { contentRoot } = await copyContent();
    const { workRoot, annotations } = await readArnett(contentRoot);
    mutate(annotations.method_annotations[0]);
    await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));
    const result = await validateCanonicalContent(contentRoot);
    assert(result.diagnostics.some(({ code }) => code === "METHOD_REVIEW_BINDING_STALE"));
  }

  const { contentRoot } = await copyContent();
  const { workRoot, annotations } = await readArnett(contentRoot);
  annotations.method_annotations[0].reason = `  ${annotations.method_annotations[0].reason}  `;
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));
  const formattingOnly = await validateCanonicalContent(contentRoot);
  assert.equal(formattingOnly.valid, true);
  assert(!formattingOnly.diagnostics.some(({ code }) => code === "METHOD_REVIEW_BINDING_STALE"));
});

test("Method review binding treats Evidence references as an unordered set", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, annotations } = await readArnett(contentRoot);
  const method = annotations.method_annotations[0];
  method.evidence_ids = [
    "evidence:arnett-abstract",
    "evidence:arnett-reduction-quadrature",
  ];
  method.review_binding.semantic_digest = "4849b2426f3784707b9638ef012f9740c63d33245c87f9e4208cde3dc584b4f1";
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));

  const ordered = await validateCanonicalContent(contentRoot);
  assert.equal(ordered.valid, true);

  method.evidence_ids.reverse();
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));
  const reordered = await validateCanonicalContent(contentRoot);

  assert.equal(reordered.valid, true);
  assert(!reordered.diagnostics.some(({ code }) => code === "METHOD_REVIEW_BINDING_STALE"));
});

test("required Interpretive Annotation reasons reject whitespace-only values", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, annotations } = await readArnett(contentRoot);
  const annotation = annotations.annotations.find(({ axis }) => axis === "inference_target");
  assert(annotation);
  annotation.reason = "   ";
  await writeFile(join(workRoot, "annotations.yaml"), stringify(annotations));

  const result = await validateCanonicalContent(contentRoot);
  assert(result.diagnostics.some(({ code }) => code === "ANNOTATION_REASON_REQUIRED"));
});

test("Arnett progenitor assessment names both modeled physical configurations", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === "work:arnett-1982");
  const annotation = work.files["annotations.yaml"].annotations.find(
    ({ axis }) => axis === "progenitor_system",
  );
  const termIds = annotation.assessment.values.map(({ term_id }) => term_id);

  assert.deepEqual(new Set(termIds), new Set([
    "term:near-chandrasekhar-carbon-ignition",
    "term:evolved-helium-star-collapse",
  ]));
  assert(!termIds.includes("term:alternative-modeled-systems"));
});

test("Arnett Evidence excerpts retain source text rather than curator synthesis", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === "work:arnett-1982");
  const excerpts = new Map(
    work.files["evidence.yaml"].evidence.map(({ id, excerpt }) => [id, excerpt]),
  );

  assert.equal(
    excerpts.get("evidence:arnett-reduction-quadrature"),
    "The solutions obtained are 'analytic' in the sense that they are expressed in terms of tabulated functions or integrals that are easy to do numerically (reduction to quadrature).",
  );
  assert.equal(
    excerpts.get("evidence:arnett-maximum-light"),
    "At maximum light the diffusion loss equals the radioactive input.",
  );
  assert.equal(
    excerpts.get("evidence:arnett-alternative-models"),
    "It is impossible to distinguish between thermonuclear and collapse models.",
  );
  assert.match(
    excerpts.get("evidence:arnett-model-classes"),
    /degenerate ignition of 12C.*core collapse of an evolved helium star/u,
  );
  assert.match(
    excerpts.get("evidence:arnett-decay-chain"),
    /electron capture.*positron emission/u,
  );
  assert.match(
    excerpts.get("evidence:arnett-blackbody-spectrum"),
    /hypothetical construct.*blackbody spectrum/u,
  );
  assert.match(excerpts.get("evidence:arnett-ubv"), /U, B, and V magnitudes/u);
});
