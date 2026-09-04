import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { buildWorkResearchLineIndex } from "../scripts/editorial-index.mjs";
import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import { validateCanonicalContent } from "../scripts/content-validator.mjs";
import { projectWorkForReader } from "../scripts/reader-projection.mjs";

const productionContent = new URL("../content/", import.meta.url);
const workId = "work:transfit-2025";
const lineId = "research-line:explosive-transients-csm";
const centralLineId = "research-line:central-engines";
const reviewTime = "2026-09-04T13:30:00Z";
const ticket08TermIds = new Set([
  "method-family:numerical-modeling",
  "method-family:model-data-parameter-estimation",
  "technique:crank-nicolson-finite-difference",
  "technique:forward-model-light-curve-fitting",
  "term:central-engine-energy-reservoir",
  "term:continuous-heating-input",
  "term:expansion-work-energy-transfer",
  "term:transient-light-curve-evolution",
  "term:ejecta-physical-properties",
  "term:progenitor-radius",
  "term:heating-source-parameters",
]);

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket08-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  return contentRoot;
}

function codes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

async function readYaml(path) {
  return parse(await readFile(path, "utf8"));
}

async function writeYaml(path, value) {
  await writeFile(path, stringify(value), "utf8");
}

test("Ticket 08 canonical TransFit content is visible and Human-reviewed", async () => {
  const productionSnapshot = await loadCanonicalContent(productionContent);
  assert(productionSnapshot.works.some(({ id }) => id === workId));
  assert(productionSnapshot.researchLines.some(({ id }) => id === lineId));
  const contentRoot = await copyContent();
  const snapshot = await loadCanonicalContent(contentRoot);
  const result = await validateCanonicalContent(contentRoot);
  const work = snapshot.works.find(({ id }) => id === workId);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert(work);
  assert.equal(work.files["work.yaml"].reader_state, "visible");
  assert.deepEqual(Object.keys(work.files).sort(), [
    "annotations.yaml",
    "evidence.yaml",
    "physical-account.yaml",
    "reading.md",
    "statements.yaml",
    "versions.yaml",
    "work.yaml",
  ]);
  assert.equal(work.files["annotations.yaml"].annotations.length, 16);
  assert.equal(new Set(work.files["annotations.yaml"].annotations.map(({ axis }) => axis)).size, 16);
  assert.equal(work.files["annotations.yaml"].method_annotations.length, 2);
  assert.equal(
    work.files["physical-account.yaml"].stages.some(
      ({ annotation_id }) => annotation_id === "annotation:transfit-observable",
    ),
    false,
  );
  const causalLinks = work.files["physical-account.yaml"].links;
  assert.equal(causalLinks.length, 10);
  assert.deepEqual(
    causalLinks.map(({ source_stage_id, target_stage_id, relation }) =>
      `${source_stage_id}|${relation}|${target_stage_id}`).sort(),
    [
      "stage:transfit-density-optical-depth|modulates|stage:transfit-radiative-diffusion",
      "stage:transfit-engine-input|produces|stage:transfit-radiation-energy-field",
      "stage:transfit-engine-reservoir|drives|stage:transfit-engine-input",
      "stage:transfit-expansion-work|produces|stage:transfit-mechanical-energy",
      "stage:transfit-homologous-expansion|drives|stage:transfit-density-optical-depth",
      "stage:transfit-radiation-energy-field|drives|stage:transfit-expansion-work",
      "stage:transfit-radiation-energy-field|enables|stage:transfit-radiative-diffusion",
      "stage:transfit-radioactive-input|produces|stage:transfit-radiation-energy-field",
      "stage:transfit-radioactive-reservoir|drives|stage:transfit-radioactive-input",
      "stage:transfit-radiative-diffusion|produces|stage:transfit-photospheric-emission",
    ].sort(),
  );
  assert.equal(
    causalLinks.some(({ source_stage_id, target_stage_id }) =>
      source_stage_id === "stage:transfit-expansion-work" &&
      target_stage_id === "stage:transfit-radiative-diffusion"),
    false,
  );
  assert(work.files["evidence.yaml"].evidence.every(({ review_state }) => review_state === "reviewed"));
  assert(projectWorkForReader(snapshot, workId));
  assert.equal(buildWorkResearchLineIndex(snapshot)[workId].length, 2);
  const memberships = snapshot.researchLines.flatMap(({ id, line }) =>
    line.memberships
      .filter(({ work_id }) => work_id === workId)
      .map((membership) => ({ line_id: id, ...membership })),
  );
  assert.equal(memberships.find(({ line_id }) => line_id === lineId).editorial_anchor, true);
  assert.equal(memberships.find(({ line_id }) => line_id === centralLineId).editorial_anchor, false);

  const ticket08Terms = [
    ...snapshot.methods.method_families,
    ...snapshot.methods.techniques,
    ...snapshot.axes.flatMap(({ value }) => value.terms),
  ].filter(({ id }) => ticket08TermIds.has(id));
  assert.equal(ticket08Terms.length, ticket08TermIds.size);
  assert(ticket08Terms.every(({ status, review_state }) => status === "active" && review_state === "reviewed"));
  const expansionWork = ticket08Terms.find(({ id }) => id === "term:expansion-work-energy-transfer");
  assert.equal(expansionWork.allowed_functional_roles, undefined);
  const continuousInput = ticket08Terms.find(({ id }) => id === "term:continuous-heating-input");
  assert.match(continuousInput.definition, /distributed radioactive deposition/);
  assert.match(continuousInput.definition, /central-boundary engine input/);
  assert.match(continuousInput.boundary_notes, /distributed or local heating deposition/);
  assert.match(continuousInput.boundary_notes, /inner-boundary radiative flux/);
  assert.equal(continuousInput.allowed_functional_roles, undefined);
  assert.equal(
    [...snapshot.axes.flatMap(({ value }) => value.terms)]
      .some(({ id }) => id === "term:continuous-heating-deposition"),
    false,
  );
});

