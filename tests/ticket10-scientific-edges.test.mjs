import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  computeReaderVisibilityDigest,
  renderValidationMarkdown,
  scientificEdgeSemanticDigest,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";
import {
  projectVisibleSnapshot,
  projectWorkForReader,
} from "../scripts/reader-projection.mjs";

const productionContent = new URL("../content/", import.meta.url);
const sourceWorkId = "work:long-yu-2026";
const targetWorkId = "work:bromberg-2011";
const targetWorkSlug = "bromberg-2011";
const thirdWorkId = "work:arnett-1982";
const sourceEvidenceId = "evidence:long-yu-dynamic-framework";
const alternateSourceEvidenceId = "evidence:long-yu-head-propagation";
const targetEvidenceId = "evidence:bromberg-abstract";
const thirdWorkEvidenceId = "evidence:arnett-abstract";
const sourceStatementId = "statement:long-yu-time-dependent-trajectory-framework";
const targetStatementId = "statement:bromberg-jet-cocoon-model";
const relations = Object.freeze([
  "builds_on",
  "extends",
  "tests",
  "constrains",
  "challenges",
  "replaces_assumption",
  "corrects",
]);
const edgeFileSlugs = Object.freeze({
  "edge:long-yu-builds-on-bromberg-dynamics": "long-yu-builds-on-bromberg-dynamics",
  "edge:long-yu-extends-bromberg-dynamics": "long-yu-extends-bromberg-dynamics",
  "edge:duplicate-same-delta": "duplicate-same-delta",
  "edge:long-yu-tests-bromberg-regime": "long-yu-tests-bromberg-regime",
  "edge:unreviewed-hidden": "unreviewed-hidden",
});
let draftContentTemplate;

async function readYaml(path) {
  return parse(await readFile(path, "utf8"));
}

async function writeYaml(path, value) {
  await writeFile(path, stringify(value), "utf8");
}

