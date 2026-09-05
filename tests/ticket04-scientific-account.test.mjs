import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  renderValidationMarkdown,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";

const productionContent = new URL("../content/", import.meta.url);
const arnettId = "work:arnett-1982";
const brombergId = "work:bromberg-2011";
const journalVersionId = "version:arnett-1982-journal";
const statementsFile = `content/works/${arnettId}/statements.yaml`;
const accountFile = `content/works/${arnettId}/physical-account.yaml`;

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket04b-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  const workPath = join(contentRoot, "works", arnettId, "work.yaml");
  const brombergWorkPath = join(contentRoot, "works", brombergId, "work.yaml");
  const zhuWorkPath = join(contentRoot, "works", "work:zhu-2021", "work.yaml");
  const transfitWorkPath = join(contentRoot, "works", "work:transfit-2025", "work.yaml");
  const longYuWorkPath = join(contentRoot, "works", "work:long-yu-2026", "work.yaml");
  const linePath = join(contentRoot, "research-lines", "research-line:central-engines", "line.yaml");
  const denseLinePath = join(
    contentRoot,
    "research-lines",
    "research-line:dense-environment-multimessenger",
    "line.yaml",
  );
  const explosiveLinePath = join(
    contentRoot,
    "research-lines",
    "research-line:explosive-transients-csm",
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
  const workRoot = join(contentRoot, "works", arnettId);
  const [statements, account, evidence, annotations] = await Promise.all(
    ["statements.yaml", "physical-account.yaml", "evidence.yaml", "annotations.yaml"].map(
      async (fileName) => parse(await readFile(join(workRoot, fileName), "utf8")),
    ),
  );
  return { workRoot, statements, account, evidence, annotations };
}

async function writeArnett(workRoot, fileName, value) {
  await writeFile(join(workRoot, fileName), stringify(value), "utf8");
}

function codes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

function diagnosticFor(result, code, context = {}) {
  const diagnostic = result.diagnostics.find((item) => item.code === code);
  assert(diagnostic, `missing diagnostic ${code}`);
  for (const [field, expected] of Object.entries(context)) {
    assert.deepEqual(diagnostic[field], expected, `${code} context field ${field}`);
  }
  return diagnostic;
}

function findStatement(statements, id) {
  const statement = statements.statements.find(({ id: statementId }) => statementId === id);
  assert(statement, `missing production statement ${id}`);
  return statement;
}

function findLink(account, id) {
  const link = account.links.find(({ id: linkId }) => linkId === id);
  assert(link, `missing production causal link ${id}`);
  return link;
}

test("4B production slice stores Work-local Statements with Version attestations and an inferred reviewed synthesis", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === arnettId);
  const statements = work.files["statements.yaml"].statements;
  const inferred = statements.find(({ basis }) => basis === "inferred");
  const evidenceById = new Map(work.files["evidence.yaml"].evidence.map((evidence) => [evidence.id, evidence]));
  const actorsById = new Map(snapshot.actors.actors.map((actor) => [actor.id, actor]));

  assert.equal(result.valid, true);
  assert.equal(statements.length, 4);
  assert(statements.every(({ id }) => /^statement:[a-z0-9._-]+$/u.test(id)));
  assert(statements.every(({ kind }) => ["assumption", "claim", "prediction", "result"].includes(kind)));
  assert(statements.some(({ basis }) => basis === "explicit"));
  assert(statements.some(({ basis }) => basis === "inferred"));
  assert(statements.every(({ lifecycle }) => ["maintained", "superseded", "withdrawn"].includes(lifecycle)));
  assert(statements.every(({ canonical_text, attestations }) =>
    typeof canonical_text === "string" && canonical_text.trim() !== "" &&
    Array.isArray(attestations) && attestations.length > 0));
  assert(statements.every(({ attestations }) => attestations.every((attestation) =>
    attestation.version_id === journalVersionId && attestation.evidence_ids.length > 0 &&
    attestation.evidence_ids.every((evidenceId) => evidenceById.has(evidenceId)))));
  assert(statements.every(({ canonical_text, attestations }) =>
    attestations.every(({ evidence_ids: evidenceIds }) =>
      evidenceIds.every((evidenceId) => canonical_text !== evidenceById.get(evidenceId).excerpt))));
  assert(inferred);
  assert.equal(inferred.kind, "claim");
  assert.equal(inferred.review_state, "reviewed");
  assert.equal(inferred.curation_provenance.actor_id, "actor:agent-curator");
  assert.equal(inferred.review_provenance.actor_id, "actor:human-curator");
  assert.notEqual(inferred.curation_provenance.actor_id, inferred.review_provenance.actor_id);
  assert(inferred.reason.trim().length > 0);
  assert(inferred.attestations.reduce((count, { evidence_ids: evidenceIds }) => count + evidenceIds.length, 0) >= 2);
  const inferredReviewer = actorsById.get(inferred.review_provenance.actor_id);
  assert.equal(inferredReviewer?.kind, "human");
  assert(inferredReviewer.capability_events.some(({ capability, action }) =>
    capability === "independent_scientific_review" && action === "grant"));
  assert.equal(inferred.review_binding.canonicalization_version, "v1");
  assert.match(inferred.review_binding.semantic_digest, /^[0-9a-f]{64}$/u);
});

