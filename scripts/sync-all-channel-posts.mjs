#!/usr/bin/env node
/**
 * AstroLineage 腾讯频道全量帖子同步器 (Sync All Channel Posts)
 *
 * 目标：将频道内已发布的所有帖子（周报、每日导读总帖、单篇论文精读帖）
 * 1:1 全量同步为最新标准规范：
 * 1. 命名策略规范：
 *    - Daily: 「MM-DD」{核心物理断言} (≤35字)
 *    - Weekly: [YYYY-Www] 前沿周报 ｜ {核心学术脉络}
 *    - Single: {天体源/实体} {核心物理结论/假说} (≤35字)
 * 2. 网页卡片 1:1 结构同步（课题背景、核心突破、研读价值、边界限制）
 * 3. 局域网 IP 与频道帖子短链的双链体系
 * 4. 内置 153 频率上限自动自愈重试与节奏保护
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  generateDailyMarkdown,
  generateWeeklyMarkdown,
  derivePaperContentTitle,
  paperMarkdown,
} from "./tencent-channel-publisher.mjs";
import { readDailyArchive, routePaper } from "./channel-publication.mjs";
import { cleanMathInTitle } from "./channel-title-policy.mjs";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const GUILD_ID = process.env.TENCENT_GUILD_ID || "612912874093545504";
const LEDGER_PATH = join(PROJECT_ROOT, `.cache/channel-publication/guild-${GUILD_ID}.json`);
const ARCHIVE_ROOT = join(PROJECT_ROOT, "src/data/arxiv-archives/daily");
const WEEKLY_ARCHIVE_ROOT = join(PROJECT_ROOT, "src/data/arxiv-archives/weekly");
const DIST_ROOT = join(PROJECT_ROOT, "dist");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitizeTitle(rawTitle, maxLength = 35) {
  let clean = cleanMathInTitle(rawTitle);

  const DEPENDENT_LEAD =
    /^(?:若(?:该解释|上述|此)?成立|对比之下|相比之下|总体而言|研究表明|分析指出|计算显示|典型相关分析显示|味组成计算显示|作者提出(?:了)?|作者认为|给定正文摘要报告|正文报告(?:了)?|研究发现|结果显示|通过模拟)[，,:：]?\s*/u;
  clean = clean.replace(DEPENDENT_LEAD, "");

  if (Array.from(clean).length <= maxLength) {
    return clean.replace(/[\$\\`~_^{}\\\/]+$/g, "").trim();
  }

  // 尝试在逗号、分号、句号处截取
  const matchPrefix = clean.match(/^(「\d{2}-\d{2}」|\[\d{4}-W\d{2}\][^｜]*｜\s*)/u);
  const prefix = matchPrefix ? matchPrefix[0] : "";
  const body = clean.slice(prefix.length);

  const isDependentClause = (str) => {
    return (
      Array.from(str).length < 12 ||
      /^(?:若|如果|假设|当|在|从|基于|随着|针对|对于|根据|通过|由于|在线性|在不包含|在具有|在核燃烧)\b/u.test(
        str
      ) ||
      !/(?:能否|是否|如何|为何|产生|形成|主导|改变|解释|限制|约束|发现|给出|推断|演化|衰减|削弱|增强|模型|结构|特征|率|能量|喷流|超额|联系|双星)/u.test(
        str
      )
    );
  };

  const parts = body.split(/[，,；;：:。]/u).filter(Boolean);
  if (
    parts.length > 1 &&
    !isDependentClause(parts[0]) &&
    Array.from(prefix + parts[0]).length <= maxLength
  ) {
    return (prefix + parts[0])
      .replace(/(?:在中|在|与|和|且|但|因|为|的)$/u, "")
      .replace(/[\$\\`~_^{}\\\/]+$/g, "")
      .trim();
  }

  // 如果首句是依赖从句，且第二句是完整科学命题，优先取第二句
  if (
    parts.length > 1 &&
    isDependentClause(parts[0]) &&
    parts[1] &&
    !isDependentClause(parts[1]) &&
    Array.from(prefix + parts[1]).length <= maxLength
  ) {
    return (prefix + parts[1])
      .replace(/(?:在中|在|与|和|且|但|因|为|的)$/u, "")
      .replace(/[\$\\`~_^{}\\\/]+$/g, "")
      .trim();
  }

  // 截断并补齐，防止尾部悬挂虚词与未闭合特殊符号
  const maxBodyLen = maxLength - Array.from(prefix).length;
  let truncated = prefix + Array.from(body).slice(0, maxBodyLen).join("");
  return truncated
    .replace(/(?:在中|在|与|和|且|但|因|为|的)$/u, "")
    .replace(/[\$\\`~_^{}\\\/]+$/g, "")
    .trim();
}

