import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  computeReaderVisibilityDigest,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";
import { buildWorkResearchLineIndex } from "../scripts/editorial-index.mjs";
import {
  projectResearchLineForReader,
  projectWorkForReader,
} from "../scripts/reader-projection.mjs";

const projectRoot = new URL("../", import.meta.url);
const productionContent = new URL("../content/", import.meta.url);
const workId = "work:zhu-2021";
const workSlug = "zhu-2021";
const arnettWorkId = "work:arnett-1982";
const brombergWorkId = "work:bromberg-2011";
const anchorLineId = "research-line:dense-environment-multimessenger";
const secondaryLineId = "research-line:central-engines";
const secondaryLineSlug = "central-engines";

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket07-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  return { temporaryRoot, contentRoot };
}

function codes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

function workFrom(snapshot) {
  return snapshot.works.find(({ id }) => id === workId);
}

function lineFrom(snapshot, lineId) {
  return snapshot.researchLines.find(({ id }) => id === lineId);
}

test("Ticket 07 stores a reviewed visible Zhu multi-messenger and cross-context slice", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  const work = workFrom(snapshot);
  assert(work);
  assert.equal(result.valid, true);
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

  const annotations = work.files["annotations.yaml"].annotations;
  assert.equal(annotations.length, 16);
  assert.equal(new Set(annotations.map(({ axis }) => axis)).size, 16);
  const byAxis = new Map(annotations.map((annotation) => [annotation.axis, annotation]));
  assert.deepEqual(
    byAxis.get("messenger").assessment.values.map(({ term_id }) => term_id),
    ["term:neutrinos", "term:photons", "term:gravitational-waves"],
  );
  assert.deepEqual(
    byAxis.get("photon_band").assessment.values.map(({ term_id }) => term_id),
    ["term:gamma-ray-band", "term:optical-band"],
  );
  assert.deepEqual(
    byAxis.get("observable").assessment.values.map(({ term_id }) => term_id),
    [
      "term:all-flavor-neutrino-fluence",
      "term:detected-neutrino-count",
      "term:shock-breakout-photon-transient",
    ],
  );
  assert.deepEqual(
    byAxis.get("inference_target").assessment.values.map(({ term_id }) => term_id),
    ["term:jet-choking-condition", "term:expected-neutrino-yield"],
  );

  const method = work.files["annotations.yaml"].method_annotations[0];
  assert.equal(method.technique_id, "technique:detector-effective-area-folding");
  assert.equal(method.basis, "explicit");
  assert.equal(method.review_state, "reviewed");
  assert.equal(method.review_provenance.actor_id, "actor:human-curator");

  for (const evidence of work.files["evidence.yaml"].evidence) {
    assert.equal(evidence.version_id, "version:zhu-2021-arxiv-v3");
    assert.match(evidence.source_url, /2103\.00789v3/u);
    assert.match(evidence.locator.type, /^(?:section|equation|figure)$/u);
  }

  const account = work.files["physical-account.yaml"];
  const outgoing = new Map(account.stages.map(({ id }) => [id, 0]));
  const incoming = new Map(account.stages.map(({ id }) => [id, 0]));
  for (const link of account.links) {
    outgoing.set(link.source_stage_id, outgoing.get(link.source_stage_id) + 1);
    incoming.set(link.target_stage_id, incoming.get(link.target_stage_id) + 1);
  }
  assert(outgoing.get("stage:zhu-choked-jet") >= 2, "choked jet must branch");
  assert.equal(incoming.get("stage:zhu-meson-decay"), 2, "hadronic branches must converge");
  const linkIds = new Set(account.links.map(({ id }) => id));
  for (const removedLinkId of [
    "causal-link:zhu-photons-enable-gamma-band",
    "causal-link:zhu-gamma-band-enables-photon-observable",
    "causal-link:zhu-choking-enables-gw-counterpart",
  ]) {
    assert.equal(linkIds.has(removedLinkId), false, `${removedLinkId} must not encode taxonomy or co-occurrence as causation`);
  }
  assert(account.stages.some(({ label }) => /neutrino messenger/iu.test(label)));
  assert(account.stages.some(({ label }) => /photon messenger/iu.test(label)));
  assert(account.stages.some(({ label }) => /gravitational-wave counterpart/iu.test(label)));

  const memberships = snapshot.researchLines.flatMap((line) =>
    line.line.memberships
      .filter(({ work_id }) => work_id === workId)
      .map((membership) => ({ line_id: line.id, ...membership })),
  );
  assert.equal(memberships.length, 2);
  assert.equal(memberships.filter(({ editorial_anchor }) => editorial_anchor).length, 1);
  assert.equal(memberships.find(({ line_id }) => line_id === anchorLineId).editorial_anchor, true);
  assert.equal(memberships.find(({ line_id }) => line_id === secondaryLineId).editorial_anchor, false);
  assert(memberships.every(({ review_state }) => review_state === "reviewed"));

  const index = buildWorkResearchLineIndex(snapshot);
  assert.deepEqual(index[workId].map(({ line_id }) => line_id), [
    secondaryLineId,
    anchorLineId,
  ]);
  assert.equal(
    JSON.stringify(work.files).includes("membership:central-engines-zhu-2021"),
    false,
    "editorial memberships must not be copied into Work-owned records",
  );
});

