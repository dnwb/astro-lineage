#!/usr/bin/env node
/**
 * scripts/sync-recent-figures.mjs
 *
 * Synchronize and maintain a sliding window of paper figures in Git.
 * Only figures for articles published within the most recent N weeks (default: 7 weeks)
 * are tracked in Git and deployed to Cloudflare Pages.
 *
 * Older historical figures (> N weeks) are untracked from Git (preserving local disk files),
 * keeping the Git repository lightweight while ensuring Cloudflare Pages displays all recent figures.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getBeijingWeekId } from "../src/domain/academic-domain.mjs";

const DEFAULT_WEEKLY_DIR = fileURLToPath(
  new URL("../src/data/arxiv-archives/weekly", import.meta.url)
);
const DEFAULT_DAILY_DIR = fileURLToPath(
  new URL("../src/data/arxiv-archives/daily", import.meta.url)
);
const DEFAULT_RADAR_PATH = fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url));
const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

/**
 * 获取最近 N 个学术周的周标识列表 (降序排列)
 *
 * @param {number} [count=7]
 * @param {Object} [options]
 * @returns {Promise<string[]>}
 */
export async function resolveRecentAcademicWeekIds(count = 7, options = {}) {
  const weeklyDir = options.weeklyDir || DEFAULT_WEEKLY_DIR;
  const currentWeek = getBeijingWeekId(options.now || new Date());
  const weeks = new Set([currentWeek]);

  try {
    const files = await readdir(weeklyDir);
    const sorted = files
      .filter((f) => /^\d{4}-W\d\d\.json$/u.test(f))
      .map((f) => f.replace(/\.json$/u, ""))
      .sort()
      .reverse();
    for (const w of sorted) {
      weeks.add(w);
    }
  } catch {}

  const sortedWeeks = Array.from(weeks).sort().reverse();
  return sortedWeeks.slice(0, count);
}

/**
 * 收集最近 N 周每日归档与当日雷达中实际引用的全部图片相对路径
 * 按最新日期优先顺序纳入，严格受限于容量预算上限 (默认 300MB)
 *
 * @param {string[]|Set<string>} recentWeekIds
 * @param {Object} [options]
 * @param {number} [options.maxMb=300] 容量预算上限 (MB)
 * @returns {Promise<Set<string>>} 相对项目根目录的路径集合 (如 "public/arxiv-figures/...")
 */
