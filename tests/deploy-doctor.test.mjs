import test from "node:test";
import assert from "node:assert/strict";
import { parseEnv, classifyWorkingTree } from "../scripts/deploy-doctor.mjs";

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

test("deploy-doctor: parseEnv distinguishes exact true from prefix truefalse", () => {
  const env1 = parseEnv("CRON_GIT_PUSH=truefalse");
  assert.notEqual(env1.CRON_GIT_PUSH, "true");

  const env2 = parseEnv("CRON_GIT_PUSH=true");
  assert.equal(env2.CRON_GIT_PUSH, "true");
});

test("deploy-doctor: classifyWorkingTree preserves leading whitespace and handles porcelain lines", () => {
  // Typical porcelain v1: unstaged modification has leading space
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

test("deploy-doctor: classifyWorkingTree reports clean on empty output", () => {
  assert.equal(classifyWorkingTree("").clean, true);
  assert.equal(classifyWorkingTree("   \n\n").clean, true);
});
