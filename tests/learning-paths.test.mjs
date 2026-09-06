import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { computeCanonicalContentDigest } from "../scripts/content-digest.mjs";
import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  projectLearningPathForReader,
  projectVisibleLearningPaths,
} from "../scripts/reader-projection.mjs";
import {
  computeReaderVisibilityDigest,
  learningPathSemanticDigest,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const productionContent = join(projectRoot, "content");
const pathId = "learning-path:transient-foundations";
const pathSlug = "transient-foundations";
const productionPathId = "learning-path:embedded-jet-dynamics";
const productionPathSlug = "embedded-jet-dynamics";
const firstWorkId = "work:arnett-1982";
const secondWorkId = "work:transfit-2025";
const secondWorkSlug = "transfit-2025";
const thirdWorkId = "work:long-yu-2026";
const productionEntryIds = [
  "work:bromberg-2011",
  "work:zhu-2021",
  "work:long-yu-2026",
];
const productionTransitionReasons = [
  "Use Bromberg et al. to establish jet-head propagation, cocoon collimation, and breakout as a compact dynamical vocabulary before applying that vocabulary to Zhu et al.'s embedded AGN-disk, multi-messenger case.",
  "After Zhu et al.'s characteristic-state choked-jet and hadronic-neutrino account, study Long and Yu's trajectory-resolved shock and cooling evolution, including both choking and breakout outcomes.",
];

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "astro-lineage-learning-paths-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  return { temporaryRoot, contentRoot };
}

async function writePath(contentRoot, path, reading = `---\npath_id: ${pathId}\n---\n\n# Path\n`) {
  const pathRoot = join(contentRoot, "learning-paths", pathSlug);
  await mkdir(pathRoot, { recursive: true });
  await writeFile(join(pathRoot, "path.yaml"), stringify(path), "utf8");
  await writeFile(join(pathRoot, "reading.md"), reading, "utf8");
}

function transition(sourceWorkId, targetWorkId, reason = "Read this next to establish the next physical step.") {
  return {
    source_work_id: sourceWorkId,
    target_work_id: targetWorkId,
    reason,
  };
}

function pathRecord({
  entries = [firstWorkId, secondWorkId],
  transitions = [transition(firstWorkId, secondWorkId)],
  reader_state = "draft",
  review_state = "unreviewed",
  curationActor = "actor:agent-curator",
  reviewActor = "actor:human-curator",
  title = "Transient Model Foundations",
} = {}) {
  const record = {
    path_id: pathId,
    reader_state,
    title,
    entries: entries.map((work_id) => ({ work_id })),
    transitions,
    curation_provenance: {
      actor_id: curationActor,
      recorded_at: "2026-09-05T07:00:00Z",
    },
    review_state,
    visibility_approvals: [],
  };
  if (review_state === "reviewed") {
    record.review_provenance = {
      actor_id: reviewActor,
      recorded_at: "2026-09-05T07:10:00Z",
    };
    record.review_binding = {
      canonicalization_version: "v1",
      semantic_digest: learningPathSemanticDigest(record),
    };
  }
  return record;
}

async function writeApprovedVisiblePath(contentRoot, overrides = {}) {
  const path = pathRecord({
    reader_state: "visible",
    review_state: "reviewed",
    ...overrides,
  });
  await writePath(contentRoot, path);
  const snapshot = await loadCanonicalContent(contentRoot);
  path.visibility_approvals = [{
    profile_id: "v0.1-default",
    visibility_digest: computeReaderVisibilityDigest(snapshot, "learning_path", pathId),
    actor_id: "actor:human-curator",
    approved_at: "2026-09-05T07:20:00Z",
  }];
  await writePath(contentRoot, path);
  return path;
}

function codes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

function diagnosticFor(result, code, fieldPath = undefined) {
  const diagnostic = result.diagnostics.find((item) =>
    item.code === code && (fieldPath === undefined || item.field_path === fieldPath));
  assert(diagnostic, `missing diagnostic ${code}${fieldPath ? ` at ${fieldPath}` : ""}`);
  return diagnostic;
}

