import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv, classifyWorkingTree, getEffectiveRunnerEnv } from "../scripts/deploy-doctor.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

test("deploy-doctor: parseEnv handles quoted values, empty values and prevents multiline bleeding", () => {
  const envText = `
# Comment line
CRON_GIT_PUSH="true"
PUBLIC_SITE_URL=
QQ_APP_SECRET=my-secret-token
LOCAL_SITE_URL='http://192.168.1.100:4321'
SYNC_FIGURES_WEEKS=5
`;

  const env = parseEnv(envText);
  assert.equal(env.CRON_GIT_PUSH, "true");
  assert.equal(env.PUBLIC_SITE_URL, "");
  assert.notEqual(env.PUBLIC_SITE_URL, "my-secret-token");
  assert.equal(env.QQ_APP_SECRET, "my-secret-token");
  assert.equal(env.LOCAL_SITE_URL, "http://192.168.1.100:4321");
  assert.equal(env.SYNC_FIGURES_WEEKS, "5");
});

test("deploy-doctor: parseEnv handles inline shell comments and preserves embedded hashes", () => {
  const envText = `
CRON_GIT_PUSH=true # automatic deployment
APP_TOKEN="secret#with#hash" # comment with #
URL_WITH_FRAGMENT=https://example.test/#papers
PUSH_WITH_HASH=true#disabled
CONCAT_PUSH="true"false
`;
  const env = parseEnv(envText);
  assert.equal(env.CRON_GIT_PUSH, "true");
  assert.equal(env.APP_TOKEN, "secret#with#hash");
  assert.equal(env.URL_WITH_FRAGMENT, "https://example.test/#papers");
  assert.equal(env.PUSH_WITH_HASH, "true#disabled");
  assert.notEqual(env.PUSH_WITH_HASH, "true");
  assert.equal(env.CONCAT_PUSH, "truefalse");
  assert.notEqual(env.CONCAT_PUSH, "true");
});

test("deploy-doctor: parseEnv distinguishes exact true from prefix truefalse", () => {
  const env1 = parseEnv("CRON_GIT_PUSH=truefalse");
  assert.notEqual(env1.CRON_GIT_PUSH, "true");

  const env2 = parseEnv("CRON_GIT_PUSH=true");
  assert.equal(env2.CRON_GIT_PUSH, "true");
});

test("deploy-doctor: getEffectiveRunnerEnv evaluates isolated .env via bash", async (t) => {
  const ws = await createTemporaryWorkspace("deploy-doctor-test-", t);
  const mockEnv = `
CRON_GIT_PUSH=true
PUBLIC_SITE_URL=https://isolated-test.pages.dev
LOCAL_SITE_URL=http://localhost:4321
SYNC_FIGURES_WEEKS=6
SYNC_FIGURES_MAX_MB=250
`;
  await writeFile(join(ws.path, ".env"), mockEnv, "utf8");

  const env = getEffectiveRunnerEnv(ws.path);
  assert.equal(env.CRON_GIT_PUSH, "true");
  assert.equal(env.PUBLIC_SITE_URL, "https://isolated-test.pages.dev");
  assert.equal(env.LOCAL_SITE_URL, "http://localhost:4321");
  assert.equal(env.SYNC_FIGURES_WEEKS, "6");
  assert.equal(env.SYNC_FIGURES_MAX_MB, "250");
});

test("deploy-doctor: classifyWorkingTree preserves leading whitespace and handles porcelain lines", () => {
  const porcelain = [
    " M src/data/arxiv-daily/2026-10-24.json",
    "?? public/figures/2026/w43/sample.jpg",
    " M scripts/deploy-doctor.mjs",
  ].join("\n");

  const result = classifyWorkingTree(porcelain);
  assert.equal(result.clean, false);
  assert.equal(result.dataFiles.length, 2);
  assert.deepEqual(result.dataFiles, [
    "src/data/arxiv-daily/2026-10-24.json",
    "public/figures/2026/w43/sample.jpg",
  ]);
  assert.equal(result.nonDataFiles.length, 1);
  assert.deepEqual(result.nonDataFiles, ["scripts/deploy-doctor.mjs"]);
});

test("deploy-doctor: classifyWorkingTree keeps code-to-data renames blocked", () => {
  // Cross-boundary rename from code to data must be treated as non-data (blocked)
  const crossPorcelain = "R  scripts/sample.json -> src/data/sample.json";
  const crossResult = classifyWorkingTree(crossPorcelain);
  assert.equal(crossResult.nonDataFiles.length, 1);
  assert.equal(crossResult.dataFiles.length, 0);

  // Rename within data boundary is allowed
  const dataPorcelain = "R  src/data/old.json -> src/data/new.json";
  const dataResult = classifyWorkingTree(dataPorcelain);
  assert.equal(dataResult.nonDataFiles.length, 0);
  assert.equal(dataResult.dataFiles.length, 1);
});

test("deploy-doctor: classifyWorkingTree reports clean on empty output", () => {
  assert.equal(classifyWorkingTree("").clean, true);
  assert.equal(classifyWorkingTree("   \n\n").clean, true);
});
