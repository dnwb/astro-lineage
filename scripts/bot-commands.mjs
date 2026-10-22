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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { generateGroupBrief } from "./qq-send.mjs";
import { readChannelShareUrl } from "./channel-publication.mjs";
import {
  formatAnnouncementInBeijing,
  getBeijingDateString,
  getBeijingWeekId,
  getPreviousAcademicWeekId,
  formatWeekIdZh,
  sanitizeWebsiteBase,
  getDefaultWebsiteBase,
  getDefaultLocalWebsiteBase,
  resolveWebsiteUrls,
} from "../src/domain/academic-domain.mjs";
import { generateWeeklyPdf } from "./weekly-pdf.mjs";

const DEFAULT_DAILY_ARCHIVES_DIR = fileURLToPath(
  new URL("../src/data/arxiv-archives/daily", import.meta.url)
);
const DEFAULT_WEEKLY_ARCHIVES_DIR = fileURLToPath(
  new URL("../src/data/arxiv-archives/weekly", import.meta.url)
);

/**
 * 根据指定 weekId 或 offset 解析目标周报编号
 * @param {string[]} weekIds
 * @param {Object} [options]
 * @param {string} [options.weekId]
 * @param {number} [options.offset=0]
 * @param {string} [options.currentWeekId]
 * @returns {string | null}
 */
export function resolveTargetWeekId(
  weekIds,
  { weekId, offset = 0, currentWeekId = getBeijingWeekId() } = {}
) {
  if (weekId) return weekId;
  if (!weekIds || weekIds.length === 0) return null;
  if (weekIds.includes(currentWeekId)) {
    const idx = weekIds.indexOf(currentWeekId);
    return weekIds[idx + offset] || weekIds.at(-1);
  }
  return weekIds[offset] || weekIds.at(-1);
}

if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
  try {
    process.loadEnvFile();
  } catch {}
}

/**
 * 规整用户输入的日期字符串为 YYYY-MM-DD
 * 支持格式：
 *   YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
 *   YYYYMMDD
 *   MM-DD, MM/DD, MM.DD, MM月DD日
 */
export function normalizeDateInput(
  rawDate,
  defaultYear = parseInt(getBeijingDateString().slice(0, 4), 10)
) {
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
  const { publicBase: websiteBase, localBase: localWebsiteBase } = resolveWebsiteUrls(options);
  const dates = await getAvailableDailyDates(archiveDir);

  if (dates.length === 0) {
    return "暂无可用的每日导读归档。";
  }

  const limit = options.limit || 12;
  const recentDates = dates.slice(0, limit);

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

    const weekday = formatAnnouncementInBeijing(date).chineseWeekday;

    lines.push(
      `• **${date}** (${weekday})${statsStr}`,
      `  🔗 [公网阅读](${websiteBase}/arxiv-daily/${date}/) ｜ [校内直连](${localWebsiteBase}/arxiv-daily/${date}/) ｜ 指令：\`\\day ${date}\``
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
  const { publicBase: websiteBase, localBase: localWebsiteBase } = resolveWebsiteUrls(options);
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

    const weekZh = formatWeekIdZh(weekId);
    const weekDisplay = weekZh ? `${weekZh} (${weekId})` : weekId;
    const tag = idx === 0 ? " (最新一期)" : idx === 1 ? " (上周)" : "";
    const cmdHint = idx === 0 ? "指令：`\\week`" : idx === 1 ? "指令：`\\last_week`" : "";

    lines.push(
      `• **${weekDisplay}**${tag}${summaryStr ? ` ｜ ${summaryStr}` : ""}`,
      `  🔗 [公网精读](${websiteBase}/arxiv-weekly/${weekId}/) ｜ [校内直连](${localWebsiteBase}/arxiv-weekly/${weekId}/)${cmdHint ? ` ｜ ${cmdHint}` : ""}`
    );
  }

  lines.push("", "💡 **使用提示**：输入 `\\week` 查看最新周报，输入 `\\last_week` 查看上周周报！");

  return lines.join("\n");
}

