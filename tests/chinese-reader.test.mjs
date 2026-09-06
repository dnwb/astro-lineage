import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { renderMathMarkup, splitMath } from "../scripts/reader-math.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(projectRoot, "dist");

function routeFile(route) {
  return route === "/"
    ? join(distRoot, "index.html")
    : join(distRoot, route.slice(1), "index.html");
}

test("reader pages present Chinese interface copy across every route", { timeout: 180_000 }, async () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const routes = [
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
  const pages = new Map(
    await Promise.all(routes.map(async (route) => [route, await readFile(routeFile(route), "utf8")])),
  );

  for (const [route, html] of pages) {
    assert.match(html, /<html lang="zh-CN">/u, route);
    assert.match(html, /[一-鿿]/u, `${route} should contain Chinese reader copy`);
  }

  assert.match(pages.get("/"), /理解高能瞬变天体物理中的思想如何演化/u);
  assert.match(pages.get("/"), /从这里开始/u);
  assert.match(pages.get("/"), /精选论文/u);
  assert.match(pages.get("/"), /科学关联/u);
  assert.match(pages.get("/papers/"), /篇精选论文/u);
  assert.match(pages.get("/papers/arnett-1982/"), /为什么这项工作重要/u);
  assert.match(pages.get("/papers/arnett-1982/"), /科学要点/u);
  assert.match(pages.get("/papers/arnett-1982/"), /溯源与科学证据/u);
  assert.match(pages.get("/learning-paths/embedded-jet-dynamics/"), /阅读顺序/u);
  assert.match(pages.get("/learning-paths/embedded-jet-dynamics/"), /下一步为什么/u);
  assert.match(pages.get("/research-lines/"), /研究方向/u);
  assert.match(pages.get("/research-lines/central-engines/"), /为什么这个方向重要/u);
  assert.doesNotMatch(pages.get("/"), />Start Here</u);
  assert.doesNotMatch(pages.get("/papers/"), />Papers</u);

  const arnett = pages.get("/papers/arnett-1982/");
  assert.match(arnett, /<div[^>]*lang="zh-CN"[^>]*>/u);
  assert.match(arnett, /id="site-language-toggle"/u);
  assert.match(arnett, /class="reading-language language-english"/u);
  assert.doesNotMatch(arnett, /<summary>英文原文 \/ English version<\/summary>/u);
  assert.match(arnett, /Read this Work to see how a compact physical model connects an energy source to transport and a measurable light curve\./u);
  assert.match(arnett, /Type I supernovae\. I - Analytic solutions for the early part of the light curve/u);
  assert.doesNotMatch(arnett, /<details[^>]*\sopen(?:[\s=>])/u);
});

test("reader math renders supported TeX delimiters as escaped static MathML", () => {
  assert.deepEqual(splitMath("Energy $E=mc^2$ and $$\\frac{a}{b}$$."), [
    { kind: "text", value: "Energy " },
    { kind: "math", value: "E=mc^2", display: false },
    { kind: "text", value: " and " },
    { kind: "math", value: "\\frac{a}{b}", display: true },
    { kind: "text", value: "." },
  ]);
  const markup = renderMathMarkup("\\frac{a}{b} + \\alpha", true);
  assert.match(markup, /^<math[^>]*display="block"[^>]*>/u);
  assert.match(markup, /<mfrac><mi>a<\/mi><mi>b<\/mi><\/mfrac>/u);
  assert.match(markup, /<mi>α<\/mi>/u);
  const common = renderMathMarkup("\\mathcal{L} \\lesssim \\rm{10}^{44} \\, \\hat{n}", false);
  assert.match(common, /<mrow mathvariant="script">/u);
  assert.match(common, /≲/u);
  const renderedBody = common.slice(common.indexOf("<semantics>"), common.indexOf("<annotation"));
  assert.doesNotMatch(renderedBody, /\\rm/u);
  assert.doesNotMatch(renderMathMarkup("<script>alert(1)<\/script>", false), /<script/iu);
});
