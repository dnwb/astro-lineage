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
    ["auto", "1", {}, ["preliminary"], 0],
    ["auto", "5", {}, ["preliminary"], 0],
    ["reconcile", "2", {}, ["daily"], 0],
    ["reconcile", "6", {}, ["both"], 0],
    ["daily", "5", {}, ["daily"], 0],
    ["weekly", "1", {}, ["weekly"], 0],
    ["auto", "5", { STUB_EXPORT_FAIL: "1" }, ["preliminary"], 1],
    ["auto", "1", { STUB_CAPTURE_FAIL: "1" }, [], 1],
    ["auto", "1", { STUB_BUILD_FAIL: "1" }, [], 1],
    ["auto", "1", { STUB_BUILT_FAIL: "1" }, [], 1],
  ]) {
    const log = resolve(path, `${mode}-${weekday}-${Object.keys(flags).join("-") || "ok"}.log`);
    const result = spawnSync("bash", ["-c", stub], {
      encoding: "utf8",
      env: {
        ...process.env,
        STUB_RUNNER: resolve(path, "scripts/cron-runner.sh"),
        STUB_LOG: log,
        STUB_WEEKDAY: weekday,
        STUB_MODE: mode,
        STUB_CAPTURE_FAIL: "0",
        STUB_EXPORT_FAIL: "0",
        STUB_BUILD_FAIL: "0",
        STUB_BUILT_FAIL: "0",
        ...flags,
      },
    });
    assert.equal(result.status, exitCode, result.stderr + result.stdout);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    assert.deepEqual(
      calls
        .filter((line) => line.startsWith("node scripts/notebooklm-sync.mjs --deliver "))
        .map((line) => line.split(" ")[3]),
      expectedKinds,
      JSON.stringify({ mode, weekday, flags, calls })
    );
    assert.equal(
      calls.some((line) => /qq-send|tencent-channel-publisher/u.test(line)),
      false
    );
    if (!["agent", "bot", "notebook"].includes(mode)) {
      const capture = calls.findIndex((line) => line.includes(" --capture-build "));
      const build = calls.findIndex((line) => line === "npm run build");
      assert.ok(capture >= 0);
      if (!flags.STUB_CAPTURE_FAIL) assert.ok(build > capture);
      if (!flags.STUB_CAPTURE_FAIL && !flags.STUB_BUILD_FAIL)
        assert.ok(calls.findIndex((line) => line.includes(" --built ")) > build);
    }
    if (flags.STUB_CAPTURE_FAIL)
      assert.equal(
        calls.some((line) => line === "npm run build"),
        false
      );
    if (flags.STUB_BUILD_FAIL)
      assert.equal(
        calls.some((line) => line.includes(" --built ")),
        false
      );
    if (flags.STUB_BUILT_FAIL)
      assert.equal(
        calls.some((line) => line.includes(" --export ")),
        false
      );
    if (flags.STUB_EXPORT_FAIL)
      assert.equal(
        calls.some((line) => line.includes(" --export ")),
        true
      );
  }
});

test("sync_git_data guards against non-master branch and dirty non-data working tree", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-runner-git-", t);
  await mkdir(resolve(path, "scripts"));
  await copyFile(runner, resolve(path, "scripts/cron-runner.sh"));

  // 1. When on a feature branch, git push must NOT be attempted
  const gitLog = resolve(path, "git.log");
  const gitStub = `
git() {
  printf 'git %s\\n' "$*" >> "${gitLog}";
  if [[ "$*" == "symbolic-ref --short HEAD" ]]; then
    printf 'feature-test\\n';
    return 0;
  fi
  return 0;
}
node() { return 0; }
export -f git node
CRON_GIT_PUSH=true bash "${resolve(path, "scripts/cron-runner.sh")}" sync-git
`;
  const res1 = spawnSync("bash", ["-c", gitStub], { encoding: "utf8" });
  assert.equal(res1.status, 0, res1.stderr);
  const gitCalls1 = (await readFile(gitLog, "utf8")).trim().split("\n");
  assert.equal(
    gitCalls1.some((l) => l.includes("push")),
    false,
    "must not push on feature branch"
  );

  // 2. When on master but dirty non-data code exists, git push must NOT be attempted
  const gitLog2 = resolve(path, "git2.log");
  const gitStub2 = `
git() {
  printf 'git %s\\n' "$*" >> "${gitLog2}";
  if [[ "$*" == "symbolic-ref --short HEAD" ]]; then
    printf 'master\\n';
    return 0;
  fi
  if [[ "$*" == "status --porcelain" ]]; then
    printf ' M src/components/SomeComponent.astro\\n';
    return 0;
  fi
  return 0;
}
node() { return 0; }
export -f git node
CRON_GIT_PUSH=true bash "${resolve(path, "scripts/cron-runner.sh")}" sync-git
`;
  const res2 = spawnSync("bash", ["-c", gitStub2], { encoding: "utf8" });
  assert.equal(res2.status, 0, res2.stderr);
  const gitCalls2 = (await readFile(gitLog2, "utf8")).trim().split("\n");
  assert.equal(
    gitCalls2.some((l) => l.includes("push")),
    false,
    "must not push when non-data files are modified"
  );
});

