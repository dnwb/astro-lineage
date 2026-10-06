import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { resolveReviewedFigure } from "../scripts/tencent-channel-publisher.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

const arxivId = "2610.10001";
const revision = 1;
const sourceFingerprint = "a".repeat(64);
const url = `/arxiv-figures/${arxivId}/fig1.png`;
const label = "Fig. 1";
const caption = "Figure 1: A tiny fixture image.";
const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const manifest = {
  version: 1,
  figures: [{
    arxiv_id: arxivId,
    revision,
    source_fingerprint: sourceFingerprint,
    url,
    label,
    caption_sha256: "8d9463d428f8403577425813b5ed611625bcf9cbeff91c5429272a132980d39f",
    visual_match: "confirmed",
    review_method: "human_visual_comparison",
    reviewed_by: "human-reviewer-fixture",
    asset_sha256: "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
  }],
};

function paper() {
  return {
    arxiv_id: arxivId,
    revision,
    analysis: {
      priority: "must_read",
      source_fingerprint: sourceFingerprint,
      coverage: { level: "full_body", source_version: `arXiv:${arxivId}v${revision}` },
      analysis: { figures: [{ url, label, caption }] },
    },
  };
}

async function fixturePublicRoot(t) {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-figure-", t);
  const publicRoot = join(path, "public");
  const distRoot = join(path, "dist");
  const asset = join(publicRoot, url.slice(1));
  const builtAsset = join(distRoot, url.slice(1));
  await mkdir(join(asset, ".."), { recursive: true });
  await writeFile(asset, imageBytes);
  await mkdir(join(builtAsset, ".."), { recursive: true });
  await writeFile(builtAsset, imageBytes);
  return { publicRoot, distRoot };
}

test("reviewed figure binds paper revision, source fingerprint, caption and in-tree asset hash", async (t) => {
  const roots = await fixturePublicRoot(t);
  const result = await resolveReviewedFigure(paper(), { ...roots, manifest });
  assert.equal(result.diagnostic, null);
  assert.equal(result.image.url, url);
  assert.equal(result.image.label, label);
  assert.equal(result.image.sha256, manifest.figures[0].asset_sha256);
});

test("figure resolver fails closed on wrong revision, unsafe path, missing caption or unreviewed asset", async (t) => {
  const roots = await fixturePublicRoot(t);

  const wrongRevision = paper();
  wrongRevision.revision = 2;
  assert.equal((await resolveReviewedFigure(wrongRevision, { ...roots, manifest })).image, null);

  const traversal = paper();
  traversal.analysis.analysis.figures[0].url = `/arxiv-figures/${arxivId}/../../secret.png`;
  assert.equal((await resolveReviewedFigure(traversal, { ...roots, manifest })).image, null);

  const noCaption = paper();
  noCaption.analysis.analysis.figures[0].caption = "";
  assert.equal((await resolveReviewedFigure(noCaption, { ...roots, manifest })).image, null);

  const unreviewed = structuredClone(manifest);
  unreviewed.figures[0].visual_match = "pending";
  assert.equal((await resolveReviewedFigure(paper(), { ...roots, manifest: unreviewed })).image, null);

  const agentOnlyReview = structuredClone(manifest);
  delete agentOnlyReview.figures[0].review_method;
  assert.equal((await resolveReviewedFigure(paper(), { ...roots, manifest: agentOnlyReview })).image, null);

  const changedHash = structuredClone(manifest);
  changedHash.figures[0].asset_sha256 = "0".repeat(64);
  assert.equal((await resolveReviewedFigure(paper(), { ...roots, manifest: changedHash })).image, null);
});

test("missing local or built assets and non-Must-Read records cannot attach figures", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-figure-", t);
  const emptyPublicRoot = join(path, "empty-public");
  await mkdir(emptyPublicRoot, { recursive: true });
  const emptyDistRoot = join(path, "empty-dist");
  await mkdir(emptyDistRoot, { recursive: true });
  const roots = await fixturePublicRoot(t);
  assert.equal((await resolveReviewedFigure(paper(), { publicRoot: emptyPublicRoot, distRoot: roots.distRoot, manifest })).image, null);
  assert.equal((await resolveReviewedFigure(paper(), { publicRoot: roots.publicRoot, distRoot: emptyDistRoot, manifest })).image, null);

  const worthKnowing = paper();
  worthKnowing.analysis.priority = "worth_knowing";
  assert.equal((await resolveReviewedFigure(worthKnowing, { ...roots, manifest })).image, null);

  const abstractOnly = paper();
  abstractOnly.analysis.coverage.level = "abstract_only";
  assert.equal((await resolveReviewedFigure(abstractOnly, { ...roots, manifest })).image, null);
});

test("a built copy with different bytes cannot be attached", async (t) => {
  const { publicRoot, distRoot } = await fixturePublicRoot(t);
  await writeFile(join(distRoot, url.slice(1)), Buffer.from("different built image"));
  assert.equal((await resolveReviewedFigure(paper(), { publicRoot, distRoot, manifest })).image, null);
});

test("a built asset symlink escaping the distribution root cannot be attached", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-figure-", t);
  const roots = await fixturePublicRoot(t);
  const distRoot = join(path, "symlink-dist");
  const builtAsset = join(distRoot, url.slice(1));
  await mkdir(join(builtAsset, ".."), { recursive: true });
  await symlink(join(roots.publicRoot, url.slice(1)), builtAsset);

  assert.equal((await resolveReviewedFigure(paper(), { publicRoot: roots.publicRoot, distRoot, manifest })).image, null);
});
