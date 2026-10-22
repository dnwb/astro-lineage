import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultDistIndex = join(projectRoot, "dist", "index.html");

/**
 * Ensures the production Astro static site is built.
 * If target file in dist/ already exists (from a previous test or build),
 * skips rebuilding to avoid redundant ~20s Astro compilation runs.
 */
export function ensureDistBuilt(requiredFilePath = defaultDistIndex) {
  const target =
    typeof requiredFilePath === "string" ? requiredFilePath : fileURLToPath(requiredFilePath);
  if (!existsSync(target)) {
    const build = spawnSync("npm", ["run", "build"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
  }
}
