import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ensureDistBuilt } from "./helpers/ensure-dist.mjs";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(projectRoot, "dist");

test("the reader adopts English-first interface and drops the language switch toggle", async () => {
  ensureDistBuilt();

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
    assert.equal((html.match(/id="site-language-toggle"/gu) ?? []).length, 0, path);
    assert.match(html, /<html[^>]*\blang="en"/u, path);
    assert.doesNotMatch(html, /<summary>英文原文 \/ English version<\/summary>/u, path);
  }
});
