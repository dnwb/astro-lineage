import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function relativePaths(root, directory = root) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const relativePath = absolutePath.slice(root.length + 1).split("\\").join("/");
    paths.push(relativePath);
    if (entry.isDirectory()) {
      paths.push(...await relativePaths(root, absolutePath));
    }
  }
  return paths;
}

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

  assert.match(html, /AstroLineage/);
  assert.match(html, /scientific reading and knowledge-navigation system/i);
  assert.match(html, /not an arXiv mirror/i);
  assert.match(papersHtml, /<h1>Papers<\/h1>/);
  assert.match(papersHtml, /Type I supernovae/i);
  assert.match(papersHtml, /5 curated Papers/);
  assert.match(papersHtml, /Read paper/);
  assert.doesNotMatch(papersHtml, /provenance/i);
  assert.equal(
    existsSync(new URL("../dist/papers/arnett-1982/index.html", import.meta.url)),
    true,
  );
  const distRoot = fileURLToPath(new URL("../dist", import.meta.url));
  assert.deepEqual(
    (await relativePaths(distRoot)).filter((path) => path.includes(":")),
    [],
    "the generated static site must not contain Windows-incompatible path components",
  );
  assert.doesNotMatch(papersHtml, /<script/i);
});
