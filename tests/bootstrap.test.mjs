import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("the project owns its Git boundary", () => {
  const gitRoot = execFileSync(
    "git",
    ["-C", projectRoot, "rev-parse", "--show-toplevel"],
    { encoding: "utf8" },
  ).trim();

  assert.equal(gitRoot, projectRoot.replace(/\/$/, ""));
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
  execFileSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const papersHtml = await readFile(new URL("../dist/papers/index.html", import.meta.url), "utf8");

  assert.match(html, /High-Energy Transient Reading Radar/);
  assert.match(html, /scientific reading and knowledge-navigation system/i);
  assert.match(html, /not an arXiv mirror/i);
  assert.match(papersHtml, /<h1>Papers<\/h1>/);
  assert.match(papersHtml, /No Papers are visible/i);
  assert.doesNotMatch(papersHtml, /<script/i);
});