/**
 * 辅助函数：根据周号或回退索引获取并格式化学术周报简报
 */
async function resolveAndFormatWeeklyBrief({
  weekId,
  offset = 0,
  label,
  resolveChannel,
  websiteBase,
}) {
  try {
    const weekIds = await getAvailableWeeklyIds();
    const targetWeekId = resolveTargetWeekId(weekIds, { weekId, offset });
    let weeklyData;
    if (targetWeekId) {
      const weeklyPath = join(DEFAULT_WEEKLY_ARCHIVES_DIR, `${targetWeekId}.json`);
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
      interactive: true,
    });
  } catch (err) {
    return `[AstroLineage] 获取${label}失败: ${err.message}。可发送 \`\\list_week\` 查看所有周报。`;
  }
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

  // 1.1 \site, /site, \url, /url, 网站, 公网地址, 部署地址
  if (
    (isSlash && /^[\\/](site|url|website|link|web)$/iu.test(query)) ||
    /^(?:网站|公网|部署|主站|官网|网页|知识库)(?:地址|链接|入口|网址|在哪|哪里)?$/iu.test(query) ||
    /^(?:网址|链接|入口|主页|公网地址|网站地址|网页地址|知识库地址)$/iu.test(query)
  ) {
    return { type: "site", query };
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

  // 5. \list_day
  if (
    (isSlash && /^[\\/](list_day|list_days|listday|listdays|days)$/iu.test(query)) ||
    /^(每日导读列表|历史导读|导读列表|历史每日)$/iu.test(query)
  ) {
    return { type: "list_day", query };
  }

  // 6. \list_week
  if (
    (isSlash && /^[\\/](list_week|list_weeks|listweek|listweeks|weeks)$/iu.test(query)) ||
    /^(周报列表|历史周报|周报归档)$/iu.test(query)
  ) {
    return { type: "list_week", query };
  }

  // 7. \last_week / \last_week pdf / 上周周报 pdf
  const lastWeekSlash =
    isSlash && query.match(/^[\\/](?:last_week|lastweek|prev_week|prevweek)(?:\s+(.+))?$/iu);
  const lastWeekZh =
    query.match(/^(?:上周周报|上一周周报|上周)(?:\s+(.+))?$/iu) ||
    query.match(/^(?:上周周报|上一周周报|上周)pdf$/iu);
  const matchLast = lastWeekSlash || lastWeekZh;
  if (matchLast) {
    const rest = (matchLast[1] || (/pdf$/iu.test(query) ? "pdf" : "")).trim();
    if (/pdf/iu.test(rest)) {
      return { type: "week_pdf", offset: 1, query };
    }
    if (!rest) {
      return { type: "last_week", query };
    }
  }

  // 8. \week / \week pdf / 周报 pdf / \week <weekId>
  const weekSlash = isSlash && query.match(/^[\\/](?:week|weekly)(?:\s+(.+))?$/iu);
  const weekZh =
    query.match(/^(?:本周周报|周报|本周|周报综述)(?:\s+(.+))?$/iu) ||
    query.match(/^(?:本周周报|周报|本周|周报综述)pdf$/iu);
  const matchWeek = weekSlash || weekZh;
  if (matchWeek) {
    const rest = (matchWeek[1] || (/pdf$/iu.test(query) ? "pdf" : "")).trim();
    if (/pdf/iu.test(rest)) {
      const widMatch = rest.match(/(\d{4}-W\d{1,2})/iu);
      return {
        type: "week_pdf",
        arg: widMatch ? widMatch[1].toUpperCase() : null,
        offset: 0,
        query,
      };
    }
    if (rest) {
      const widMatch = rest.match(/^(\d{4}-W\d{1,2})$/iu);
      if (widMatch) {
        return { type: "week", arg: widMatch[1].toUpperCase(), offset: 0, query };
      }
    }
    return { type: "week", query };
  }

  return null;
}

