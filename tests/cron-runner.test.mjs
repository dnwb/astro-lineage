import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

const runner = resolve(import.meta.dirname, "../scripts/cron-runner.sh");
const stub = `
node() { printf 'node %s\\n' "$*" >> "$STUB_LOG"; if [[ "$*" == "-e "* ]]; then printf '1\\n'; fi; if [[ "$*" == "scripts/notebooklm-sync.mjs --capture-build "* && "$STUB_CAPTURE_FAIL" == 1 ]]; then return 1; fi; if [[ "$*" == "scripts/notebooklm-sync.mjs --export "* && "$STUB_EXPORT_FAIL" == 1 ]]; then return 1; fi; if [[ "$*" == "scripts/notebooklm-sync.mjs --built "* && "$STUB_BUILT_FAIL" == 1 ]]; then return 1; fi; }
npm() { printf 'npm %s\\n' "$*" >> "$STUB_LOG"; [[ "$STUB_BUILD_FAIL" != 1 ]]; }
systemctl() { printf 'systemctl %s\\n' "$*" >> "$STUB_LOG"; }
git() { if [[ "$*" == "status "* ]]; then printf ' M src/data/arxiv-daily.json\\n'; elif [[ "$*" == "log "* ]]; then printf 'mock-commit\\n'; else command git "$@"; fi; }
date() { printf 'date %s weekday=%s\\n' "$*" "$STUB_WEEKDAY" >> "$STUB_LOG"; case "$*" in *+%u*) printf '%s\\n' "$STUB_WEEKDAY";; *+%s%N*) printf '1234567890123456789\\n';; *) printf '2026-10-01 00:00:00 CST\\n';; esac; }
export -f node npm systemctl git date
bash "$STUB_RUNNER" "$STUB_MODE"
`;

