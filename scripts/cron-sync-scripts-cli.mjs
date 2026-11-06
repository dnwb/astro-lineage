#!/usr/bin/env node
import { existsSync, statSync, mkdirSync, copyFileSync, chmodSync, readFileSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_TARGET_DIR = "/home/long/astro-lineage-cron";

/**
 * Validate syntax of a single script file using native engines.
 */
export function validateScriptSyntax(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  if (filePath.endsWith(".mjs") || filePath.endsWith(".js")) {
    try {
      execFileSync(process.execPath, ["--check", filePath], { stdio: "pipe" });
      return { valid: true, type: "node" };
    } catch (err) {
      return { valid: false, type: "node", error: err.stderr?.toString() || err.message };
    }
  }

  if (filePath.endsWith(".sh")) {
    try {
      execFileSync("/bin/bash", ["-n", filePath], { stdio: "pipe" });
      return { valid: true, type: "bash" };
    } catch (err) {
      return { valid: false, type: "bash", error: err.stderr?.toString() || err.message };
    }
  }

  if (filePath.endsWith(".py")) {
    try {
      execFileSync("python3", ["-m", "py_compile", filePath], { stdio: "pipe" });
      return { valid: true, type: "python" };
    } catch (err) {
      return { valid: false, type: "python", error: err.stderr?.toString() || err.message };
    }
  }

  return { valid: true, type: "other" };
}

/**
 * Collect files to sync from git or directory structure.
 */
export function collectSyncFiles({ projectRoot, includeDomain = true }) {
  const files = [];

  const collectSection = (sectionDir) => {
    try {
      const stdout = execFileSync("git", ["ls-files", sectionDir], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "ignore"],
        encoding: "utf8",
      });
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        for (const line of lines) {
          if (existsSync(join(projectRoot, line))) files.push(line);
        }
        return;
      }
    } catch {}

    // Fallback: traverse directory
    const fullDir = join(projectRoot, sectionDir);
    if (!existsSync(fullDir)) return;
    try {
      const entries = execFileSync("find", [fullDir, "-type", "f"], { encoding: "utf8" }).split(
        "\n"
      );
      for (const entry of entries) {
        const trimmed = entry.trim();
        if (trimmed) files.push(relative(projectRoot, trimmed));
      }
    } catch {}
  };

  collectSection("scripts");
  if (includeDomain) {
    collectSection("src/domain");
  }

  return [...new Set(files)].sort();
}

/**
 * Perform synchronization and syntax validation.
 */
export function syncScripts({
  sourceDir,
  targetDir,
  includeDomain = true,
  dryRun = false,
  logger = console,
}) {
  const resolvedSource = resolve(sourceDir);
  const resolvedTarget = resolve(targetDir);

  if (!existsSync(resolvedSource)) {
    throw new Error(`[cron-sync] 源工作区目录不存在: ${resolvedSource}`);
  }
  if (!existsSync(resolvedTarget)) {
    throw new Error(`[cron-sync] 目标生产目录不存在: ${resolvedTarget}`);
  }

  const files = collectSyncFiles({ projectRoot: resolvedSource, includeDomain });
  if (files.length === 0) {
    logger.warn(`[cron-sync] 未发现任何待同步的脚本文件`);
    return { copied: [], unchanged: [], validated: 0 };
  }

  logger.log(`[cron-sync] 步骤 1/3: 验证本地源文件语法 (${files.length} 个文件)...`);
  for (const relPath of files) {
    const srcFile = join(resolvedSource, relPath);
    const syntax = validateScriptSyntax(srcFile);
    if (!syntax.valid) {
      throw new Error(`[cron-sync] 本地源文件语法错误，中止同步: ${relPath}\n${syntax.error}`);
    }
  }
  logger.log(`[cron-sync] ✓ 本地全部 ${files.length} 个文件语法核验通过`);

  logger.log(`[cron-sync] 步骤 2/3: 同步文件至目标目录 (${resolvedTarget})...`);
  const copied = [];
  const unchanged = [];

  for (const relPath of files) {
    const srcFile = join(resolvedSource, relPath);
    const destFile = join(resolvedTarget, relPath);

    let needsCopy = true;
    if (existsSync(destFile)) {
      const srcBuf = readFileSync(srcFile);
      const destBuf = readFileSync(destFile);
      if (srcBuf.equals(destBuf)) {
        needsCopy = false;
        unchanged.push(relPath);
      }
    }

    if (needsCopy) {
      copied.push(relPath);
      if (!dryRun) {
        mkdirSync(dirname(destFile), { recursive: true });
        copyFileSync(srcFile, destFile);

        // Preserve executable bit for shell scripts and CLI runners
        const srcStat = statSync(srcFile);
        if (srcStat.mode & 0o111) {
          try {
            chmodSync(destFile, srcStat.mode);
          } catch {}
        }
      }
    }
  }

  if (dryRun) {
    logger.log(
      `[cron-sync] (Dry Run) 将会同步 ${copied.length} 个变更文件，跳过 ${unchanged.length} 个无变化文件`
    );
    return { copied, unchanged, validated: 0 };
  }

  logger.log(
    `[cron-sync] ✓ 成功同步 ${copied.length} 个变更文件 (${unchanged.length} 个无变化文件跳过)`
  );

  logger.log(`[cron-sync] 步骤 3/3: 校验生产环境目标文件语法与完整性...`);
  let validatedCount = 0;
  for (const relPath of copied) {
    const destFile = join(resolvedTarget, relPath);
    const syntax = validateScriptSyntax(destFile);
    if (!syntax.valid) {
      throw new Error(`[cron-sync] 目标文件语法校验失败: ${relPath}\n${syntax.error}`);
    }
    validatedCount++;
  }
  logger.log(`[cron-sync] ✓ 生产环境变更脚本语法核验全部通过 (${validatedCount} 个文件)`);

  return { copied, unchanged, validated: validatedCount };
}

function parseCliArgs(args) {
  const options = {
    target: process.env.CRON_PROJECT_DIR || DEFAULT_TARGET_DIR,
    includeDomain: true,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--no-domain") {
      options.includeDomain = false;
    } else if (arg === "--with-domain") {
      options.includeDomain = true;
    } else if (arg === "--target" && args[i + 1]) {
      options.target = args[++i];
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
    }
  }

  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`
AstroLineage 流水线核心脚本单向同步工具 (开发环境 -> 生产运行环境)

用法:
  node scripts/cron-sync-scripts-cli.mjs [选项]
  npm run cron:sync-scripts [-- 选项]

选项:
  --target <path>      目标生产目录 (默认: /home/long/astro-lineage-cron 或 CRON_PROJECT_DIR 环境变量)
  --no-domain          仅同步 scripts/，不同步 src/domain/
  --dry-run            试运行，仅展示待同步文件，不实际写入
  --help, -h           显示此帮助信息
`);
    process.exit(0);
  }

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  try {
    const result = syncScripts({
      sourceDir: projectRoot,
      targetDir: options.target,
      includeDomain: options.includeDomain,
      dryRun: options.dryRun,
    });
    if (result.copied.length > 0) {
      console.log(`[cron-sync] 变更清单:`);
      for (const file of result.copied) {
        console.log(`  - ${file}`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
