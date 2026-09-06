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
  const start = html.indexOf('<h2 id="connections-heading">科学关联</h2>');
  const end = html.indexOf('<h2 id="research-context-heading">研究背景</h2>');
  assert.notEqual(start, -1, "missing Connections section");
  assert.notEqual(end, -1, "missing Research Context boundary");
  return html.slice(start, end);
}

function provenanceRegion(html) {
  const start = html.indexOf('<summary>溯源与科学证据</summary>');
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
    ["long-yu-2026", "扩展", "/papers/zhu-2021/", "活动星系核吸积盘中受阻伽马射线暴产生的高能中微子", longYuReason],
    ["zhu-2021", "被扩展", "/papers/long-yu-2026/", "嵌入 AGN 吸积盘的 GRB 喷流高能中微子信号：动态喷流传播框架", longYuReason],
    ["transfit-2025", "挑战", "/papers/arnett-1982/", "I 型超新星：早期光变曲线的解析解", transfitReason],
    ["arnett-1982", "受到挑战", "/papers/transfit-2025/", "TransFit：具有时间依赖辐射扩散的瞬变光变曲线高效拟合框架", transfitReason],
  ];

  for (const [slug, relation, href, title, reason] of expectations) {
    const html = await readFile(join(projectRoot, "dist", "papers", slug, "index.html"), "utf8");
    const connections = connectionRegion(html);
    const provenance = provenanceRegion(html);
    assert.match(connections, new RegExp(`>${relation}<`, "u"), slug);
    assert.equal((connections.match(new RegExp(`href="${href}"`, "gu")) ?? []).length, 2, slug);
    assert.ok(connections.includes(title), slug);
    assert.ok(connections.includes(renderedText(reason)), `${slug}: canonical reason must remain complete`);
    assert.doesNotMatch(connections, /Scientific Edge Evidence|evidence:|reviewed by|basis inferred|basis explicit/iu, slug);
    assert.match(provenance, /<summary>溯源与科学证据<\/summary>/u, slug);
    assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/u, slug);
    assert.match(provenance, /<h3>科学关联证据<\/h3>/u, slug);
    assert.match(provenance, /typed locator/iu, slug);
    assert(html.indexOf("科学增量</h2>") < html.indexOf("科学关联</h2>"), slug);
    assert(html.indexOf("科学关联</h2>") < html.indexOf("出版关系</h3>"), slug);
  }

  const bromberg = await readFile(join(projectRoot, "dist", "papers", "bromberg-2011", "index.html"), "utf8");
  assert.match(connectionRegion(bromberg), /暂无经过审核的科学关联。/u);

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
    assert.match(connectionRegion(html), /暂无经过审核的科学关联。/u, slug);
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
    ["transfit-2025", "挑战", "/papers/arnett-1982/"],
    ["arnett-1982", "受到挑战", "/papers/transfit-2025/"],
  ]) {
    const html = await readFile(join(root, "dist", "papers", slug, "index.html"), "utf8");
    const connections = connectionRegion(html);
    assert.match(connections, new RegExp(`>${relation}<`, "u"), slug);
    assert.match(connections, /有争议/u, slug);
    assert.match(connections, new RegExp(`href="${href}"`, "u"), slug);
    assert.ok(connections.includes(renderedText(transfitReason)), slug);
    assert.match(provenanceRegion(html), /disposition contested/iu, slug);
    assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/u, slug);
  }
});