/**
 * 执行已匹配的 Bot 指令（同步指令返回 string，异步指令返回 Promise<string>）
 * @param {{ type: string, arg?: string, query?: string }} cmd
 * @param {Object} [options]
 * @returns {string | Promise<string>}
 */
export async function executeBotCommand(cmd, options = {}) {
  const websiteBase = sanitizeWebsiteBase(options.websiteBase || getDefaultWebsiteBase());

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
      "• `\\week pdf` (或 `/week pdf`)：获取周报完整精读 PDF（含完整高清图表与超链接）",
      "• `\\last_week` (或 `/last_week`)：查看上周前沿周报 (亦支持 `\\last_week pdf`)",
      "• `\\list_day` (或 `/list_day`)：查看已归档的每日导读日期列表",
      "• `\\list_week` (或 `/list_week`)：查看所有已归档的周报列表",
      "• `\\start` (或 `/start`)：调出本帮助指南",
      "• `\\site` (或 `/site`、`网址`)：查看前沿知识库公网地址与校内直连入口",
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
  const resolveChannel = async () => {
    if (options.channelUrl) return options.channelUrl;
    if (typeof options.resolveChannelLink === "function") {
      const link = await options.resolveChannelLink();
      if (link) return link;
    }
    const url = await readChannelShareUrl({ url: process.env.ASTRO_CHANNEL_URL });
    return url || "https://pd.qq.com/s/d4lw4zl0g";
  };

  switch (cmd.type) {
    case "site": {
      const urls = resolveWebsiteUrls(options);
      const channelUrl = await resolveChannel();
      return [
        `🌐 **AstroLineage 前沿学术知识库入口**`,
        "",
        `• **公网在线阅读 (Cloudflare Pages)**：`,
        `  ${urls.publicBase}/`,
        "",
        `• **校内/局域网直连 (实验室服务器)**：`,
        `  ${urls.localBase}/`,
        "",
        `📚 **板块直达**：`,
        `• 每日导读 (Daily)：${urls.publicBase}/arxiv-daily/ (校内：${urls.localBase}/arxiv-daily/)`,
        `• 前沿周报 (Weekly)：${urls.publicBase}/arxiv-weekly/ (校内：${urls.localBase}/arxiv-weekly/)`,
        channelUrl ? `• QQ 频道学术讨论帖：${channelUrl}` : "",
        "",
        `💡 **访问建议**：校外及移动端建议访问公网在线地址（Cloudflare 全球 CDN 加速）；校内或连接 VPN 建议访问校内直连（支持周报 PDF 完整报告极速下载）。`,
      ]
        .filter((line) => line !== null && line !== undefined)
        .join("\n");
    }

    case "today": {
      try {
        const channelUrl = await resolveChannel();
        return await generateGroupBrief("daily", {
          format: "markdown",
          markdown: true,
          websiteBase,
          channelUrl,
          interactive: true,
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
          interactive: true,
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
          interactive: true,
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
      if (cmd.arg) {
        return await resolveAndFormatWeeklyBrief({
          weekId: cmd.arg,
          label: `周报 ${cmd.arg}`,
          resolveChannel,
          websiteBase,
        });
      }
      return await resolveAndFormatWeeklyBrief({
        offset: 0,
        label: "本周周报",
        resolveChannel,
        websiteBase,
      });
    }

    case "last_week": {
      return await resolveAndFormatWeeklyBrief({
        offset: 1,
        label: "上周周报",
        resolveChannel,
        websiteBase,
      });
    }

    case "week_pdf": {
      try {
        const weekIds = await getAvailableWeeklyIds();
        if (weekIds.length === 0) {
          return "[AstroLineage] 当前暂无已归档周报。";
        }
        const targetWeekId = resolveTargetWeekId(weekIds, {
          weekId: cmd.arg,
          offset: cmd.offset || 0,
        });

        const weeklyPath = join(DEFAULT_WEEKLY_ARCHIVES_DIR, `${targetWeekId}.json`);
        if (!existsSync(weeklyPath)) {
          return `ℹ️ 未找到周报 **${targetWeekId}** 归档。可发送 \`\\list_week\` 查看已归档周报列表。`;
        }

        const weeklyBytes = await readFile(weeklyPath, "utf8");
        const weeklyData = JSON.parse(weeklyBytes);
        const paperCount = weeklyData.papers?.length ?? weeklyData.top_picks?.length ?? 0;

        let synthesisClaim = "";
        if (typeof weeklyData.executive_summary === "string") {
          const summaryLines = weeklyData.executive_summary
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          if (summaryLines.length > 0) {
            synthesisClaim = summaryLines[0].replace(/^[#*\s-]+/u, "").slice(0, 150);
          }
        }

        const pdfBase = sanitizeWebsiteBase(options.websiteBase || getDefaultLocalWebsiteBase());
        const pdfResult = await generateWeeklyPdf({
          weekId: targetWeekId,
          websiteBase: pdfBase,
          publicDir: options.publicDir,
          distDir: options.distDir,
        });

        const channelUrl = await resolveChannel();
        const formattedSize = pdfResult.fileSize
          ? (pdfResult.fileSize / (1024 * 1024)).toFixed(1) + " MB"
          : "已生成";

        const weekZh = formatWeekIdZh(targetWeekId);
        const weekDisplay = weekZh ? `${weekZh} (${targetWeekId})` : targetWeekId;

        return [
          `📄 **AstroLineage 前沿学术周报 · ${weekDisplay} PDF 精读版**`,
          "",
          synthesisClaim ? `💡 **核心脉络研判**：\n${synthesisClaim}\n` : "",
          `🌐 **周报网页在线精读入口**：`,
          `- 公网在线 (Cloudflare)：${websiteBase}/arxiv-weekly/${targetWeekId}/`,
          `- 校内直连 (局域网)：${getDefaultLocalWebsiteBase()}/arxiv-weekly/${targetWeekId}/`,
          "",
          `📥 **PDF 完整报告下载**（含论文高清切图与原文超链接）：`,
          `- 校内/局域网直连下载：${pdfResult.pdfUrl}`,
          `（注：PDF 由校内工作站实时渲染托管；外网访问请连接校园网/VPN或在网页端直接在线精读）`,
          "",
          channelUrl ? `💬 **QQ 频道学术讨论帖**：\n${channelUrl}\n` : "",
          `📊 **报告概览**：共研读 ${paperCount} 篇文献 ｜ 文件大小：${formattedSize} ｜ 包含完整学术图表与原文引用链接`,
          "",
          `💡 **使用提示**：网页端支持在线精读与一键下载 PDF；输入 \`\\week\` 可在聊天中查看纯文字版。`,
        ]
          .filter((line) => line !== null && line !== undefined)
          .join("\n");
      } catch (err) {
        return `[AstroLineage] 获取周报 PDF 失败: ${err.message}。可发送 \`\\week\` 在线阅读本期周报。`;
      }
    }

    case "list_day": {
      try {
        const channelUrl = await resolveChannel();
        return await formatDailyList({ websiteBase, channelUrl });
      } catch (err) {
        return `[AstroLineage] 获取导读列表失败: ${err.message}`;
      }
    }

    case "list_week": {
      try {
        const channelUrl = await resolveChannel();
        return await formatWeeklyList({ websiteBase, channelUrl });
      } catch (err) {
        return `[AstroLineage] 获取周报列表失败: ${err.message}`;
      }
    }

    default:
      return "";
  }
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
  const replyText = await executeBotCommand(cmd, options);
  return { matched: true, replyText };
}