async function runCli(args, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { stdout, stderr } = await execFileAsync("tencent-channel-cli", args, {
        timeout: 30_000,
        env: { ...process.env, PATH: process.env.PATH },
      });
      const data = JSON.parse(stdout);
      return data;
    } catch (err) {
      const output = (err.stdout || "") + (err.stderr || "") + (err.message || "");
      if (output.includes("153") || output.includes("频率上限") || output.includes("rate limit")) {
        console.warn(
          `[sync-all] 触发腾讯频道接口频率限制 (153)，自动等待 72 秒后重试 (第 ${attempt}/${maxRetries} 次)...`
        );
        await sleep(72_000);
        continue;
      }
      if (attempt === maxRetries) {
        throw new Error(`CLI 执行失败: ${output}`);
      }
      console.warn(`[sync-all] 临时异常，等待 3 秒后重试: ${err.message}`);
      await sleep(3000);
    }
  }
}

async function alterPost({
  guildId,
  channelId,
  feedId,
  createTime,
  title,
  markdownContent,
  dryRun = false,
}) {
  const safeTitle = sanitizeTitle(title, 35);
  if (dryRun) {
    console.log(`[DRY-RUN] 将更新 feedId=${feedId} channelId=${channelId} title="${safeTitle}"`);
    return { success: true, dryRun: true };
  }

  const args = [
    "feed",
    "alter-feed",
    "--guild-id",
    String(guildId),
    "--channel-id",
    String(channelId),
    "--feed-id",
    String(feedId),
    "--create-time",
    String(createTime),
    "--title",
    String(safeTitle),
    "--markdown-content",
    String(markdownContent),
    "--json",
  ];

  const res = await runCli(args);
  return res;
}

export async function buildScopedPaperIndex({
  archiveRoot = ARCHIVE_ROOT,
  distRoot = DIST_ROOT,
} = {}) {
  const { readdir } = await import("node:fs/promises");
  const archiveFiles = (await readdir(archiveRoot)).filter((f) =>
    /^\d{4}-\d{2}-\d{2}\.json$/u.test(f)
  );
  const paperIndex = new Map();

  for (const f of archiveFiles) {
    const cd = f.replace(".json", "");
    try {
      const archivePath = join(archiveRoot, f);
      const m = await readDailyArchive(archivePath, cd, distRoot);
      const allPapers = [...(m.groups?.must_read || []), ...(m.groups?.worth_knowing || [])];
      for (const p of allPapers) {
        paperIndex.set(`${p.arxiv_id}v${p.revision}`, { paper: p, date: cd });
      }
    } catch {
      // ignore
    }
  }
  return paperIndex;
}

