import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(projectRoot, "dist");
const paperSlugs = [
  "arnett-1982",
  "blandford-mckee-1976",
  "bromberg-2011",
  "chen-psr-b1259-2019",
  "chen-takata-binaries-2022",
  "chevalier-1982",
  "du-frb-2026",
  "du-psr-j1932-2026",
  "dubus-2013",
  "kasen-bildsten-2010",
  "khatami-kasen-2024",
  "liu-csm-formalism-2020",
  "liu-fbot-2022",
  "liu-fbot-radio-2026",
  "liu-magnetar-2017",
  "liu-multiple-ejecta-csm-2018",
  "long-yu-2026",
  "metzger-2017",
  "ni-dense-csm-2026",
  "sari-piran-narayan-1998",
  "tan-yu-2020",
  "transfit-2025",
  "transfit-csm-2025",
  "transfit-mag-2026",
  "weaver-1977",
  "wu-magnetar-csm-2026",
  "xie-sgr-j1935-2025",
  "yu-gw-jet-2020",
  "yu-li-dai-2015",
  "yu-zhang-gao-2013",
  "zhang-agn-jet-2024",
  "zhang-frb-2023",
  "zhang-grb-radio-2022",
  "zhu-2021",
  "zhu-bns-agn-2021",
];
const researchLineSlugs = [
  "baseline-binaries-frb",
  "baseline-central-engine-transients",
  "baseline-csm-radiative-transients",
  "baseline-jet-multimessenger",
  "central-engines",
  "dense-environment-multimessenger",
  "explosive-transients-csm",
];
const learningPathSlugs = [
  "baseline-binary-multimessenger",
  "baseline-csm-light-curves",
  "baseline-engine-powered-transients",
  "baseline-jet-foundations",
  "embedded-jet-dynamics",
];
const expectedRoutes = [
  "/",
  "/arxiv-daily/",
  "/papers/",
  ...paperSlugs.map((slug) => `/papers/${slug}/`),
  "/research-lines/",
  ...researchLineSlugs.map((slug) => `/research-lines/${slug}/`),
  "/learning-paths/",
  ...learningPathSlugs.map((slug) => `/learning-paths/${slug}/`),
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

test("technical delivery exposes the gated dev command, all baseline routes, and closed internal links", async () => {
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
  assert.match(home, /35 篇基准论文/u);
  assert.match(home, /2 条科学关联/u);
  assert.match(papers, /35 篇基准文献/u);
  assert.match(lines, /7 个研究方向：3 个已审核/u);
  assert.match(paths, /5 条学习路径：1 条已审核/u);
  assert.doesNotMatch(allHtml.join("\n"), /<script/iu);
});