test("runner gives each kind one channel path, blocks stale export, and sends no proactive QQ", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-runner-", t);
  await mkdir(resolve(path, "scripts"));
  await copyFile(runner, resolve(path, "scripts/cron-runner.sh"));
  for (const [mode, weekday, flags, expectedKinds, exitCode] of [
    ["auto", "1", {}, ["preliminary"], 0],
    ["auto", "5", {}, ["preliminary", "weekly"], 0],
    ["reconcile", "2", {}, ["both"], 0],
    ["reconcile", "6", {}, ["both"], 0],
    ["daily", "5", {}, ["both"], 0],
    ["weekly", "1", {}, ["weekly"], 0],
    ["auto", "5", { STUB_EXPORT_FAIL: "1" }, ["preliminary", "weekly"], 1],
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

function runGit(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(res.status, 0, `git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  return res.stdout.trim();
}

async function setupBareAndTwoClones(t) {
  const { path: root } = await createTemporaryWorkspace("astro-lineage-git-sync-", t);
  const bare = resolve(root, "remote.git");
  const dev = resolve(root, "other-dev");
  const cron = resolve(root, "local-cron");

  await mkdir(bare, { recursive: true });
  runGit(bare, ["init", "--bare", "--initial-branch=master"]);

  runGit(root, ["clone", bare, dev]);
  runGit(dev, ["config", "user.name", "Dev"]);
  runGit(dev, ["config", "user.email", "dev@example.com"]);
  await writeFile(resolve(dev, "README.md"), "init\n", "utf8");
  runGit(dev, ["add", "README.md"]);
  runGit(dev, ["commit", "-m", "init"]);
  runGit(dev, ["push", "-u", "origin", "master"]);

  runGit(root, ["clone", bare, cron]);
  runGit(cron, ["config", "user.name", "Cron"]);
  runGit(cron, ["config", "user.email", "cron@example.com"]);
  await mkdir(resolve(cron, "scripts"), { recursive: true });
  await mkdir(resolve(cron, "src/data"), { recursive: true });
  await copyFile(runner, resolve(cron, "scripts/cron-runner.sh"));
  // Stub sync-recent-figures.mjs as a no-op so git status stays clean of code changes
  await writeFile(resolve(cron, "scripts/sync-recent-figures.mjs"), "// noop\n", "utf8");
  await writeFile(resolve(cron, ".gitignore"), ".cache/\n", "utf8");
  await writeFile(resolve(cron, "src/data/.gitkeep"), "", "utf8");
  runGit(cron, ["add", "scripts/", ".gitignore", "src/data/.gitkeep"]);
  runGit(cron, ["commit", "-m", "add runner"]);
  runGit(cron, ["push", "origin", "master"]);

  runGit(dev, ["pull", "origin", "master"]);
  return { root, bare, dev, cron };
}

test("sync_git_data rebases and pushes when origin/master advances with non-conflicting commits", async (t) => {
  const { dev, cron } = await setupBareAndTwoClones(t);

  // Remote advances by 2 commits (simulating PR #58, #59 merged on origin/master)
  await writeFile(resolve(dev, "README.md"), "pr58\n", "utf8");
  runGit(dev, ["add", "README.md"]);
  runGit(dev, ["commit", "-m", "PR #58"]);
  await writeFile(resolve(dev, "README.md"), "pr59\n", "utf8");
  runGit(dev, ["add", "README.md"]);
  runGit(dev, ["commit", "-m", "PR #59"]);
  runGit(dev, ["push", "origin", "master"]);

  // Local cron produces new data in src/data/
  await mkdir(resolve(cron, "src/data"), { recursive: true });
  await writeFile(resolve(cron, "src/data/edition.json"), '{"ok":true}\n', "utf8");

  const res = spawnSync("bash", ["scripts/cron-runner.sh", "sync-git"], {
    cwd: cron,
    encoding: "utf8",
    env: { ...process.env, CRON_GIT_PUSH: "true" },
  });

  assert.equal(res.status, 0, `expected exit 0, got ${res.status}:\n${res.stdout}\n${res.stderr}`);
  const remoteHead = runGit(dev, ["ls-remote", "origin", "refs/heads/master"]).split(/\s+/)[0];
  const localHead = runGit(cron, ["rev-parse", "HEAD"]);
  assert.equal(localHead, remoteHead, "local HEAD should match origin/master after rebase+push");
});

async function setupConflictingDataChange(dev, cron) {
  await mkdir(resolve(dev, "src/data"), { recursive: true });
  await writeFile(resolve(dev, "src/data/shared.json"), '{"from":"remote"}\n', "utf8");
  runGit(dev, ["add", "src/data/shared.json"]);
  runGit(dev, ["commit", "-m", "remote data conflict"]);
  runGit(dev, ["push", "origin", "master"]);

  await writeFile(resolve(cron, "src/data/shared.json"), '{"from":"local"}\n', "utf8");
}

test("sync_git_data aborts rebase, preserves local commit, and exits 1 on conflict", async (t) => {
  const { dev, cron } = await setupBareAndTwoClones(t);
  await setupConflictingDataChange(dev, cron);

  const res = spawnSync("bash", ["scripts/cron-runner.sh", "sync-git"], {
    cwd: cron,
    encoding: "utf8",
    env: { ...process.env, CRON_GIT_PUSH: "true" },
  });

  assert.equal(res.status, 1, `expected exit 1 on rebase conflict, got ${res.status}`);
  assert.match(res.stderr, /rebase --abort|冲突/u);
  // Must not leave repo in mid-rebase or detached HEAD
  assert.equal(runGit(cron, ["symbolic-ref", "--short", "HEAD"]), "master");
  assert.equal(runGit(cron, ["status", "--porcelain"]), "");
  const localContent = await readFile(resolve(cron, "src/data/shared.json"), "utf8");
  assert.equal(localContent, '{"from":"local"}\n');
});

test("sync_git_data retries push once after fetch+rebase when first push fails", async (t) => {
  const { root, dev, cron } = await setupBareAndTwoClones(t);

  await writeFile(resolve(cron, "src/data/edition.json"), '{"ok":true}\n', "utf8");

  const attemptFile = resolve(root, "push-attempts.txt");
  const script = `
git() {
  if [[ "$1" == "push" ]]; then
    local n=0
    if [[ -f "${attemptFile}" ]]; then n=$(cat "${attemptFile}"); fi
    n=$((n + 1))
    printf '%s' "$n" > "${attemptFile}"
    if [[ "$n" -eq 1 ]]; then
      printf 'simulated push race\\n' >&2
      return 1
    fi
  fi
  command git "$@"
}
export -f git
CRON_GIT_PUSH=true bash scripts/cron-runner.sh sync-git
`;
  const res = spawnSync("bash", ["-c", script], {
    cwd: cron,
    encoding: "utf8",
  });

  assert.equal(
    res.status,
    0,
    `expected exit 0 after retry, got ${res.status}:\n${res.stdout}\n${res.stderr}`
  );
  assert.equal(await readFile(attemptFile, "utf8"), "2");
  const remoteHead = runGit(dev, ["ls-remote", "origin", "refs/heads/master"]).split(/\s+/)[0];
  const localHead = runGit(cron, ["rev-parse", "HEAD"]);
  assert.equal(localHead, remoteHead);
});

test("auto short-circuit propagates DELIVERY_FAILED=1 from sync_git_data as exit 1", async (t) => {
  const { dev, cron } = await setupBareAndTwoClones(t);
  await setupConflictingDataChange(dev, cron);

  const script = `
node() {
  if [[ "$1" == "-e" ]]; then
    printf '0\\n'
  fi
  return 0
}
export -f node
CRON_GIT_PUSH=true bash scripts/cron-runner.sh auto
`;
  const res = spawnSync("bash", ["-c", script], {
    cwd: cron,
    encoding: "utf8",
  });

  assert.equal(
    res.status,
    1,
    `expected exit 1 when auto short-circuit hits git sync failure, got ${res.status}`
  );
});