test("4B production Physical Account is Work-local, controlled-Annotation based, acyclic, and uses only frozen links", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === arnettId);
  const account = work.files["physical-account.yaml"];
  const annotationIds = new Set(work.files["annotations.yaml"].annotations.map(({ id }) => id));

  assert.equal(result.valid, true);
  assert(account.stages.length >= 5);
  assert(account.links.length >= 3);
  assert(account.stages.every(({ id, annotation_id: annotationId }) =>
    /^stage:[a-z0-9._-]+$/u.test(id) && annotationIds.has(annotationId)));
  assert(account.links.every(({ id, source_stage_id: source, target_stage_id: target, relation }) =>
    /^causal-link:[a-z0-9._-]+$/u.test(id) && source !== target &&
    ["drives", "enables", "transforms_into", "produces", "modulates"].includes(relation)));
  const explicit = account.links.find(({ origin }) => origin === "explicit");
  const inferred = account.links.find(({ origin }) => origin === "inferred");
  assert(explicit && inferred);
  assert.equal(explicit.interpretive_risk, "interpretive");
  assert(explicit.evidence_ids.length > 0);
  assert.equal(explicit.review_state, "reviewed");
  assert.equal(inferred.interpretive_risk, "synthetic");
  assert(inferred.evidence_ids.length >= 2);
  assert.equal(inferred.review_state, "reviewed");
  assert.notEqual(inferred.curation_provenance.actor_id, inferred.review_provenance.actor_id);
  assert.deepEqual(
    snapshot.scientificEdges.map(({ id }) => id).sort(),
    [
      "edge:long-yu-extends-zhu-dynamic-trajectory",
      "edge:transfit-challenges-arnett-maximum-light",
    ],
  );
});

test("Statements reject invalid kind, basis, lifecycle, and cross-Version attestations", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, statements } = await readArnett(contentRoot);
  const statement = statements.statements[0];
  const statementIndex = statements.statements.indexOf(statement);
  statement.kind = "observation";
  statement.basis = "derived";
  statement.lifecycle = "contested";
  statement.attestations[0].version_id = "version:other-work";
  await writeArnett(workRoot, "statements.yaml", statements);

  const result = await validateCanonicalContent(contentRoot);
  const diagnosticCodes = codes(result);
  assert(diagnosticCodes.has("STATEMENT_KIND_INVALID"));
  assert(diagnosticCodes.has("STATEMENT_BASIS_INVALID"));
  assert(diagnosticCodes.has("STATEMENT_LIFECYCLE_INVALID"));
  assert(diagnosticCodes.has("STATEMENT_ATTESTATION_VERSION_MISMATCH"));
  const statementId = statements.statements[0].id;
  diagnosticFor(result, "STATEMENT_KIND_INVALID", {
    file: statementsFile,
    record_id: statementId,
    field_path: `/statements/${statementIndex}/kind`,
  });
  diagnosticFor(result, "STATEMENT_BASIS_INVALID", {
    file: statementsFile,
    record_id: statementId,
    field_path: `/statements/${statementIndex}/basis`,
  });
  diagnosticFor(result, "STATEMENT_LIFECYCLE_INVALID", {
    file: statementsFile,
    record_id: statementId,
    field_path: `/statements/${statementIndex}/lifecycle`,
  });
  diagnosticFor(result, "STATEMENT_ATTESTATION_VERSION_MISMATCH", {
    file: statementsFile,
    record_id: statementId,
    field_path: `/statements/${statementIndex}/attestations/0/version_id`,
  });
});

