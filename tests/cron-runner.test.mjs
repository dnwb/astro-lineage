import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

const runner = resolve(import.meta.dirname, "../scripts/cron-runner.sh");
const stub = `
node() { printf 'node %s\\n' "$*" >> "$STUB_LOG"; if [[ "$*" == "scripts/notebooklm-sync.mjs --capture-build "* && "$STUB_CAPTURE_FAIL" == 1 ]]; then return 1; fi; if [[ "$*" == "scripts/notebooklm-sync.mjs --export "* && "$STUB_EXPORT_FAIL" == 1 ]]; then return 1; fi; if [[ "$*" == "scripts/notebooklm-sync.mjs --built "* && "$STUB_BUILT_FAIL" == 1 ]]; then return 1; fi; }
npm() { printf 'npm %s\\n' "$*" >> "$STUB_LOG"; [[ "$STUB_BUILD_FAIL" != 1 ]]; }
systemctl() { printf 'systemctl %s\\n' "$*" >> "$STUB_LOG"; }
date() { printf 'date %s weekday=%s\\n' "$*" "$STUB_WEEKDAY" >> "$STUB_LOG"; case "$*" in *+%u*) printf '%s\\n' "$STUB_WEEKDAY";; *+%s%N*) printf '1234567890123456789\\n';; *) printf '2026-10-01 00:00:00 CST\\n';; esac; }
export -f node npm systemctl date
bash "$STUB_RUNNER" "$STUB_MODE"
`;

test("runner gives each kind one channel path, blocks stale export, and sends no proactive QQ", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-runner-", t);
  await mkdir(resolve(path, "scripts"));
  await copyFile(runner, resolve(path, "scripts/cron-runner.sh"));
  for (const [mode, weekday, flags, expectedKinds, exitCode] of [
    ["auto", "1", {}, ["daily"], 0],
    ["auto", "5", {}, ["both"], 0],
    ["daily", "5", {}, ["daily"], 0],
    ["weekly", "1", {}, ["weekly"], 0],
    ["auto", "5", { STUB_EXPORT_FAIL: "1" }, ["both"], 1],
    ["auto", "1", { STUB_CAPTURE_FAIL: "1" }, [], 1],
    ["auto", "1", { STUB_BUILD_FAIL: "1" }, [], 1],
    ["auto", "1", { STUB_BUILT_FAIL: "1" }, [], 1],
  ]) {
    const log = resolve(path, `${mode}-${weekday}-${Object.keys(flags).join("-") || "ok"}.log`);
    const result = spawnSync("bash", ["-c", stub], { encoding: "utf8", env: {
      ...process.env, STUB_RUNNER: resolve(path, "scripts/cron-runner.sh"), STUB_LOG: log,
      STUB_WEEKDAY: weekday, STUB_MODE: mode, STUB_CAPTURE_FAIL: "0", STUB_EXPORT_FAIL: "0", STUB_BUILD_FAIL: "0", STUB_BUILT_FAIL: "0", ...flags,
    } });
    assert.equal(result.status, exitCode, result.stderr + result.stdout);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    assert.deepEqual(calls.filter((line) => line.startsWith("node scripts/notebooklm-sync.mjs --deliver "))
      .map((line) => line.split(" ")[3]), expectedKinds, JSON.stringify({mode, weekday, flags, calls}));
    assert.equal(calls.some((line) => /qq-send|tencent-channel-publisher/u.test(line)), false);
    if (!["agent", "bot", "notebook"].includes(mode)) {
      const capture = calls.findIndex((line) => line.includes(" --capture-build "));
      const build = calls.findIndex((line) => line === "npm run build");
      assert.ok(capture >= 0);
      if (!flags.STUB_CAPTURE_FAIL) assert.ok(build > capture);
      if (!flags.STUB_CAPTURE_FAIL && !flags.STUB_BUILD_FAIL) assert.ok(calls.findIndex((line) => line.includes(" --built ")) > build);
    }
    if (flags.STUB_CAPTURE_FAIL) assert.equal(calls.some((line) => line === "npm run build"), false);
    if (flags.STUB_BUILD_FAIL) assert.equal(calls.some((line) => line.includes(" --built ")), false);
    if (flags.STUB_BUILT_FAIL) assert.equal(calls.some((line) => line.includes(" --export ")), false);
    if (flags.STUB_EXPORT_FAIL) assert.equal(calls.some((line) => line.includes(" --export ")), true);
  }
});
