import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const packagePath = join(projectRoot, "package.json");
const workflowPath = join(projectRoot, ".github", "workflows", "verify.yml");

async function readPackage() {
  return JSON.parse(await readFile(packagePath, "utf8"));
}

test("the five frozen npm commands retain their verification contract", async () => {
  const packageJson = await readPackage();
  assert.equal(packageJson.engines?.node, ">=22.20.0");
  assert.deepEqual(packageJson.scripts, {
    validate: "node scripts/validate.mjs",
    test: "node --test --test-concurrency=1 tests/*.test.mjs",
    check: "astro check",
    build: "npm run validate && node scripts/editorial-index.mjs && astro build",
    verify: "npm run validate && npm run test && npm run check && npm run build",
  });

  const verify = packageJson.scripts.verify;
  assert.deepEqual(
    verify.split(" && "),
    ["npm run validate", "npm run test", "npm run check", "npm run build"],
  );
  assert.match(packageJson.scripts.build, /^npm run validate && /u);
  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /(?:refresh|deploy|arxiv|ads|crossref|publisher)/iu);
});

test("the CI workflow reproduces the local proof in a clean Node environment", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const config = parse(workflow);
  const job = config.jobs?.verify;
  assert.equal(config.name, "V0.1 verification");
  assert.deepEqual(config.on, {
    push: null,
    pull_request: null,
    workflow_dispatch: null,
  });
  assert.deepEqual(config.permissions, { contents: "read" });
  assert.equal(job?.["runs-on"], "ubuntu-24.04");
  assert.equal(job?.["timeout-minutes"], 10);
  assert.deepEqual(job?.env, {
    CI: true,
    ASTRO_TELEMETRY_DISABLED: "1",
  });
  assert.deepEqual(
    job?.steps?.map((step) => step.uses ?? step.run),
    [
      "actions/checkout@v4",
      "actions/setup-node@v4",
      "npm ci --ignore-scripts",
      "npm run verify",
    ],
  );
  assert.equal(job?.steps?.[1]?.with?.["node-version"], "22.20.0");
  assert.equal(job?.steps?.[1]?.with?.cache, "npm");

  assert.doesNotMatch(workflow, /\b(?:deploy|publish|pages|netlify|vercel|wrangler)\b/iu);
  assert.equal(workflow.indexOf("npm ci --ignore-scripts") < workflow.indexOf("npm run verify"), true);
});

test("the verification workflow keeps scholarly source refresh outside production CI", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const productionEntrypoints = [
    "scripts/validate.mjs",
    "scripts/content-validator.mjs",
    "scripts/editorial-index.mjs",
    "scripts/reader-projection.mjs",
  ];

  for (const relativePath of productionEntrypoints) {
    const source = await readFile(join(projectRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /(?:from\s+["']node:(?:http|https)["']|\b(?:fetch|XMLHttpRequest)\s*\()/u, relativePath);
  }

  assert.match(workflow, /committed canonical content/u);
  assert.match(workflow, /never\n\s+# contacts bibliographic providers/u);
  assert.doesNotMatch(workflow, /(?:source.?refresh|export\.arxiv|api\.crossref|adsabs)/iu);
});
