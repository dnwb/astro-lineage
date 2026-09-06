import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { validateCanonicalContent } from "../scripts/content-validator.mjs";
import {
  alternateSourceEvidenceId,
  codes,
  diagnosticFor,
  edge,
  edgeDiagnosticFile,
  inferredEdge,
  readYaml,
  targetEvidenceId,
  targetStatementId,
  targetWorkSlug,
  thirdWorkId,
  validFixture,
  writeEdge,
  writeYaml,
} from "./helpers/scientific-edge-fixture.mjs";

test("reviewed explicit and inferred Scientific Edges satisfy their distinct Evidence and Human gates", async () => {
  const { contentRoot } = await validFixture();
  await writeEdge(contentRoot, edge());
  await writeEdge(contentRoot, inferredEdge());

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.statistics.scientific_edges, 2);
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
