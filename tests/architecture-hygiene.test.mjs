import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function getCodeFiles(dir, extensions = [".mjs", ".js", ".ts", ".astro"]) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const res = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "dist") {
        files.push(...(await getCodeFiles(res, extensions)));
      }
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(res);
    }
  }
  return files;
}

test("architecture-hygiene: git working tree must have zero untracked artifacts in public/", () => {
  try {
    const status = execSync("git status --porcelain public/", {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
    const untracked = status
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("??"))
      .filter((l) => !l.includes("public/arxiv-figures/"))
      .join("\n");
    assert.equal(
      untracked,
      "",
      `Detected leaked test or build artifacts in public/:\n${untracked}\nAll tests must allocate temporary workspaces using createTemporaryWorkspace(prefix, t).`
    );
  } catch (err) {
    if (err.code !== "ERR_ASSERTION") throw err;
    throw err;
  }
});

test("architecture-hygiene: KaTeX math rendering is strictly encapsulated in src/domain/scientific-text/", async () => {
  const scriptsDir = join(projectRoot, "scripts");
  const srcDir = join(projectRoot, "src");
  const allowedFile = join(projectRoot, "src", "domain", "scientific-text", "index.mjs");

  const files = [...(await getCodeFiles(scriptsDir)), ...(await getCodeFiles(srcDir))];

  for (const file of files) {
    if (file === allowedFile) continue;
    const content = await readFile(file, "utf8");
    // Strip comments to focus on actual imports
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const importsKatex = /from\s+["']katex["']|require\(["']katex["']\)/u.test(stripped);
    assert.ok(
      !importsKatex,
      `File ${file.replace(projectRoot, "")} directly imports KaTeX. Per ARCHITECTURE.md §2, all scientific formula and math AST rendering must be delegated to src/domain/scientific-text/index.mjs.`
    );
  }
});

test("architecture-hygiene: operational scripts must not re-export domain SSOT functions", async () => {
  const scriptsDir = join(projectRoot, "scripts");
  const scriptFiles = await getCodeFiles(scriptsDir, [".mjs", ".js"]);

  for (const file of scriptFiles) {
    const content = await readFile(file, "utf8");
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // 1. Direct re-exports: export { ... } from "...domain..."
    const directReExport = /export\s*\{[^}]*\}\s*from\s*["'][^"']*domain[^"']*["']/u.test(stripped);
    assert.ok(
      !directReExport,
      `Script ${file.replace(projectRoot, "")} directly re-exports from domain SSOT. Consumers must import domain concepts directly from src/domain/.`
    );

    // 2. Re-export of symbols imported from domain
    const domainImports = [
      ...stripped.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*domain[^"']*["']/gu),
    ]
      .flatMap((match) =>
        match[1].split(",").map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            .trim()
        )
      )
      .filter(Boolean);

    for (const sym of domainImports) {
      const reExportPattern = new RegExp(`export\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}`, "u");
      assert.ok(
        !reExportPattern.test(stripped),
        `Script ${file.replace(projectRoot, "")} re-exports domain symbol '${sym}'. Consumers must import domain concepts directly from src/domain/.`
      );
    }
  }
});

test("architecture-hygiene: UI components must not import translation from scripts/", async () => {
  const pagesDir = join(projectRoot, "src", "pages");
  const componentsDir = join(projectRoot, "src", "components");
  const astroFiles = [
    ...(await getCodeFiles(pagesDir, [".astro"])),
    ...(await getCodeFiles(componentsDir, [".astro"])),
  ];

  for (const file of astroFiles) {
    const content = await readFile(file, "utf8");
    const importsScriptTranslation =
      /from\s+["'][^"']*scripts\/paper-translation(?:\.mjs)?["']/u.test(content);
    assert.ok(
      !importsScriptTranslation,
      `Astro file ${file.replace(projectRoot, "")} imports from scripts/paper-translation.mjs. UI components must import exclusively from src/domain/paper-translation.mjs.`
    );
  }
});

test("architecture-hygiene: UI components must not import math rendering from scripts/", async () => {
  const pagesDir = join(projectRoot, "src", "pages");
  const componentsDir = join(projectRoot, "src", "components");
  const astroFiles = [
    ...(await getCodeFiles(pagesDir, [".astro"])),
    ...(await getCodeFiles(componentsDir, [".astro"])),
  ];

  for (const file of astroFiles) {
    const content = await readFile(file, "utf8");
    const importsScriptMath = /from\s+["'][^"']*scripts\/reader-math(?:\.mjs)?["']/u.test(content);
    assert.ok(
      !importsScriptMath,
      `Astro file ${file.replace(projectRoot, "")} imports from scripts/reader-math.mjs. UI components must import exclusively from src/domain/scientific-text/index.mjs.`
    );
  }
});

test("architecture-hygiene: scripts with direct CLI runners must be registered in package.json or cli orchestrator", async () => {
  const pkg = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const registeredScripts = Object.values(pkg.scripts || {}).join(" ");
  const cliContent = await readFile(join(projectRoot, "scripts", "cli.mjs"), "utf8");
  const cronContent = await readFile(join(projectRoot, "scripts", "cron-runner.sh"), "utf8");

  const scriptFiles = await getCodeFiles(join(projectRoot, "scripts"), [".mjs"]);
  for (const file of scriptFiles) {
    const basename = file.split("/").pop();
    if (basename === "cli.mjs") continue;
    const content = await readFile(file, "utf8");
    const hasCliRunner = content.includes("process.argv[1]");
    if (hasCliRunner) {
      const isRegistered =
        registeredScripts.includes(basename) ||
        cliContent.includes(basename) ||
        cronContent.includes(basename);
      assert.ok(
        isRegistered,
        `Script scripts/${basename} declares a direct CLI execution runner (process.argv[1]) but is not registered in package.json, scripts/cli.mjs, or cron-runner.sh. Standalone logic modules must export functions cleanly rather than embedding orphan CLI runners.`
      );
    }
  }
});
