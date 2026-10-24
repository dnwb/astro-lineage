#!/usr/bin/env node
/**
 * scripts/deploy-doctor.mjs
 *
 * AstroLineage Deployment & Cloudflare Sync Diagnostic Tool
 *
 * Inspects:
 * 1. Environment configuration (CRON_GIT_PUSH, PUBLIC_SITE_URL, LOCAL_SITE_URL)
 * 2. Git working tree state and branch isolation
 * 3. Pending unpushed commits against origin/master
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

export function parseEnv(content) {
  const env = {};
  if (!content) return env;
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = rawLine.indexOf("=");
    if (eqIdx === -1) continue;
    const key = rawLine.slice(0, eqIdx).trim();
    let val = rawLine.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

export function classifyWorkingTree(porcelainOutput) {
  if (!porcelainOutput || !porcelainOutput.trim()) {
    return { clean: true, nonDataFiles: [], dataFiles: [] };
  }
  const lines = porcelainOutput.trimEnd().split(/\r?\n/).filter(Boolean);
  const dataFiles = [];
  const nonDataFiles = [];

  for (const line of lines) {
    const match = line.match(/^(?:..|[A-Z?]{1,2})\s+(.+)$/u);
    const filePath = match ? match[1].trim() : line.trim();
    const isAllowedData =
      filePath.startsWith("src/data/") ||
      filePath.startsWith("public/figures/") ||
      filePath.includes("-> src/data/") ||
      filePath.includes("-> public/figures/");

    if (isAllowedData) {
      dataFiles.push(filePath);
    } else {
      nonDataFiles.push(filePath);
    }
  }

  return {
    clean: lines.length === 0,
    nonDataFiles,
    dataFiles,
  };
}

export function runDeployDoctor(options = {}) {
  const root = options.projectRoot || projectRoot;
  console.log("========================================================");
  console.log("  AstroLineage 部署与 Cloudflare 同步状态诊断");
  console.log("========================================================\n");

  const envPath = resolve(root, ".env");
  const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const parsedEnv = parseEnv(envContent);

  // 1. 检查环境变量配置 (优先使用环境生效值，兜底读取 .env 文件解析值)
  const effectiveCronPush = process.env.CRON_GIT_PUSH ?? parsedEnv.CRON_GIT_PUSH ?? "false";
  const cronPush = effectiveCronPush === "true";
  const publicUrl = process.env.PUBLIC_SITE_URL || parsedEnv.PUBLIC_SITE_URL || "未配置";
  const localUrl = process.env.LOCAL_SITE_URL || parsedEnv.LOCAL_SITE_URL || "未配置";
  const syncWeeks = process.env.SYNC_FIGURES_WEEKS || parsedEnv.SYNC_FIGURES_WEEKS || "7";
  const syncMaxMb = process.env.SYNC_FIGURES_MAX_MB || parsedEnv.SYNC_FIGURES_MAX_MB || "300";

  console.log("[1/3] 环境与站点配置:");
  console.log(`  - 公网 CDN (Cloudflare): ${publicUrl}`);
  console.log(`  - 本地局域网服务:         ${localUrl}`);
  console.log(
    `  - 定时自动推送 (CRON_GIT_PUSH): ${cronPush ? "✅ 已开启 (true)" : "⚠️ 已关闭 (false - 定时任务将不会自动推送到 GitHub)"}`
  );
  console.log(`  - 论文切图同步预算:       最近 ${syncWeeks} 周，上限 ${syncMaxMb}MB\n`);

  const blockers = [];
  if (!cronPush) {
    blockers.push("定时自动推送未开启 (CRON_GIT_PUSH != true)");
  }

  // 2. 检查 Git 仓库状态与分支隔离
  console.log("[2/3] Git 状态与分支隔离:");
  let currentBranch = "unknown";
  try {
    currentBranch = execSync("git symbolic-ref --short HEAD", {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (currentBranch === "master") {
      console.log(`  - 当前活跃分支:           ✅ master (与生产部署分支对齐)`);
    } else {
      console.log(
        `  - 当前活跃分支:           ⚠️ ${currentBranch} (非 master 分支，定时推送门禁将自动拦截)`
      );
      blockers.push(`当前分支为 '${currentBranch}' (非 master 生产分支)`);
    }
  } catch (err) {
    console.log(`  - 当前活跃分支:           ⚠️ 头指针处于分离状态或非 git 仓库`);
    blockers.push("当前活跃分支处于分离状态 (Detached HEAD) 或非 git 仓库");
  }

  // 检查工作区纯净度
  let workingTree = { clean: true, nonDataFiles: [], dataFiles: [] };
  try {
    const rawPorcelain = execSync("git status --porcelain", {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    workingTree = classifyWorkingTree(rawPorcelain);
    if (workingTree.clean) {
      console.log(`  - 工作区状态:             ✅ 完全干净 (Working tree clean)`);
    } else if (workingTree.nonDataFiles.length > 0) {
      console.log(
        `  - 工作区状态:             ⚠️ 存在 ${workingTree.nonDataFiles.length} 个未提交的代码文件 (定时推送将安全挂起)`
      );
      blockers.push(
        `工作区存在 ${workingTree.nonDataFiles.length} 个未提交的代码文件 (推送门禁挂起)`
      );
    } else {
      console.log(
        `  - 工作区状态:             ℹ️ 仅存在数据/图表更新 (${workingTree.dataFiles.length} 项)`
      );
    }
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString().trim() : err.message;
    console.log(`  - 工作区检查失败:         ⚠️ ${msg}`);
    blockers.push(`工作区状态检查失败: ${msg}`);
  }

  // 3. 检查远程同步与待推送状态
  console.log("\n[3/3] 远程 master 差异对比:");
  let unpushedCommits = [];
  let remoteCheckError = null;
  try {
    const rawUnpushed = execSync("git log origin/master..HEAD --oneline", {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (rawUnpushed) {
      unpushedCommits = rawUnpushed.split(/\r?\n/).filter(Boolean);
      const count = unpushedCommits.length;
      console.log(
        `  - 待推送到远程 master:   ⚠️ 存在 ${count} 个未同步提交 (Cloudflare 页面尚未包含最新数据)`
      );
      console.log("    近期未同步提交:");
      unpushedCommits.slice(0, 3).forEach((c) => console.log(`      • ${c}`));
      if (count > 3) console.log(`      ... 以及另外 ${count - 3} 个提交`);
    } else {
      console.log(`  - 待推送到远程 master:   ✅ 0 (本地与 origin/master 完全同步)`);
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    remoteCheckError = stderr || err.message;
    console.log(`  - 远程差异检查失败:       ⚠️ 无法对比 origin/master (${remoteCheckError})`);
    blockers.push(`远程 master 差异对比失败: ${remoteCheckError}`);
  }

  console.log("\n========================================================");
  if (blockers.length === 0) {
    console.log("✅ 诊断结论: 部署链路配置完整，工作在主分支，门禁处于健康状态。");
    if (unpushedCommits.length > 0) {
      console.log(
        `   (注: 当前有 ${unpushedCommits.length} 个本地提交待推送至远程，将在下次定时运行或手动触发时推送)`
      );
    }
  } else {
    console.log("⚠️ 诊断结论: 部署门禁处于非就绪/挂起状态，自动同步将不会执行：");
    for (const blocker of blockers) {
      console.log(`   • ${blocker}`);
    }
  }
  console.log("========================================================\n");

  return {
    ok: blockers.length === 0,
    blockers,
    unpushedCommits,
    workingTree,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDeployDoctor();
}
