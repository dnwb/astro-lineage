/**
 * AstroLineage QQ Bot 常规指令路由器与解析器
 *
 * 支持指令：
 *   \today, /today, 今日导读
 *   \yesterday, /yesterday, 昨日导读
 *   \day <date>, /day <date>, 导读 <date>
 *   \week, /week, 本周周报, 周报
 *   \last_week, /last_week, 上周周报
 *   \list_day, /list_day, 每日导读列表
 *   \list_week, /list_week, 周报列表
 *   \start, /start, \help, /help
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { generateGroupBrief } from "./qq-send.mjs";
import { readChannelShareUrl } from "./channel-publication.mjs";

const DEFAULT_DAILY_ARCHIVES_DIR = fileURLToPath(
  new URL("../src/data/arxiv-archives/daily", import.meta.url)
);
const DEFAULT_WEEKLY_ARCHIVES_DIR = fileURLToPath(
  new URL("../src/data/arxiv-archives/weekly", import.meta.url)
);

/**
 * 规整用户输入的日期字符串为 YYYY-MM-DD
 * 支持格式：
 *   YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
 *   YYYYMMDD
 *   MM-DD, MM/DD, MM.DD, MM月DD日
 */
export function normalizeDateInput(rawDate, defaultYear = new Date().getFullYear()) {
  if (!rawDate || typeof rawDate !== "string") return null;
  const trimmed = rawDate.trim();

  // 1. YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
  const matchFull = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u);
  if (matchFull) {
    const y = matchFull[1];
    const m = matchFull[2].padStart(2, "0");
    const d = matchFull[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 2. YYYYMMDD
  const matchDigits = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/u);
  if (matchDigits) {
    return `${matchDigits[1]}-${matchDigits[2]}-${matchDigits[3]}`;
  }

  // 3. MM-DD, MM/DD, MM.DD, MM月DD日
  const matchShort =
    trimmed.match(/^(\d{1,2})[-/.](\d{1,2})$/u) || trimmed.match(/^(\d{1,2})月(\d{1,2})日?$/u);
  if (matchShort) {
    const m = matchShort[1].padStart(2, "0");
    const d = matchShort[2].padStart(2, "0");
    return `${defaultYear}-${m}-${d}`;
  }

  return null;
}

/**
 * 获取所有已归档的每日导读日期（降序排列）
 */
