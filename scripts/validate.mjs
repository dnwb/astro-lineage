import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const errors = [];

const gitRoot = execFileSync(
  "git",
  ["-C", projectRoot, "rev-parse", "--show-toplevel"],
  { encoding: "utf8" },
).trim();

if (gitRoot !== projectRoot) {
  errors.push(`Expected Git root ${projectRoot}, received ${gitRoot}`);
}

for (const command of ["validate", "test", "check", "build", "verify"]) {
  if (typeof packageJson.scripts?.[command] !== "string") {
    errors.push(`Missing npm script: ${command}`);
  }
}

const packages = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};

for (const forbidden of ["pagefind", "@astrojs/mdx"]) {
  if (forbidden in packages) {
    errors.push(`Deferred dependency is not allowed in V0.1: ${forbidden}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log("Bootstrap validation passed.");
}