async function copyContent({ draftReaders = true } = {}) {
  if (draftReaders && draftContentTemplate) {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket10-"));
    const contentRoot = join(temporaryRoot, "content");
    await cp(draftContentTemplate, contentRoot, { recursive: true });
    return { temporaryRoot, contentRoot };
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket10-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  if (draftReaders) {
    await rm(join(contentRoot, "scientific-edges"), { recursive: true, force: true });
  }
  await mkdir(join(contentRoot, "scientific-edges"), { recursive: true });
  if (draftReaders) {
    const snapshot = await loadCanonicalContent(contentRoot);
    const recordGroups = [
      snapshot.works.map(({ sourcePath }) => join(temporaryRoot, sourcePath, "work.yaml")),
      snapshot.researchLines.map(({ sourcePath }) => join(temporaryRoot, sourcePath, "line.yaml")),
      snapshot.learningPaths.map(({ sourcePath }) => join(temporaryRoot, sourcePath, "path.yaml")),
    ];
    for (const records of recordGroups) {
      for (const path of records) {
        const record = await readYaml(path);
        record.reader_state = "draft";
        record.visibility_approvals = [];
        await writeYaml(path, record);
      }
    }
    draftContentTemplate = contentRoot;
    const fixtureRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket10-"));
    const fixtureContentRoot = join(fixtureRoot, "content");
    await cp(draftContentTemplate, fixtureContentRoot, { recursive: true });
    return { temporaryRoot: fixtureRoot, contentRoot: fixtureContentRoot };
  }
  return { temporaryRoot, contentRoot };
}

async function addSyntheticActors(contentRoot) {
  const path = join(contentRoot, "actors.yaml");
  const actors = await readYaml(path);
  actors.actors.push(
    {
      id: "actor:human-independent-reviewer",
      kind: "human",
      label: "Synthetic Independent Reviewer",
      capability_events: [
        ["draft_records", "Synthetic fixture authorship."],
        ["review_records", "Synthetic fixture review."],
        ["independent_scientific_review", "Synthetic independent review."],
      ].map(([capability, reason]) => ({
        capability,
        action: "grant",
        effective_at: "2026-09-04T03:00:00Z",
        reason,
      })),
    },
    {
      id: "actor:agent-reviewer",
      kind: "agent",
      label: "Synthetic Agent Reviewer",
      capability_events: [{
        capability: "draft_records",
        action: "grant",
        effective_at: "2026-09-04T03:00:00Z",
        reason: "Synthetic fixture drafting; Agent review remains deliberately unauthorized.",
      }],
    },
  );
  await writeYaml(path, actors);
}

function edge(overrides = {}) {
  const value = {
    id: "edge:long-yu-builds-on-bromberg-dynamics",
    source_work_id: sourceWorkId,
    source_statement_id: sourceStatementId,
    relation: "builds_on",
    target_work_id: targetWorkId,
    target_statement_id: targetStatementId,
    basis: "explicit",
    disposition: "active",
    reason: "The source explicitly adopts the target's jet-head and cocoon framework as the baseline for its time-dependent calculation.",
    evidence_ids: [sourceEvidenceId],
    curation_provenance: {
      actor_id: "actor:agent-curator",
      recorded_at: "2026-09-05T05:00:00Z",
    },
    review_state: "reviewed",
    review_provenance: {
      actor_id: "actor:human-curator",
      recorded_at: "2026-09-05T05:10:00Z",
    },
    ...overrides,
  };
  value.review_binding = {
    canonicalization_version: "v1",
    semantic_digest: scientificEdgeSemanticDigest(value),
  };
  return value;
}

function inferredEdge(overrides = {}) {
  return edge({
    id: "edge:long-yu-extends-bromberg-dynamics",
    relation: "extends",
    basis: "inferred",
    reason: "The source adds time-dependent shock and cooling evolution to the target's analytic jet propagation account.",
    evidence_ids: [sourceEvidenceId, targetEvidenceId],
    curation_provenance: {
      actor_id: "actor:human-curator",
      recorded_at: "2026-09-05T05:00:00Z",
    },
    review_provenance: {
      actor_id: "actor:human-independent-reviewer",
      recorded_at: "2026-09-05T05:10:00Z",
    },
    ...overrides,
  });
}

function edgeFileSlug(value) {
  const fileSlug = edgeFileSlugs[value.id];
  assert(fileSlug, `missing explicit filesystem slug for ${value.id}`);
  return fileSlug;
}

function edgeDiagnosticFile(value) {
  return `content/scientific-edges/${edgeFileSlug(value)}.yaml`;
}

async function writeEdge(contentRoot, value, fileSlug = edgeFileSlug(value)) {
  const path = join(contentRoot, "scientific-edges", `${fileSlug}.yaml`);
  await writeYaml(path, value);
  return path;
}

function codes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

function diagnosticFor(result, code, context = {}) {
  const diagnostic = result.diagnostics.find(
    (item) => item.code === code && Object.entries(context).every(
      ([field, expected]) => JSON.stringify(item[field]) === JSON.stringify(expected),
    ),
  );
  assert(diagnostic, `missing diagnostic ${code} with expected context ${JSON.stringify(context)}`);
  return diagnostic;
}

async function validFixture() {
  const fixture = await copyContent();
  await addSyntheticActors(fixture.contentRoot);
  return fixture;
}

test("reviewed explicit and inferred Scientific Edges satisfy their distinct Evidence and Human gates", async () => {
  const { contentRoot } = await validFixture();
  await writeEdge(contentRoot, edge());
  await writeEdge(contentRoot, inferredEdge());

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.statistics.scientific_edges, 2);
});

test("Scientific Edge relation is restricted to the frozen seven-value vocabulary", async () => {
  const { contentRoot } = await validFixture();
  const value = edge({ relation: "cites" });
  await writeEdge(contentRoot, value);

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, false);
  diagnosticFor(result, "SCIENTIFIC_EDGE_RELATION_INVALID", {
    file: edgeDiagnosticFile(value),
    record_id: value.id,
    field_path: "/relation",
  });
});

