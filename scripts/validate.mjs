import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createDiagnostic } from "./diagnostic.mjs";
import { runValidation } from "./content-validator.mjs";

const projectRoot = resolve(process.cwd());
const packageFile = "package.json";
const packageRecordId = "package";
const requiredNpmScripts = Object.freeze([
  "validate",
  "test",
  "check",
  "build",
  "verify",
]);
const forbiddenDependencies = Object.freeze(["pagefind", "@astrojs/mdx"]);

function projectDiagnostic({
  code,
  file = packageFile,
  recordId = packageRecordId,
  fieldPath = null,
  message,
  relatedIds = [],
}) {
  return createDiagnostic({
    severity: "error",
    code,
    dataset: "project",
    file,
    recordId,
    fieldPath,
    message,
    relatedIds,
  });
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectGitDiagnostics(root) {
  try {
    const gitRoot = execFileSync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();

    if (resolve(gitRoot) !== root) {
      return [
        projectDiagnostic({
          code: "PROJECT_GIT_BOUNDARY_MISMATCH",
          file: ".git",
          recordId: "project",
          message: `Git top-level must equal the project root (${root}), but is ${gitRoot}.`,
        }),
      ];
    }
  } catch (error) {
    return [
      projectDiagnostic({
        code: "PROJECT_GIT_BOUNDARY_UNAVAILABLE",
        file: ".git",
        recordId: "project",
        message: `Could not verify the project Git boundary: ${error.message}`,
      }),
    ];
  }

  return [];
}

async function readProjectPackage(root, diagnostics) {
  try {
    return JSON.parse(await readFile(join(root, packageFile), "utf8"));
  } catch (error) {
    diagnostics.push(
      projectDiagnostic({
        code: error?.name === "SyntaxError"
          ? "PROJECT_PACKAGE_JSON_INVALID"
          : "PROJECT_PACKAGE_READ_ERROR",
        message: `Could not read a valid ${packageFile}: ${error.message}`,
      }),
    );
    return null;
  }
}

function collectPackageDiagnostics(packageJson) {
  if (!isObject(packageJson)) {
    return [
      projectDiagnostic({
        code: "PROJECT_PACKAGE_JSON_INVALID",
        message: `${packageFile} must contain a JSON object.`,
      }),
    ];
  }

  const diagnostics = [];
  for (const command of requiredNpmScripts) {
    if (typeof packageJson.scripts?.[command] !== "string") {
      diagnostics.push(
        projectDiagnostic({
          code: "PROJECT_NPM_SCRIPT_MISSING",
          fieldPath: `/scripts/${pointerSegment(command)}`,
          message: `Required npm script is missing: ${command}.`,
        }),
      );
    }
  }

  for (const forbidden of forbiddenDependencies) {
    const section = ["dependencies", "devDependencies"].find(
      (name) => isObject(packageJson[name]) && Object.hasOwn(packageJson[name], forbidden),
    );
    if (section) {
      diagnostics.push(
        projectDiagnostic({
          code: "PROJECT_FORBIDDEN_DEPENDENCY",
          fieldPath: `/${section}/${pointerSegment(forbidden)}`,
          message: `Deferred dependency is not allowed in V0.1: ${forbidden}.`,
        }),
      );
    }
  }

  return diagnostics;
}

const projectDiagnostics = collectGitDiagnostics(projectRoot);
const packageJson = await readProjectPackage(projectRoot, projectDiagnostics);
if (packageJson !== null) {
  projectDiagnostics.push(...collectPackageDiagnostics(packageJson));
}

const report = await runValidation({
  contentRoot: join(projectRoot, "content"),
  outputRoot: projectRoot,
  additionalDiagnostics: projectDiagnostics,
});

if (!report.valid) {
  for (const item of report.diagnostics) {
    console.error(`${item.code}: ${item.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Validation passed (${report.statistics.works} Works, digest ${report.canonical_content_digest}).`,
  );
}
