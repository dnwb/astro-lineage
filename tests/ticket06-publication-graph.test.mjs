import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  publicationRelationSemanticDigest,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";
import { projectWorkForReader } from "../scripts/reader-projection.mjs";

const projectRoot = new URL("../", import.meta.url);
const productionContent = new URL("../content/", import.meta.url);
const workId = "work:arnett-1982";
const journalVersionId = "version:arnett-1982-journal";
const sharedSourceId = "source:arnett-publication-graph";
const brombergWorkId = "work:bromberg-2011";

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket06-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  const workRoot = join(contentRoot, "works", workId);
  const versionsPath = join(workRoot, "versions.yaml");
  const workPath = join(workRoot, "work.yaml");
  const brombergWorkPath = join(contentRoot, "works", brombergWorkId, "work.yaml");
  const linePath = join(contentRoot, "research-lines", "research-line:central-engines", "line.yaml");
  const versions = parse(await readFile(versionsPath, "utf8"));
  const work = parse(await readFile(workPath, "utf8"));
  const brombergWork = parse(await readFile(brombergWorkPath, "utf8"));
  const line = parse(await readFile(linePath, "utf8"));
  work.reader_state = "draft";
  work.visibility_approvals = [];
  brombergWork.reader_state = "draft";
  brombergWork.visibility_approvals = [];
  line.reader_state = "draft";
  line.visibility_approvals = [];
  await Promise.all([
    writeFile(workPath, stringify(work), "utf8"),
    writeFile(brombergWorkPath, stringify(brombergWork), "utf8"),
    writeFile(linePath, stringify(line), "utf8"),
  ]);
  return { temporaryRoot, contentRoot, workRoot, versions, versionsPath };
}

function leafPointers(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leafPointers(item, `${prefix}/${index}`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      leafPointers(child, `${prefix}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`),
    );
  }
  return [prefix || "/"];
}

function addFieldSources(version, sourceIds) {
  const fields = structuredClone(version);
  delete fields.id;
  delete fields.kind;
  delete fields.field_sources;
  version.field_sources = Object.fromEntries(
    leafPointers(fields).map((pointer) => [pointer, [...sourceIds]]),
  );
  return version;
}

function relation(overrides = {}) {
  const base = {
    id: "publication-relation:arnett-arxiv-v2-journal",
    source_version_id: "version:arnett-1982-arxiv-v2",
    target_version_id: journalVersionId,
    relation: "published_as",
    basis: "source_asserted",
    reason: "The ADS record explicitly maps the curated arXiv revision to the journal manifestation.",
    bibliographic_source_ids: [sharedSourceId],
    curation_provenance: {
      actor_id: "actor:human-curator",
      recorded_at: "2026-09-04T05:00:00Z",
    },
    review_state: "reviewed",
    review_provenance: {
      actor_id: "actor:human-curator",
      recorded_at: "2026-09-04T05:01:00Z",
    },
  };
  const result = { ...base, ...overrides };
  result.review_binding = {
    canonicalization_version: "v1",
    semantic_digest: publicationRelationSemanticDigest(result),
  };
  return result;
}

async function makePublicationFixture() {
  const fixture = await copyContent();
  const journal = fixture.versions.versions.find(({ id }) => id === journalVersionId);
  const source = {
    id: sharedSourceId,
    provider: "ads",
    record_id: "1107.1326",
    source_url: "https://ui.adsabs.harvard.edu/abs/1107.1326/abstract",
    retrieved_at: "2026-09-04T04:50:00Z",
  };
  const makeArxiv = (id, revision, date) => addFieldSources({
    id,
    kind: "arxiv_revision",
    title: journal.title,
    authors: structuredClone(journal.authors),
    release_date: { value: date, precision: "day" },
    arxiv_id: "1107.1326",
    arxiv_revision: revision,
    access_urls: [{ kind: "arxiv", url: `https://arxiv.org/abs/1107.1326v${revision}` }],
  }, [sharedSourceId]);
  const arxivV1 = makeArxiv(
    "version:arnett-1982-arxiv-v1",
    1,
    "2011-07-07",
  );
  const arxivV2 = makeArxiv(
    "version:arnett-1982-arxiv-v2",
    2,
    "2011-07-08",
  );
  addFieldSources(journal, [sharedSourceId]);
  fixture.versions.bibliographic_sources.push(source);
  fixture.versions.versions = [arxivV1, arxivV2, journal];
  fixture.versions.publication_relations = [
    relation({
      id: "publication-relation:arnett-arxiv-v2-v1",
      source_version_id: arxivV2.id,
      target_version_id: arxivV1.id,
      relation: "revises",
      reason: undefined,
    }),
    relation(),
  ];
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
  return fixture;
}

