import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

import { computeCanonicalContentDigest } from "../scripts/content-digest.mjs";
import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import { computeReaderVisibilityDigest } from "../scripts/content-validator.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const productionContent = join(projectRoot, "content");
const workIds = [
  "work:arnett-1982",
  "work:bromberg-2011",
  "work:long-yu-2026",
  "work:transfit-2025",
  "work:zhu-2021",
];
const longYuReason = "Long and Yu preserve Zhu et al.'s embedded-GRB reverse-shock and hadronic-neutrino scaffold while expanding the calculation from a characteristic stalling-state evaluation to evolving shock and cooling conditions along complete jet-head trajectories, including both choking and breakout outcomes.";
const transfitReason = "Under centrally concentrated or spatially stratified heating, TransFit finds that the self-similar internal-energy-profile assumption underlying the target maximum-light balance breaks down and that Arnett's Law systematically underestimates peak luminosity; the challenge is limited to those heating geometries.";

function renderedText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("'", "&#39;");
}

function connectionRegion(html) {
  const start = html.indexOf('<section class="panel" aria-labelledby="connections-heading">');
  const end = html.indexOf('<section class="panel" aria-labelledby="research-context-heading">');
  assert.notEqual(start, -1, "missing Connections section");
  assert.notEqual(end, -1, "missing Research Context boundary");
  return html.slice(start, end);
}

function provenanceRegion(html) {
  const start = html.indexOf('<details class="panel provenance-detail">');
  assert.notEqual(start, -1, "missing provenance disclosure");
  return html.slice(start);
}

