import assert from "node:assert/strict";
import { cp, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  isValidationValid,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";

const productionContent = new URL("../content/", import.meta.url);

async function relativePaths(root, directory = root) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const relativePath = absolutePath.slice(root.length + 1).split("\\").join("/");
    paths.push(relativePath);
    if (entry.isDirectory()) {
      paths.push(...await relativePaths(root, absolutePath));
    }
  }
  return paths;
}

test("canonical content uses colon-free filesystem paths while preserving semantic IDs", async () => {
  const contentRoot = fileURLToPath(new URL("../content", import.meta.url));
  const paths = await relativePaths(contentRoot);
  assert.deepEqual(paths.filter((path) => path.includes(":")), []);

  const snapshot = await loadCanonicalContent(productionContent);
  const transfit = snapshot.works.find(({ id }) => id === "work:transfit-2025");
  const denseLine = snapshot.researchLines.find(
    ({ id }) => id === "research-line:dense-environment-multimessenger",
  );
  const learningPath = snapshot.learningPaths.find(
    ({ id }) => id === "learning-path:embedded-jet-dynamics",
  );
  const scientificEdge = snapshot.scientificEdges.find(
    ({ id }) => id === "edge:long-yu-extends-zhu-dynamic-trajectory",
  );

  assert.equal(transfit?.slug, "transfit-2025");
  assert.equal(denseLine?.slug, "dense-environment-multimessenger");
  assert.equal(learningPath?.slug, "embedded-jet-dynamics");
  assert.equal(scientificEdge?.slug, "long-yu-extends-zhu-dynamic-trajectory");
});

test("renaming filesystem slugs does not change semantic identity or validity", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-p0-slugs-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });

  try {
    await rename(
      join(contentRoot, "works", "arnett-1982"),
      join(contentRoot, "works", "renamed-arnett-bundle"),
    );
    await rename(
      join(contentRoot, "research-lines", "central-engines"),
      join(contentRoot, "research-lines", "renamed-central-engines"),
    );
    await rename(
      join(contentRoot, "learning-paths", "embedded-jet-dynamics"),
      join(contentRoot, "learning-paths", "renamed-learning-path"),
    );
    await rename(
      join(contentRoot, "scientific-edges", "transfit-challenges-arnett-maximum-light.yaml"),
      join(contentRoot, "scientific-edges", "renamed-scientific-edge.yaml"),
    );

    const snapshot = await loadCanonicalContent(contentRoot);
    assert(snapshot.works.some(({ id }) => id === "work:arnett-1982"));
    assert(snapshot.researchLines.some(({ id }) => id === "research-line:central-engines"));
    assert(snapshot.learningPaths.some(({ id }) => id === "learning-path:embedded-jet-dynamics"));
    assert(snapshot.scientificEdges.some(
      ({ id }) => id === "edge:transfit-challenges-arnett-maximum-light",
    ));

    const result = await validateCanonicalContent(contentRoot);
    assert.equal(isValidationValid(result.diagnostics), true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("distinct filesystem slugs cannot declare duplicate semantic IDs", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-p0-duplicate-ids-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });

  const duplicatePaths = [
    ["works", "arnett-1982", "zz-duplicate-arnett-bundle"],
    ["research-lines", "central-engines", "zz-duplicate-central-engines"],
    ["learning-paths", "embedded-jet-dynamics", "zz-duplicate-learning-path"],
  ];

  try {
    for (const [collection, sourceSlug, duplicateSlug] of duplicatePaths) {
      assert.equal(duplicateSlug.includes(":"), false);
      await cp(
        join(contentRoot, collection, sourceSlug),
        join(contentRoot, collection, duplicateSlug),
        { recursive: true },
      );
    }

    const result = await validateCanonicalContent(contentRoot);
    const expectedDiagnostics = [
      ["WORK_ID_DUPLICATE", "content/works/zz-duplicate-arnett-bundle/work.yaml", "/work_id"],
      [
        "RESEARCH_LINE_ID_DUPLICATE",
        "content/research-lines/zz-duplicate-central-engines/line.yaml",
        "/line_id",
      ],
      [
        "LEARNING_PATH_ID_DUPLICATE",
        "content/learning-paths/zz-duplicate-learning-path/path.yaml",
        "/path_id",
      ],
    ];

    for (const [code, file, fieldPath] of expectedDiagnostics) {
      assert(
        result.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === code &&
            diagnostic.file === file &&
            diagnostic.field_path === fieldPath,
        ),
        `Expected ${code} on ${file}${fieldPath}`,
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("duplicate Scientific Edge IDs quarantine only the colliding source file", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-p0-duplicate-edge-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });

  const duplicateSlug = "zz-duplicate-transfit-arnett-edge.yaml";
  const duplicatePath = join(contentRoot, "scientific-edges", duplicateSlug);

  try {
    assert.equal(duplicateSlug.includes(":"), false);
    await cp(
      join(
        contentRoot,
        "scientific-edges",
        "transfit-challenges-arnett-maximum-light.yaml",
      ),
      duplicatePath,
    );

    const result = await validateCanonicalContent(contentRoot);
    assert(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "SCIENTIFIC_EDGE_ID_DUPLICATE" &&
          diagnostic.file === `content/scientific-edges/${duplicateSlug}` &&
          diagnostic.field_path === "/id",
      ),
    );
    assert.equal(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "VISIBILITY_APPROVAL_STALE" &&
          ["work:arnett-1982", "work:transfit-2025"].includes(diagnostic.record_id),
      ),
      false,
      "the invalid duplicate Edge must not change approved reader projections",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
