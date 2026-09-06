import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parseArxivFeed } from "../scripts/arxiv-daily.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("the daily arXiv feed parser preserves identifiers, dates, authors and abstracts", () => {
  const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2608.12217v1</id><title> A paper &amp; its result </title><summary> A short abstract. </summary><published>2026-08-12T00:00:00Z</published><updated>2026-08-13T00:00:00Z</updated><author><name>Wei-Cheng Long</name></author><link href="http://arxiv.org/abs/2608.12217v1" rel="alternate" type="text/html"/></entry></feed>`;
  assert.deepEqual(parseArxivFeed(feed), [{
    arxiv_id: "2608.12217",
    revision: 1,
    title: "A paper & its result",
    abstract: "A short abstract.",
    published: "2026-08-12T00:00:00Z",
    updated: "2026-08-13T00:00:00Z",
    authors: ["Wei-Cheng Long"],
    url: "https://arxiv.org/abs/2608.12217v1",
  }]);
});

test("the deployed daily arXiv page is static and exposes the latest refresh data", async () => {
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  assert.equal(typeof packageJson.scripts?.["arxiv:refresh"], "string");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const html = await readFile(join(projectRoot, "dist", "arxiv-daily", "index.html"), "utf8");
  assert.match(html, /每日 arXiv 更新/u);
  assert.match(html, /arXiv/iu);
  const chineseAbstracts = [...html.matchAll(/<p class="language-primary">([\s\S]*?)<\/p>/gu)].map((match) => match[1]);
  const englishAbstracts = [...html.matchAll(/<p class="language-english" lang="en">([\s\S]*?)<\/p>/gu)].map((match) => match[1]);
  assert.ok(chineseAbstracts.some((abstract) => abstract.includes("低角动量磁化吸积流中的驻立激波")));
  assert.ok(englishAbstracts.some((abstract) => abstract.includes("X-ray flares from Sgr")));
  assert.doesNotMatch(html, /<script/iu);
});