export async function collectReferencedFiguresForWeeks(recentWeekIds, options = {}) {
  const weekSet = recentWeekIds instanceof Set ? recentWeekIds : new Set(recentWeekIds);
  const dailyDir = options.dailyDir || DEFAULT_DAILY_DIR;
  const radarPath = options.radarPath || DEFAULT_RADAR_PATH;
  const publicDir = options.publicDir || DEFAULT_PUBLIC_DIR;
  const maxMb = Number.isFinite(options.maxMb)
    ? options.maxMb
    : parseInt(process.env.SYNC_FIGURES_MAX_MB || "300", 10);
  const maxBytes = maxMb * 1024 * 1024;

  const referencedPaths = new Set();
  let currentBytes = 0;

  const extractUrls = (content) => {
    const matches = String(content).matchAll(/\/arxiv-figures\/([^\s"'\\<>]+)/gu);
    for (const match of matches) {
      const cleanSubpath = match[1].replace(/#.*$/u, "").replace(/\?.*$/u, "");
      const repoRelPath = `public/arxiv-figures/${cleanSubpath}`;
      if (referencedPaths.has(repoRelPath)) continue;

      const diskPath = join(publicDir, "arxiv-figures", cleanSubpath);
      if (existsSync(diskPath)) {
        const stat = statSync(diskPath);
        if (stat.isFile()) {
          if (currentBytes + stat.size <= maxBytes) {
            referencedPaths.add(repoRelPath);
            currentBytes += stat.size;
          }
        }
      }
    }
  };

  // 1. 优先扫描当前活跃雷达 (始终属于最新周次第一优先级)
  if (existsSync(radarPath)) {
    try {
      const radarContent = await readFile(radarPath, "utf8");
      extractUrls(radarContent);
    } catch {}
  }

  // 2. 按降序（从最新到最旧）扫描匹配周次的每日归档
  try {
    const dailyFiles = await readdir(dailyDir);
    const sortedDailyFiles = dailyFiles
      .filter((file) => /^\d{4}-\d\d-\d\d\.json$/u.test(file))
      .sort()
      .reverse();

    for (const file of sortedDailyFiles) {
      const date = file.replace(/\.json$/u, "");
      const weekId = getBeijingWeekId(date);
      if (weekSet.has(weekId)) {
        try {
          const content = await readFile(join(dailyDir, file), "utf8");
          extractUrls(content);
        } catch {}
      }
    }
  } catch {}

  // 附加总字节数元数据供调试分析
  referencedPaths.totalBytes = currentBytes;
  return referencedPaths;
}

/**
 * 同步最近 N 周图片到 Git 暂存区：
 * - 属于最近 N 周且在容量预算 (默认 300MB) 内的有效图表：执行 git add -f 暂存入库
 * - 超出最近 N 周或超出容量预算的已跟踪图表：执行 git rm --cached -f 解除 Git 跟踪 (保留本地磁盘文件)
 *
 * @param {Object} [options]
 * @param {number} [options.weeks=7]
 * @param {number} [options.maxMb=300]
 * @param {boolean} [options.dryRun=false]
 * @param {string} [options.projectRoot]
 * @returns {Promise<{ recentWeeks: string[], allowedCount: number, stagedCount: number, untrackedCount: number, totalTracked: number, totalSizeMb: number, maxMb: number }>}
 */
export async function syncRecentFiguresToGit({
  weeks = 7,
  maxMb = parseInt(process.env.SYNC_FIGURES_MAX_MB || "300", 10),
  dryRun = false,
  projectRoot = fileURLToPath(new URL("..", import.meta.url)),
  ...restOptions
} = {}) {
  const recentWeeks = await resolveRecentAcademicWeekIds(weeks, restOptions);
  const allowedPaths = await collectReferencedFiguresForWeeks(recentWeeks, {
    maxMb,
    ...restOptions,
  });

  // 获取当前 Git 已跟踪的所有图片文件
  let trackedFiles = [];
  try {
    const out = execSync("git ls-files public/arxiv-figures/", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    if (out) {
      trackedFiles = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    }
  } catch {
    trackedFiles = [];
  }
  const trackedSet = new Set(trackedFiles);

  const toUntrack = [];
  for (const tracked of trackedFiles) {
    if (!allowedPaths.has(tracked)) {
      toUntrack.push(tracked);
    }
  }

  const toStage = [];
  for (const allowed of allowedPaths) {
    if (!trackedSet.has(allowed)) {
      toStage.push(allowed);
    }
  }

  if (!dryRun) {
    // 1. 解除历史过期或废弃文件的 Git 跟踪 (保留磁盘文件)
    if (toUntrack.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < toUntrack.length; i += batchSize) {
        const batch = toUntrack
          .slice(i, i + batchSize)
          .map((f) => `"${f}"`)
          .join(" ");
        execSync(`git rm --cached -f --ignore-unmatch ${batch}`, {
          cwd: projectRoot,
          stdio: ["pipe", "pipe", "ignore"],
        });
      }
    }

    // 2. 将最近 N 周的有效图表加入 Git 暂存区
    if (toStage.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < toStage.length; i += batchSize) {
        const batch = toStage
          .slice(i, i + batchSize)
          .map((f) => `"${f}"`)
          .join(" ");
        execSync(`git add -f ${batch}`, {
          cwd: projectRoot,
          stdio: ["pipe", "pipe", "ignore"],
        });
      }
    }
  }

  const finalTrackedCount = trackedFiles.length - toUntrack.length + toStage.length;
  const totalBytes = Number.isFinite(allowedPaths.totalBytes)
    ? allowedPaths.totalBytes
    : Array.from(allowedPaths).reduce((acc, p) => {
        const diskPath = join(projectRoot, p);
        return acc + (existsSync(diskPath) ? statSync(diskPath).size : 0);
      }, 0);
  const totalSizeMb = Number((totalBytes / (1024 * 1024)).toFixed(2));

  return {
    recentWeeks,
    allowedCount: allowedPaths.size,
    stagedCount: toStage.length,
    untrackedCount: toUntrack.length,
    totalTracked: dryRun ? trackedFiles.length : finalTrackedCount,
    totalSizeMb,
    maxMb,
  };
}

// CLI 执行入口
if (process.argv[1] && process.argv[1].endsWith("sync-recent-figures.mjs")) {
  const args = process.argv.slice(2);
  let weeks = parseInt(process.env.SYNC_FIGURES_WEEKS || "7", 10);
  let maxMb = parseInt(process.env.SYNC_FIGURES_MAX_MB || "300", 10);
  let dryRun = false;
  let statusOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--weeks" && args[i + 1]) {
      weeks = parseInt(args[i + 1], 10) || 7;
      i++;
    } else if (args[i] === "--max-mb" && args[i + 1]) {
      maxMb = parseInt(args[i + 1], 10) || 300;
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--status") {
      statusOnly = true;
    }
  }

  (async () => {
    try {
      console.log(
        `[sync-recent-figures] 计算最近 ${weeks} 周论文图表同步窗口 (预算上限: ${maxMb} MB)...`
      );
      const res = await syncRecentFiguresToGit({ weeks, maxMb, dryRun: dryRun || statusOnly });
      console.log(
        `[sync-recent-figures] 活跃周次 (${res.recentWeeks.length} 周): ${res.recentWeeks.join(", ")}`
      );
      const usagePct = ((res.totalSizeMb / res.maxMb) * 100).toFixed(1);
      console.log(
        `[sync-recent-figures] 窗口内有效图表总数: ${res.allowedCount} 篇切图 (${res.totalSizeMb} MB / 预算上限 ${res.maxMb} MB, 占比 ${usagePct}%)`
      );
      if (statusOnly) {
        console.log(`[sync-recent-figures] 当前 Git 已跟踪图表: ${res.totalTracked}`);
        console.log(`[sync-recent-figures] 待新增暂存入库: ${res.stagedCount}`);
        console.log(`[sync-recent-figures] 待解除过期跟踪: ${res.untrackedCount}`);
      } else if (dryRun) {
        console.log(`[sync-recent-figures] [Dry-Run] 计划暂存入库: ${res.stagedCount}`);
        console.log(`[sync-recent-figures] [Dry-Run] 计划解除跟踪: ${res.untrackedCount}`);
      } else {
        console.log(`[sync-recent-figures] ✓ 成功将 ${res.stagedCount} 张新图表加入 Git 暂存区`);
        if (res.untrackedCount > 0) {
          console.log(
            `[sync-recent-figures] ✓ 成功解除 ${res.untrackedCount} 张过期图表的 Git 跟踪 (磁盘原图已完整保留)`
          );
        }
        console.log(`[sync-recent-figures] 当前 Git 跟踪总图表数: ${res.totalTracked}`);
      }
    } catch (err) {
      console.error(`[sync-recent-figures] 执行失败:`, err.message);
      process.exit(1);
    }
  })();
}
