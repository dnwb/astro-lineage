import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { existsSync } from "node:fs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function getAstroFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const res = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getAstroFiles(res)));
    } else if (entry.name.endsWith(".astro")) {
      files.push(res);
    }
  }
  return files;
}

test("reader templates enforce Caveman principle and ban meta-engineering jargon", async () => {
  const pagesDir = join(projectRoot, "src", "pages");
  const componentsDir = join(projectRoot, "src", "components");
  const files = [...(await getAstroFiles(pagesDir)), ...(await getAstroFiles(componentsDir))];

  const forbiddenTerms = [
    { pattern: /免跳转/u, name: "免跳转" },
    { pattern: /一一对齐/u, name: "一一对齐" },
    { pattern: /平滑跳转/u, name: "平滑跳转" },
    { pattern: /底层逻辑/u, name: "底层逻辑" },
    { pattern: /工程实现/u, name: "工程实现" },
    { pattern: /双时间尺度/u, name: "双时间尺度" },
    { pattern: /沉淀长周期/u, name: "沉淀长周期" },
    { pattern: /发光时间轴/u, name: "发光时间轴" },
    { pattern: /研读月历看板/u, name: "研读月历看板" },
  ];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    // Strip comments to focus on actual rendered UI markup and code
    const stripped = content.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

    for (const term of forbiddenTerms) {
      assert.ok(
        !term.pattern.test(stripped),
        `File ${file.replace(projectRoot, "")} contains forbidden meta-engineering jargon "${term.name}". UI copy must follow the Caveman principle (pure facts/data/links).`
      );
    }
  }
});

test("static reader dist HTML files do not contain unapproved client scripts", async () => {
  const distDaily = join(projectRoot, "dist", "arxiv-daily", "index.html");
  if (existsSync(distDaily)) {
    const dailyHtml = await readFile(distDaily, "utf8");
    assert.doesNotMatch(
      dailyHtml,
      /<script\b/iu,
      "Daily reader page must not leak unapproved client scripts"
    );
  }
});

test("weekly reader pages enforce English metadata and navigation bars", async () => {
  const weeklyPages = [
    join(projectRoot, "src", "pages", "arxiv-weekly", "index.astro"),
    join(projectRoot, "src", "pages", "arxiv-weekly", "[week].astro"),
  ];

  for (const pagePath of weeklyPages) {
    const content = await readFile(pagePath, "utf8");
    // 1. Ensure meta-bar contains English labels and no language-primary
    assert.match(
      content,
      /<div\s+class="weekly-meta-bar">[\s\S]*?Period:[\s\S]*?Span:[\s\S]*?Analyzed:/u,
      `${pagePath} meta-bar missing English structure`
    );
    assert.doesNotMatch(
      content,
      /class="language-primary"/u,
      `${pagePath} meta-bar still contains language-primary`
    );
    // 2. Ensure tools details contains English labels
    assert.match(
      content,
      /<details\s+class="weekly-tools-details">[\s\S]*?Tools/u,
      `${pagePath} tools-details missing English label`
    );
  }

  // 3. Ensure week switcher contains aria-current="page"
  const switcherPath = join(projectRoot, "src", "components", "weekly", "WeeklyWeekSwitcher.astro");
  const switcherContent = await readFile(switcherPath, "utf8");
  assert.match(
    switcherContent,
    /<nav\s+class="weekly-nav-bar"[\s\S]*?Current:[\s\S]*?Archives/u,
    "WeeklyWeekSwitcher.astro missing English navigation labels"
  );
  assert.match(
    switcherContent,
    /class="summary-current"[^>]*aria-current="page"/u,
    "WeeklyWeekSwitcher.astro missing aria-current='page'"
  );
});