function codes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

async function validateFixture(fixture) {
  return validateCanonicalContent(fixture.contentRoot);
}

test("production Bromberg is visible and its publication/scientific structures render", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === brombergWorkId);
  assert(work, "production Bromberg Work is present");
  const workRecord = work.files["work.yaml"];
  const versionsRecord = work.files["versions.yaml"];
  const annotationsRecord = work.files["annotations.yaml"];
  const statementsRecord = work.files["statements.yaml"];
  const accountRecord = work.files["physical-account.yaml"];

  assert.equal(result.valid, true);
  assert.equal(workRecord.reader_state, "visible");
  const approval = workRecord.visibility_approvals.at(-1);
  assert.equal(approval.profile_id, snapshot.manifest.visibility_profile_id);
  assert.equal(approval.actor_id, "actor:human-curator");
  assert.match(approval.visibility_digest, /^[0-9a-f]{64}$/u);
  assert.equal(
    result.work_inventory.find(({ work_id }) => work_id === brombergWorkId)?.visibility_status,
    "approved",
  );

  const versions = versionsRecord.versions;
  assert.equal(versions.length, 2);
  assert.deepEqual(
    versions.map(({ kind }) => kind).sort(),
    ["arxiv_revision", "journal_manifestation"],
  );
  const arxiv = versions.find(({ kind }) => kind === "arxiv_revision");
  const journal = versions.find(({ kind }) => kind === "journal_manifestation");
  assert.equal(arxiv.arxiv_id, "1107.1326");
  assert.equal(arxiv.arxiv_revision, 1);
  assert.equal(arxiv.release_date.value, "2011-07-07");
  assert.equal(journal.doi, "10.1088/0004-637x/740/2/100");
  assert.equal(journal.release_date.value, "2011-10-04");
  for (const version of versions) {
    assert(version.field_sources, `${version.id} has field-level Bibliographic Provenance`);
    assert(version.field_sources["/title"]?.length > 0, `${version.id} title provenance`);
    assert(version.field_sources["/authors/0/display_name"]?.length > 0, `${version.id} author provenance`);
    assert(version.field_sources["/release_date/value"]?.length > 0, `${version.id} date provenance`);
  }

  const relations = versionsRecord.publication_relations;
  assert.equal(relations.length, 1);
  const publishedAs = relations[0];
  assert.equal(publishedAs.relation, "published_as");
  assert.equal(publishedAs.source_version_id, arxiv.id);
  assert.equal(publishedAs.target_version_id, journal.id);
  assert.equal(publishedAs.basis, "source_asserted");
  assert.match(publishedAs.reason, /arXiv record explicitly supplies/u);
  assert.equal(publishedAs.review_state, "reviewed");
  assert.equal(publishedAs.curation_provenance.actor_id, "actor:agent-curator");
  assert.equal(publishedAs.review_provenance.actor_id, "actor:human-curator");
  assert.equal(publishedAs.bibliographic_source_ids.length, 1);
  const source = versionsRecord.bibliographic_sources.find(
    ({ id }) => id === publishedAs.bibliographic_source_ids[0],
  );
  assert.equal(source.provider, "arxiv");
  assert.equal(source.record_id, "1107.1326");
  assert.match(source.source_url, /^https:\/\//u);
  assert.match(source.retrieved_at, /Z$/u);

  const productionRelations = snapshot.works.flatMap(
    ({ files }) => files["versions.yaml"]?.publication_relations ?? [],
  );
  assert.equal(productionRelations.filter(({ relation }) => relation === "revises").length, 0);
  assert.equal(snapshot.scientificEdges.length, 0);
  assert.equal(result.statistics.scientific_edges, 0);

  assert.equal(annotationsRecord.annotations.length, 16);
  assert.equal(annotationsRecord.method_annotations.length, 1);
  assert.equal(statementsRecord.statements.length, 4);
  assert.equal(accountRecord.stages.length, 7);
  assert.equal(accountRecord.links.length, 7);
  const outgoing = accountRecord.links.filter(
    ({ source_stage_id }) => source_stage_id === "stage:bromberg-cocoon-pressure",
  );
  const incoming = accountRecord.links.filter(
    ({ target_stage_id }) => target_stage_id === "stage:bromberg-head-propagation",
  );
  assert.equal(outgoing.length, 2, "Physical Account has a meaningful branch");
  assert.equal(incoming.length, 2, "Physical Account has a meaningful convergence");

  const projection = projectWorkForReader(snapshot, brombergWorkId);
  assert(projection);
  assert.equal(projection.versions.length, 2);
  assert.equal(projection.publication_relations.length, 1);
  assert.equal(projection.publication_relations[0].relation, "published_as");
  assert.equal(projection.bibliographic_sources.length, 1);
  assert.equal(projection.bibliographic_sources[0].id, publishedAs.bibliographic_source_ids[0]);
  assert.equal(projection.annotations.length, 16);
  assert.equal(projection.method_annotations.length, 1);
  assert.equal(projection.statements.length, 4);
  assert.equal(projection.physical_account.links.length, 7);
  assert.equal(projection.scientific_edges.length, 0);
  assert.doesNotMatch(JSON.stringify(projection), /review_state/u);
});