test("missing, foreign, and unilateral Evidence fail at the precise Scientific Edge reference", async () => {
  for (const [label, value, expectedCode, fieldPath] of [
    [
      "missing",
      edge({ evidence_ids: ["evidence:missing"] }),
      "REFERENTIAL_SCIENTIFIC_EDGE_EVIDENCE_MISSING",
      "/evidence_ids/0",
    ],
    [
      "foreign",
      edge({ evidence_ids: [thirdWorkEvidenceId] }),
      "SCIENTIFIC_EDGE_EVIDENCE_WORK_MISMATCH",
      "/evidence_ids/0",
    ],
    [
      "unilateral inferred",
      inferredEdge({ evidence_ids: [sourceEvidenceId, alternateSourceEvidenceId] }),
      "SCIENTIFIC_EDGE_BILATERAL_EVIDENCE_REQUIRED",
      "/evidence_ids",
    ],
  ]) {
    const { contentRoot } = await validFixture();
    await writeEdge(contentRoot, value);
    const result = await validateCanonicalContent(contentRoot);
    assert.equal(result.valid, false, label);
    diagnosticFor(result, expectedCode, {
      file: edgeDiagnosticFile(value),
      record_id: value.id,
      field_path: fieldPath,
    });
  }
});

test("Scientific Edges reject same-Work endpoints", async () => {
  const { contentRoot } = await validFixture();
  const value = edge({ target_work_id: sourceWorkId, target_statement_id: sourceStatementId });
  await writeEdge(contentRoot, value);

  const result = await validateCanonicalContent(contentRoot);
  diagnosticFor(result, "SCIENTIFIC_EDGE_SELF_LOOP", {
    file: edgeDiagnosticFile(value),
    record_id: value.id,
    field_path: "/target_work_id",
  });
});

test("optional Statement endpoints must exist and belong to the declared endpoint Work", async () => {
  for (const [value, expectedCode, fieldPath] of [
    [
      edge({ source_statement_id: "statement:missing" }),
      "REFERENTIAL_SCIENTIFIC_EDGE_STATEMENT_MISSING",
      "/source_statement_id",
    ],
    [
      edge({ source_statement_id: targetStatementId }),
      "SCIENTIFIC_EDGE_STATEMENT_WORK_MISMATCH",
      "/source_statement_id",
    ],
    [
      edge({ target_statement_id: sourceStatementId }),
      "SCIENTIFIC_EDGE_STATEMENT_WORK_MISMATCH",
      "/target_statement_id",
    ],
  ]) {
    const { contentRoot } = await validFixture();
    await writeEdge(contentRoot, value);
    const result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, expectedCode, {
      file: edgeDiagnosticFile(value),
      record_id: value.id,
      field_path: fieldPath,
    });
  }
});

test("reviewed Scientific Edges cannot expose unreviewed Statement or Evidence dependencies", async () => {
  for (const [label, fileName, collection, recordId, expectedCode, fieldPath] of [
    [
      "Statement",
      "statements.yaml",
      "statements",
      targetStatementId,
      "SCIENTIFIC_EDGE_STATEMENT_NOT_REVIEWED",
      "/target_statement_id",
    ],
    [
      "Evidence",
      "evidence.yaml",
      "evidence",
      targetEvidenceId,
      "SCIENTIFIC_EDGE_EVIDENCE_NOT_REVIEWED",
      "/evidence_ids/1",
    ],
  ]) {
    const { contentRoot } = await validFixture();
    const path = join(contentRoot, "works", targetWorkSlug, fileName);
    const envelope = await readYaml(path);
    const record = envelope[collection].find(({ id }) => id === recordId);
    record.review_state = "unreviewed";
    delete record.review_provenance;
    delete record.review_binding;
    await writeYaml(path, envelope);

    const value = inferredEdge();
    await writeEdge(contentRoot, value);
    const result = await validateCanonicalContent(contentRoot);
    assert.equal(result.valid, false, label);
    diagnosticFor(result, expectedCode, {
      file: edgeDiagnosticFile(value),
      record_id: value.id,
      field_path: fieldPath,
    });
  }
});