function assertInOrder(source, markers, label) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${label}: missing ${marker}`);
    assert(next > cursor, `${label}: ${marker} is out of order`);
    cursor = next;
  }
}

function htmlText(source) {
  return source
    .replace(/<[^>]+>/gu, " ")
    .replace(/&#39;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

async function withFixture(callback) {
  const fixture = await copyContent();
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
}

test("draft Learning Paths with zero or one entry are valid but hidden", async () => {
  for (const entries of [[], [firstWorkId]]) {
    await withFixture(async ({ contentRoot }) => {
      await writePath(contentRoot, pathRecord({ entries, transitions: [] }));
      const result = await validateCanonicalContent(contentRoot);
      assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
      const inventory = result.learning_path_inventory.find(({ path_id }) => path_id === pathId);
      assert.deepEqual(inventory, {
        path_id: pathId,
        reader_state: "draft",
        validation_status: "valid",
        entries: entries.length,
        transitions: 0,
        visibility_digest: null,
        visibility_status: "hidden",
      });
      assert.equal(codes(result).has("VISIBLE_LEARNING_PATH_ENTRIES_REQUIRED"), false);
    });
  }
});

test("a visible Learning Path needs reviewed atomic content, visible Works, and a current Human approval", async () => {
  await withFixture(async ({ contentRoot }) => {
    await writeApprovedVisiblePath(contentRoot, {
      entries: [firstWorkId, secondWorkId, thirdWorkId],
      transitions: [
        transition(firstWorkId, secondWorkId),
        transition(secondWorkId, thirdWorkId),
      ],
    });
    const result = await validateCanonicalContent(contentRoot);
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
    const inventory = result.learning_path_inventory.find(({ path_id }) => path_id === pathId);
    assert.equal(inventory.reader_state, "visible");
    assert.equal(inventory.visibility_status, "approved");
    assert.match(inventory.visibility_digest, /^[0-9a-f]{64}$/u);
    assert.equal(inventory.entries, 3);
    assert.equal(inventory.transitions, 2);
  });
});

test("Learning Path entries are duplicate-free and transitions have exact count and adjacency", async () => {
  await withFixture(async ({ contentRoot }) => {
    const duplicate = pathRecord({
      entries: [firstWorkId, secondWorkId, secondWorkId],
      transitions: [
        transition(firstWorkId, secondWorkId),
        transition(secondWorkId, secondWorkId),
      ],
    });
    await writePath(contentRoot, duplicate);
    let result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, "LEARNING_PATH_ENTRY_DUPLICATE", "/entries/2/work_id");
    assert.equal(
      result.learning_path_inventory.find(({ path_id }) => path_id === pathId)?.visibility_status,
      "skipped",
    );

    const countMismatch = pathRecord({
      entries: [firstWorkId, secondWorkId, thirdWorkId],
      transitions: [transition(firstWorkId, secondWorkId)],
    });
    await writePath(contentRoot, countMismatch);
    result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, "LEARNING_PATH_TRANSITION_COUNT_INVALID", "/transitions");
    assert.equal(
      result.learning_path_inventory.find(({ path_id }) => path_id === pathId)?.visibility_status,
      "skipped",
    );

    const nonAdjacent = pathRecord({
      entries: [firstWorkId, secondWorkId, thirdWorkId],
      transitions: [
        transition(firstWorkId, thirdWorkId),
        transition(secondWorkId, thirdWorkId),
      ],
    });
    await writePath(contentRoot, nonAdjacent);
    result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, "LEARNING_PATH_TRANSITION_ADJACENCY_INVALID", "/transitions/0");
    assert.equal(
      result.learning_path_inventory.find(({ path_id }) => path_id === pathId)?.visibility_status,
      "skipped",
    );
  });
});

test("Pedagogical Transition reasons must be non-empty and normalized", async () => {
  await withFixture(async ({ contentRoot }) => {
    await writePath(contentRoot, pathRecord({
      transitions: [transition(firstWorkId, secondWorkId, "  read   this next  ")],
    }));
    let result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, "LEARNING_PATH_TRANSITION_REASON_NOT_NORMALIZED", "/transitions/0/reason");

    await writePath(contentRoot, pathRecord({
      transitions: [transition(firstWorkId, secondWorkId, "")],
    }));
    result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, "LEARNING_PATH_TRANSITION_REASON_INVALID", "/transitions/0/reason");
  });
});

test("Agent-created paths require Human review, and semantic edits stale an atomic review binding", async () => {
  await withFixture(async ({ contentRoot }) => {
    const reviewed = pathRecord({ reader_state: "draft", review_state: "reviewed" });
    reviewed.review_provenance.actor_id = "actor:agent-curator";
    await writePath(contentRoot, reviewed);
    let result = await validateCanonicalContent(contentRoot);
    assert(codes(result).has("CURATION_HUMAN_REVIEW_REQUIRED"));

    for (const mutate of [
      (path) => {
        path.transitions[0].reason = "A materially changed pedagogical reason.";
      },
      (path) => {
        path.title = "A materially changed path title";
      },
    ]) {
      const validReviewed = pathRecord({ reader_state: "draft", review_state: "reviewed" });
      mutate(validReviewed);
      await writePath(contentRoot, validReviewed);
      result = await validateCanonicalContent(contentRoot);
      diagnosticFor(result, "LEARNING_PATH_REVIEW_BINDING_STALE", "/review_binding/semantic_digest");
    }
  });
});

test("stale visibility approval blocks without mutating the visible Reader State", async () => {
  await withFixture(async ({ contentRoot }) => {
    const path = await writeApprovedVisiblePath(contentRoot);
    await writePath(
      contentRoot,
      path,
      `---\npath_id: ${pathId}\n---\n\n# Path\n\nChanged after release approval.\n`,
    );
    const result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, "VISIBILITY_APPROVAL_STALE", "/visibility_approvals");
    const reloaded = parse(await readFile(join(contentRoot, "learning-paths", pathSlug, "path.yaml"), "utf8"));
    assert.equal(reloaded.reader_state, "visible");
  });
});