test("Statements reject missing or foreign Evidence in Version attestations", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, statements } = await readArnett(contentRoot);
  statements.statements[0].attestations[0].evidence_ids = ["evidence:not-in-work"];
  await writeArnett(workRoot, "statements.yaml", statements);

  const result = await validateCanonicalContent(contentRoot);
  const diagnosticCodes = codes(result);
  assert(diagnosticCodes.has("REFERENTIAL_EVIDENCE_MISSING"));
  assert(!diagnosticCodes.has("STATEMENT_ATTESTATION_EVIDENCE_VERSION_MISMATCH"));
  diagnosticFor(result, "REFERENTIAL_EVIDENCE_MISSING", {
    file: statementsFile,
    record_id: statements.statements[0].id,
    field_path: "/statements/0/attestations/0/evidence_ids/0",
  });
});

test("inferred Statements require a normalized reason, concrete Evidence, and independent Human review", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, statements } = await readArnett(contentRoot);
  const inferred = statements.statements.find(({ basis }) => basis === "inferred");
  assert(inferred);
  const statementIndex = statements.statements.indexOf(inferred);
  delete inferred.reason;
  inferred.attestations[0].evidence_ids = [];
  inferred.review_provenance.actor_id = "actor:agent-curator";
  await writeArnett(workRoot, "statements.yaml", statements);

  const result = await validateCanonicalContent(contentRoot);
  const diagnosticCodes = codes(result);
  assert(diagnosticCodes.has("STATEMENT_INFERRED_REASON_REQUIRED"));
  assert(diagnosticCodes.has("EVIDENCE_REQUIRED"));
  assert(diagnosticCodes.has("CURATION_HUMAN_REVIEW_REQUIRED"));
  assert(diagnosticCodes.has("CURATION_INDEPENDENT_REVIEW_REQUIRED"));
  diagnosticFor(result, "STATEMENT_INFERRED_REASON_REQUIRED", {
    file: statementsFile,
    record_id: inferred.id,
    field_path: `/statements/${statementIndex}/reason`,
  });
});

test("reviewed Statement semantic bindings become stale after semantic edits", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, statements } = await readArnett(contentRoot);
  const statement = findStatement(statements, "statement:arnett-analytic-light-curve-solutions");
  statement.canonical_text = `${statement.canonical_text} with a materially different claim.`;
  await writeArnett(workRoot, "statements.yaml", statements);

  const result = await validateCanonicalContent(contentRoot);
  assert(codes(result).has("STATEMENT_REVIEW_BINDING_STALE"));
  diagnosticFor(result, "STATEMENT_REVIEW_BINDING_STALE", {
    file: statementsFile,
    record_id: statement.id,
    field_path: "/statements/0/review_binding",
  });
});

test("Statement Evidence and attestation ordering are formatting-only changes", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, statements } = await readArnett(contentRoot);
  const statement = findStatement(statements, "statement:arnett-radioactive-optical-account");
  statement.canonical_text = `  ${statement.canonical_text.replaceAll(" ", "  ")}  `;
  statement.attestations.reverse();
  statement.attestations.forEach((attestation) => attestation.evidence_ids.reverse());
  await writeArnett(workRoot, "statements.yaml", statements);

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true);
  assert(!codes(result).has("STATEMENT_REVIEW_BINDING_STALE"));
});

