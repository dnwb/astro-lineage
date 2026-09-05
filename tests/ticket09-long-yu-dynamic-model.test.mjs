import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { AXIS_IDS, loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  computeReaderVisibilityDigest,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";
import { projectWorkForReader } from "../scripts/reader-projection.mjs";

const projectRoot = new URL("../", import.meta.url);
const productionContent = new URL("../content/", import.meta.url);
const workId = "work:long-yu-2026";
const versionId = "version:long-yu-2026-arxiv-v1";
const lineId = "research-line:dense-environment-multimessenger";
const approvalTime = "2026-09-05T04:44:27Z";
const versionsFile = `content/works/${workId}/versions.yaml`;
const accountFile = `content/works/${workId}/physical-account.yaml`;

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket09-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  return contentRoot;
}

async function readYaml(path) {
  return parse(await readFile(path, "utf8"));
}

async function writeYaml(path, value) {
  await writeFile(path, stringify(value), "utf8");
}

function diagnosticFor(result, code, context = {}) {
  const diagnostic = result.diagnostics.find(
    (item) => item.code === code && Object.entries(context).every(
      ([field, expected]) => JSON.stringify(item[field]) === JSON.stringify(expected),
    ),
  );
  assert(diagnostic, `missing diagnostic ${code} with expected context`);
  return diagnostic;
}

function edgeValue(edge) {
  return edge?.value && typeof edge.value === "object" ? edge.value : edge;
}

function edgeEndpoint(edge, side) {
  const value = edgeValue(edge);
  const keys = side === "source"
    ? ["source_work_id", "source_work", "source"]
    : ["target_work_id", "target_work", "target"];
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string") {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      const id = candidate.work_id ?? candidate.id;
      if (typeof id === "string") {
        return id;
      }
    }
  }
  return null;
}

test("Ticket 09 publishes the approved Long & Yu arXiv-only Work", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
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

  const versions = work.files["versions.yaml"].versions;
  assert.equal(versions.length, 1);
  assert.equal(versions[0].id, versionId);
  assert.equal(versions[0].kind, "arxiv_revision");
  assert.equal(versions[0].arxiv_id, "2608.12217");
  assert.equal(versions[0].arxiv_revision, 1);
  assert.equal(work.files["versions.yaml"].publication_relations.length, 0);
  assert.equal(
    snapshot.scientificEdges.some((edge) =>
      edgeEndpoint(edge, "source") === workId || edgeEndpoint(edge, "target") === workId),
    false,
    "shared topic or Research Line membership must not manufacture a Scientific Edge",
  );

  const evidence = work.files["evidence.yaml"].evidence;
  assert(evidence.every(({ version_id }) => version_id === versionId));
  assert(evidence.every(({ source_url }) => /2608\.12217v1/u.test(source_url)));
  assert(evidence.every(({ review_state, review_provenance }) =>
    review_state === "reviewed" &&
    review_provenance.actor_id === "actor:human-curator" &&
    review_provenance.recorded_at === approvalTime));
  assert.doesNotMatch(JSON.stringify(work.files), /\bRNS\b/u);

  const annotations = work.files["annotations.yaml"].annotations;
  assert.equal(annotations.length, AXIS_IDS.length);
  assert.deepEqual(new Set(annotations.map(({ axis }) => axis)), new Set(AXIS_IDS));
  const byAxis = new Map(annotations.map((annotation) => [annotation.axis, annotation]));
  assert.deepEqual(
    byAxis.get("energy_dissipation").assessment.values.map(({ term_id }) => term_id),
    ["term:jet-head-shock-heating", "term:reverse-shock-particle-acceleration"],
  );
  assert.deepEqual(
    byAxis.get("phenomenon").assessment.values.map(({ term_id }) => term_id),
    ["term:relativistic-jet-propagation"],
  );
  assert.equal(byAxis.get("photon_band").assessment.state, "not_applicable");
  assert.equal(byAxis.get("observable").assessment.state, "not_applicable");
  assert.deepEqual(
    byAxis.get("inference_target").assessment.values.map(({ term_id }) => term_id),
    ["term:jet-choking-condition", "term:jet-breakout-time", "term:expected-neutrino-yield"],
  );

  const method = work.files["annotations.yaml"].method_annotations[0];
  assert.equal(method.technique_id, "technique:detector-effective-area-folding");
  assert.equal(method.basis, "explicit");
  assert.equal(method.review_state, "reviewed");
  assert.equal(method.review_provenance.actor_id, "actor:human-curator");

  const statements = work.files["statements.yaml"].statements;
  assert.equal(statements.length, 4);
  assert(statements.every(({ basis, review_state, review_provenance }) =>
    basis === "explicit" && review_state === "reviewed" &&
    review_provenance.actor_id === "actor:human-curator"));

  const line = snapshot.researchLines.find(({ id }) => id === lineId);
  const membership = line.line.memberships.find(({ work_id }) => work_id === workId);
  assert(membership);
  assert.equal(membership.editorial_anchor, true);
  assert.deepEqual(membership.reading_roles, ["frontier", "method"]);
  assert.equal(membership.review_state, "reviewed");
  assert.equal(membership.review_provenance.actor_id, "actor:human-curator");

  assert(work.files["work.yaml"].visibility_approvals.some(({ visibility_digest }) =>
    visibility_digest === computeReaderVisibilityDigest(snapshot, "work", workId)));
  assert(line.line.visibility_approvals.some(({ visibility_digest }) =>
    visibility_digest === computeReaderVisibilityDigest(snapshot, "research_line", lineId)));
});

