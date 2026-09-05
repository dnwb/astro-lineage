import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { createDiagnostic } from "../scripts/diagnostic.mjs";
import {
  AXIS_IDS,
  AXIS_QUESTIONS,
  WORK_CONCERN_FILES,
  discoverCanonicalContent,
  loadCanonicalContent,
} from "../scripts/content-loader.mjs";
import {
  canonicalizeMarkdown,
  computeCanonicalContentDigest,
} from "../scripts/content-digest.mjs";
import {
  runValidation,
  isValidationValid,
  validateCanonicalContent,
  writeValidationReports,
} from "../scripts/content-validator.mjs";

const productionContent = new URL("../content/", import.meta.url);

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket02-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  return { temporaryRoot, contentRoot };
}

test("the production snapshot keeps the frozen canonical layout across canonical Works", async () => {
  const snapshot = await loadCanonicalContent(productionContent);

  assert.deepEqual(snapshot.manifest, {
    schema_version: "v0.1",
    canonicalization_version: "v1",
    visibility_profile_id: "v0.1-default",
  });
  const workIds = snapshot.works.map(({ id }) => id);
  assert(workIds.includes("work:arnett-1982"));
  assert(workIds.includes("work:bromberg-2011"));
  assert(workIds.includes("work:zhu-2021"));
  assert(workIds.includes("work:transfit-2025"));
  assert.deepEqual(
    snapshot.scientificEdges.map(({ id }) => id).sort(),
    [
      "edge:long-yu-extends-zhu-dynamic-trajectory",
      "edge:transfit-challenges-arnett-maximum-light",
    ],
  );
  assert.deepEqual(
    snapshot.researchLines.map(({ id }) => id),
    [
      "research-line:central-engines",
      "research-line:dense-environment-multimessenger",
      "research-line:explosive-transients-csm",
    ],
  );
  assert.deepEqual(
    snapshot.learningPaths.map(({ id, path }) => ({
      id,
      reader_state: path.reader_state,
      review_state: path.review_state,
    })),
    [{
      id: "learning-path:embedded-jet-dynamics",
      reader_state: "visible",
      review_state: "reviewed",
    }],
  );
  assert.deepEqual(snapshot.axes.map((axis) => axis.id), AXIS_IDS);
  assert.deepEqual(
    snapshot.methods.method_families.map(({ id }) => id),
    [
      "method-family:analytical-modeling",
      "method-family:numerical-modeling",
      "method-family:model-data-parameter-estimation",
    ],
  );
  const techniqueIds = snapshot.methods.techniques.map(({ id }) => id);
  assert(techniqueIds.includes("technique:reduction-to-quadrature"));
  assert(techniqueIds.includes("technique:coupled-pressure-balance-model"));
  assert(techniqueIds.includes("technique:detector-effective-area-folding"));
  assert(techniqueIds.includes("technique:crank-nicolson-finite-difference"));
  assert(techniqueIds.includes("technique:forward-model-light-curve-fitting"));
  assert(snapshot.discovery.files.includes("content/works/work:bromberg-2011/work.yaml"));
  assert(snapshot.discovery.files.every((file) => !file.startsWith("generated/")));
});

test("closed-world discovery rejects unknown production entries", async () => {
  const { contentRoot } = await copyContent();
  const digestBefore = await computeCanonicalContentDigest(contentRoot);
  await writeFile(join(contentRoot, "README.txt"), "not canonical\n");
  await mkdir(join(contentRoot, "scientific-edges"), { recursive: true });
  await writeFile(join(contentRoot, "scientific-edges", "edge.txt"), "not yaml\n");

  const discovery = await discoverCanonicalContent(contentRoot);
  const diagnostic = discovery.diagnostics.find(
    ({ code }) => code === "STRUCTURE_UNKNOWN_ENTRY",
  );

  assert(diagnostic);
  assert.equal(diagnostic.dataset, "production");
  assert.equal(diagnostic.file, "content/README.txt");
  assert.equal(diagnostic.field_path, null);
  assert.equal(discovery.files.includes("content/README.txt"), false);
  assert.equal(discovery.files.includes("content/scientific-edges/edge.txt"), false);

  const digestAfter = await computeCanonicalContentDigest(contentRoot);
  assert.equal(digestAfter, digestBefore);
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "code",
    "dataset",
    "field_path",
    "file",
    "message",
    "record_id",
    "related_ids",
    "severity",
  ]);
});