test("unreviewed hidden paths never create reader-facing or scientific-graph records", async () => {
  await withFixture(async ({ contentRoot }) => {
    const before = await loadCanonicalContent(contentRoot);
    await writePath(contentRoot, pathRecord({ entries: [firstWorkId, secondWorkId] }));
    const result = await validateCanonicalContent(contentRoot);
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
    const inventory = result.learning_path_inventory.find(({ path_id }) => path_id === pathId);
    assert.equal(inventory.visibility_status, "hidden");
    assert.equal(result.scientific_edges.length, before.scientificEdges.length);
    assert.equal(result.scientific_edges.some((edge) => edge.path_id === pathId), false);
    const after = await loadCanonicalContent(contentRoot);
    for (const work of after.works) {
      assert.equal(Object.hasOwn(work.files["work.yaml"], "next_read"), false);
    }
  });
});

test("a visible path cannot reference a draft Work", async () => {
  await withFixture(async ({ contentRoot }) => {
    await writeApprovedVisiblePath(contentRoot);
    const workFile = join(contentRoot, "works", secondWorkSlug, "work.yaml");
    const work = parse(await readFile(workFile, "utf8"));
    work.reader_state = "draft";
    work.visibility_approvals = [];
    await writeFile(workFile, stringify(work), "utf8");
    const result = await validateCanonicalContent(contentRoot);
    diagnosticFor(result, "VISIBLE_LEARNING_PATH_WORK_NOT_VISIBLE", "/entries/1/work_id");
  });
});

test("the reader projection exposes only visible paths and entries while preserving canonical pedagogy", async () => {
  await withFixture(async ({ contentRoot }) => {
    const snapshot = await loadCanonicalContent(contentRoot);
    const visiblePaths = projectVisibleLearningPaths(snapshot);
    assert.deepEqual(visiblePaths.map(({ path_id }) => path_id), [productionPathId]);

    const path = visiblePaths[0];
    assert.deepEqual(path.entries.map(({ work_id }) => work_id), productionEntryIds);
    assert.deepEqual(path.transitions.map(({ reason }) => reason), productionTransitionReasons);
    assert.deepEqual(
      path.transitions.map(({ source_work_id, target_work_id }) => [source_work_id, target_work_id]),
      [productionEntryIds.slice(0, 2), productionEntryIds.slice(1, 3)],
    );
    assert.deepEqual(path.review_context, {
      status: "reviewed",
      reviewer_actor_id: "actor:human-curator",
      reviewed_at: "2026-09-05T11:48:58Z",
    });

    await writeApprovedVisiblePath(contentRoot, {
      entries: [firstWorkId, secondWorkId, thirdWorkId],
      transitions: [
        transition(firstWorkId, secondWorkId),
        transition(secondWorkId, thirdWorkId),
      ],
    });
    const sortedCollection = projectVisibleLearningPaths(await loadCanonicalContent(contentRoot));
    assert.deepEqual(
      sortedCollection.map(({ path_id }) => path_id),
      [productionPathId, pathId],
    );
    assert.deepEqual(
      sortedCollection.find(({ path_id }) => path_id === productionPathId).entries.map(({ work_id }) => work_id),
      productionEntryIds,
      "collection sorting must not reorder a path's canonical entries",
    );

    await writePath(contentRoot, pathRecord());
    assert.deepEqual(
      projectVisibleLearningPaths(await loadCanonicalContent(contentRoot)).map(({ path_id }) => path_id),
      [productionPathId],
      "a draft path must stay out of the reader collection",
    );

    const zhuWorkFile = join(contentRoot, "works", "zhu-2021", "work.yaml");
    const zhuWork = parse(await readFile(zhuWorkFile, "utf8"));
    zhuWork.reader_state = "draft";
    zhuWork.visibility_approvals = [];
    await writeFile(zhuWorkFile, stringify(zhuWork), "utf8");
    const projectedWithHiddenEntry = projectLearningPathForReader(
      await loadCanonicalContent(contentRoot),
      productionPathId,
    );
    assert.deepEqual(
      projectedWithHiddenEntry.entries.map(({ work_id }) => work_id),
      ["work:bromberg-2011", "work:long-yu-2026"],
    );
    assert.deepEqual(projectedWithHiddenEntry.transitions, []);
  });
});

