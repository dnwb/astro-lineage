import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import { validateCanonicalContent } from "../scripts/content-validator.mjs";

const projectRoot = new URL("../", import.meta.url);
const productionContent = new URL("../content/", import.meta.url);
const workId = "work:arnett-1982";
const workSlug = "arnett-1982";
const lineId = "research-line:central-engines";
const lineSlug = "central-engines";
const lineFile = `content/research-lines/${lineSlug}/line.yaml`;
const lineReadingFile = `content/research-lines/${lineSlug}/reading.md`;

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "astro-lineage-visibility-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  return { temporaryRoot, contentRoot };
}

async function readVisibleRecords(contentRoot) {
  const workRoot = join(contentRoot, "works", workSlug);
  const lineRoot = join(contentRoot, "research-lines", lineSlug);
  return {
    workRoot,
    lineRoot,
    work: parse(await readFile(join(workRoot, "work.yaml"), "utf8")),
    statements: parse(await readFile(join(workRoot, "statements.yaml"), "utf8")),
    line: parse(await readFile(join(lineRoot, "line.yaml"), "utf8")),
  };
}

function codes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

function diagnosticFor(result, code, context = {}) {
  const diagnostic = result.diagnostics.find(
    (item) =>
      item.code === code &&
      Object.entries(context).every(([field, expected]) =>
        JSON.stringify(item[field]) === JSON.stringify(expected)),
  );
  assert(diagnostic, `missing diagnostic ${code}`);
  for (const [field, expected] of Object.entries(context)) {
    assert.deepEqual(diagnostic[field], expected, `${code} context field ${field}`);
  }
  return diagnostic;
}

test("visibility publishes Arnett and one Research Line atomically with independent approvals", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === workId);
  const researchLine = snapshot.researchLines.find(({ id }) => id === lineId);
  const membership = researchLine?.line.memberships[0];

  assert.equal(result.valid, true);
  assert.equal(work.files["work.yaml"].reader_state, "visible");
  assert.equal(researchLine?.line.line_id, lineId);
  assert.equal(researchLine?.line.reader_state, "visible");
  assert.equal(membership.work_id, workId);
  assert.deepEqual(membership.reading_roles, ["foundation"]);
  assert.equal(membership.editorial_anchor, true);
  assert.equal(membership.review_state, "reviewed");
  assert.equal(membership.curation_provenance.actor_id, "actor:agent-curator");
  assert.equal(membership.review_provenance.actor_id, "actor:human-curator");
  assert.match(membership.review_binding.semantic_digest, /^[0-9a-f]{64}$/u);

  const workApproval = work.files["work.yaml"].visibility_approvals.at(-1);
  const lineApproval = researchLine.line.visibility_approvals.at(-1);
  for (const approval of [workApproval, lineApproval]) {
    assert.equal(approval.profile_id, "v0.1-default");
    assert.equal(approval.actor_id, "actor:human-curator");
    assert.match(approval.visibility_digest, /^[0-9a-f]{64}$/u);
    assert.match(approval.approved_at, /Z$/u);
  }
  assert.notEqual(workApproval.visibility_digest, lineApproval.visibility_digest);
  assert.equal(result.work_inventory[0].visibility_status, "approved");
  assert.equal(result.research_line_inventory[0].visibility_status, "approved");
});

