import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  computeReaderVisibilityDigest,
  renderValidationMarkdown,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";
import {
  projectVisibleSnapshot,
  projectWorkForReader,
} from "../scripts/reader-projection.mjs";
import {
  addSyntheticActors,
  alternateSourceEvidenceId,
  codes,
  copyContent,
  diagnosticFor,
  edge,
  edgeDiagnosticFile,
  inferredEdge,
  readYaml,
  relations,
  sourceEvidenceId,
  sourceStatementId,
  sourceWorkId,
  targetEvidenceId,
  targetStatementId,
  targetWorkId,
  thirdWorkEvidenceId,
  validFixture,
  writeEdge,
  writeYaml,
} from "./helpers/scientific-edge-fixture.mjs";

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
  const buildRoot = await mkdtemp(join(tmpdir(), "astro-lineage-scientific-edges-build-"));
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