test("a second Editorial Anchor for Zhu fails the cross-context membership invariant", async () => {
  const { contentRoot } = await copyContent();
  const file = join(contentRoot, "research-lines", secondaryLineSlug, "line.yaml");
  const line = parse(await readFile(file, "utf8"));
  const membership = line.memberships.find(({ work_id }) => work_id === workId);
  membership.editorial_anchor = true;
  await writeFile(file, stringify(line), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  assert(codes(result).has("EDITORIAL_ANCHOR_CARDINALITY_INVALID"));
});

test("a photon-band term cannot be stored as a messenger", async () => {
  const { contentRoot } = await copyContent();
  const file = join(contentRoot, "works", workSlug, "annotations.yaml");
  const envelope = parse(await readFile(file, "utf8"));
  const messenger = envelope.annotations.find(({ axis }) => axis === "messenger");
  messenger.assessment.values[0].term_id = "term:gamma-ray-band";
  await writeFile(file, stringify(envelope), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  assert(codes(result).has("ANNOTATION_TERM_AXIS_MISMATCH"));
});

test("an unreviewed secondary membership remains canonical but hidden from reverse indexes", async () => {
  const { contentRoot } = await copyContent();
  const lineFile = join(contentRoot, "research-lines", secondaryLineSlug, "line.yaml");
  const workFile = join(contentRoot, "works", workSlug, "work.yaml");
  const line = parse(await readFile(lineFile, "utf8"));
  const membership = line.memberships.find(({ work_id }) => work_id === workId);
  membership.review_state = "unreviewed";
  delete membership.review_provenance;
  delete membership.review_binding;
  await writeFile(lineFile, stringify(line), "utf8");

  const hiddenSnapshot = await loadCanonicalContent(contentRoot);
  const beforeLineDigest = computeReaderVisibilityDigest(
    hiddenSnapshot,
    "research_line",
    secondaryLineId,
  );
  const beforeWorkDigest = computeReaderVisibilityDigest(hiddenSnapshot, "work", workId);
  membership.reason = `${membership.reason} HIDDEN_TICKET07_MARKER`;
  line.visibility_approvals.push({
    profile_id: "v0.1-default",
    visibility_digest: beforeLineDigest,
    actor_id: "actor:human-curator",
    approved_at: "2026-09-04T10:40:00Z",
  });
  const work = parse(await readFile(workFile, "utf8"));
  work.visibility_approvals.push({
    profile_id: "v0.1-default",
    visibility_digest: beforeWorkDigest,
    actor_id: "actor:human-curator",
    approved_at: "2026-09-04T10:40:10Z",
  });
  await Promise.all([
    writeFile(lineFile, stringify(line), "utf8"),
    writeFile(workFile, stringify(work), "utf8"),
  ]);

  const snapshot = await loadCanonicalContent(contentRoot);
  assert.equal(
    computeReaderVisibilityDigest(snapshot, "research_line", secondaryLineId),
    beforeLineDigest,
  );
  assert.equal(computeReaderVisibilityDigest(snapshot, "work", workId), beforeWorkDigest);
  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, true);
  const index = buildWorkResearchLineIndex(snapshot);
  assert.deepEqual(index[workId].map(({ line_id }) => line_id), [anchorLineId]);
  assert.doesNotMatch(JSON.stringify(index[workId]), /HIDDEN_TICKET07_MARKER/u);
  const workProjection = projectWorkForReader(snapshot, workId);
  const lineProjection = projectResearchLineForReader(snapshot, secondaryLineId);
  assert.doesNotMatch(JSON.stringify(workProjection), /HIDDEN_TICKET07_MARKER/u);
  assert.doesNotMatch(JSON.stringify(lineProjection), /HIDDEN_TICKET07_MARKER/u);
  assert.equal(
    lineFrom(snapshot, secondaryLineId).line.memberships.some(
      ({ id }) => id === "membership:central-engines-zhu-2021",
    ),
    true,
  );
});

test("a malformed secondary membership is quarantined without invalidating its independent anchor line", async () => {
  const { contentRoot } = await copyContent();
  const file = join(contentRoot, "research-lines", secondaryLineSlug, "line.yaml");
  const line = parse(await readFile(file, "utf8"));
  const membership = line.memberships.find(({ work_id }) => work_id === workId);
  membership.reading_roles = [];
  await writeFile(file, stringify(line), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  const diagnosticCodes = codes(result);
  assert(diagnosticCodes.has("READING_ROLE_REQUIRED"));
  assert.deepEqual([...diagnosticCodes], ["READING_ROLE_REQUIRED"]);
  assert.equal(diagnosticCodes.has("VISIBILITY_APPROVAL_STALE"), false);
  assert.equal(diagnosticCodes.has("VISIBLE_RESEARCH_LINE_MEMBERSHIP_REQUIRED"), false);
  assert.equal(
    result.diagnostics.find(({ code }) => code === "READING_ROLE_REQUIRED").record_id,
    "membership:central-engines-zhu-2021",
  );
  assert.equal(
    result.work_inventory.find(({ work_id }) => work_id === workId).visibility_status,
    "skipped",
  );
  for (const unaffectedWorkId of [arnettWorkId, brombergWorkId]) {
    const inventory = result.work_inventory.find(({ work_id }) => work_id === unaffectedWorkId);
    assert.equal(inventory.validation_status, "valid", unaffectedWorkId);
    assert.equal(inventory.visibility_status, "approved", unaffectedWorkId);
  }
  const secondaryInventory = result.research_line_inventory.find(
    ({ line_id }) => line_id === secondaryLineId,
  );
  assert.equal(secondaryInventory.validation_status, "invalid");
  assert.equal(secondaryInventory.visibility_status, "skipped");
  assert.equal(
    result.research_line_inventory.find(({ line_id }) => line_id === anchorLineId)
      .visibility_status,
    "approved",
  );
  assert.equal(
    result.research_line_inventory.find(({ line_id }) => line_id === anchorLineId)
      .validation_status,
    "valid",
  );
});

test("Zhu Reader View renders scientific, provenance, and secondary-context detail", async () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const workHtml = await readFile(
    new URL("../dist/papers/zhu-2021/index.html", import.meta.url),
    "utf8",
  );
  const lineHtml = await readFile(
    new URL(
      "../dist/research-lines/dense-environment-multimessenger/index.html",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workHtml, /Jet stalling and choking/iu);
  assert.match(workHtml, /Escaping neutrino messenger/iu);
  assert.match(workHtml, /Soft gamma-ray photon band/iu);
  assert.match(workHtml, /Predicted short-GRB gravitational-wave counterpart/iu);
  assert.match(workHtml, /Central Engines and Engine-powered Transients/iu);
  assert.match(workHtml, /Dense Environments and Multi-messenger Transients/iu);
  assert.match(workHtml, /evidence:zhu-detector-folding/u);
  assert.match(workHtml, /equation; section Neutrino Bursts Detection; equation 6/iu);
  assert.match(workHtml, /figure; section Neutrino Bursts Detection; figure 3/iu);
  assert.match(workHtml, /reviewed by actor:human-curator/iu);
  assert.doesNotMatch(workHtml, /(?:section|equation|figure); page\s*:/iu);
  assert.match(lineHtml, /foundation/iu);
  assert.doesNotMatch(`${workHtml}${lineHtml}`, /<script/iu);
});