test("Bromberg's static Work page renders publication provenance and the branching account", async () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const html = await readFile(
    new URL("../dist/papers/work:bromberg-2011/index.html", import.meta.url),
    "utf8",
  );
  for (const marker of [
    "<h3>Versions</h3>",
    "version:bromberg-2011-arxiv-v1",
    "version:bromberg-2011-journal",
    "<h3>Publication Relations</h3>",
    "published_as",
    "Bibliographic Provenance",
    "source:arxiv-bromberg-2011-20260904-091405z",
    "Scientific Statements",
    "Methods",
    "Physics Ontology",
    "Physical Account",
    "stage:bromberg-collimated-regime",
    "stage:bromberg-uncollimated-regime",
    "stage:bromberg-head-propagation",
  ]) {
    assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")), marker);
  }
  assert.doesNotMatch(html, /review_state/u);
});

test("Ticket 06 validates an explicit arXiv revision graph and publication correspondence", async () => {
  const fixture = await makePublicationFixture();
  const result = await validateFixture(fixture);

  assert.equal(result.valid, true);
  assert.equal(codes(result).size, 0);
  assert.deepEqual(
    fixture.versions.versions
      .filter(({ kind }) => kind === "arxiv_revision")
      .map(({ arxiv_id, arxiv_revision }) => [arxiv_id, arxiv_revision]),
    [["1107.1326", 1], ["1107.1326", 2]],
  );
  assert.equal(fixture.versions.publication_relations[0].relation, "revises");
  assert.equal(fixture.versions.publication_relations[1].relation, "published_as");
});

test("DOI-less journal manifestations require a stable publisher identity and reason", async () => {
  const fixture = await makePublicationFixture();
  const journal = fixture.versions.versions.find(({ id }) => id === journalVersionId);
  delete journal.doi;
  journal.publisher_identifier = {
    value: "publisher-record-arnett-1982",
    reason: "The publisher archive exposes this stable record identifier without a DOI.",
  };
  addFieldSources(journal, [sharedSourceId]);
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
  let result = await validateFixture(fixture);
  assert.equal(result.valid, true);

  delete journal.publisher_identifier.reason;
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
  result = await validateFixture(fixture);
  assert(codes(result).has("BIB_PUBLISHER_ID_REASON_INVALID"));
});

