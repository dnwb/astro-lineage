import { existsSync, rmSync, mkdirSync, rmdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultDistIndex = join(projectRoot, "dist", "index.html");
const lockDir = join(projectRoot, ".dist-build.lock");

function acquireLock() {
  const start = Date.now();
  while (true) {
    try {
      mkdirSync(lockDir);
      return;
    } catch (err) {
      if (err.code === "EEXIST") {
        if (Date.now() - start > 120000) {
          try {
            rmdirSync(lockDir);
          } catch {}
          continue;
        }
        spawnSync("sleep", ["0.2"]);
      } else {
        throw err;
      }
    }
  }
}

function releaseLock() {
  try {
    rmdirSync(lockDir);
  } catch {}
}

/**
 * Ensures the production Astro static site is built.
 * If target file in dist/ already exists (from a previous test or build),
 * skips rebuilding to avoid redundant ~20s Astro compilation runs.
 * Uses atomic directory locking to prevent race conditions during concurrent test runs.
 */
export function ensureDistBuilt(requiredFilePath = defaultDistIndex) {
  const target =
    typeof requiredFilePath === "string" ? requiredFilePath : fileURLToPath(requiredFilePath);
  if (!existsSync(target)) {
    acquireLock();
    try {
      if (!existsSync(target)) {
        try {
          rmSync(join(projectRoot, ".astro", ".prerender"), { recursive: true, force: true });
        } catch {}
        const build = spawnSync("npm", ["run", "build"], {
          cwd: projectRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        assert.equal(build.status, 0, build.stderr || build.stdout);
      }
    } finally {
      releaseLock();
    }
  }
}
