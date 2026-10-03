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
  const files = [
    ...(await getAstroFiles(pagesDir)),
    ...(await getAstroFiles(componentsDir)),
  ];

  const forbiddenTerms = [
    { pattern: /免跳转/u, name: "免跳转" },
    { pattern: /一一对齐/u, name: "一一对齐" },
    { pattern: /平滑跳转/u, name: "平滑跳转" },
    { pattern: /底层逻辑/u, name: "底层逻辑" },
    { pattern: /工程实现/u, name: "工程实现" },
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
