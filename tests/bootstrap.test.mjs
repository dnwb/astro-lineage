import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("the project owns its Git boundary", async () => {
  const head = await readFile(new URL("../.git/HEAD", import.meta.url), "utf8");
  const config = await readFile(new URL("../.git/config", import.meta.url), "utf8");

  assert.match(head, /^(ref: refs\/heads\/|[0-9a-f]{40}$)/u);
  assert.match(config, /^\[core\]$/mu);
});

test("the public verification commands are stable", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  for (const command of ["validate", "test", "check", "build", "verify"]) {
    assert.equal(typeof packageJson.scripts?.[command], "string", command);
    assert.notEqual(packageJson.scripts[command].trim(), "", command);
  }
});

test("the production build renders the product boundary as static HTML", async () => {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    build.status,
    0,
    `production build failed${build.signal ? ` with ${build.signal}` : ""}:\n${build.stderr || build.stdout}`,
  );

  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const papersHtml = await readFile(new URL("../dist/papers/index.html", import.meta.url), "utf8");

  assert.match(html, /High-Energy Transient Reading Radar/);
  assert.match(html, /scientific reading and knowledge-navigation system/i);
  assert.match(html, /not an arXiv mirror/i);
  assert.match(papersHtml, /<h1>Papers<\/h1>/);
  assert.match(papersHtml, /Type I supernovae/i);
  assert.match(papersHtml, /work:arnett-1982/);
  assert.doesNotMatch(papersHtml, /provenance/i);
  assert.equal(
    existsSync(new URL("../dist/papers/work:arnett-1982/index.html", import.meta.url)),
    true,
  );
  assert.doesNotMatch(papersHtml, /<script/i);
});