test("Publication Graph aliases never substitute for the frozen canonical fields", async () => {
  let fixture = await makePublicationFixture();
  const arxiv = fixture.versions.versions[0];
  const externalIdentity = {
    arxiv_id: arxiv.arxiv_id,
    revision_number: arxiv.arxiv_revision,
  };
  delete arxiv.arxiv_id;
  delete arxiv.arxiv_revision;
  arxiv.external_identity = externalIdentity;
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
  let result = await validateFixture(fixture);
  assert(codes(result).has("BIB_ARXIV_ID_MISSING"));
  assert(codes(result).has("BIB_ARXIV_REVISION_INVALID"));

  fixture = await makePublicationFixture();
  const publishedAs = fixture.versions.publication_relations[1];
  publishedAs.source_ids = publishedAs.bibliographic_source_ids;
  delete publishedAs.bibliographic_source_ids;
  publishedAs.review_binding.semantic_digest = publicationRelationSemanticDigest(publishedAs);
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
  result = await validateFixture(fixture);
  assert(codes(result).has("PUBLICATION_RELATION_BIBLIOGRAPHIC_SOURCES_INVALID"));
});

test("curator_matched requires two meaningful identity sources and ignores set ordering", async () => {
  const fixture = await makePublicationFixture();
  const relationRecord = fixture.versions.publication_relations[1];
  const journal = fixture.versions.versions.find(({ id }) => id === journalVersionId);
  const secondSource = {
    id: "source:crossref-arnett-publication-graph",
    provider: "crossref",
    record_id: "10.1086/159681",
    source_url: "https://api.crossref.org/works/10.1086/159681",
    retrieved_at: "2026-09-04T04:51:00Z",
  };
  fixture.versions.bibliographic_sources.push(secondSource);
  journal.field_sources["/doi"].push(secondSource.id);
  relationRecord.basis = "curator_matched";
  relationRecord.bibliographic_source_ids = [sharedSourceId, secondSource.id];
  relationRecord.review_binding.semantic_digest = publicationRelationSemanticDigest(relationRecord);
  relationRecord.bibliographic_source_ids.reverse();
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");

  const result = await validateFixture(fixture);
  assert.equal(result.valid, true);
  assert.equal(codes(result).size, 0);
});

test("Ticket 06 rejects malformed identities and hostile Publication Graph topology without cascades", async () => {
  for (const [mutate, expectedCode] of [
    [
      (fixture) => {
        fixture.versions.versions[0].arxiv_id = "arXiv:1107.1326v1";
      },
      "BIB_ARXIV_ID_NOT_NORMALIZED",
    ],
    [
      (fixture) => {
        fixture.versions.versions[1].arxiv_revision = 0;
      },
      "BIB_ARXIV_REVISION_INVALID",
    ],
    [
      (fixture) => {
        fixture.versions.publication_relations[0].source_version_id = journalVersionId;
      },
      "PUBLICATION_RELATION_ENDPOINT_KIND_INVALID",
    ],
    [
      (fixture) => {
        fixture.versions.publication_relations[0].source_version_id = fixture.versions.versions[0].id;
        fixture.versions.publication_relations[0].target_version_id = fixture.versions.versions[1].id;
      },
      "PUBLICATION_REVISES_REVISION_ORDER_INVALID",
    ],
    [
      (fixture) => {
        fixture.versions.publication_relations[1].bibliographic_source_ids = [
          "source:ads-arnett-1982-20260904-032118z",
        ];
      },
      "PUBLICATION_SOURCE_ASSERTION_COVERAGE_INVALID",
    ],
    [
      (fixture) => {
        fixture.versions.publication_relations[1].bibliographic_source_ids = [];
      },
      "PUBLICATION_RELATION_BIBLIOGRAPHIC_SOURCES_INVALID",
    ],
    [
      (fixture) => {
        fixture.versions.publication_relations[1].reason = "  Not normalized.  ";
      },
      "PUBLICATION_RELATION_REASON_NOT_NORMALIZED",
    ],
  ]) {
    const fixture = await makePublicationFixture();
    mutate(fixture);
    await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
    const result = await validateFixture(fixture);
    assert(codes(result).has(expectedCode), expectedCode);
    if (expectedCode === "PUBLICATION_RELATION_ENDPOINT_KIND_INVALID") {
      assert.equal(codes(result).has("PUBLICATION_GRAPH_CYCLE"), false);
    }
  }
});