test("Statement semantic evolution preserves the prior identity and creates a new unreviewed Statement", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, statements } = await readArnett(contentRoot);
  const prior = findStatement(statements, "statement:arnett-analytic-light-curve-solutions");
  const evolved = structuredClone(prior);
  evolved.id = "statement:arnett-analytic-light-curve-solutions-expanded";
  evolved.canonical_text = `${prior.canonical_text} The later semantic formulation also addresses transparency.`;
  evolved.review_state = "unreviewed";
  evolved.curation_provenance.recorded_at = "2026-09-04T06:00:00Z";
  delete evolved.review_provenance;
  delete evolved.review_binding;
  statements.statements.push(evolved);
  await writeArnett(workRoot, "statements.yaml", statements);

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true);
  assert(statements.statements.some(({ id }) => id === prior.id));
  assert(statements.statements.some(({ id }) => id === evolved.id));
});

test("unreviewed governed records cannot retain prior review bindings", async () => {
  for (const [fileName, select] of [
    ["statements.yaml", ({ statements }) => statements.statements[0]],
    ["physical-account.yaml", ({ account }) => account.links[0]],
  ]) {
    const { contentRoot } = await copyContent();
    const records = await readArnett(contentRoot);
    const record = select(records);
    record.review_state = "unreviewed";
    delete record.review_provenance;
    await writeArnett(
      records.workRoot,
      fileName,
      fileName === "statements.yaml" ? records.statements : records.account,
    );

    const result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, "REVIEW_BINDING_WITHOUT_REVIEW", {
      file: `content/works/${arnettId}/${fileName}`,
      record_id: record.id,
    });
  }
});

test("Causal Links enforce frozen relations, local endpoints, and non-cascading DAG diagnostics", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, account } = await readArnett(contentRoot);
  const link = account.links[0];
  link.relation = "related_to";
  link.target_stage_id = "stage:not-present";
  await writeArnett(workRoot, "physical-account.yaml", account);

  const result = await validateCanonicalContent(contentRoot);
  const diagnosticCodes = codes(result);
  assert(diagnosticCodes.has("CAUSAL_LINK_RELATION_INVALID"));
  assert(diagnosticCodes.has("REFERENTIAL_CAUSAL_STAGE_MISSING"));
  assert(!diagnosticCodes.has("CAUSAL_ACCOUNT_CYCLE"));
  diagnosticFor(result, "CAUSAL_LINK_RELATION_INVALID", {
    file: accountFile,
    record_id: link.id,
    field_path: "/links/0/relation",
  });
  diagnosticFor(result, "REFERENTIAL_CAUSAL_STAGE_MISSING", {
    file: accountFile,
    record_id: link.id,
    field_path: "/links/0/target_stage_id",
  });
});

test("Causal Account rejects missing Annotation stages, self-loops, and cycles", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, account } = await readArnett(contentRoot);
  account.stages[0].annotation_id = "annotation:not-present";
  account.links[0].source_stage_id = account.links[0].target_stage_id;
  account.links[1].source_stage_id = account.stages[1].id;
  account.links[1].target_stage_id = account.stages[2].id;
  account.links[2].source_stage_id = account.stages[2].id;
  account.links[2].target_stage_id = account.stages[1].id;
  await writeArnett(workRoot, "physical-account.yaml", account);

  const result = await validateCanonicalContent(contentRoot);
  const diagnosticCodes = codes(result);
  assert(diagnosticCodes.has("REFERENTIAL_CAUSAL_ANNOTATION_MISSING"));
  assert(diagnosticCodes.has("CAUSAL_LINK_SELF_LOOP"));
  assert(diagnosticCodes.has("CAUSAL_ACCOUNT_CYCLE"));
  diagnosticFor(result, "REFERENTIAL_CAUSAL_ANNOTATION_MISSING", {
    file: accountFile,
    record_id: account.stages[0].id,
    field_path: "/stages/0/annotation_id",
  });
  diagnosticFor(result, "CAUSAL_LINK_SELF_LOOP", {
    file: accountFile,
    record_id: account.links[0].id,
  });
});

