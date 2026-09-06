import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const validatorEntry = new URL("../scripts/content-validator.mjs", import.meta.url);
const domainNames = Object.freeze([
  "works",
  "versions",
  "evidence",
  "ontology",
  "methods",
  "edges",
  "editorial",
  "visibility",
]);

test("the content validator delegates to the eight domain modules", async () => {
  const entrySource = await readFile(validatorEntry, "utf8");

  for (const domainName of domainNames) {
    const moduleUrl = new URL(`../scripts/validation/${domainName}.mjs`, import.meta.url);
    const moduleSource = await readFile(moduleUrl, "utf8");
    assert.match(entrySource, new RegExp(`\\./validation/${domainName}\\.mjs`));
    assert.match(moduleSource, /(?:function|const)\s+[A-Za-z]/u);
  }

  assert.equal(entrySource.split("\n").length <= 80, true);
  assert.deepEqual(
    [...entrySource.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gu)]
      .map((match) => match[1]),
    ["runValidation"],
  );
});

test("domain tests do not preserve ticket numbers as architecture", async () => {
  const testFiles = await readdir(new URL("./", import.meta.url));

  assert.equal(testFiles.some((name) => /^ticket\d+.*\.test\.mjs$/u.test(name)), false);
  for (const expected of [
    "scientific-edges.test.mjs",
    "edge-review-policy.test.mjs",
    "visibility.test.mjs",
    "learning-paths.test.mjs",
  ]) {
    assert(testFiles.includes(expected), `missing domain test ${expected}`);
  }
});