test("production discovery does not scan generated artifacts or test fixtures", async () => {
  const { temporaryRoot, contentRoot } = await copyContent();
  await mkdir(join(temporaryRoot, "generated"), { recursive: true });
  await mkdir(join(temporaryRoot, "tests", "fixtures", "valid"), { recursive: true });
  await writeFile(join(temporaryRoot, "generated", "index.json"), "derived\n");
  await writeFile(join(temporaryRoot, "tests", "fixtures", "valid", "fake.yaml"), "fixture: true\n");

  const discovery = await discoverCanonicalContent(contentRoot);

  assert.equal(discovery.files.some((file) => file.includes("generated")), false);
  assert.equal(discovery.files.some((file) => file.includes("fixtures")), false);
});

test("a Work directory must contain the complete seven-file bundle", async () => {
  const { contentRoot } = await copyContent();
  const workRoot = join(contentRoot, "works", "work-example");
  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, "work.yaml"), "work_id: work-example\n");

  const discovery = await discoverCanonicalContent(contentRoot);
  const diagnostic = discovery.diagnostics.find(
    ({ code }) => code === "STRUCTURE_WORK_BUNDLE_INCOMPLETE",
  );

  assert(diagnostic);
  assert.equal(diagnostic.record_id, "work-example");
  assert.equal(diagnostic.file, "content/works/work-example");
  assert.equal(diagnostic.field_path, null);
  assert.deepEqual(diagnostic.related_ids, WORK_CONCERN_FILES);
});

test("unsupported manifest versions fail explicitly", async () => {
  const { contentRoot } = await copyContent();
  await writeFile(
    join(contentRoot, "manifest.yaml"),
    "schema_version: v9\ncanonicalization_version: v1\nvisibility_profile_id: v0.1-default\n",
  );

  const result = await validateCanonicalContent(contentRoot);
  const diagnostic = result.diagnostics.find(
    ({ code }) => code === "MANIFEST_UNSUPPORTED_SCHEMA_VERSION",
  );

  assert(diagnostic);
  assert.equal(diagnostic.record_id, "manifest");
  assert.equal(diagnostic.field_path, "/schema_version");
});

test("a malformed YAML document is quarantined without manifest cascades", async () => {
  const { contentRoot } = await copyContent();
  await writeFile(join(contentRoot, "manifest.yaml"), "schema_version: [\n");

  const result = await validateCanonicalContent(contentRoot);
  const codes = result.diagnostics.map(({ code }) => code);

  assert.deepEqual(codes, ["STRUCTURE_YAML_PARSE_ERROR"]);
  assert.equal(result.canonical_content_digest, null);
});

test("malformed YAML reports an unavailable digest instead of hashing raw source", async () => {
  const { temporaryRoot, contentRoot } = await copyContent();
  await writeFile(join(contentRoot, "manifest.yaml"), "schema_version: [\n");

  const report = await runValidation({ contentRoot, outputRoot: temporaryRoot });
  const reportJson = JSON.parse(
    await readFile(join(temporaryRoot, "validation/report.json"), "utf8"),
  );
  const reportMarkdown = await readFile(join(temporaryRoot, "validation/report.md"), "utf8");

  assert.equal(report.canonical_content_digest, null);
  assert.equal(reportJson.canonical_content_digest, null);
  assert.match(reportMarkdown, /Canonical content digest: `unavailable`/);
});

test("manifest failure reports preserve invalid and missing metadata values", async () => {
  const invalid = await copyContent();
  await writeFile(
    join(invalid.contentRoot, "manifest.yaml"),
    "schema_version: v0.1\ncanonicalization_version: v9\nvisibility_profile_id: v9-profile\n",
  );
  const invalidReport = await validateCanonicalContent(invalid.contentRoot);

  assert.equal(invalidReport.canonicalization_version, "v9");
  assert.equal(invalidReport.visibility_profile_id, "v9-profile");

  const missing = await copyContent();
  await writeFile(join(missing.contentRoot, "manifest.yaml"), "schema_version: v0.1\n");
  const missingReport = await validateCanonicalContent(missing.contentRoot);

  assert.equal(missingReport.canonicalization_version, null);
  assert.equal(missingReport.visibility_profile_id, null);
});

