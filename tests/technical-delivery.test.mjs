import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(projectRoot, "dist");
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

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

function routeFile(route) {
  return route === "/"
    ? join(distRoot, "index.html")
    : join(distRoot, route.slice(1), "index.html");
}

function normalizeInternalRoute(href) {
  if (!href.startsWith("/") || href.startsWith("/_astro/") || href.startsWith("//")) return null;
  const pathname = href.split(/[?#]/u, 1)[0];
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

test("technical delivery exposes the gated dev command, all 14 routes, and closed internal links", async () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts.dev, "node scripts/validate.mjs && astro dev");
  const readme = await readFile(join(projectRoot, "README.md"), "utf8");
  for (const command of [
    "npm run dev -- --host 0.0.0.0",
    "npm run verify",
    "npm run build",
    "npm exec -- astro preview --host 0.0.0.0 --port 3000",
  ]) {
    assert.match(readme, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")), command);
  }

  for (const route of expectedRoutes) {
    assert.equal(existsSync(routeFile(route)), true, route);
  }

  const files = await htmlFiles(distRoot);
  assert.equal(files.length, expectedRoutes.length);
  const allHtml = await Promise.all(files.map((path) => readFile(path, "utf8")));
  const internalLinks = new Set(
    allHtml.flatMap((html) => [...html.matchAll(/href="([^"]+)"/gu)].map((match) => normalizeInternalRoute(match[1]))).filter(Boolean),
  );
  for (const route of internalLinks) {
    assert.equal(existsSync(routeFile(route)), true, `broken internal route ${route}`);
  }

  const home = await readFile(join(distRoot, "index.html"), "utf8");
  const papers = await readFile(join(distRoot, "papers", "index.html"), "utf8");
  const lines = await readFile(join(distRoot, "research-lines", "index.html"), "utf8");
  const paths = await readFile(join(distRoot, "learning-paths", "index.html"), "utf8");
  assert.match(home, /5 篇可见论文/u);
  assert.match(home, /2 条科学关联/u);
  assert.match(papers, /5 篇精选论文/u);
  assert.match(lines, /3 个经过审核的研究方向/u);
  assert.match(paths, /1 条已审核学习路径/u);
  assert.doesNotMatch(allHtml.join("\n"), /<script/iu);
});
