import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";

import { loadCanonicalContent } from "../../scripts/content-loader.mjs";
import {
  scientificEdgeSemanticDigest,
} from "../../scripts/content-validator.mjs";

const productionContent = new URL("../../content/", import.meta.url);

export const sourceWorkId = "work:long-yu-2026";
export const targetWorkId = "work:bromberg-2011";
export const targetWorkSlug = "bromberg-2011";
export const thirdWorkId = "work:arnett-1982";
export const sourceEvidenceId = "evidence:long-yu-dynamic-framework";
export const alternateSourceEvidenceId = "evidence:long-yu-head-propagation";
export const targetEvidenceId = "evidence:bromberg-abstract";
export const thirdWorkEvidenceId = "evidence:arnett-abstract";
export const sourceStatementId = "statement:long-yu-time-dependent-trajectory-framework";
export const targetStatementId = "statement:bromberg-jet-cocoon-model";
export const relations = Object.freeze([
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

export async function readYaml(path) {
  return parse(await readFile(path, "utf8"));
}

export async function writeYaml(path, value) {
  await writeFile(path, stringify(value), "utf8");
}

export async function copyContent({ draftReaders = true } = {}) {
  if (draftReaders && draftContentTemplate) {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "astro-lineage-scientific-edges-"));
    const contentRoot = join(temporaryRoot, "content");
    await cp(draftContentTemplate, contentRoot, { recursive: true });
    return { temporaryRoot, contentRoot };
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), "astro-lineage-scientific-edges-"));
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
    const fixtureRoot = await mkdtemp(join(tmpdir(), "astro-lineage-scientific-edges-"));
    const fixtureContentRoot = join(fixtureRoot, "content");
    await cp(draftContentTemplate, fixtureContentRoot, { recursive: true });
    return { temporaryRoot: fixtureRoot, contentRoot: fixtureContentRoot };
  }
  return { temporaryRoot, contentRoot };
}

export async function addSyntheticActors(contentRoot) {
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

export function edge(overrides = {}) {
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

export function inferredEdge(overrides = {}) {
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

export function edgeDiagnosticFile(value) {
  return `content/scientific-edges/${edgeFileSlug(value)}.yaml`;
}

export async function writeEdge(contentRoot, value, fileSlug = edgeFileSlug(value)) {
  const path = join(contentRoot, "scientific-edges", `${fileSlug}.yaml`);
  await writeYaml(path, value);
  return path;
}

export function codes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

export function diagnosticFor(result, code, context = {}) {
  const diagnostic = result.diagnostics.find(
    (item) => item.code === code && Object.entries(context).every(
      ([field, expected]) => JSON.stringify(item[field]) === JSON.stringify(expected),
    ),
  );
  assert(diagnostic, `missing diagnostic ${code} with expected context ${JSON.stringify(context)}`);
  return diagnostic;
}

export async function validFixture() {
  const fixture = await copyContent();
  await addSyntheticActors(fixture.contentRoot);
  return fixture;
}