test("editorial bundle metadata and reading prose must be regular files", async () => {
  for (const [collection, metadataFile] of [
    ["research-lines", "line.yaml"],
    ["learning-paths", "path.yaml"],
  ]) {
    const { contentRoot } = await copyContent();
    const bundleRoot = join(contentRoot, collection, "bundle-example");
    await mkdir(join(bundleRoot, metadataFile), { recursive: true });
    await mkdir(join(bundleRoot, "reading.md"), { recursive: true });

    const discovery = await discoverCanonicalContent(contentRoot);
    const diagnostics = discovery.diagnostics.filter(
      ({ code, file }) =>
        code === "STRUCTURE_EDITORIAL_EXPECTED_FILE" &&
        file.startsWith(`content/${collection}/bundle-example/`),
    );

    assert.deepEqual(
      diagnostics.map(({ file }) => file).sort(),
      [
        `content/${collection}/bundle-example/${metadataFile}`,
        `content/${collection}/bundle-example/reading.md`,
      ].sort(),
    );
    assert.equal(
      discovery.files.some((file) => file.startsWith(`content/${collection}/bundle-example/`)),
      false,
    );
  }
});

test("Physics Ontology axis questions are frozen schema-level contracts", async () => {
  const { contentRoot } = await copyContent();
  const axisPath = join(contentRoot, "ontology", "axes", "central_object.yaml");
  const axis = parse(await readFile(axisPath, "utf8"));
  axis.question = "A different question";
  await writeFile(axisPath, stringify(axis));

  const result = await validateCanonicalContent(contentRoot);
  const diagnostic = result.diagnostics.find(
    ({ code }) => code === "STRUCTURE_AXIS_QUESTION_MISMATCH",
  );

  assert(diagnostic);
  assert.equal(diagnostic.record_id, "central_object");
  assert.equal(diagnostic.field_path, "/question");
  assert.deepEqual(diagnostic.related_ids, []);
  assert.equal(AXIS_QUESTIONS.central_object !== axis.question, true);
});

test("a scalar axis record keeps its declared filename identity without cascades", async () => {
  const { contentRoot } = await copyContent();
  const axisPath = join(contentRoot, "ontology", "axes", "central_object.yaml");
  await writeFile(axisPath, "scalar-axis-record\n");

  const snapshot = await loadCanonicalContent(contentRoot);
  const loadedAxis = snapshot.axes.find(({ id }) => id === "central_object");
  assert(loadedAxis);
  assert.equal(loadedAxis.value, "scalar-axis-record");

  const result = await validateCanonicalContent(contentRoot);
  assert.deepEqual(
    result.diagnostics
      .filter(({ file }) => file === "content/ontology/axes/central_object.yaml")
      .map(({ code }) => code),
    ["STRUCTURE_AXIS_INVALID_SHAPE"],
  );
});

test("only error diagnostics make a validation result invalid", () => {
  const base = {
    code: "TEST_DIAGNOSTIC",
    file: "tests/fixture.yaml",
    message: "test",
  };

  assert.equal(
    isValidationValid([
      createDiagnostic({ ...base, severity: "warning" }),
      createDiagnostic({ ...base, severity: "info" }),
    ]),
    true,
  );
  assert.equal(
    isValidationValid([
      createDiagnostic({ ...base, severity: "warning" }),
      createDiagnostic({ ...base, severity: "error" }),
    ]),
    false,
  );
});

test("canonical reading I/O errors are diagnosed instead of becoming empty prose", async () => {
  const { contentRoot } = await copyContent();
  const workRoot = join(contentRoot, "works", "work-with-directory-reading");
  await mkdir(workRoot, { recursive: true });
  for (const fileName of WORK_CONCERN_FILES) {
    const filePath = join(workRoot, fileName);
    if (fileName === "reading.md") {
      await mkdir(filePath);
    } else {
      await writeFile(filePath, "{}\n");
    }
  }

  const snapshot = await loadCanonicalContent(contentRoot);
  const diagnostic = snapshot.discovery.diagnostics.find(
    ({ code, file }) =>
      code === "STRUCTURE_CANONICAL_READ_ERROR" &&
      file === "content/works/work-with-directory-reading/reading.md",
  );

  assert(diagnostic);
  assert.equal(snapshot.works[0].files["reading.md"], undefined);

  const result = await validateCanonicalContent(contentRoot);
  assert.equal(result.valid, false);
  assert(result.diagnostics.some(({ code }) => code === "STRUCTURE_CANONICAL_READ_ERROR"));
});