test("the static Learning Paths index and detail form a complete slug-based reading route", async () => {
  const beforeCanonicalDigest = await computeCanonicalContentDigest(productionContent);
  const beforeSnapshot = await loadCanonicalContent(productionContent);
  const beforeVisibilityDigest = computeReaderVisibilityDigest(
    beforeSnapshot,
    "learning_path",
    productionPathId,
  );

  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const indexPath = join(projectRoot, "dist", "learning-paths", "index.html");
  const detailPath = join(projectRoot, "dist", "learning-paths", productionPathSlug, "index.html");
  assert.equal(existsSync(indexPath), true);
  assert.equal(existsSync(detailPath), true);

  const indexHtml = await readFile(indexPath, "utf8");
  const detailHtml = await readFile(detailPath, "utf8");
  const detailText = htmlText(detailHtml);
  assert.match(indexHtml, /1 条已审核学习路径/u);
  assert.match(indexHtml, /href="\/learning-paths\/embedded-jet-dynamics\/"/u);
  assert.match(indexHtml, /From Jet Propagation to Dynamic Multi-messenger Yields/u);
  assert.match(detailText, /This path moves from a compact account of relativistic jet propagation/u);
  assert.match(detailText, /Begin with Bromberg et al\. 2011 to establish jet-head motion/u);
  assertInOrder(detailText, [
    "The Propagation of Relativistic Jets in External Media",
    productionTransitionReasons[0],
    "High-energy Neutrinos from Choked Gamma-Ray Bursts in Active Galactic Nucleus Accretion Disks",
    productionTransitionReasons[1],
    "High-energy neutrino signatures of embedded GRB jets in AGN disks: a dynamic jet-propagation framework",
  ], "Learning Path timeline");
  for (const href of [
    "/papers/bromberg-2011/",
    "/papers/zhu-2021/",
    "/papers/long-yu-2026/",
  ]) {
    assert.match(detailHtml, new RegExp(`href="${href}"`, "u"), href);
    assert.equal(existsSync(join(projectRoot, "dist", href.slice(1), "index.html")), true, href);
  }
  assert.equal((detailHtml.match(/>阅读论文<\/a>/gu) ?? []).length, 3);
  assert.equal((detailHtml.match(/<strong>下一步为什么：<\/strong>/gu) ?? []).length, 2);
  for (const versionId of [
    "version:bromberg-2011-journal",
    "version:zhu-2021-arxiv-v3",
    "version:long-yu-2026-arxiv-v1",
  ]) {
    assert.match(detailHtml, new RegExp(`首选版本 ${versionId}`, "u"), versionId);
  }
  assert.match(detailHtml, /<summary>溯源详情<\/summary>/u);
  assert.doesNotMatch(`${indexHtml}${detailHtml}`, /<script/iu);

  const indexSource = await readFile(
    join(projectRoot, "src", "pages", "learning-paths", "index.astro"),
    "utf8",
  );
  assert.match(indexSource, /learningPaths\.length === 0/u);
  assert.match(indexSource, />暂无经过审核的学习路径。<\/p>/u);

  const emptyFixture = await copyContent();
  try {
    const visiblePathFile = join(
      emptyFixture.contentRoot,
      "learning-paths",
      productionPathSlug,
      "path.yaml",
    );
    const visiblePath = parse(await readFile(visiblePathFile, "utf8"));
    visiblePath.reader_state = "draft";
    visiblePath.visibility_approvals = [];
    await writeFile(visiblePathFile, stringify(visiblePath), "utf8");
    assert.deepEqual(
      projectVisibleLearningPaths(await loadCanonicalContent(emptyFixture.contentRoot)),
      [],
      "the index empty-state branch must receive an empty visible projection",
    );
  } finally {
    await rm(emptyFixture.temporaryRoot, { recursive: true, force: true });
  }

  const afterSnapshot = await loadCanonicalContent(productionContent);
  assert.equal(await computeCanonicalContentDigest(productionContent), beforeCanonicalDigest);
  assert.equal(
    computeReaderVisibilityDigest(afterSnapshot, "learning_path", productionPathId),
    beforeVisibilityDigest,
  );
});