test("explicit and inferred Causal Links use separate risk, evidence, and review rules", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, account } = await readArnett(contentRoot);
  const explicit = account.links.find(({ origin }) => origin === "explicit");
  const inferred = account.links.find(({ origin }) => origin === "inferred");
  assert(explicit && inferred);
  const inferredIndex = account.links.indexOf(inferred);
  explicit.evidence_ids = [];
  inferred.interpretive_risk = "descriptive";
  inferred.review_provenance.actor_id = "actor:agent-curator";
  inferred.evidence_ids = [inferred.evidence_ids[0]];
  await writeArnett(workRoot, "physical-account.yaml", account);

  const result = await validateCanonicalContent(contentRoot);
  const diagnosticCodes = codes(result);
  assert(diagnosticCodes.has("EVIDENCE_REQUIRED"));
  assert(diagnosticCodes.has("CAUSAL_LINK_INFERRED_DESCRIPTIVE_FORBIDDEN"));
  assert(diagnosticCodes.has("CAUSAL_LINK_MULTIPLE_EVIDENCE_REQUIRED"));
  assert(diagnosticCodes.has("CURATION_INDEPENDENT_REVIEW_REQUIRED"));
  diagnosticFor(result, "CAUSAL_LINK_INFERRED_DESCRIPTIVE_FORBIDDEN", {
    file: accountFile,
    record_id: inferred.id,
    field_path: `/links/${inferredIndex}/interpretive_risk`,
  });
});

test("reviewed Causal Link bindings ignore reason whitespace and Evidence order but reject semantic changes", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, account } = await readArnett(contentRoot);
  const link = findLink(account, "causal-link:arnett-radioactive-optical-light");
  const linkIndex = account.links.indexOf(link);
  link.reason = `  ${link.reason.replaceAll(" ", "  ")}  `;
  link.evidence_ids.reverse();
  await writeArnett(workRoot, "physical-account.yaml", account);
  const formattingOnly = await validateCanonicalContent(contentRoot);
  assert.equal(formattingOnly.valid, true);
  assert(!codes(formattingOnly).has("CAUSAL_LINK_REVIEW_BINDING_STALE"));

  link.relation = link.relation === "drives" ? "enables" : "drives";
  await writeArnett(workRoot, "physical-account.yaml", account);
  const semanticEdit = await validateCanonicalContent(contentRoot);
  assert(codes(semanticEdit).has("CAUSAL_LINK_REVIEW_BINDING_STALE"));
  diagnosticFor(semanticEdit, "CAUSAL_LINK_REVIEW_BINDING_STALE", {
    file: accountFile,
    record_id: link.id,
    field_path: `/links/${linkIndex}/review_binding`,
  });
});

test("validation reports expose stored scientific-account counts and status without creating Paper Graph Edges", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  const expectedCounts = snapshot.works.reduce((counts, { files }) => ({
    scientific_statements: counts.scientific_statements + (files["statements.yaml"]?.statements.length ?? 0),
    causal_stages: counts.causal_stages + (files["physical-account.yaml"]?.stages.length ?? 0),
    causal_links: counts.causal_links + (files["physical-account.yaml"]?.links.length ?? 0),
  }), {
    scientific_statements: 0,
    causal_stages: 0,
    causal_links: 0,
  });
  const arnettWork = snapshot.works.find(({ id }) => id === arnettId);
  assert(arnettWork);
  const arnettInventory = result.work_inventory.find(({ work_id: workId }) => workId === arnettId);
  assert(arnettInventory);

  assert.equal(result.statistics.scientific_statements, expectedCounts.scientific_statements);
  assert.equal(result.statistics.causal_stages, expectedCounts.causal_stages);
  assert.equal(result.statistics.causal_links, expectedCounts.causal_links);
  assert.equal(arnettInventory.scientific_statements, arnettWork.files["statements.yaml"].statements.length);
  assert.equal(arnettInventory.causal_stages, arnettWork.files["physical-account.yaml"].stages.length);
  assert.equal(arnettInventory.causal_links, arnettWork.files["physical-account.yaml"].links.length);
  assert.equal(arnettInventory.scientific_account_validation_status, "valid");
  assert.deepEqual(
    snapshot.scientificEdges.map(({ id }) => id).sort(),
    [
      "edge:long-yu-extends-zhu-dynamic-trajectory",
      "edge:transfit-challenges-arnett-maximum-light",
    ],
  );
});

