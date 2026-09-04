import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import {
  AXIS_IDS,
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

test("the empty production snapshot has the frozen canonical layout", async () => {
  const snapshot = await loadCanonicalContent(productionContent);

  assert.deepEqual(snapshot.manifest, {
    schema_version: "v0.1",
    canonicalization_version: "v1",
    visibility_profile_id: "v0.1-default",
  });
  assert.deepEqual(snapshot.works, []);
  assert.deepEqual(snapshot.scientificEdges, []);
  assert.deepEqual(snapshot.researchLines, []);
  assert.deepEqual(snapshot.learningPaths, []);
  assert.deepEqual(snapshot.axes.map((axis) => axis.id), AXIS_IDS);
  assert.deepEqual(snapshot.methods, {
    method_families: [],
    techniques: [],
  });
  assert.equal(snapshot.discovery.files.length, 19);
  assert(snapshot.discovery.files.every((file) => !file.startsWith("generated/")));
});

test("closed-world discovery rejects unknown production entries", async () => {
  const { contentRoot } = await copyContent();
  await writeFile(join(contentRoot, "README.txt"), "not canonical\n");

  const discovery = await discoverCanonicalContent(contentRoot);
  const diagnostic = discovery.diagnostics.find(
    ({ code }) => code === "STRUCTURE_UNKNOWN_ENTRY",
  );

  assert(diagnostic);
  assert.equal(diagnostic.dataset, "production");
  assert.equal(diagnostic.file, "content/README.txt");
  assert.equal(diagnostic.field_path, null);
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