export async function getAvailableDailyDates(archiveDir = DEFAULT_DAILY_ARCHIVES_DIR) {
  try {
    const files = await readdir(archiveDir);
    return files
      .filter((f) => /^\d{4}-\d\d-\d\d\.json$/u.test(f))
      .map((f) => f.replace(/\.json$/u, ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * 获取所有已归档的周报列表（降序排列）
 */
export async function getAvailableWeeklyIds(weeklyDir = DEFAULT_WEEKLY_ARCHIVES_DIR) {
  try {
    const files = await readdir(weeklyDir);
    return files
      .filter((f) => /^\d{4}-W\d\d\.json$/u.test(f))
      .map((f) => f.replace(/\.json$/u, ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * 生成每日导读归档列表 Markdown
 */
export async function formatDailyList(options = {}) {
  const archiveDir = options.archiveDir || DEFAULT_DAILY_ARCHIVES_DIR;
  const websiteBase = (
    options.websiteBase ||
    process.env.SITE_BASE_URL ||
    process.env.ASTRO_SITE_URL ||
    "http://localhost:4321"
  ).replace(/\/+$/u, "");
  const dates = await getAvailableDailyDates(archiveDir);

  if (dates.length === 0) {
    return "暂无可用的每日导读归档。";
  }

  const limit = options.limit || 12;
  const recentDates = dates.slice(0, limit);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  const lines = [
    `📅 **AstroLineage 每日前沿导读归档列表** (最近 ${recentDates.length} 期 / 共 ${dates.length} 期)`,
    "",
  ];

  for (const date of recentDates) {
    let statsStr = "";
    try {
      const bytes = await readFile(join(archiveDir, `${date}.json`), "utf8");
      const data = JSON.parse(bytes);
      const mustRead =
        data.counts?.must_read ??
        (data.radar?.groups?.must_read?.length || data.groups?.must_read?.length || 0);
      const worthKnowing =
        data.counts?.worth_knowing ??
        (data.radar?.groups?.worth_knowing?.length || data.groups?.worth_knowing?.length || 0);
      const total = data.counts?.total || data.feed?.items?.length || 0;
      statsStr = ` ｜ 必读 ${mustRead} 篇 · 关注 ${worthKnowing} 篇 (共 ${total} 篇)`;
    } catch {}

    const d = new Date(`${date}T00:00:00Z`);
    const weekday = weekdays[d.getUTCDay()];

    lines.push(
      `• **${date}** (${weekday})${statsStr}`,
      `  🔗 [网页版](${websiteBase}/arxiv-daily/${date}/) ｜ 快速查看指令：\`\\day ${date}\``
    );
  }

  lines.push(
    "",
    `💡 **使用提示**：输入 \`\\day <日期>\`（例如 \`\\day ${recentDates[0]}\` 或 \`\\day ${recentDates[0].slice(5)}\`）即可直接调出该期导读！`
  );

  return lines.join("\n");
}

/**
 * 生成前沿周报归档列表 Markdown
 */
export async function formatWeeklyList(options = {}) {
  const weeklyDir = options.weeklyDir || DEFAULT_WEEKLY_ARCHIVES_DIR;
  const websiteBase = (
    options.websiteBase ||
    process.env.SITE_BASE_URL ||
    process.env.ASTRO_SITE_URL ||
    "http://localhost:4321"
  ).replace(/\/+$/u, "");
  const weekIds = await getAvailableWeeklyIds(weeklyDir);

  if (weekIds.length === 0) {
    return "暂无可用的前沿周报归档。";
  }

  const lines = [`📊 **AstroLineage 前沿周报脉络归档列表** (共 ${weekIds.length} 期)`, ""];

  for (const [idx, weekId] of weekIds.entries()) {
    let summaryStr = "";
    try {
      const bytes = await readFile(join(weeklyDir, `${weekId}.json`), "utf8");
      const data = JSON.parse(bytes);
      const papersCount = (data.papers || []).length;
      const topPicksCount = (data.top_picks || []).length;
      const dateRange = data.date_range ? ` (${data.date_range})` : "";
      summaryStr = `${dateRange} ｜ 研读 ${papersCount} 篇 · 精读 ${topPicksCount} 篇`;
    } catch {}

    const tag = idx === 0 ? " (最新一期)" : idx === 1 ? " (上周)" : "";
    const cmdHint = idx === 0 ? "指令：`\\week`" : idx === 1 ? "指令：`\\last_week`" : "";

    lines.push(
      `• **${weekId}**${tag}${summaryStr ? ` ｜ ${summaryStr}` : ""}`,
      `  🔗 [网页精读](${websiteBase}/arxiv-weekly/${weekId}/)${cmdHint ? ` ｜ ${cmdHint}` : ""}`
    );
  }

  lines.push("", "💡 **使用提示**：输入 `\\week` 查看最新周报，输入 `\\last_week` 查看上周周报！");

  return lines.join("\n");
}

/**
 * 同步检查是否为 Bot 指令
 * @param {string} rawQuery
 * @returns {{ type: string, arg?: string, query?: string } | null}
 */
export function matchBotCommand(rawQuery) {
  if (!rawQuery || typeof rawQuery !== "string") return null;
  const query = rawQuery.trim();

  const isSlash = query.startsWith("\\") || query.startsWith("/");

  if (
    (isSlash && /^[\\/](start|help|menu|guide|id|whoami|groupid|bind)$/iu.test(query)) ||
    /^(帮助|指南|菜单|功能列表|指令列表)$/iu.test(query)
  ) {
    return { type: "start", query };
  }

  if (isSlash && /^[\\/](test|ping|test-c2c)$/iu.test(query)) {
    return { type: "test", query };
  }

  if (
    (isSlash && /^[\\/](today|daily|radar)$/iu.test(query)) ||
    /^(今日导读|今日雷达|今日|今日论文)$/iu.test(query)
  ) {
    return { type: "today", query };
  }

  if (
    (isSlash && /^[\\/](yesterday|last_day|lastday|prev_day|prevday)$/iu.test(query)) ||
    /^(昨日导读|昨天导读|上一期导读|昨日|昨天)$/iu.test(query)
  ) {
    return { type: "yesterday", query };
  }

  const dayMatch =
    query.match(/^[\\/]day(?:\s+|:|=)(.+)$/iu) || query.match(/^(?:导读|查导读)(?:\s+|:|=)(.+)$/iu);
  if (dayMatch) {
    return { type: "day", arg: dayMatch[1].trim(), query };
  }

  if (isSlash && /^[\\/]day$/iu.test(query)) {
    return { type: "day_help", query };
  }

  if (
    (isSlash && /^[\\/](week|weekly)$/iu.test(query)) ||
    /^(本周周报|周报|本周|周报综述)$/iu.test(query)
  ) {
    return { type: "week", query };
  }

  if (
    (isSlash && /^[\\/](last_week|lastweek|prev_week|prevweek)$/iu.test(query)) ||
    /^(上周周报|上一周周报|上周)$/iu.test(query)
  ) {
    return { type: "last_week", query };
  }

  if (
    (isSlash && /^[\\/](list_day|list_days|listday|listdays|days)$/iu.test(query)) ||
    /^(每日导读列表|历史导读|导读列表|历史每日)$/iu.test(query)
  ) {
    return { type: "list_day", query };
  }

  if (
    (isSlash && /^[\\/](list_week|list_weeks|listweek|listweeks|weeks)$/iu.test(query)) ||
    /^(周报列表|历史周报|周报归档)$/iu.test(query)
  ) {
    return { type: "list_week", query };
  }

  return null;
}

/**
 * 执行已匹配的 Bot 指令（同步指令返回 string，异步指令返回 Promise<string>）
 * @param {{ type: string, arg?: string, query?: string }} cmd
 * @param {Object} [options]
 * @returns {string | Promise<string>}
 */
export function executeBotCommand(cmd, options = {}) {
  const websiteBase = (
    options.websiteBase ||
    process.env.SITE_BASE_URL ||
    process.env.ASTRO_SITE_URL ||
    "http://localhost:4321"
  ).replace(/\/+$/u, "");

  // 1. 同步指令直接返回
  if (cmd.type === "start") {
    return [
      "👋 你好！我是 AstroLineage 高能天体物理前沿文献助手。",
      "",
      "📚 常规学术指令：",
      "• `\\today` (或 `/today`)：查看最新一期 arXiv 前沿导读卡片",
      "• `\\yesterday` (或 `/yesterday`)：查看上一期/昨日 arXiv 导读",
      "• `\\day <日期>` (或 `/day <日期>`)：查看指定日期导读 (例如 `\\day 10-05` 或 `\\day 2026-10-05`)",
      "• `\\week` (或 `/week`)：查看最新一期高能天体物理前沿周报",
      "• `\\last_week` (或 `/last_week`)：查看上周前沿周报",
      "• `\\list_day` (或 `/list_day`)：查看已归档的每日导读日期列表",
      "• `\\list_week` (或 `/list_week`)：查看所有已归档的周报列表",
      "• `\\start` (或 `/start`)：调出本帮助指南",
      "",
      "💬 直接发送论文题目、arXiv 编号（如 2610.05773）或物理问题（如“总结今天的必读论文”），即可开始研讨！",
    ].join("\n");
  }

  if (cmd.type === "test") {
    if (cmd.query === "/test-c2c" || cmd.query === "\\test-c2c") {
      return "[AstroLineage 测试] 收到私聊测试请求！双向连通状态：正常。";
    }
    return `[AstroLineage] 连通性测试正常！Markdown 与 LaTeX 渲染模式已就绪。输入 \`\\today\` 查看今日导读，输入 \`\\week\` 查看前沿周报。`;
  }

  // 2. 异步指令执行
  return (async () => {
    const resolveChannel = async () => {
      if (options.channelUrl) return options.channelUrl;
      if (typeof options.resolveChannelLink === "function") {
        const link = await options.resolveChannelLink();
        if (link) return link;
      }
      return await readChannelShareUrl({ url: process.env.ASTRO_CHANNEL_URL });
    };

    switch (cmd.type) {
      case "today": {
        try {
          const channelUrl = await resolveChannel();
          return await generateGroupBrief("daily", {
            format: "markdown",
            markdown: true,
            websiteBase,
            channelUrl,
          });
        } catch (err) {
          return `[AstroLineage] 获取今日导读失败: ${err.message}。可发送 \`\\list_day\` 查看历史可用导读。`;
        }
      }

      case "yesterday": {
        try {
          const dates = await getAvailableDailyDates();
          const yesterdayDate = dates.length >= 2 ? dates[1] : dates[0];
          const channelUrl = await resolveChannel();
          return await generateGroupBrief("daily", {
            date: yesterdayDate,
            format: "markdown",
            markdown: true,
            websiteBase,
            channelUrl,
          });
        } catch (err) {
          return `[AstroLineage] 获取昨日导读失败: ${err.message}。可发送 \`\\list_day\` 查看历史可用导读。`;
        }
      }

      case "day": {
        const rawDateArg = cmd.arg;
        const normalizedDate = normalizeDateInput(rawDateArg);
        if (!normalizedDate) {
          return `⚠️ 日期格式未能识别：“${rawDateArg}”。\n\n请使用标准格式，例如：\n• \`\\day 2026-10-05\`\n• \`\\day 10-05\`\n\n发送 \`\\list_day\` 可查看所有可用日期列表。`;
        }
        try {
          const dates = await getAvailableDailyDates();
          if (!dates.includes(normalizedDate)) {
            const recentSamples = dates.slice(0, 5).join(", ");
            return `ℹ️ 未找到 **${normalizedDate}** 的导读归档（可能为 arXiv 官方周末/休刊日）。\n\n📌 最近可用日期：${recentSamples}\n发送 \`\\list_day\` 查看完整日期列表。`;
          }
          const channelUrl = await resolveChannel();
          return await generateGroupBrief("daily", {
            date: normalizedDate,
            format: "markdown",
            markdown: true,
            websiteBase,
            channelUrl,
          });
        } catch (err) {
          return `[AstroLineage] 获取 ${normalizedDate} 导读失败: ${err.message}`;
        }
      }

      case "day_help": {
        const dates = await getAvailableDailyDates();
        const sample = dates[0] || "2026-10-05";
        return `请指定查询日期，例如：\n• \`\\day ${sample}\`\n• \`\\day ${sample.slice(5)}\`\n\n发送 \`\\list_day\` 可查看所有可用日期列表。`;
      }

      case "week": {
        try {
          const weekIds = await getAvailableWeeklyIds();
          let weeklyData;
          if (weekIds.length > 0) {
            const latestWeekId = weekIds[0];
            const weeklyPath = join(DEFAULT_WEEKLY_ARCHIVES_DIR, `${latestWeekId}.json`);
            const bytes = await readFile(weeklyPath, "utf8");
            weeklyData = JSON.parse(bytes);
          }
          const channelUrl = await resolveChannel();
          return await generateGroupBrief("weekly", {
            weekly: weeklyData,
            format: "markdown",
            markdown: true,
            websiteBase,
            channelUrl,
          });
        } catch (err) {
          return `[AstroLineage] 获取本周周报失败: ${err.message}。可发送 \`\\list_week\` 查看所有周报。`;
        }
      }

      case "last_week": {
        try {
          const weekIds = await getAvailableWeeklyIds();
          let weeklyData;
          if (weekIds.length >= 2) {
            const lastWeekId = weekIds[1];
            const weeklyPath = join(DEFAULT_WEEKLY_ARCHIVES_DIR, `${lastWeekId}.json`);
            const bytes = await readFile(weeklyPath, "utf8");
            weeklyData = JSON.parse(bytes);
          }
          const channelUrl = await resolveChannel();
          return await generateGroupBrief("weekly", {
            weekly: weeklyData,
            format: "markdown",
            markdown: true,
            websiteBase,
            channelUrl,
          });
        } catch (err) {
          return `[AstroLineage] 获取上周周报失败: ${err.message}。可发送 \`\\list_week\` 查看所有周报。`;
        }
      }

      case "list_day": {
        try {
          return await formatDailyList({ websiteBase });
        } catch (err) {
          return `[AstroLineage] 获取导读列表失败: ${err.message}`;
        }
      }

      case "list_week": {
        try {
          return await formatWeeklyList({ websiteBase });
        } catch (err) {
          return `[AstroLineage] 获取周报列表失败: ${err.message}`;
        }
      }

      default:
        return "";
    }
  })();
}

/**
 * 完整指令解析与执行
 * @param {string} rawQuery 用户提问内容
 * @param {Object} [options]
 * @returns {Promise<{ matched: boolean, replyText?: string }>}
 */
export async function handleBotCommand(rawQuery, options = {}) {
  const cmd = matchBotCommand(rawQuery);
  if (!cmd) return { matched: false };
  const res = executeBotCommand(cmd, options);
  const replyText = typeof res?.then === "function" ? await res : res;
  return { matched: true, replyText };
}
