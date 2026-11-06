import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, chmod, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  validateScriptSyntax,
  collectSyncFiles,
  syncScripts,
} from "../scripts/cron-sync-scripts-cli.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

test("cron-sync-scripts: validateScriptSyntax identifies valid and invalid node, bash, python scripts", async (t) => {
  const ws = await createTemporaryWorkspace("sync-syntax-test-", t);

  // 1. Valid and invalid Node .mjs
  const validMjs = join(ws.path, "valid.mjs");
  await writeFile(validMjs, "export const a = 1;\n", "utf8");
  assert.equal(validateScriptSyntax(validMjs).valid, true);

  const invalidMjs = join(ws.path, "invalid.mjs");
  await writeFile(invalidMjs, "export const = 1;\n", "utf8");
  assert.equal(validateScriptSyntax(invalidMjs).valid, false);

  // 2. Valid and invalid Bash .sh
  const validSh = join(ws.path, "valid.sh");
  await writeFile(validSh, "#!/bin/bash\necho 'hello'\n", "utf8");
  assert.equal(validateScriptSyntax(validSh).valid, true);

  const invalidSh = join(ws.path, "invalid.sh");
  await writeFile(invalidSh, "#!/bin/bash\nif [ 1 ]; then\n", "utf8");
  assert.equal(validateScriptSyntax(invalidSh).valid, false);

  // 3. Valid and invalid Python .py
  const validPy = join(ws.path, "valid.py");
  await writeFile(validPy, "import sys\nprint('hello')\n", "utf8");
  assert.equal(validateScriptSyntax(validPy).valid, true);

  const invalidPy = join(ws.path, "invalid.py");
  await writeFile(invalidPy, "def foo(\n", "utf8");
  assert.equal(validateScriptSyntax(invalidPy).valid, false);

  // 4. Non-existent file throws
  assert.throws(() => validateScriptSyntax(join(ws.path, "missing.mjs")), /File not found/);
});

test("cron-sync-scripts: syncScripts fails closed if source or target directory does not exist", async (t) => {
  const ws = await createTemporaryWorkspace("sync-missing-dir-", t);

  assert.throws(
    () => syncScripts({ sourceDir: join(ws.path, "no-source"), targetDir: ws.path }),
    /源工作区目录不存在/
  );

  assert.throws(
    () => syncScripts({ sourceDir: ws.path, targetDir: join(ws.path, "no-target") }),
    /目标生产目录不存在/
  );
});

test("cron-sync-scripts: syncScripts aborts before copying if local source has syntax error", async (t) => {
  const wsSrc = await createTemporaryWorkspace("sync-src-", t);
  const wsDest = await createTemporaryWorkspace("sync-dest-", t);

  await mkdir(join(wsSrc.path, "scripts"), { recursive: true });
  await mkdir(join(wsDest.path, "scripts"), { recursive: true });

  const badScript = join(wsSrc.path, "scripts", "bad.mjs");
  await writeFile(badScript, "const a = ;\n", "utf8");

  // Mock collectSyncFiles via monkeypatching or isolated testing
  assert.throws(
    () =>
      syncScripts({
        sourceDir: wsSrc.path,
        targetDir: wsDest.path,
        includeDomain: false,
      }),
    /本地源文件语法错误/
  );
});

test("cron-sync-scripts: syncScripts copies files, preserves permissions and handles dry-run", async (t) => {
  const wsSrc = await createTemporaryWorkspace("sync-flow-src-", t);
  const wsDest = await createTemporaryWorkspace("sync-flow-dest-", t);

  // Set up source structure
  await mkdir(join(wsSrc.path, "scripts"), { recursive: true });
  await mkdir(join(wsSrc.path, "src", "domain"), { recursive: true });
  await mkdir(join(wsDest.path, "scripts"), { recursive: true });
  await mkdir(join(wsDest.path, "src", "domain"), { recursive: true });

  const script1 = join(wsSrc.path, "scripts", "task.sh");
  await writeFile(script1, "#!/bin/bash\necho 'running'\n", "utf8");
  await chmod(script1, 0o755);

  const domain1 = join(wsSrc.path, "src", "domain", "model.mjs");
  await writeFile(domain1, "export const name = 'astro';\n", "utf8");

  const silentLogger = { log() {}, warn() {}, error() {} };

  // 1. Dry run
  const dryResult = syncScripts({
    sourceDir: wsSrc.path,
    targetDir: wsDest.path,
    includeDomain: true,
    dryRun: true,
    logger: silentLogger,
  });
  assert.equal(dryResult.copied.length, 2);
  assert.equal(dryResult.validated, 0);

  // 2. Real run
  const realResult = syncScripts({
    sourceDir: wsSrc.path,
    targetDir: wsDest.path,
    includeDomain: true,
    dryRun: false,
    logger: silentLogger,
  });
  assert.equal(realResult.copied.length, 2);
  assert.equal(realResult.validated, 2);

  // Verify executable bit preserved
  const destStat = await stat(join(wsDest.path, "scripts", "task.sh"));
  assert.ok(destStat.mode & 0o111, "Executable permission must be preserved");

  // 3. Second run: nothing changed
  const secondResult = syncScripts({
    sourceDir: wsSrc.path,
    targetDir: wsDest.path,
    includeDomain: true,
    dryRun: false,
    logger: silentLogger,
  });
  assert.equal(secondResult.copied.length, 0);
  assert.equal(secondResult.unchanged.length, 2);
});
