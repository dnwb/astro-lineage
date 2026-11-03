import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
      ? status
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("??"))
          .filter(
            (l) =>
              !/^\?\?\s+public\/(?:arxiv-figures\/\d{4}\.\d{4,5}(v\d+)?\/|gcn-figures\/(?:$|[a-z0-9-]+\.(?:png|svg)$))/.test(
                l
              )
          )
          .join("\n")
      : "";
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

test("architecture-hygiene: controlled figure filter exempts valid arXiv figures but catches rogue files", () => {
  const isControlledFigure = (line) =>
    /^\?\?\s+public\/(?:arxiv-figures\/\d{4}\.\d{4,5}(v\d+)?\/|gcn-figures\/(?:$|[a-z0-9-]+\.(?:png|svg)$))/.test(
      line
    );

  assert.equal(isControlledFigure("?? public/arxiv-figures/2609.09285/"), true);
  assert.equal(isControlledFigure("?? public/arxiv-figures/2609.13540v1/"), true);
  assert.equal(isControlledFigure("?? public/arxiv-figures/2610.12345/fig1.png"), true);
  assert.equal(isControlledFigure("?? public/gcn-figures/"), true);
  assert.equal(isControlledFigure("?? public/gcn-figures/grb-261029a.png"), true);

  assert.equal(isControlledFigure("?? public/arxiv-figures/leak-test.png"), false);
  assert.equal(isControlledFigure("?? public/test-leak.pdf"), false);
  assert.equal(isControlledFigure("?? public/arxiv-figures/temp-artifact.json"), false);
  assert.equal(isControlledFigure("?? public/arxiv-figures/random-folder/image.png"), false);
  assert.equal(isControlledFigure("?? public/gcn-figures/test.tmp"), false);
  assert.equal(isControlledFigure("?? public/gcn-figures/sandbox.json"), false);
});

test("architecture-hygiene: events with fewer than 2 photometry points must suppress figure path and artifacts", async () => {
  const gcnIndexPath = join(projectRoot, "src", "data", "gcn-events", "index.json");
  if (!existsSync(gcnIndexPath)) return;
  const gcnData = JSON.parse(await readFile(gcnIndexPath, "utf8"));
  const events = gcnData.events || {};

  for (const [slug, meta] of Object.entries(events)) {
    const ledgerPath = join(projectRoot, "src", "data", "gcn-events", `${slug}.json`);
    if (!existsSync(ledgerPath)) continue;
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const opticalCount = (ledger.photometry_points || []).length;

    if (opticalCount < 2) {
      assert.equal(
        meta.figure_path,
        null,
        `Event ledger ${slug} has ${opticalCount} optical points but index.json declares figure_path: ${meta.figure_path}`
      );
      const pngPath = join(projectRoot, "public", "gcn-figures", `${slug}.png`);
      const svgPath = join(projectRoot, "public", "gcn-figures", `${slug}.svg`);
      assert.equal(existsSync(pngPath), false, `Found orphaned blank plot file: ${pngPath}`);
      assert.equal(existsSync(svgPath), false, `Found orphaned blank plot file: ${svgPath}`);
    }
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

test("architecture-hygiene: domain and lib modules must not resolve public/ via import.meta.url", async () => {
  const domainDir = join(projectRoot, "src", "domain");
  const libDir = join(projectRoot, "src", "lib");
  const files = [...(await getCodeFiles(domainDir)), ...(await getCodeFiles(libDir))];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const usesMetaUrlForPublic =
      /new\s+URL\(\s*["'][^"']*public(?:\/[^"']*)?["']\s*,\s*import\.meta\.url\s*\)/u.test(
        stripped
      );
    assert.ok(
      !usesMetaUrlForPublic,
      `File ${file.replace(projectRoot, "")} resolves public/ via import.meta.url, which breaks when bundled into dist/_astro/pages/ during Astro SSR build. Use resolve("public") instead.`
    );
  }
});