test("Research Line ownership and Reading Role contracts are structural", async () => {
  const { contentRoot } = await copyContent();
  const records = await readVisibleRecords(contentRoot);
  records.line.memberships[0].reading_roles = ["foundation", "foundation", "primary"];
  const readingPath = join(records.lineRoot, "reading.md");
  const reading = await readFile(readingPath, "utf8");
  await Promise.all([
    writeFile(join(records.lineRoot, "line.yaml"), stringify(records.line), "utf8"),
    writeFile(readingPath, reading.replace(lineId, "research-line:wrong"), "utf8"),
  ]);

  const result = await validateCanonicalContent(contentRoot);
  diagnosticFor(result, "RESEARCH_LINE_READING_OWNERSHIP_MISMATCH", {
    file: lineReadingFile,
    record_id: lineId,
    field_path: "/line_id",
  });
  diagnosticFor(result, "READING_ROLE_DUPLICATE", {
    file: lineFile,
    record_id: records.line.memberships[0].id,
    field_path: "/memberships/0/reading_roles/1",
  });
  diagnosticFor(result, "READING_ROLE_INVALID", {
    file: lineFile,
    record_id: records.line.memberships[0].id,
    field_path: "/memberships/0/reading_roles/2",
  });
  assert.equal(result.passes.structural.status, "partial");
  assert.equal(result.passes.semantic.diagnostic_count, 0);
  assert.equal(result.work_inventory[0].visibility_status, "skipped");
  assert.equal(result.research_line_inventory[0].visibility_status, "skipped");
  assert.equal(codes(result).has("MEMBERSHIP_REVIEW_BINDING_STALE"), false);
  assert.equal(codes(result).has("VISIBILITY_APPROVAL_STALE"), false);
});

test("malformed visibility approvals quarantine the entity without derived diagnostics", async () => {
  for (const {
    name,
    mutate,
    code,
    fieldPath,
    semanticStatus = "skipped",
    semanticDiagnosticCount = 0,
  } of [
    {
      name: "collection",
      mutate: ({ line }) => {
        line.visibility_approvals = 42;
      },
      code: "VISIBILITY_APPROVALS_INVALID",
      fieldPath: "/visibility_approvals",
    },
    {
      name: "shape",
      mutate: ({ line }) => {
        line.visibility_approvals[0] = 42;
      },
      code: "VISIBILITY_APPROVAL_INVALID_SHAPE",
      fieldPath: "/visibility_approvals/0",
    },
    {
      name: "digest",
      mutate: ({ line }) => {
        line.visibility_approvals[0].visibility_digest = 42;
      },
      code: "VISIBILITY_APPROVAL_DIGEST_INVALID",
      fieldPath: "/visibility_approvals/0/visibility_digest",
    },
    {
      name: "timestamp",
      mutate: ({ line }) => {
        line.visibility_approvals[0].approved_at = "not-a-timestamp";
      },
      code: "VISIBILITY_APPROVAL_TIMESTAMP_INVALID",
      fieldPath: "/visibility_approvals/0/approved_at",
    },
    {
      name: "profile type",
      mutate: ({ line }) => {
        line.visibility_approvals[0].profile_id = 42;
      },
      code: "VISIBILITY_APPROVAL_PROFILE_INVALID",
      fieldPath: "/visibility_approvals/0/profile_id",
    },
    {
      name: "missing actor",
      mutate: ({ line }) => {
        line.visibility_approvals[0].actor_id = "actor:missing";
      },
      code: "VISIBILITY_APPROVAL_ACTOR_INVALID",
      fieldPath: "/visibility_approvals/0/actor_id",
      semanticStatus: "partial",
      semanticDiagnosticCount: 1,
    },
  ]) {
    const { contentRoot } = await copyContent();
    const records = await readVisibleRecords(contentRoot);
    mutate(records);
    await writeFile(join(records.lineRoot, "line.yaml"), stringify(records.line), "utf8");

    const result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, code, {
      file: lineFile,
      record_id: lineId,
      field_path: fieldPath,
    });
    assert.deepEqual([...codes(result)], [code], name);
    assert.equal(result.passes.semantic.status, semanticStatus, name);
    assert.equal(result.passes.semantic.diagnostic_count, semanticDiagnosticCount, name);
    assert.equal(result.research_line_inventory[0].visibility_status, "skipped", name);
  }
});