test("Agent review, including a different Agent, cannot satisfy Human or inferred independence gates", async () => {
  for (const [label, value] of [
    ["same Agent", edge({ review_provenance: {
      actor_id: "actor:agent-curator",
      recorded_at: "2026-09-05T05:10:00Z",
    } })],
    ["different Agent", inferredEdge({ review_provenance: {
      actor_id: "actor:agent-reviewer",
      recorded_at: "2026-09-05T05:10:00Z",
    } })],
  ]) {
    const { contentRoot } = await validFixture();
    await writeEdge(contentRoot, value);
    const result = await validateCanonicalContent(contentRoot);
    assert.equal(result.valid, false, label);
    assert(
      codes(result).has("CURATION_HUMAN_ACTOR_REQUIRED") ||
      codes(result).has("CURATION_HUMAN_REVIEW_REQUIRED"),
      `${label} must emit the Human review diagnostic`,
    );
    if (value.basis === "inferred") {
      assert(
        codes(result).has("CURATION_HUMAN_ACTOR_REQUIRED") ||
        codes(result).has("CURATION_INDEPENDENT_REVIEW_REQUIRED"),
        "inferred review cannot treat a different Agent as production independence",
      );
    }
  }
});

test("every material Scientific Edge field independently invalidates a reviewed semantic binding", async () => {
  for (const [label, mutate] of [
    ["source endpoint", (value) => { value.source_work_id = thirdWorkId; }],
    ["source Statement", (value) => { delete value.source_statement_id; }],
    ["target endpoint", (value) => { value.target_work_id = thirdWorkId; }],
    ["target Statement", (value) => { delete value.target_statement_id; }],
    ["relation", (value) => { value.relation = "tests"; }],
    ["basis", (value) => { value.basis = "inferred"; }],
    ["reason", (value) => { value.reason = "A materially different scientific delta."; }],
    ["Evidence", (value) => { value.evidence_ids = [alternateSourceEvidenceId]; }],
  ]) {
    const { contentRoot } = await validFixture();
    const value = edge();
    mutate(value);
    await writeEdge(contentRoot, value);
    const result = await validateCanonicalContent(contentRoot);
    assert(codes(result).has("SCIENTIFIC_EDGE_REVIEW_BINDING_STALE"), label);
    diagnosticFor(result, "SCIENTIFIC_EDGE_REVIEW_BINDING_STALE", {
      file: edgeDiagnosticFile(value),
      record_id: value.id,
      field_path: "/review_binding/semantic_digest",
    });
  }
});

test("reason whitespace and Evidence ordering are formatting-only Scientific Edge changes", async () => {
  const { contentRoot } = await validFixture();
  const value = inferredEdge();
  value.reason = `  ${value.reason.replaceAll(" ", "  ")}  `;
  value.evidence_ids.reverse();
  await writeEdge(contentRoot, value);

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(codes(result).has("SCIENTIFIC_EDGE_REVIEW_BINDING_STALE"), false);
});

test("Disposition is orthogonal to review and contested Edges remain contextual rather than positive signals", async () => {
  for (const disposition of ["active", "contested", "superseded", "withdrawn"]) {
    const { contentRoot } = await validFixture();
    const value = edge();
    value.disposition = disposition;
    await writeEdge(contentRoot, value);
    const result = await validateCanonicalContent(contentRoot);
    assert.equal(result.valid, true, `${disposition}: ${JSON.stringify(result.diagnostics, null, 2)}`);
    assert.equal(codes(result).has("SCIENTIFIC_EDGE_REVIEW_BINDING_STALE"), false);
  }

  const { contentRoot } = await validFixture();
  const contested = edge();
  contested.disposition = "contested";
  await writeEdge(contentRoot, contested);
  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));

  const snapshot = await loadCanonicalContent(contentRoot);
  for (const work of snapshot.works) {
    work.files["work.yaml"].reader_state = "visible";
  }
  const projection = projectVisibleSnapshot(snapshot);
  const projected = projection.scientific_edges.find(({ id }) => id === contested.id);
  assert(projected);
  assert.equal(projected.review_state, "reviewed");
  assert.equal(projected.disposition, "contested");
  assert.notEqual(projected.ranking_signal, true);
});