test("Publication Relation provenance coverage, Human review, and material bindings are enforced", async () => {
  const fixture = await makePublicationFixture();
  const relationRecord = fixture.versions.publication_relations[1];
  relationRecord.basis = "curator_matched";
  relationRecord.bibliographic_source_ids = [sharedSourceId];
  relationRecord.review_binding.semantic_digest = publicationRelationSemanticDigest(relationRecord);
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
  let result = await validateFixture(fixture);
  assert(codes(result).has("PUBLICATION_CURATOR_MATCH_SOURCES_REQUIRED"));

  const agentRelation = relation({
    id: "publication-relation:arnett-agent-draft",
    review_state: "reviewed",
    curation_provenance: {
      actor_id: "actor:agent-curator",
      recorded_at: "2026-09-04T05:00:00Z",
    },
    review_provenance: {
      actor_id: "actor:agent-curator",
      recorded_at: "2026-09-04T05:01:00Z",
    },
  });
  fixture.versions.publication_relations.push(agentRelation);
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
  result = await validateFixture(fixture);
  assert(codes(result).has("CURATION_HUMAN_REVIEW_REQUIRED"));

  fixture.versions.publication_relations[0].reason = "A material revision explanation changed.";
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
  result = await validateFixture(fixture);
  assert(codes(result).has("PUBLICATION_RELATION_REVIEW_BINDING_STALE"));
});

test("every semantic Publication Relation field resets review independently", async () => {
  for (const [label, mutate] of [
    ["source endpoint", (record) => { record.source_version_id = "version:arnett-1982-arxiv-v1"; }],
    ["target endpoint", (record) => { record.target_version_id = "version:arnett-1982-arxiv-v1"; }],
    ["relation", (record) => { record.relation = "revises"; }],
    ["basis", (record) => { record.basis = "curator_matched"; }],
    ["reason", (record) => { record.reason = "A materially different normalized justification."; }],
    ["source references", (record) => {
      record.bibliographic_source_ids = ["source:ads-arnett-1982-20260904-032118z"];
    }],
  ]) {
    const fixture = await makePublicationFixture();
    mutate(fixture.versions.publication_relations[1]);
    await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
    const result = await validateFixture(fixture);
    assert(codes(result).has("PUBLICATION_RELATION_REVIEW_BINDING_STALE"), label);
  }
});

test("Publication Graph detects revision cycles and incoming journal correspondence duplicates", async () => {
  const fixture = await makePublicationFixture();
  fixture.versions.publication_relations.push(relation({
    id: "publication-relation:arnett-arxiv-v1-v2",
    source_version_id: "version:arnett-1982-arxiv-v1",
    target_version_id: "version:arnett-1982-arxiv-v2",
    relation: "revises",
    reason: undefined,
  }));
  fixture.versions.publication_relations.push(relation({
    id: "publication-relation:arnett-arxiv-v1-journal",
    source_version_id: "version:arnett-1982-arxiv-v1",
    target_version_id: journalVersionId,
  }));
  await writeFile(fixture.versionsPath, stringify(fixture.versions), "utf8");
  const result = await validateFixture(fixture);
  const diagnosticCodes = codes(result);
  assert(diagnosticCodes.has("PUBLICATION_GRAPH_CYCLE"));
  assert(diagnosticCodes.has("PUBLICATION_REVISES_REVISION_ORDER_INVALID"));
  assert(diagnosticCodes.has("PUBLICATION_PUBLISHED_AS_CARDINALITY_INVALID"));
});
