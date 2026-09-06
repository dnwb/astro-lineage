import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  runValidation,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";
import {
  buildWorkResearchLineIndex,
  writeEditorialIndexes,
} from "../scripts/editorial-index.mjs";
import {
  parseReadingMarkdown,
} from "../scripts/reader-markdown.mjs";
import {
  projectVisibleSnapshot,
} from "../scripts/reader-projection.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const productionContent = join(projectRoot, "content");
const works = [
  { id: "work:arnett-1982", slug: "arnett-1982" },
  { id: "work:bromberg-2011", slug: "bromberg-2011" },
  { id: "work:long-yu-2026", slug: "long-yu-2026" },
  { id: "work:transfit-2025", slug: "transfit-2025" },
  { id: "work:zhu-2021", slug: "zhu-2021" },
];

async function readYaml(path) {
  return parse(await readFile(path, "utf8"));
}

async function withContentFixture(callback) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "astro-lineage-reader-content-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  try {
    return await callback({ temporaryRoot, contentRoot });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("the reading prose parser preserves section hierarchy and wrapped list items", () => {
  assert.deepEqual(
    parseReadingMarkdown(`---\nwork_id: work:test\n---\n\n# Title\n\n## Assumptions\n\n- A wrapped\n  list item.\n\n## Reason to read\n\nRead this Work.`),
    [
      { kind: "heading", depth: 2, text: "Assumptions" },
      { kind: "list", items: ["A wrapped list item."] },
      { kind: "heading", depth: 2, text: "Reason to read" },
      { kind: "paragraph", text: "Read this Work." },
    ],
  );
});

