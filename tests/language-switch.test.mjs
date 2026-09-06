import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(projectRoot, "dist");

test("the reader exposes one page-level language switch and keeps English in the static page", async () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);

  const htmlPaths = [
    "index.html",
    "papers/index.html",
    "papers/long-yu-2026/index.html",
    "learning-paths/embedded-jet-dynamics/index.html",
    "research-lines/dense-environment-multimessenger/index.html",
    "arxiv-daily/index.html",
  ];
  for (const path of htmlPaths) {
    const html = await readFile(join(distRoot, path), "utf8");
    assert.equal((html.match(/id="site-language-toggle"/gu) ?? []).length, 1, path);
    assert.match(html, /中文[\s\S]*English/u, path);
    assert.match(html, /class="[^"]*language-english[^"]*"/u, path);
    assert.doesNotMatch(html, /<summary>英文原文 \/ English version<\/summary>/u, path);
  }
});