test("the Human-reviewed Work renders Method and inference structure separately", async () => {
  const contentRoot = await copyContent();

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  const snapshot = await loadCanonicalContent(contentRoot);
  const projection = projectWorkForReader(snapshot, workId);
  assert(projection);
  assert.deepEqual(
    projection.method_annotations.map(({ technique_id }) => technique_id).sort(),
    [
      "technique:crank-nicolson-finite-difference",
      "technique:forward-model-light-curve-fitting",
    ],
  );
  const byAxis = new Map(projection.annotations.map((annotation) => [annotation.axis, annotation]));
  const observableTerms = byAxis.get("observable").assessment.values.map(({ term_id }) => term_id);
  const inferenceTerms = byAxis.get("inference_target").assessment.values.map(({ term_id }) => term_id);
  assert.deepEqual(observableTerms, ["term:light-curves"]);
  assert.deepEqual(inferenceTerms, [
    "term:ejecta-physical-properties",
    "term:heating-source-parameters",
    "term:progenitor-radius",
  ]);
  assert.equal(observableTerms.some((termId) => inferenceTerms.includes(termId)), false);
  assert(projection.evidence.some(({ id, review_context }) =>
    id === "evidence:transfit-crank-nicolson" &&
    review_context.reviewer_actor_id === "actor:human-curator"));
  assert.deepEqual(
    projection.research_lines.map(({ line_id }) => line_id).sort(),
    [centralLineId, lineId].sort(),
  );
  assert.equal(
    projection.research_lines.filter(({ editorial_anchor }) => editorial_anchor).length,
    1,
  );
  assert.equal(
    projection.research_lines.find(({ line_id: membershipLineId }) => membershipLineId === lineId).editorial_anchor,
    true,
  );
  assert.equal(
    projection.research_lines.find(({ line_id: membershipLineId }) => membershipLineId === centralLineId).editorial_anchor,
    false,
  );
  assert(projection.research_lines.every(({ reading_roles }) =>
    reading_roles.length === 1 && reading_roles[0] === "method"));
});

test("inferred Method review is independent and material edits invalidate its binding", async () => {
  const contentRoot = await copyContent();
  const path = join(contentRoot, "works", workId, "annotations.yaml");
  const annotations = await readYaml(path);
  const inferred = annotations.method_annotations.find(({ basis }) => basis === "inferred");

  inferred.review_provenance.actor_id = "actor:agent-curator";
  await writeYaml(path, annotations);
  const nonHuman = await validateCanonicalContent(contentRoot);
  assert(codes(nonHuman).has("CURATION_HUMAN_REVIEW_REQUIRED"));
  assert(codes(nonHuman).has("CURATION_INDEPENDENT_REVIEW_REQUIRED"));

  inferred.review_provenance.actor_id = "actor:human-curator";
  inferred.reason = `${inferred.reason} This changes the scientific justification.`;
  await writeYaml(path, annotations);
  const stale = await validateCanonicalContent(contentRoot);
  assert(codes(stale).has("METHOD_REVIEW_BINDING_STALE"));
});

test("observable assignments reject inference-target terms", async () => {
  const contentRoot = await copyContent();
  const path = join(contentRoot, "works", workId, "annotations.yaml");
  const annotations = await readYaml(path);
  const observable = annotations.annotations.find(({ axis }) => axis === "observable");
  observable.assessment.values[0].term_id = "term:ejecta-physical-properties";
  await writeYaml(path, annotations);

  const result = await validateCanonicalContent(contentRoot);
  assert(codes(result).has("ANNOTATION_TERM_AXIS_MISMATCH"));
});

test("an unresolved reader-relevant TransFit bibliographic discrepancy blocks visibility", async () => {
  const contentRoot = await copyContent();
  const workRoot = join(contentRoot, "works", workId);
  const versionsPath = join(workRoot, "versions.yaml");
  const versions = await readYaml(versionsPath);
  versions.bibliographic_sources.push({
    id: "source:ads-transfit-2025-test",
    provider: "ads",
    record_id: "2025ApJ...992...20L",
    source_url: "https://ui.adsabs.harvard.edu/abs/2025ApJ...992...20L/abstract",
    retrieved_at: reviewTime,
  });
  versions.bibliographic_discrepancies.push({
    id: "discrepancy:transfit-title-test",
    version_id: "version:transfit-2025-arxiv-v1",
    field_path: "/title",
    conflicting_source_ids: [
      "source:arxiv-transfit-2025-20260904-130845z",
      "source:ads-transfit-2025-test",
    ],
    conflicting_values: [
      {
        source_id: "source:arxiv-transfit-2025-20260904-130845z",
        value: "TransFit: An Efficient Framework for Transient Light-Curve Fitting with Time-Dependent Radiative Diffusion",
      },
      {
        source_id: "source:ads-transfit-2025-test",
        value: "TransFit: A conflicting title retained for validator coverage",
      },
    ],
    reader_relevant: true,
    resolution_events: [],
  });
  await writeYaml(versionsPath, versions);

  const result = await validateCanonicalContent(contentRoot);
  assert(codes(result).has("BIB_DISCREPANCY_BLOCKS_VISIBILITY"));
});