test("the coverage matrix closes every real fixture row with Stored, Validated, and Rendered evidence", async () => {
  const matrixPath = join(projectRoot, "docs", "coverage", "v0.1-stored-validated-rendered.md");
  const matrix = await readFile(matrixPath, "utf8");
  assert.match(matrix, /Stored \+ Validated \+ Rendered coverage matrix/u);
  assert.match(matrix, /\| Major structure \| Stored: real canonical fixture \| Validated: check\/evidence \| Rendered: reader artifact\/evidence \| Status \|/u);

  const rows = matrix
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.startsWith("| ---") && !line.includes("Major structure"));
  assert.equal(rows.length, 12);
  for (const row of rows) {
    const cells = row.slice(1, -1).split("|").map((cell) => cell.trim());
    assert.equal(cells.length, 5, row);
    assert.match(cells[1], /content\//u, row);
    assert.match(cells[2], /tests\//u, row);
    assert.match(cells[3], /(?:\/|validation\/)/u, row);
    assert.equal(cells[4], "Complete", row);
    for (const path of [...cells[1].matchAll(/`(content\/[^`]+)`/gu)].map((match) => match[1])) {
      const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
      assert.equal(existsSync(join(projectRoot, normalized)), true, normalized);
    }
  }
});

test("all five Work pages render the paper-reading loop and on-demand provenance as static HTML", async () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  for (const { id: workId, slug } of works) {
    const html = await readFile(join(projectRoot, "dist", "papers", slug, "index.html"), "utf8");
    for (const marker of [
      "<h1>",
      "Why This Work Matters",
      "Problem",
      "Scientific Takeaway",
      "Assumptions",
      "Scientific Delta",
      "Connections",
      "Research Context",
      "Physical Account",
      "Physics Ontology",
      "Methods",
      "Provenance &amp; scientific evidence",
      "Version Evidence",
      "typed locator",
    ]) {
      assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")), `${workId}: ${marker}`);
    }
    assert.doesNotMatch(html, /<script/iu, workId);
  }

  const papers = await readFile(join(projectRoot, "dist", "papers", "index.html"), "utf8");
  const home = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
  assert.doesNotMatch(papers, /provenance/iu);
  assert.match(home, /Research Lines/u);
  assert.match(home, /Learning Paths/u);
  assert.match(home, /href="\/papers\/arnett-1982\/"/u);
  assert.equal(existsSync(join(projectRoot, "dist", "validation")), false);
});

test("Validation Report carries pass states, digests, complete inventory statistics, and explicit zero counts", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "astro-lineage-reader-report-"));
  try {
    const report = await runValidation({
      contentRoot: productionContent,
      outputRoot: temporaryRoot,
      dataset: "fixture:reader-production",
    });
    assert.equal(report.valid, true, JSON.stringify(report.diagnostics, null, 2));
    assert.deepEqual(
      Object.fromEntries(Object.entries(report.passes).map(([name, pass]) => [name, pass.status])),
      {
        structural: "complete",
        referential: "complete",
        semantic: "complete",
        discovery: "complete",
      },
    );
    assert.match(report.canonical_content_digest, /^[0-9a-f]{64}$/u);
    for (const key of [
      "actors",
      "works",
      "versions",
      "evidence",
      "physics_annotations",
      "method_annotations",
      "ontology_axes",
      "controlled_terms",
      "research_lines",
      "research_line_memberships",
      "learning_paths",
      "learning_path_entries",
      "pedagogical_transitions",
      "scientific_statements",
      "causal_stages",
      "causal_links",
      "publication_relations",
      "scientific_edges",
    ]) {
      assert.equal(typeof report.statistics[key], "number", key);
    }
    assert.deepEqual(report.statistics.scientific_edge_relation_counts, {
      builds_on: 0,
      extends: 1,
      tests: 0,
      constrains: 0,
      challenges: 1,
      replaces_assumption: 0,
      corrects: 0,
    });
    assert.deepEqual(report.statistics.publication_relation_counts, {
      revises: 0,
      published_as: 1,
    });
    const jsonReport = JSON.parse(await readFile(join(temporaryRoot, "validation", "report.json"), "utf8"));
    const markdownReport = await readFile(join(temporaryRoot, "validation", "report.md"), "utf8");
    assert.equal(jsonReport.dataset, "fixture:reader-production");
    assert.match(markdownReport, /## Stored \+ Validated \+ Rendered/u);
    assert.match(markdownReport, /scientific_edge_relation_counts/u);
    assert.match(markdownReport, /builds_on.*0/u);
    assert.match(markdownReport, /## Diagnostics/u);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("reverse indexes are direct, byte-for-byte reproducible, removable, and exclude hidden records", async () => {
  await withContentFixture(async ({ temporaryRoot, contentRoot }) => {
    const snapshot = await loadCanonicalContent(contentRoot);
    const generatedRoot = join(temporaryRoot, "generated");
    const firstIndex = await writeEditorialIndexes(snapshot, generatedRoot);
    const firstBytes = await readFile(join(generatedRoot, "work-research-lines.json"), "utf8");
    await rm(join(generatedRoot, "work-research-lines.json"));
    assert.equal(existsSync(join(generatedRoot, "work-research-lines.json")), false);
    const secondIndex = await writeEditorialIndexes(await loadCanonicalContent(contentRoot), generatedRoot);
    const secondBytes = await readFile(join(generatedRoot, "work-research-lines.json"), "utf8");
    assert.deepEqual(secondIndex, firstIndex);
    assert.equal(secondBytes, firstBytes);
    assert.deepEqual(firstIndex, buildWorkResearchLineIndex(snapshot));

    const statementsPath = join(contentRoot, "works", "arnett-1982", "statements.yaml");
    const statements = await readYaml(statementsPath);
    const hidden = structuredClone(statements.statements[0]);
    hidden.id = "statement:reader-hidden-marker";
    hidden.canonical_text = "HIDDEN_READER_MARKER";
    hidden.review_state = "unreviewed";
    delete hidden.review_provenance;
    delete hidden.review_binding;
    statements.statements.push(hidden);
    await writeFile(statementsPath, stringify(statements), "utf8");

    const report = await validateCanonicalContent(contentRoot, { dataset: "fixture:reader-hidden" });
    assert.equal(report.valid, true, JSON.stringify(report.diagnostics, null, 2));
    const after = await loadCanonicalContent(contentRoot);
    const projection = projectVisibleSnapshot(after);
    const index = buildWorkResearchLineIndex(after);
    assert.doesNotMatch(JSON.stringify(projection), /HIDDEN_READER_MARKER/u);
    assert.doesNotMatch(JSON.stringify(index), /HIDDEN_READER_MARKER/u);
    assert.equal(report.work_inventory.find(({ work_id }) => work_id === "work:arnett-1982").visibility_status, "approved");
  });
});