test("Research Line Membership pairs and visible Work anchors are unique", async () => {
  const { contentRoot } = await copyContent();
  const records = await readVisibleRecords(contentRoot);
  const targetMembership = records.line.memberships.find(({ work_id }) => work_id === workId);
  assert(targetMembership, `missing target membership for ${workId}`);
  const duplicateMembership = structuredClone(targetMembership);
  duplicateMembership.id = "membership:central-engines-arnett-duplicate";
  records.line.memberships.push(duplicateMembership);
  await writeFile(join(records.lineRoot, "line.yaml"), stringify(records.line), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  const diagnosticCodes = codes(result);
  assert(diagnosticCodes.has("RESEARCH_LINE_MEMBERSHIP_PAIR_DUPLICATE"));
  assert(diagnosticCodes.has("EDITORIAL_ANCHOR_CARDINALITY_INVALID"));
});

test("Research Line Membership IDs are globally unique across editorial bundles", async () => {
  const { contentRoot } = await copyContent();
  const records = await readVisibleRecords(contentRoot);
  const secondLineId = "research-line:duplicate-id-fixture";
  const secondLineSlug = "duplicate-id-fixture";
  const secondRoot = join(contentRoot, "research-lines", secondLineSlug);
  await cp(records.lineRoot, secondRoot, { recursive: true });

  const secondLine = structuredClone(records.line);
  secondLine.line_id = secondLineId;
  secondLine.reader_state = "draft";
  secondLine.visibility_approvals = [];
  secondLine.memberships[0].editorial_anchor = false;
  secondLine.memberships[0].review_state = "unreviewed";
  delete secondLine.memberships[0].review_provenance;
  delete secondLine.memberships[0].review_binding;
  await Promise.all([
    writeFile(join(secondRoot, "line.yaml"), stringify(secondLine), "utf8"),
    writeFile(
      join(secondRoot, "reading.md"),
      `---\nline_id: ${secondLineId}\n---\n\n# Duplicate-ID fixture\n`,
      "utf8",
    ),
  ]);

  const result = await validateCanonicalContent(contentRoot);
  assert(codes(result).has("RESEARCH_LINE_MEMBERSHIP_ID_DUPLICATE"));
});

test("Membership review is Human-gated and material changes stale its binding", async () => {
  for (const mutate of [
    (membership) => {
      membership.curation_provenance.actor_id = "actor:agent-curator";
      membership.review_provenance.actor_id = "actor:agent-curator";
    },
    (membership) => {
      membership.reading_roles = ["review"];
    },
  ]) {
    const { contentRoot } = await copyContent();
    const records = await readVisibleRecords(contentRoot);
    mutate(records.line.memberships[0]);
    await writeFile(join(records.lineRoot, "line.yaml"), stringify(records.line), "utf8");
    const result = await validateCanonicalContent(contentRoot);
    assert(
      codes(result).has("CURATION_HUMAN_REVIEW_REQUIRED") ||
        codes(result).has("MEMBERSHIP_REVIEW_BINDING_STALE"),
    );
  }
});

test("final-snapshot visibility requires a visible anchored pair", async () => {
  for (const [mutate, expectedCode] of [
    [
      ({ line }) => {
        line.reader_state = "draft";
        line.visibility_approvals = [];
      },
      "VISIBLE_WORK_ANCHOR_LINE_NOT_VISIBLE",
    ],
    [
      ({ work, line }) => {
        work.reader_state = "draft";
        work.visibility_approvals = [];
        line.memberships = line.memberships.filter(({ work_id }) => work_id === workId);
      },
      "VISIBLE_RESEARCH_LINE_MEMBERSHIP_REQUIRED",
    ],
  ]) {
    const { contentRoot } = await copyContent();
    const records = await readVisibleRecords(contentRoot);
    mutate(records);
    await Promise.all([
      writeFile(join(records.workRoot, "work.yaml"), stringify(records.work), "utf8"),
      writeFile(join(records.lineRoot, "line.yaml"), stringify(records.line), "utf8"),
    ]);
    const result = await validateCanonicalContent(contentRoot);
    assert(codes(result).has(expectedCode));
  }
});

test("stale visibility approvals block without mutating Reader State", async () => {
  const { contentRoot } = await copyContent();
  const records = await readVisibleRecords(contentRoot);
  records.line.scientific_question += " Materially changed after approval.";
  await writeFile(join(records.lineRoot, "line.yaml"), stringify(records.line), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  diagnosticFor(result, "VISIBILITY_APPROVAL_STALE", {
    file: lineFile,
    record_id: lineId,
    field_path: "/visibility_approvals",
  });
  const reloaded = parse(await readFile(join(records.lineRoot, "line.yaml"), "utf8"));
  assert.equal(reloaded.reader_state, "visible");
});

test("hidden unreviewed records are excluded from the Work visibility projection", async () => {
  const { contentRoot } = await copyContent();
  const before = await validateCanonicalContent(contentRoot);
  const records = await readVisibleRecords(contentRoot);
  const hidden = structuredClone(records.statements.statements[0]);
  hidden.id = "statement:arnett-hidden-visibility-fixture";
  hidden.canonical_text = "HIDDEN_VISIBILITY_MARKER";
  hidden.review_state = "unreviewed";
  hidden.curation_provenance.recorded_at = "2026-09-04T07:00:00Z";
  delete hidden.review_provenance;
  delete hidden.review_binding;
  records.statements.statements.push(hidden);
  await writeFile(join(records.workRoot, "statements.yaml"), stringify(records.statements), "utf8");

  const after = await validateCanonicalContent(contentRoot);
  assert.equal(after.valid, true);
  assert.equal(after.work_inventory[0].visibility_digest, before.work_inventory[0].visibility_digest);

  const { projectVisibleSnapshot } = await import("../scripts/reader-projection.mjs");
  const projection = await projectVisibleSnapshot(await loadCanonicalContent(contentRoot));
  assert.doesNotMatch(JSON.stringify(projection), /HIDDEN_VISIBILITY_MARKER/u);
});

test("generated reverse membership indexes are reproducible and non-canonical", async () => {
  const { temporaryRoot, contentRoot } = await copyContent();
  const generatedRoot = join(temporaryRoot, "generated");
  const { writeEditorialIndexes } = await import("../scripts/editorial-index.mjs");
  const snapshot = await loadCanonicalContent(contentRoot);
  await writeEditorialIndexes(snapshot, generatedRoot);
  const first = await readFile(join(generatedRoot, "work-research-lines.json"), "utf8");
  await writeEditorialIndexes(snapshot, generatedRoot);
  const second = await readFile(join(generatedRoot, "work-research-lines.json"), "utf8");
  assert.equal(second, first);
  assert.match(first, new RegExp(workId));
  assert.match(first, new RegExp(lineId));

  const loaded = await loadCanonicalContent(contentRoot);
  assert.equal(loaded.discovery.files.some((file) => file.includes("generated")), false);
});

test("the static Paper, Work, and Research Line routes render the visible validated snapshot", async () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const papersHtml = await readFile(new URL("../dist/papers/index.html", import.meta.url), "utf8");
  const workHtml = await readFile(
    new URL("../dist/papers/arnett-1982/index.html", import.meta.url),
    "utf8",
  );
  const lineHtml = await readFile(
    new URL("../dist/research-lines/central-engines/index.html", import.meta.url),
    "utf8",
  );
  assert.match(papersHtml, /Type I supernovae\. I(?:\.| -)/u);
  assert.match(workHtml, /科学陈述/u);
  assert.match(workHtml, /物理描述/u);
  assert.match(workHtml, /Central Engines/u);
  assert.match(lineHtml, /What powers/u);
  assert.match(lineHtml, /foundation/u);
  assert.doesNotMatch(`${papersHtml}${workHtml}${lineHtml}`, /<script/iu);
  assert(existsSync(new URL("../generated/work-research-lines.json", import.meta.url)));
});
