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

export function runDeployDoctor() {
  console.log("========================================================");
  console.log("  AstroLineage 部署与 Cloudflare 同步状态诊断");
  console.log("========================================================\n");

  const envPath = resolve(projectRoot, ".env");
  const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

  // 1. 检查环境变量配置
  const cronPush = /^\s*CRON_GIT_PUSH\s*=\s*true/m.test(envContent);
  const publicUrl = envContent.match(/^\s*PUBLIC_SITE_URL\s*=\s*(.+)$/m)?.[1]?.trim() || "未配置";
  const localUrl = envContent.match(/^\s*LOCAL_SITE_URL\s*=\s*(.+)$/m)?.[1]?.trim() || "未配置";
  const syncWeeks = envContent.match(/^\s*SYNC_FIGURES_WEEKS\s*=\s*(.+)$/m)?.[1]?.trim() || "7";
  const syncMaxMb = envContent.match(/^\s*SYNC_FIGURES_MAX_MB\s*=\s*(.+)$/m)?.[1]?.trim() || "300";

  console.log("[1/3] 环境与站点配置:");
  console.log(`  - 公网 CDN (Cloudflare): ${publicUrl}`);
  console.log(`  - 本地局域网服务:         ${localUrl}`);
  console.log(
    `  - 定时自动推送 (CRON_GIT_PUSH): ${cronPush ? "✅ 已开启 (true)" : "⚠️ 已关闭 (false - 定时任务将不会自动推送到 GitHub)"}`
  );
  console.log(`  - 论文切图同步预算:       最近 ${syncWeeks} 周，上限 ${syncMaxMb}MB\n`);

  // 2. 检查 Git 仓库状态
  console.log("[2/3] Git 状态与分支隔离:");
  let currentBranch = "unknown";
  try {
    currentBranch = execSync("git symbolic-ref --short HEAD 2>/dev/null", {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
    if (currentBranch === "master") {
      console.log(`  - 当前活跃分支:           ✅ master (与生产部署分支对齐)`);
    } else {
      console.log(
        `  - 当前活跃分支:           ⚠️ ${currentBranch} (非 master 分支，定时推送门禁将自动拦截)`
      );
    }
  } catch {
    console.log(`  - 当前活跃分支:           ⚠️ 头指针处于分离状态 (Detached HEAD)`);
  }

  // 检查工作区纯净度
  try {
    const dirtyPorcelain = execSync("git status --porcelain 2>/dev/null", {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
    if (!dirtyPorcelain) {
      console.log(`  - 工作区状态:             ✅ 完全干净 (Working tree clean)`);
    } else {
      const nonDataDirty = dirtyPorcelain
        .split("\n")
        .filter((line) => !line.match(/^..\s+(src\/data\/|public\/figures\/)/u));
      if (nonDataDirty.length > 0) {
        console.log(
          `  - 工作区状态:             ⚠️ 存在 ${nonDataDirty.length} 个未提交的代码文件 (定时推送将安全挂起)`
        );
      } else {
        console.log(
          `  - 工作区状态:             ℹ️ 仅存在数据/图表更新 (${dirtyPorcelain.split("\n").length} 项)`
        );
      }
    }
  } catch (err) {
    console.log(`  - 工作区检查失败:         ${err.message}`);
  }

  // 3. 检查远程同步与待推送状态
  console.log("\n[3/3] 远程 master 差异对比:");
  try {
    const unpushed = execSync("git log origin/master..HEAD --oneline 2>/dev/null || true", {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
    if (unpushed) {
      const count = unpushed.split("\n").length;
      console.log(
        `  - 待推送到远程 master:   ⚠️ 存在 ${count} 个未同步提交 (Cloudflare 页面尚未包含最新数据)`
      );
      console.log("    近期未同步提交:");
      unpushed
        .split("\n")
        .slice(0, 3)
        .forEach((c) => console.log(`      • ${c}`));
      if (count > 3) console.log(`      ... 以及另外 ${count - 3} 个提交`);
    } else {
      console.log(`  - 待推送到远程 master:   ✅ 0 (本地与 origin/master 完全同步)`);
    }
  } catch (err) {
    console.log(`  - 远程差异检查失败:       ${err.message}`);
  }

  console.log("\n========================================================");
  if (!cronPush) {
    console.log("💡 诊断提示: 若希望定时任务更新后自动部署到 Cloudflare Pages，");
    console.log("   请在 .env 中设置 CRON_GIT_PUSH=true。");
  } else if (currentBranch !== "master") {
    console.log("💡 诊断提示: 当前处于特性分支，定时任务会自动跳过远程推送以保护代码。");
    console.log("   开发完成后合并到 master 即可自动恢复推送。");
  } else {
    console.log("✅ 诊断结论: 部署链路配置完整，工作在主分支，门禁处于健康状态。");
  }
  console.log("========================================================\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDeployDoctor();
}