async function buildFixture() {
  const root = await mkdtemp(join(tmpdir(), "astro-lineage-scientific-connections-"));
  for (const entry of ["astro.config.mjs", "package.json", "package-lock.json", "tsconfig.json"]) {
    await cp(join(projectRoot, entry), join(root, entry));
  }
  for (const directory of ["content", "scripts", "src"]) {
    await cp(join(projectRoot, directory), join(root, directory), { recursive: true });
  }
  await symlink(join(projectRoot, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}

function runAstroBuild(root) {
  const build = spawnSync(join(root, "node_modules", ".bin", "astro"), ["build"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
}

async function updateYaml(path, mutate) {
  const record = parse(await readFile(path, "utf8"));
  mutate(record);
  await writeFile(path, stringify(record), "utf8");
}

test("Paper Connections render both canonical directions, qualified reasons, links, and closed provenance", async () => {
  const beforeSnapshot = await loadCanonicalContent(productionContent);
  const beforeCanonicalDigest = await computeCanonicalContentDigest(productionContent);
  const beforeVisibilityDigests = new Map(workIds.map((workId) => [
    workId,
    computeReaderVisibilityDigest(beforeSnapshot, "work", workId),
  ]));

  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const expectations = [
    ["long-yu-2026", "EXTENDS", "/papers/zhu-2021/", "High-energy Neutrinos from Choked Gamma-Ray Bursts in Active Galactic Nucleus Accretion Disks", longYuReason],
    ["zhu-2021", "EXTENDED BY", "/papers/long-yu-2026/", "High-energy neutrino signatures of embedded GRB jets in AGN disks: a dynamic jet-propagation framework", longYuReason],
    ["transfit-2025", "CHALLENGES", "/papers/arnett-1982/", "Type I supernovae. I - Analytic solutions for the early part of the light curve", transfitReason],
    ["arnett-1982", "CHALLENGED BY", "/papers/transfit-2025/", "TransFit: An Efficient Framework for Transient Light-Curve Fitting with Time-Dependent Radiative Diffusion", transfitReason],
  ];

  for (const [slug, relation, href, title, reason] of expectations) {
    const html = await readFile(join(projectRoot, "dist", "papers", slug, "index.html"), "utf8");
    const connections = connectionRegion(html);
    const provenance = provenanceRegion(html);
    assert.match(connections, new RegExp(`<span class="tag">${relation}</span>`, "u"), slug);
    assert.equal((connections.match(new RegExp(`href="${href}"`, "gu")) ?? []).length, 2, slug);
    assert.ok(connections.includes(title), slug);
    assert.ok(connections.includes(renderedText(reason)), `${slug}: canonical reason must remain complete`);
    assert.doesNotMatch(connections, /Scientific Edge Evidence|evidence:|reviewed by|basis inferred|basis explicit/iu, slug);
    assert.match(provenance, /<summary>Provenance &amp; scientific evidence<\/summary>/u, slug);
    assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/u, slug);
    assert.match(provenance, /<h3>Scientific Edge Evidence<\/h3>/u, slug);
    assert.match(provenance, /typed locator/iu, slug);
    assert(html.indexOf("Scientific Delta</h2>") < html.indexOf("Connections</h2>"), slug);
    assert(html.indexOf("Connections</h2>") < html.indexOf("Publication Relations</h3>"), slug);
  }

  const bromberg = await readFile(join(projectRoot, "dist", "papers", "bromberg-2011", "index.html"), "utf8");
  assert.match(connectionRegion(bromberg), /No reviewed scientific connections yet\./u);

  const afterSnapshot = await loadCanonicalContent(productionContent);
  assert.equal(await computeCanonicalContentDigest(productionContent), beforeCanonicalDigest);
  for (const workId of workIds) {
    assert.equal(
      computeReaderVisibilityDigest(afterSnapshot, "work", workId),
      beforeVisibilityDigests.get(workId),
      workId,
    );
  }
});

test("hidden endpoints and unreviewed Edges are absent from generated HTML and produce the empty state", async (t) => {
  const root = await buildFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await updateYaml(join(root, "content", "works", "zhu-2021", "work.yaml"), (record) => {
    record.reader_state = "draft";
    record.visibility_approvals = [];
  });
  await updateYaml(join(root, "content", "scientific-edges", "transfit-challenges-arnett-maximum-light.yaml"), (record) => {
    record.review_state = "unreviewed";
    delete record.review_provenance;
    delete record.review_binding;
  });

  runAstroBuild(root);

  for (const slug of ["long-yu-2026", "arnett-1982", "transfit-2025"]) {
    const html = await readFile(join(root, "dist", "papers", slug, "index.html"), "utf8");
    assert.match(connectionRegion(html), /No reviewed scientific connections yet\./u, slug);
    assert.doesNotMatch(html, /edge:long-yu-extends-zhu-dynamic-trajectory|edge:transfit-challenges-arnett-maximum-light/u, slug);
    assert.doesNotMatch(html, /complete jet-head trajectories|challenge is limited to those heating geometries/u, slug);
  }
  await assert.rejects(readFile(join(root, "dist", "papers", "zhu-2021", "index.html"), "utf8"), { code: "ENOENT" });
});

test("a projected contested Edge is visibly qualified in both endpoint Connections and remains inspectable", async (t) => {
  const root = await buildFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await updateYaml(join(root, "content", "scientific-edges", "transfit-challenges-arnett-maximum-light.yaml"), (record) => {
    record.disposition = "contested";
  });

  runAstroBuild(root);

  for (const [slug, relation, href] of [
    ["transfit-2025", "CHALLENGES", "/papers/arnett-1982/"],
    ["arnett-1982", "CHALLENGED BY", "/papers/transfit-2025/"],
  ]) {
    const html = await readFile(join(root, "dist", "papers", slug, "index.html"), "utf8");
    const connections = connectionRegion(html);
    assert.match(connections, new RegExp(`<span class="tag">${relation}</span>`, "u"), slug);
    assert.match(connections, /<strong class="dispute-indicator"> Contested<\/strong>/u, slug);
    assert.match(connections, new RegExp(`href="${href}"`, "u"), slug);
    assert.ok(connections.includes(renderedText(transfitReason)), slug);
    assert.match(provenanceRegion(html), /disposition contested/iu, slug);
    assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/u, slug);
  }
});