test("pull_upstream_master: respects CRON_GIT_PULL, guards dirty/branch states, and degrades gracefully on failure", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-runner-pull-", t);
  await mkdir(resolve(path, "scripts"));
  await copyFile(runner, resolve(path, "scripts/cron-runner.sh"));

  // 1. By default (CRON_GIT_PULL not set), git fetch/merge must NOT be called
  const log1 = resolve(path, "git1.log");
  const stub1 = `
git() { printf 'git %s\\n' "$*" >> "${log1}"; return 0; }
node() { return 0; }
npm() { return 0; }
systemctl() { return 0; }
export -f git node npm systemctl
bash "${resolve(path, "scripts/cron-runner.sh")}" build
`;
  const res1 = spawnSync("bash", ["-c", stub1], { encoding: "utf8" });
  assert.equal(res1.status, 0, res1.stderr);
  const calls1 = (await readFile(log1, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  assert.equal(calls1.some((l) => l.includes("fetch") || l.includes("merge")), false, "default must not fetch or merge");

  // 2. When CRON_GIT_PULL=true but on non-master branch, it skips gracefully without fatal exit
  const log2 = resolve(path, "git2.log");
  const stub2 = `
git() {
  printf 'git %s\\n' "$*" >> "${log2}";
  if [[ "$*" == "symbolic-ref --short HEAD" ]]; then printf 'dev-branch\\n'; return 0; fi
  return 0;
}
node() { return 0; }
npm() { return 0; }
systemctl() { return 0; }
export -f git node npm systemctl
CRON_GIT_PULL=true bash "${resolve(path, "scripts/cron-runner.sh")}" build
`;
  const res2 = spawnSync("bash", ["-c", stub2], { encoding: "utf8" });
  assert.equal(res2.status, 0, res2.stderr);
  const calls2 = (await readFile(log2, "utf8")).trim().split("\n");
  assert.equal(calls2.some((l) => l.includes("fetch") || l.includes("merge")), false, "must not pull on non-master branch");

  // 3. When CRON_GIT_PULL=true on master but working tree has dirty code, it skips gracefully
  const log3 = resolve(path, "git3.log");
  const stub3 = `
git() {
  printf 'git %s\\n' "$*" >> "${log3}";
  if [[ "$*" == "symbolic-ref --short HEAD" ]]; then printf 'master\\n'; return 0; fi
  if [[ "$*" == "status --porcelain" ]]; then printf ' M src/components/Card.astro\\n'; return 0; fi
  return 0;
}
node() { return 0; }
npm() { return 0; }
systemctl() { return 0; }
export -f git node npm systemctl
CRON_GIT_PULL=true bash "${resolve(path, "scripts/cron-runner.sh")}" build
`;
  const res3 = spawnSync("bash", ["-c", stub3], { encoding: "utf8" });
  assert.equal(res3.status, 0, res3.stderr);
  const calls3 = (await readFile(log3, "utf8")).trim().split("\n");
  assert.equal(calls3.some((l) => l.includes("merge")), false, "must not merge when code is dirty");

  // 4. When CRON_GIT_PULL=true on master and clean, it fetches and fast-forward merges
  const log4 = resolve(path, "git4.log");
  const stub4 = `
git() {
  printf 'git %s\\n' "$*" >> "${log4}";
  if [[ "$*" == "symbolic-ref --short HEAD" ]]; then printf 'master\\n'; return 0; fi
  if [[ "$*" == "status --porcelain" ]]; then return 0; fi
  return 0;
}
node() { return 0; }
npm() { return 0; }
systemctl() { return 0; }
export -f git node npm systemctl
CRON_GIT_PULL=true bash "${resolve(path, "scripts/cron-runner.sh")}" build
`;
  const res4 = spawnSync("bash", ["-c", stub4], { encoding: "utf8" });
  assert.equal(res4.status, 0, res4.stderr);
  const calls4 = (await readFile(log4, "utf8")).trim().split("\n");
  assert.ok(calls4.some((l) => l.includes("fetch origin master")), "must fetch origin master");
  assert.ok(calls4.some((l) => l.includes("merge --ff-only origin/master")), "must fast-forward merge");

  // 5. When fast-forward merge fails (e.g. divergence or conflict), it must NOT exit 1 (graceful fallback)
  const log5 = resolve(path, "git5.log");
  const stub5 = `
git() {
  printf 'git %s\\n' "$*" >> "${log5}";
  if [[ "$*" == "symbolic-ref --short HEAD" ]]; then printf 'master\\n'; return 0; fi
  if [[ "$*" == "status --porcelain" ]]; then return 0; fi
  if [[ "$*" == "merge --ff-only origin/master" ]]; then return 1; fi
  return 0;
}
node() { return 0; }
npm() { return 0; }
systemctl() { return 0; }
export -f git node npm systemctl
CRON_GIT_PULL=true bash "${resolve(path, "scripts/cron-runner.sh")}" build
`;
  const res5 = spawnSync("bash", ["-c", stub5], { encoding: "utf8" });
  assert.equal(res5.status, 0, "must not exit 1 on merge failure; runner must proceed with local baseline");
});
