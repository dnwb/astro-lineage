import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const validateScript = fileURLToPath(new URL("../scripts/validate.mjs", import.meta.url));

test("project validation failures are merged into the emitted report", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-project-validation-"));
  await cp(new URL("../content/", import.meta.url), join(temporaryRoot, "content"), {
    recursive: true,
  });

  const packageJson = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  delete packageJson.scripts.check;
  packageJson.devDependencies.pagefind = "1.0.0";
  await writeFile(
    join(temporaryRoot, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );

  const result = spawnSync(process.execPath, [validateScript], {
    cwd: temporaryRoot,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);

  const report = JSON.parse(
    await readFile(join(temporaryRoot, "validation/report.json"), "utf8"),
  );
  assert.equal(report.valid, false);

  const projectDiagnostics = report.diagnostics.filter(
    ({ dataset }) => dataset === "project",
  );
  assert(projectDiagnostics.some(({ code }) => code === "PROJECT_NPM_SCRIPT_MISSING"));
  assert(projectDiagnostics.some(({ code }) => code === "PROJECT_FORBIDDEN_DEPENDENCY"));
  assert(
    projectDiagnostics.some(({ code }) => code.startsWith("PROJECT_GIT_BOUNDARY_")),
  );
  for (const diagnostic of projectDiagnostics) {
    assert.deepEqual(Object.keys(diagnostic).sort(), [
      "code",
      "dataset",
      "field_path",
      "file",
      "message",
      "record_id",
      "related_ids",
      "severity",
    ]);
    assert.equal(diagnostic.severity, "error");
  }
});