test("duplicate Scientific Deltas are rejected while distinct deltas for one Work pair coexist", async () => {
  const { contentRoot } = await validFixture();
  const first = edge();
  const duplicate = edge({
    id: "edge:duplicate-same-delta",
    disposition: "contested",
  });
  await writeEdge(contentRoot, first);
  await writeEdge(contentRoot, duplicate);
  let result = await validateCanonicalContent(contentRoot);
  const duplicateDiagnostic = diagnosticFor(result, "SCIENTIFIC_EDGE_DELTA_DUPLICATE");
  assert.deepEqual(
    new Set(duplicateDiagnostic.related_ids),
    new Set([first.id, duplicate.id]),
    "the diagnostic identifies both records regardless of deterministic file order",
  );

  const distinct = edge({
    id: "edge:long-yu-tests-bromberg-regime",
    relation: "tests",
    reason: "The source evaluates the target's jet propagation regime along an explicitly time-dependent trajectory.",
    evidence_ids: [alternateSourceEvidenceId],
  });
  await writeEdge(contentRoot, distinct);
  duplicate.review_state = "unreviewed";
  delete duplicate.review_provenance;
  delete duplicate.review_binding;
  duplicate.disposition = "withdrawn";
  duplicate.reason = "A withdrawn non-duplicate historical curation attempt.";
  await writeEdge(contentRoot, duplicate);
  result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
});

test("unreviewed Scientific Edges are absent from Reader and Provenance projections", async () => {
  const { contentRoot } = await validFixture();
  const reviewed = edge();
  const unreviewed = inferredEdge({
    id: "edge:unreviewed-hidden",
    review_state: "unreviewed",
  });
  delete unreviewed.review_provenance;
  delete unreviewed.review_binding;
  await writeEdge(contentRoot, reviewed);
  await writeEdge(contentRoot, unreviewed);

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  const snapshot = await loadCanonicalContent(contentRoot);
  for (const work of snapshot.works) {
    work.files["work.yaml"].reader_state = "visible";
  }
  const sourceProjection = projectWorkForReader(snapshot, sourceWorkId);
  assert(sourceProjection.scientific_edges.some(({ id }) => id === reviewed.id));
  assert.equal(sourceProjection.scientific_edges.some(({ id }) => id === unreviewed.id), false);

  const markdown = renderValidationMarkdown(result);
  assert.match(markdown, new RegExp(reviewed.id, "u"));
  assert.doesNotMatch(markdown, new RegExp(unreviewed.id, "u"));
});

test("Scientific Edge statistics report every frozen relation, including valid zero counts", async () => {
  const { contentRoot } = await validFixture();
  await writeEdge(contentRoot, edge());
  await writeEdge(contentRoot, inferredEdge());
  const result = await validateCanonicalContent(contentRoot);
  assert.deepEqual(Object.keys(result.statistics.scientific_edge_relation_counts), [...relations]);
  assert.deepEqual(result.statistics.scientific_edge_relation_counts, {
    builds_on: 1,
    extends: 1,
    tests: 0,
    constrains: 0,
    challenges: 0,
    replaces_assumption: 0,
    corrects: 0,
  });
});

async function approveCurrentEdgeVisibility(contentRoot) {
  let snapshot = await loadCanonicalContent(contentRoot);
  for (const workId of [sourceWorkId, targetWorkId]) {
    const work = snapshot.works.find(({ id }) => id === workId);
    const path = join(contentRoot, "..", work.sourcePath, "work.yaml");
    const record = await readYaml(path);
    record.visibility_approvals.at(-1).visibility_digest =
      computeReaderVisibilityDigest(snapshot, "work", workId);
    await writeYaml(path, record);
    work.files["work.yaml"] = record;
    snapshot = await loadCanonicalContent(contentRoot);
  }
}