test("the approved Physical Account keeps dynamics, inference, and detector projection separate", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === workId);
  const account = work.files["physical-account.yaml"];
  const stageIds = new Set(account.stages.map(({ id }) => id));

  assert.equal(account.stages.length, 11);
  assert.equal(account.links.length, 11);
  assert(account.links.every(({ source_stage_id, target_stage_id, evidence_ids }) =>
    stageIds.has(source_stage_id) && stageIds.has(target_stage_id) &&
    Array.isArray(evidence_ids) && evidence_ids.length > 0));
  assert.equal(
    account.stages.some(({ annotation_id }) => annotation_id === "annotation:long-yu-inference-target"),
    false,
    "the engine-clock classifier is epistemic and must not become a physical causal stage",
  );
  assert.equal(
    account.stages.find(({ id }) => id === "stage:long-yu-choking-breakout").annotation_id,
    "annotation:long-yu-dynamics",
  );
  assert(account.stages.some(({ id, label }) =>
    id === "stage:long-yu-reverse-shock-processing" && /energy processing/iu.test(label)));
  assert(account.stages.some(({ id, label }) =>
    id === "stage:long-yu-collisionless-reverse-shock" && /proton acceleration/iu.test(label)));
  assert.doesNotMatch(JSON.stringify(account), /detector-effective-area|expected event count/iu);

  const outgoing = new Map(account.stages.map(({ id }) => [id, 0]));
  const incoming = new Map(account.stages.map(({ id }) => [id, 0]));
  for (const link of account.links) {
    outgoing.set(link.source_stage_id, outgoing.get(link.source_stage_id) + 1);
    incoming.set(link.target_stage_id, incoming.get(link.target_stage_id) + 1);
  }
  assert(outgoing.get("stage:long-yu-trajectory") >= 2);
  assert(outgoing.get("stage:long-yu-collisionless-reverse-shock") >= 2);
  assert.equal(incoming.get("stage:long-yu-meson-muon-decay"), 2);

  const projection = projectWorkForReader(snapshot, workId);
  assert(projection);
  assert.equal(projection.versions.length, 1);
  assert.deepEqual(projection.publication_relations, []);
  assert.equal(projection.scientific_edges.length, 0);
  assert.equal(projection.statements.length, 4);
  assert.equal(projection.physical_account.stages.length, 11);
  assert.equal(projection.physical_account.links.length, 11);
});

test("Long & Yu Reader View renders the arXiv-only dynamic account and provenance", async () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const html = await readFile(
    new URL("../dist/papers/work:long-yu-2026/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /2608\.12217v1/u);
  assert.match(html, /Time-dependent jet-head trajectory/iu);
  assert.match(html, /Trajectory-dependent reverse-shock energy processing/iu);
  assert.match(html, /Collisionless reverse-shock proton acceleration/iu);
  assert.match(html, /technique:detector-effective-area-folding/u);
  assert.match(html, /evidence:long-yu-engine-clock/u);
  assert.match(html, /reviewed by actor:human-curator/iu);
  assert.doesNotMatch(html, /<script/iu);
});

test("an arXiv revision must use a positive separate revision number", async () => {
  const contentRoot = await copyContent();
  const path = join(contentRoot, "works", workId, "versions.yaml");
  const versions = await readYaml(path);
  versions.versions[0].arxiv_revision = 0;
  await writeYaml(path, versions);

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, false);
  diagnosticFor(result, "BIB_ARXIV_REVISION_INVALID", {
    file: versionsFile,
    record_id: versionId,
    field_path: "/versions/0/arxiv_revision",
  });
});

test("a Physical Account link with a missing endpoint is quarantined with a stable diagnostic", async () => {
  const contentRoot = await copyContent();
  const path = join(contentRoot, "works", workId, "physical-account.yaml");
  const account = await readYaml(path);
  const link = account.links[0];
  link.target_stage_id = "stage:ticket09-missing";
  await writeYaml(path, account);

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, false);
  diagnosticFor(result, "REFERENTIAL_CAUSAL_STAGE_MISSING", {
    file: accountFile,
    record_id: link.id,
    field_path: "/links/0/target_stage_id",
  });
  assert.equal(result.diagnostics.some(({ code }) => code === "CAUSAL_ACCOUNT_CYCLE"), false);
});
