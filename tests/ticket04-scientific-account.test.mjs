import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import { validateCanonicalContent } from "../scripts/content-validator.mjs";

const productionContent = new URL("../content/", import.meta.url);
const arnettId = "work:arnett-1982";
const journalVersionId = "version:arnett-1982-journal";
const statementsFile = `content/works/${arnettId}/statements.yaml`;
const accountFile = `content/works/${arnettId}/physical-account.yaml`;

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket04b-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
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
  assert.equal(snapshot.scientificEdges.length, 0);
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
  const work = snapshot.works.find(({ id }) => id === arnettId);

  assert.equal(result.statistics.scientific_statements, work.files["statements.yaml"].statements.length);
  assert.equal(result.statistics.causal_stages, work.files["physical-account.yaml"].stages.length);
  assert.equal(result.statistics.causal_links, work.files["physical-account.yaml"].links.length);
  assert.equal(result.work_inventory[0].scientific_statements, result.statistics.scientific_statements);
  assert.equal(result.work_inventory[0].causal_stages, result.statistics.causal_stages);
  assert.equal(result.work_inventory[0].causal_links, result.statistics.causal_links);
  assert.equal(result.work_inventory[0].scientific_account_validation_status, "valid");
  assert.deepEqual(snapshot.scientificEdges, []);
});