async function makeBuildRoot(contentRoot) {
  const buildRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket10-build-"));
  for (const entry of ["astro.config.mjs", "package.json", "package-lock.json", "tsconfig.json"]) {
    await cp(new URL(`../${entry}`, import.meta.url), join(buildRoot, entry));
  }
  for (const directory of ["scripts", "src"]) {
    await cp(new URL(`../${directory}/`, import.meta.url), join(buildRoot, directory), { recursive: true });
  }
  await cp(contentRoot, join(buildRoot, "content"), { recursive: true });
  await mkdir(join(buildRoot, "generated"), { recursive: true });
  await symlink(
    fileURLToPath(new URL("../node_modules/", import.meta.url)),
    join(buildRoot, "node_modules"),
    "dir",
  );
  return buildRoot;
}

test("Reader pages render reviewed inbound/outbound Scientific Edges and bilateral Evidence provenance", async () => {
  const { contentRoot } = await copyContent({ draftReaders: false });
  await addSyntheticActors(contentRoot);
  const value = inferredEdge({ disposition: "contested" });
  await writeEdge(contentRoot, value);
  await approveCurrentEdgeVisibility(contentRoot);
  const validation = await validateCanonicalContent(contentRoot);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics, null, 2));
  const snapshot = await loadCanonicalContent(contentRoot);
  const sourceWorkSlug = snapshot.works.find(({ id }) => id === sourceWorkId)?.slug;
  const targetWorkSlug = snapshot.works.find(({ id }) => id === targetWorkId)?.slug;
  assert.equal(typeof sourceWorkSlug, "string");
  assert.equal(typeof targetWorkSlug, "string");
  const buildRoot = await makeBuildRoot(contentRoot);
  const indexBuild = spawnSync("node", ["scripts/editorial-index.mjs"], {
    cwd: buildRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(indexBuild.status, 0, indexBuild.stderr || indexBuild.stdout);
  const build = spawnSync(join(buildRoot, "node_modules", ".bin", "astro"), ["build"], {
    cwd: buildRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const sourceHtml = await readFile(join(buildRoot, "dist", "papers", sourceWorkSlug, "index.html"), "utf8");
  const targetHtml = await readFile(join(buildRoot, "dist", "papers", targetWorkSlug, "index.html"), "utf8");
  for (const [html, direction, otherWorkSlug] of [
    [sourceHtml, "outbound", targetWorkSlug],
    [targetHtml, "inbound", sourceWorkSlug],
  ]) {
    assert.match(html, new RegExp(direction, "iu"));
    assert.match(html, new RegExp(`href=["']?/papers/${otherWorkSlug}/`, "u"));
    assert.match(html, /extends/iu);
    assert.match(html, /contested/iu);
    assert.match(html, /adds time-dependent shock and cooling evolution/iu);
    assert.match(html, /basis[^<]*inferred|inferred[^<]*basis/iu);
    assert.match(html, /reviewed by actor:human-independent-reviewer/iu);
    assert.match(html, new RegExp(sourceEvidenceId, "u"));
    assert.match(html, new RegExp(targetEvidenceId, "u"));
    assert.match(
      html,
      new RegExp(`${sourceEvidenceId}[\\s\\S]{0,400}${sourceWorkId}`, "u"),
      "source Evidence provenance names its owning Work",
    );
    assert.match(
      html,
      new RegExp(`${targetEvidenceId}[\\s\\S]{0,400}${targetWorkId}`, "u"),
      "target Evidence provenance names its owning Work",
    );
    assert.match(html, /version:long-yu-2026-arxiv-v1/u);
    assert.match(html, /version:bromberg-2011-arxiv-v1/u);
    assert.match(html, /section[^<]*Abstract/iu);
    assert.match(html, /https:\/\/arxiv\.org\/abs\/2608\.12217v1/u);
    assert.match(html, /https:\/\/arxiv\.org\/abs\/1107\.1326v1/u);
  }
});
