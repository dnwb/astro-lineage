import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedRoutes = [
  "/",
  "/arxiv-daily/",
  "/papers/",
  "/papers/arnett-1982/",
  "/papers/bromberg-2011/",
  "/papers/long-yu-2026/",
  "/papers/transfit-2025/",
  "/papers/zhu-2021/",
  "/research-lines/",
  "/research-lines/central-engines/",
  "/research-lines/dense-environment-multimessenger/",
  "/research-lines/explosive-transients-csm/",
  "/learning-paths/",
  "/learning-paths/embedded-jet-dynamics/",
];
const edgeReasons = [
  "Long and Yu preserve Zhu et al.'s embedded-GRB reverse-shock and hadronic-neutrino scaffold",
  "Under centrally concentrated or spatially stratified heating, TransFit finds that the self-similar internal-energy-profile assumption",
];

function assertInOrder(source, markers, label) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${label}: missing ${marker}`);
    assert(next > cursor, `${label}: ${marker} is out of order`);
    cursor = next;
  }
}

function routeFile(root, route) {
  return route === "/"
    ? join(root, "dist", "index.html")
    : join(root, "dist", route.slice(1), "index.html");
}

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await htmlFiles(path));
    } else if (entry.name.endsWith(".html")) {
      files.push(path);
    }
  }
  return files;
}

async function copyProject() {
  const root = await mkdtemp(join(tmpdir(), "astro-lineage-home-navigation-"));
  for (const entry of ["astro.config.mjs", "package.json", "package-lock.json", "tsconfig.json"]) {
    await cp(join(projectRoot, entry), join(root, entry));
  }
  for (const directory of ["content", "scripts", "src"]) {
    await cp(join(projectRoot, directory), join(root, directory), { recursive: true });
  }
  await symlink(join(projectRoot, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}

function runBuild(root) {
  const indexes = spawnSync("node", ["scripts/editorial-index.mjs"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(indexes.status, 0, JSON.stringify({ error: indexes.error, signal: indexes.signal, stdout: indexes.stdout, stderr: indexes.stderr }));
  const build = spawnSync(join(root, "node_modules", ".bin", "astro"), ["build"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, JSON.stringify({ error: build.error, signal: build.signal, stdout: build.stdout, stderr: build.stderr }));
}

test("Home provides the four reader entry areas, projected content, and complete global navigation", async () => {
  runBuild(projectRoot);
  const home = await readFile(join(projectRoot, "dist", "index.html"), "utf8");
  assertInOrder(home, [
    "<h1 id=\"home-title\">AstroLineage</h1>",
    "从这里开始",
    "精选论文",
    "科学关联",
  ], "首页区域");
  assert.match(home, /理解高能瞬变天体物理中的思想如何演化。/u);
  assert.match(home, /围绕论文、物理关系与学习路径构建的科学阅读地图。/u);
  assert.match(home, /From Jet Propagation to Dynamic Multi-messenger Yields/u);
  assertInOrder(home, [
    "/papers/bromberg-2011/",
    "/papers/zhu-2021/",
    "/papers/long-yu-2026/",
  ], "起始阅读顺序");
  for (const title of [
    "I 型超新星：早期光变曲线的解析解",
    "相对论喷流在外部介质中的传播",
    "嵌入 AGN 吸积盘的 GRB 喷流高能中微子信号：动态喷流传播框架",
    "TransFit：具有时间依赖辐射扩散的瞬变光变曲线高效拟合框架",
    "活动星系核吸积盘中受阻伽马射线暴产生的高能中微子",
  ]) {
    assert.match(home, new RegExp(title), `Home missing paper ${title}`);
  }
  assert.match(home, /5 篇可见论文/u);
  const homeText = home.replaceAll("&#39;", "'").replaceAll("&amp;", "&");
  for (const reason of edgeReasons) {
    assert.equal((homeText.match(new RegExp(reason, "gu")) ?? []).length, 1, reason);
  }
  assert.equal((home.match(/>(?:扩展|挑战)</gu) ?? []).length, 2);
  assert.doesNotMatch(home, /Why next|Pedagogical Transitions|Provenance &amp; scientific evidence/u);

  const internalLinks = new Set(
    [...home.matchAll(/href="(\/[^"#?]*)/gu)].map((match) => match[1]),
  );
  const homeLinks = [
    "/",
    "/papers/",
    "/research-lines/",
    "/learning-paths/",
    "/learning-paths/embedded-jet-dynamics/",
    "/papers/arnett-1982/",
    "/papers/bromberg-2011/",
    "/papers/long-yu-2026/",
    "/papers/transfit-2025/",
    "/papers/zhu-2021/",
  ];
  for (const route of homeLinks) {
    assert(internalLinks.has(route), `Home missing route ${route}`);
  }
  for (const route of expectedRoutes) {
    assert.equal(await readFile(routeFile(projectRoot, route), "utf8").then(() => true), true, route);
  }

  for (const route of expectedRoutes) {
    const html = await readFile(routeFile(projectRoot, route), "utf8");
    assert.match(html, /<nav[^>]*aria-label="主导航"/u, route);
    for (const navRoute of ["/", "/papers/", "/research-lines/", "/learning-paths/", "/arxiv-daily/"]) {
      assert.match(html, new RegExp(`href="${navRoute.replaceAll("/", "\\/")}"`, "u"), `${route}: ${navRoute}`);
    }
    assert.doesNotMatch(html, /<script/iu, route);
    assert.doesNotMatch(html, /tabindex="-1"/u, route);
  }
});

test("Home and downstream routes exclude hidden Works, Paths, and Edges from the complete fixture build", async (t) => {
  const root = await copyProject();
  t.after(() => rm(root, { recursive: true, force: true }));

  const hiddenWorkPath = join(root, "content", "works", "zhu-2021", "work.yaml");
  const hiddenWork = parse(await readFile(hiddenWorkPath, "utf8"));
  hiddenWork.reader_state = "draft";
  hiddenWork.visibility_approvals = [];
  await writeFile(hiddenWorkPath, stringify(hiddenWork), "utf8");

  for (const slug of ["central-engines", "dense-environment-multimessenger", "explosive-transients-csm"]) {
    const linePath = join(root, "content", "research-lines", slug, "line.yaml");
    const line = parse(await readFile(linePath, "utf8"));
    line.reader_state = "draft";
    line.visibility_approvals = [];
    await writeFile(linePath, stringify(line), "utf8");
  }

  const hiddenPathPath = join(root, "content", "learning-paths", "embedded-jet-dynamics", "path.yaml");
  const hiddenPath = parse(await readFile(hiddenPathPath, "utf8"));
  hiddenPath.reader_state = "draft";
  hiddenPath.visibility_approvals = [];
  await writeFile(hiddenPathPath, stringify(hiddenPath), "utf8");

  const hiddenEdgePath = join(root, "content", "scientific-edges", "long-yu-extends-zhu-dynamic-trajectory.yaml");
  const hiddenEdge = parse(await readFile(hiddenEdgePath, "utf8"));
  hiddenEdge.review_state = "unreviewed";
  delete hiddenEdge.review_provenance;
  delete hiddenEdge.review_binding;
  await writeFile(hiddenEdgePath, stringify(hiddenEdge), "utf8");

  runBuild(root);
  const files = await htmlFiles(join(root, "dist"));
  const rendered = await Promise.all(files.map((path) => readFile(path, "utf8")));
  const allHtml = rendered.join("\n");
  const home = await readFile(join(root, "dist", "index.html"), "utf8");
  assert.match(home, /暂无经过审核的学习路径。/u);
  assert.doesNotMatch(home, /zhu-2021|embedded-jet-dynamics|Long and Yu preserve Zhu/u);
  assert.doesNotMatch(allHtml, /HIDDEN|zhu-2021|embedded-jet-dynamics|Long and Yu preserve Zhu/u);
  assert.equal(files.some((path) => path.endsWith("/papers/zhu-2021/index.html")), false);
  assert.equal(files.some((path) => path.endsWith("/learning-paths/embedded-jet-dynamics/index.html")), false);
});