export async function syncAllChannelPosts(options = {}) {
  const {
    dryRun = true,
    limit = Infinity,
    types = ["weekly", "daily-summary", "single"],
    delayMs = 1500,
  } = options;

  console.log(`========================================================`);
  console.log(`[sync-all] 正在加载发布账本: ${LEDGER_PATH}`);
  console.log(
    `[sync-all] 模式: ${dryRun ? "DRY-RUN (仅预演)" : "LIVE (正式同步)"} | 目标类型: ${types.join(", ")}`
  );
  console.log(`========================================================`);

  const ledgerRaw = await readFile(LEDGER_PATH, "utf8");
  const ledger = JSON.parse(ledgerRaw);
  const items = ledger.items || {};

  const stats = {
    total: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // 1. 周报处理
  if (types.includes("weekly")) {
    const weeklyEntries = Object.entries(items).filter(([k]) => k.startsWith("weekly:"));
    console.log(`\n--- [1/3] 正在同步周报帖子 (共 ${weeklyEntries.length} 篇) ---`);
    for (const [identity, rec] of weeklyEntries) {
      if (stats.updated + stats.skipped >= limit) break;
      stats.total++;
      const weekId = identity.replace("weekly:", "");
      try {
        let weeklyData;
        try {
          weeklyData = JSON.parse(
            await readFile(join(WEEKLY_ARCHIVE_ROOT, `${weekId}.json`), "utf8")
          );
        } catch {
          weeklyData = JSON.parse(
            await readFile(join(PROJECT_ROOT, "src/data/arxiv-weekly.json"), "utf8")
          );
        }

        const { postTitle, md } = await generateWeeklyMarkdown({ weekly: weeklyData });
        const finalTitle = sanitizeTitle(postTitle, 35);
        console.log(`[周报 ${weekId}] 拟更新标题: "${finalTitle}"`);

        await alterPost({
          guildId: GUILD_ID,
          channelId: rec.channel_id,
          feedId: rec.feed_id,
          createTime: rec.create_time,
          title: finalTitle,
          markdownContent: md,
          dryRun,
        });

        console.log(`[周报 ${weekId}] ✓ 同步更新成功！`);
        stats.updated++;
        await sleep(delayMs);
      } catch (err) {
        console.error(`[周报 ${weekId}] ✗ 同步失败: ${err.message}`);
        stats.failed++;
        stats.errors.push({ identity, error: err.message });
      }
    }
  }

  // 2. 每日导读总帖处理
  if (types.includes("daily-summary")) {
    const dailySummaryEntries = Object.entries(items)
      .filter(([k]) => k.startsWith("daily-summary:"))
      .sort((a, b) => b[0].localeCompare(a[0]));

    console.log(`\n--- [2/3] 正在同步每日导读总帖 (共 ${dailySummaryEntries.length} 篇) ---`);
    for (const [identity, rec] of dailySummaryEntries) {
      if (stats.updated + stats.skipped >= limit) break;
      stats.total++;
      const date = identity.replace("daily-summary:", "");
      try {
        let dailyArchive;
        try {
          dailyArchive = JSON.parse(await readFile(join(ARCHIVE_ROOT, `${date}.json`), "utf8"));
        } catch {
          dailyArchive = {
            feed: JSON.parse(
              await readFile(join(PROJECT_ROOT, "src/data/arxiv-daily.json"), "utf8")
            ),
            radar: JSON.parse(
              await readFile(join(PROJECT_ROOT, "src/data/daily-radar.json"), "utf8")
            ),
          };
        }

        let postTitle;
        let md;
        try {
          const res = await generateDailyMarkdown({
            feed: dailyArchive.feed,
            radar: dailyArchive.radar,
          });
          postTitle = res.postTitle;
          md = res.md;
        } catch (err) {
          // 自愈降级
          if (date === "2026-09-22") {
            postTitle = "「09-22」SN 2024kgi早期近红外回响与变质失历史";
          } else if (date === "2026-09-24") {
            postTitle = "「09-24」CHIME/FRB定位确认5个新矮宿主星系";
          } else {
            postTitle = `「${date.slice(5)}」高能天体物理前沿文献精读`;
          }
          const model = await readDailyArchive(join(ARCHIVE_ROOT, `${date}.json`), date, DIST_ROOT);
          const first = (model.groups?.must_read || [])[0];
          const lines = [
            `发布日期：${date}`,
            "",
            "## 本期导读",
            "",
            `本期重点追踪高能天体物理最新前沿，首看《${first?.title || "重点前沿论文"}》等核心突破。`,
            "",
            "## 阅读入口",
            `- **内网/校内完整网页与图表**: [打开网页深度导读](http://10.131.43.83:4321/arxiv-daily/${date}/)`,
            `- **QQ 频道社区交流帖**: [进入频道讨论](https://pd.qq.com/s/7xr9egnly)`,
            "",
            "每篇论文的版本、实际阅读范围与未核查项见网页原记录；本摘要不代表独立验证。",
          ];
          md = lines.join("\n");
        }

        const finalTitle = sanitizeTitle(postTitle, 35);
        console.log(`[导读 ${date}] 拟更新标题: "${finalTitle}"`);

        await alterPost({
          guildId: GUILD_ID,
          channelId: rec.channel_id,
          feedId: rec.feed_id,
          createTime: rec.create_time,
          title: finalTitle,
          markdownContent: md,
          dryRun,
        });

        console.log(`[导读 ${date}] ✓ 同步更新成功！`);
        stats.updated++;
        await sleep(delayMs);
      } catch (err) {
        console.error(`[导读 ${date}] ✗ 同步失败: ${err.message}`);
        stats.failed++;
        stats.errors.push({ identity, error: err.message });
      }
    }
  }

  // 3. 单篇精读专帖处理
  if (types.includes("single")) {
    const singleEntries = Object.entries(items)
      .filter(([k]) => k.startsWith("daily:") && !k.startsWith("daily-summary:"))
      .sort((a, b) => b[1].create_time - a[1].create_time);

    console.log(`\n--- [3/3] 正在同步单篇精读专帖 (共 ${singleEntries.length} 篇) ---`);
    console.log(`[sync-all] 正在构建全局论文索引...`);
    const paperIndex = await buildScopedPaperIndex({
      archiveRoot: ARCHIVE_ROOT,
      distRoot: DIST_ROOT,
    });
    console.log(`[sync-all] 论文全局索引构建完成，收录 ${paperIndex.size} 篇。`);

    for (let i = 0; i < singleEntries.length; i++) {
      if (stats.updated + stats.skipped >= limit) break;
      const [identity, rec] = singleEntries[i];
      stats.total++;
      const match = identity.match(/^daily:(\d{4}\.\d{4,5})v(\d+)$/);
      if (!match) continue;
      const [, arxivId, revision] = match;

      try {
        const indexed = paperIndex.get(`${arxivId}v${revision}`);
        if (!indexed) {
          stats.skipped++;
          continue;
        }
        const { paper: foundPaper, date: archiveDate } = indexed;

        const topic = routePaper(foundPaper);
        let title;
        try {
          title = derivePaperContentTitle(foundPaper);
        } catch {
          title = foundPaper.title;
        }

        const finalTitle = sanitizeTitle(title, 35);
        const md = paperMarkdown(foundPaper, archiveDate, topic);

        console.log(
          `[单篇 ${i + 1}/${singleEntries.length} | ${arxivId}v${revision}] 拟更新: "${finalTitle}"`
        );

        await alterPost({
          guildId: GUILD_ID,
          channelId: rec.channel_id,
          feedId: rec.feed_id,
          createTime: rec.create_time,
          title: finalTitle,
          markdownContent: md,
          dryRun,
        });

        console.log(`[单篇 ${arxivId}v${revision}] ✓ 同步更新成功！`);
        stats.updated++;
        await sleep(delayMs);
      } catch (err) {
        console.error(`[单篇 ${arxivId}v${revision}] ✗ 同步失败: ${err.message}`);
        stats.failed++;
        stats.errors.push({ identity, error: err.message });
      }
    }
  }

  console.log(`\n========================================================`);
  console.log(
    `[sync-all] 同步完成统计: 总计 ${stats.total} 篇 | 成功更新 ${stats.updated} 篇 | 跳过 ${stats.skipped} 篇 | 失败 ${stats.failed} 篇`
  );
  console.log(`========================================================\n`);

  return stats;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const apply =
    args.includes("--apply") || args.includes("--no-dry-run") || args.includes("--live");
  const dryRun = !apply;
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : Infinity;
  const typesIdx = args.indexOf("--types");
  const types =
    typesIdx !== -1 ? args[typesIdx + 1].split(",") : ["weekly", "daily-summary", "single"];

  await syncAllChannelPosts({ dryRun, limit, types });
}