test("editorial reading I/O errors preserve an absent reading value", async () => {
  for (const [collection, metadataFile, property] of [
    ["research-lines", "line.yaml", "researchLines"],
    ["learning-paths", "path.yaml", "learningPaths"],
  ]) {
    const { contentRoot } = await copyContent();
    const bundleRoot = join(contentRoot, collection, "bundle-with-unreadable-reading");
    const readingPath = join(bundleRoot, "reading.md");
    await mkdir(bundleRoot, { recursive: true });
    await writeFile(join(bundleRoot, metadataFile), "{}\n");
    await writeFile(readingPath, "This prose cannot be read.\n");
    await chmod(readingPath, 0o000);

    try {
      const snapshot = await loadCanonicalContent(contentRoot);
      const diagnostic = snapshot.discovery.diagnostics.find(
        ({ code, file }) =>
          code === "STRUCTURE_CANONICAL_READ_ERROR" &&
          file === `content/${collection}/bundle-with-unreadable-reading/reading.md`,
      );

      assert(diagnostic);
      assert.equal(snapshot[property][0].reading, undefined);
      assert.equal(Object.hasOwn(snapshot[property][0], "reading"), false);
    } finally {
      await chmod(readingPath, 0o644);
    }
  }
});

test("semantic content digests ignore YAML formatting and line-ending changes", async () => {
  const { contentRoot } = await copyContent();
  const before = await computeCanonicalContentDigest(contentRoot);
  const axisPath = join(contentRoot, "ontology", "axes", "central_object.yaml");
  const axis = parse(await readFile(axisPath, "utf8"));

  await writeFile(
    axisPath,
    stringify(
      {
        terms: axis.terms,
        default_risk: axis.default_risk,
        question: axis.question,
        label: axis.label,
        id: axis.id,
      },
      { lineWidth: 0 },
    ).replaceAll("\n", "\r\n"),
  );

  const after = await computeCanonicalContentDigest(contentRoot);
  assert.equal(after, before);
  assert.equal(canonicalizeMarkdown("a\r\nb\r\nc"), "a\nb\nc");
});

test("successful validation emits complete pass metadata and both reports", async () => {
  const { temporaryRoot, contentRoot } = await copyContent();
  const report = await validateCanonicalContent(contentRoot);
  await writeValidationReports(report, temporaryRoot);

  assert.equal(report.diagnostics.length, 0);
  assert.equal(report.passes.structural.status, "complete");
  assert.equal(report.passes.referential.status, "complete");
  assert.equal(report.passes.semantic.status, "complete");
  assert.match(report.canonical_content_digest, /^[0-9a-f]{64}$/);
  assert.equal(report.schema_version, "v0.1");
  assert.match(await readFile(join(temporaryRoot, "validation/report.json"), "utf8"), /canonical_content_digest/);
  assert.match(await readFile(join(temporaryRoot, "validation/report.md"), "utf8"), /Stored \+ Validated \+ Rendered/);
});

test("failing validation still emits reports before returning errors", async () => {
  const { temporaryRoot, contentRoot } = await copyContent();
  await writeFile(
    join(contentRoot, "manifest.yaml"),
    "schema_version: unsupported\ncanonicalization_version: v1\nvisibility_profile_id: v0.1-default\n",
  );

  const report = await runValidation({ contentRoot, outputRoot: temporaryRoot });

  assert(report.diagnostics.some(({ code }) => code === "MANIFEST_UNSUPPORTED_SCHEMA_VERSION"));
  assert.equal(report.passes.structural.status, "partial");
  assert.match(await readFile(join(temporaryRoot, "validation/report.json"), "utf8"), /MANIFEST_UNSUPPORTED_SCHEMA_VERSION/);
  assert.match(await readFile(join(temporaryRoot, "validation/report.md"), "utf8"), /MANIFEST_UNSUPPORTED_SCHEMA_VERSION/);
});