test("malformed Annotation and Causal Stage records quarantine dependent checks and pass metadata", async () => {
  for (const [fileName, mutate, expectedCode] of [
    [
      "annotations.yaml",
      ({ account, annotations }) => {
        const annotationId = account.stages[0].annotation_id;
        const annotation = annotations.annotations.find(({ id }) => id === annotationId);
        assert(annotation);
        annotation.assessment.values = "not-an-array";
      },
      "ANNOTATION_VALUES_INVALID",
    ],
    [
      "physical-account.yaml",
      ({ account }) => {
        account.stages[0] = null;
      },
      "CAUSAL_STAGE_INVALID_SHAPE",
    ],
  ]) {
    const { contentRoot } = await copyContent();
    const records = await readArnett(contentRoot);
    mutate(records);
    await writeArnett(records.workRoot, fileName, fileName === "annotations.yaml"
      ? records.annotations
      : records.account);

    const result = await validateCanonicalContent(contentRoot);
    assert.equal(result.valid, false);
    assert.equal(result.passes.structural.status, "partial");
    assert.equal(result.passes.structural.diagnostic_count, 1);
    assert.equal(result.passes.referential.status, "skipped");
    assert.equal(result.passes.referential.diagnostic_count, 0);
    assert.equal(result.passes.semantic.status, "skipped");
    assert.equal(result.passes.semantic.diagnostic_count, 0);
    assert.equal(result.work_inventory[0].scientific_account_validation_status, "invalid");
    assert.equal(result.diagnostics.filter(({ code }) => code === expectedCode).length, 1);
    assert(!codes(result).has("REFERENTIAL_CAUSAL_STAGE_MISSING"));
    assert(!codes(result).has("CAUSAL_ACCOUNT_CYCLE"));
  }
});

test("a malformed Actor Registry invalidates every governed Scientific Account", async () => {
  const { contentRoot } = await copyContent();
  const actorsPath = join(contentRoot, "actors.yaml");
  const actors = parse(await readFile(actorsPath, "utf8"));
  actors.actors[0] = null;
  await writeFile(actorsPath, stringify(actors), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, false);
  diagnosticFor(result, "STRUCTURE_ACTOR_INVALID_SHAPE", {
    file: "content/actors.yaml",
    record_id: "actors",
    field_path: "/actors/0",
  });
  assert.equal(result.passes.structural.status, "partial");
  assert.equal(result.passes.structural.diagnostic_count, 1);
  assert.equal(result.passes.referential.status, "skipped");
  assert.equal(result.passes.referential.diagnostic_count, 0);
  assert.equal(result.passes.semantic.status, "skipped");
  assert.equal(result.passes.semantic.diagnostic_count, 0);
  assert.equal(result.work_inventory[0].scientific_account_validation_status, "invalid");
  assert.equal(result.scientific_accounts[0].validation_status, "invalid");
});

test("local Statement and Evidence reference shape failures are structural, while policy failures remain semantic", async () => {
  for (const [fileName, mutate, expectedCode] of [
    [
      "statements.yaml",
      ({ statements }) => {
        const statement = statements.statements[0];
        statement.canonical_text = "";
        statement.review_state = "unreviewed";
        delete statement.review_provenance;
        delete statement.review_binding;
      },
      "STATEMENT_CANONICAL_TEXT_INVALID",
    ],
    [
      "physical-account.yaml",
      ({ account }) => {
        const link = account.links[0];
        link.evidence_ids = "not-an-array";
        link.review_state = "unreviewed";
        delete link.review_provenance;
        delete link.review_binding;
      },
      "EVIDENCE_REFERENCES_INVALID",
    ],
  ]) {
    const { contentRoot } = await copyContent();
    const records = await readArnett(contentRoot);
    mutate(records);
    await writeArnett(records.workRoot, fileName, fileName === "statements.yaml"
      ? records.statements
      : records.account);

    const result = await validateCanonicalContent(contentRoot);
    assert.equal(result.valid, false);
    assert.equal(result.passes.structural.status, "partial");
    assert.equal(result.passes.structural.diagnostic_count, 1);
    assert.equal(result.passes.referential.status, "skipped");
    assert.equal(result.passes.referential.diagnostic_count, 0);
    assert.equal(result.passes.semantic.status, "skipped");
    assert.equal(result.passes.semantic.diagnostic_count, 0);
    assert.equal(result.diagnostics.filter(({ code }) => code === expectedCode).length, 1);
  }

  const { contentRoot } = await copyContent();
  const { workRoot, account } = await readArnett(contentRoot);
  const inferred = account.links.find(({ origin }) => origin === "inferred");
  assert(inferred);
  inferred.interpretive_risk = "descriptive";
  inferred.review_state = "unreviewed";
  delete inferred.review_provenance;
  delete inferred.review_binding;
  await writeArnett(workRoot, "physical-account.yaml", account);

  const semantic = await validateCanonicalContent(contentRoot);
  assert.equal(semantic.valid, false);
  assert.equal(semantic.passes.structural.status, "complete");
  assert.equal(semantic.passes.structural.diagnostic_count, 0);
  assert.equal(semantic.passes.referential.status, "complete");
  assert.equal(semantic.passes.referential.diagnostic_count, 0);
  assert.equal(semantic.passes.semantic.status, "partial");
  assert.equal(semantic.passes.semantic.diagnostic_count, 1);
  assert.equal(semantic.diagnostics.filter(({ code }) =>
    code === "CAUSAL_LINK_INFERRED_DESCRIPTIVE_FORBIDDEN").length, 1);
});

test("invalid locator on Evidence referenced by the scientific account invalidates its account status", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, evidence } = await readArnett(contentRoot);
  const referenced = evidence.evidence.find(({ id }) => id === "evidence:arnett-abstract");
  assert(referenced);
  referenced.locator.page = 0;
  await writeArnett(workRoot, "evidence.yaml", evidence);

  const result = await validateCanonicalContent(contentRoot);
  const diagnostic = diagnosticFor(result, "EVIDENCE_LOCATOR_PAGE_INVALID", {
    file: `content/works/${arnettId}/evidence.yaml`,
    record_id: referenced.id,
    field_path: "/evidence/0/locator/page",
  });
  assert(diagnostic);
  assert.equal(result.work_inventory[0].scientific_account_validation_status, "invalid");
  assert.equal(result.scientific_accounts[0].statements[0].evidence[0].locator.page, 0);
});

test("validation reports project scientific-account evidence and provenance into JSON and Markdown views", async () => {
  const result = await validateCanonicalContent(productionContent);
  const account = result.scientific_accounts.find(({ work_id: workId }) => workId === arnettId);
  assert(account);
  assert.equal(account.validation_status, "valid");

  const statement = account.statements.find(({ id }) =>
    id === "statement:arnett-radioactive-optical-account");
  assert(statement);
  assert.equal(statement.kind, "claim");
  assert.equal(statement.basis, "inferred");
  assert.equal(statement.lifecycle, "maintained");
  assert.equal(
    statement.canonical_text,
    "Radioactive decay deposition followed by diffusion through expanding ejecta accounts for the modeled optical luminosity.",
  );
  assert.equal(statement.review_state, "reviewed");
  assert.equal(statement.evidence_ids.length, 3);
  assert(statement.evidence.every(({ version_id, locator, source_url }) =>
    version_id === journalVersionId && locator && typeof locator.type === "string" &&
    source_url === "https://articles.adsabs.harvard.edu/pdf/1982ApJ...253..785A"));
  assert.equal(statement.curation_provenance.actor_id, "actor:agent-curator");
  assert.equal(statement.curation_provenance.recorded_at, "2026-09-04T04:31:00Z");
  assert.equal(statement.review_provenance.actor_id, "actor:human-curator");
  assert.equal(statement.review_provenance.recorded_at, "2026-09-04T12:30:31Z");

  assert.equal(account.stages.length, 6);
  assert.deepEqual(account.stages[0], {
    id: "stage:arnett-radioactive-decay",
    annotation_id: "annotation:arnett-particle-interaction",
    label: "Radioactive decay chain",
  });
  assert(account.stages.every(({ id, annotation_id: annotationId, label }) =>
    typeof id === "string" && annotationId.startsWith("annotation:") &&
    typeof label === "string" && label.length > 0));

  const link = account.links.find(({ id }) => id === "causal-link:arnett-heating-to-optical-light");
  assert(link);
  assert.equal(link.relation, "drives");
  assert.equal(link.origin, "inferred");
  assert.equal(link.interpretive_risk, "synthetic");
  assert.equal(link.source_stage_id, "stage:arnett-decay-heating");
  assert.equal(link.target_stage_id, "stage:arnett-modeled-optical-light");
  assert(link.evidence.some(({ id }) => id === "evidence:arnett-ubv"));
  assert.equal(link.curation_provenance.actor_id, "actor:agent-curator");
  assert.equal(link.curation_provenance.recorded_at, "2026-09-04T05:10:20Z");
  assert.equal(link.review_provenance.actor_id, "actor:human-curator");
  assert.equal(link.review_provenance.recorded_at, "2026-09-04T12:30:31Z");

  const markdown = renderValidationMarkdown(result);
  assert.match(markdown, /## Scientific Account Provenance/);
  assert.match(markdown, /### Statements/);
  assert.match(markdown, /### Causal Links/);
  assert.match(markdown, /statement:arnett-radioactive-optical-account/);
  assert.match(markdown, /\| claim \| inferred \| maintained \|/);
  assert.match(markdown, /Radioactive decay deposition followed by diffusion through expanding ejecta/);
  assert.match(markdown, /evidence:arnett-radioactive-diffusion \(version:arnett-1982-journal;/);
  assert.match(markdown, /type=equation, page=786, section=II\(b\)/);
  assert.match(markdown, /source_url=https:\/\/articles\.adsabs\.harvard\.edu\/pdf\/1982ApJ\.\.\.253\.\.785A/);
  assert.match(markdown, /stage:arnett-radioactive-decay \| annotation:arnett-particle-interaction \| Radioactive decay chain/);
  assert.match(markdown, /causal-link:arnett-heating-to-optical-light/);
  assert.match(markdown, /\| drives \| inferred \| synthetic \|/);
  assert.match(markdown, /2026-09-04T12:30:31Z/);
  assert.match(markdown, /actor:human-curator/);

  const markdownLines = markdown.split("\n");
  for (const headerPrefix of ["| Work ID | Statement ID |", "| Work ID | Causal Link ID |"]) {
    const headerIndex = markdownLines.findIndex((line) => line.startsWith(headerPrefix));
    assert(headerIndex >= 0, `missing Markdown table header ${headerPrefix}`);
    const widths = markdownLines
      .slice(headerIndex, headerIndex + 3)
      .map((line) => line.split("|").length - 2);
    assert.equal(widths[1], widths[0], `${headerPrefix} delimiter width`);
    assert.equal(widths[2], widths[0], `${headerPrefix} data width`);
  }
});
