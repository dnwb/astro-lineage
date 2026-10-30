#!/usr/bin/env node
/**
 * AstroLineage 每周学术脉络 PDF 报告生成引擎
 *
 * 功能规范：
 *   1. 独立学术出版物紧凑排版（非网页直接截图），专为学术研读与存档设计。
 *   2. 双轨内容展现：
 *      - ⭐ 核心必读（must_read）：全面展开精读内容（科学问题、观测与研究方法、物理模型与假设、核心学术切图与图注、关键结论与定量测量、局限性、阅读切入）。
 *      - 📌 重点关注（worth_knowing）：两列紧凑条目呈现，不展开精读详情，保持版面高效聚焦。
 *   3. 静态数学公式与 Markdown 全面渲染：
 *      - 基于 KaTeX 与 micromark 深度结合，将行内公式（$...$）与块级公式（$$...$$）编译为矢量 MathML 与 HTML。
 *      - 注入本地 KaTeX 字体样式，彻底消灭未渲染的 LaTeX 源码与裸 Markdown 标记。
 *   4. 严禁 localhost 泄露：基于环境变量与局域网主机构建规范可访问网址（默认 http://10.131.43.83:4321）。
 *   5. 自动解析双语文献标题（规范化中文译名 + 英文原题），保留所有 arXiv 原文与网站超链接（矢量可点击）。
 *   6. 切图全量转换为 Base64 内嵌 Data URI，保障完全离线可读与图表完整性。
 *   7. 同步生成对应 Markdown 报告（weekly-${weekId}.md），支持纯文本查阅与后续二次编译。
 *   8. 调用无头 Chromium 输出高质量 A4 PDF，部署至 public/ 与 dist/。
 */

import { readFile, writeFile, mkdir, stat, unlink, copyFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolvePaperTitleZhSync } from "../src/domain/paper-translation.mjs";
import {
  formatWeekIdZh,
  sanitizeWebsiteBase,
  getDefaultWebsiteBase,
  getBibliographicUrl,
  getBibliographicSourceName,
  deriveFigurePhysicalCore,
  groupPicksByTheme,
} from "../src/domain/academic-domain.mjs";
import {
  tokenizeScientificText,
  expandAstrophysicsMacros,
  escapeHtml,
  renderScientificMarkdownWithMath as renderMarkdownWithMath,
  renderInlineScientificMarkdownWithMath as renderInlineMarkdownWithMath,
} from "../src/domain/scientific-text/index.mjs";

export { renderMarkdownWithMath, renderInlineMarkdownWithMath };

if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
  try {
    process.loadEnvFile();
  } catch {}
}

const DEFAULT_DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));
const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
const DEFAULT_WEEKLY_ARCHIVES_DIR = fileURLToPath(
  new URL("../src/data/arxiv-archives/weekly", import.meta.url)
);
const DEFAULT_DAILY_ARCHIVES_DIR = fileURLToPath(
  new URL("../src/data/arxiv-archives/daily", import.meta.url)
);
const KATEX_DIST_DIR = fileURLToPath(new URL("../node_modules/katex/dist", import.meta.url));

/**
 * 探测系统中可用的 Chromium / Chrome 二进制程序路径
 * @returns {string | null}
 */
export function findChromiumPath() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * 读取并重写 KaTeX 样式表，使其直接引用本地文件字体
 * @returns {string}
 */
export function loadKatexPrintCss() {
  const cssPath = join(KATEX_DIST_DIR, "katex.min.css");
  if (!existsSync(cssPath)) return "";
  const css = readFileSync(cssPath, "utf8");
  const fontsDir = join(KATEX_DIST_DIR, "fonts");
  return css.replaceAll("url(fonts/", `url(file://${fontsDir}/`);
}

/**
 * 载入指定周报及全部每日雷达精读索引
 * @param {Object} options
 * @param {string} options.weekId
 * @param {string} [options.archiveDir]
 * @param {string} [options.dailyArchiveDir]
 * @returns {Promise<{ weeklyData: any, dailyAnalysisMap: Map<string, any>, dailyEntryMap: Map<string, any> }>}
 */
export async function loadWeeklyAndDailyData({
  weekId,
  archiveDir = DEFAULT_WEEKLY_ARCHIVES_DIR,
  dailyArchiveDir = DEFAULT_DAILY_ARCHIVES_DIR,
}) {
  const jsonPath = join(archiveDir, `${weekId}.json`);
  if (!existsSync(jsonPath)) {
    throw new Error(`周报归档数据不存在: ${weekId} (${jsonPath})`);
  }
  const bytes = await readFile(jsonPath, "utf8");
  const weeklyData = JSON.parse(bytes);

  const dailyAnalysisMap = new Map();
  const dailyEntryMap = new Map();

  if (existsSync(dailyArchiveDir)) {
    const files = await readdir(dailyArchiveDir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const dBytes = await readFile(join(dailyArchiveDir, f), "utf8");
        const dData = JSON.parse(dBytes);
        for (const entry of dData.feed?.entries || []) {
          if (entry.arxiv_id) dailyEntryMap.set(entry.arxiv_id, entry);
        }
        for (const a of dData.radar?.analyses || []) {
          if (a.arxiv_id) dailyAnalysisMap.set(a.arxiv_id, a);
        }
      } catch {
        // 容错单个日常归档解析异常
      }
    }
  }

  return { weeklyData, dailyAnalysisMap, dailyEntryMap };
}

/**
 * 汇总全周所有重点关注（worth_knowing）文献：
 * 优先保留模型选出的 top_picks 重点关注条目（置顶），随后包含全周其余所有 worth_knowing 论文
 * @param {Object} weeklyData
 * @param {Map<string, any>} dailyAnalysisMap
 * @returns {Array<Object>}
 */
export function collectWorthKnowingPapers(weeklyData, dailyAnalysisMap = new Map()) {
  const topPicks = weeklyData.top_picks || [];
  const topWorths = topPicks.filter((p) => p.priority !== "must_read");
  const seen = new Set();
  const list = [];

  // 1. 精选 top_picks 重点关注（保持原有精选顺序，置顶展示）
  for (const p of topWorths) {
    if (!p.arxiv_id || seen.has(p.arxiv_id)) continue;
    seen.add(p.arxiv_id);
    list.push({
      ...p,
      isTopPick: true,
      recommendation_reason: p.recommendation_reason || p.reason || "",
      core_insight: p.core_insight || p.result || "",
      reading_guide: p.reading_guide || "",
    });
  }

  // 2. 纳入 weeklyData.papers 中全周所有的 worth_knowing 论文
  const allPapers = weeklyData.papers || [];
  const otherWorths = allPapers.filter(
    (p) => p.priority === "worth_knowing" && !seen.has(p.arxiv_id)
  );

  // 按发布/公布日期或 arXiv ID 逆序排列
  otherWorths.sort((a, b) => {
    const da = a.announcement_date || "";
    const db = b.announcement_date || "";
    if (da !== db) return db.localeCompare(da);
    return (b.arxiv_id || "").localeCompare(a.arxiv_id || "");
  });

  for (const p of otherWorths) {
    if (seen.has(p.arxiv_id)) continue;
    seen.add(p.arxiv_id);
    const dailyA = dailyAnalysisMap.get(p.arxiv_id);
    const reason =
      p.recommendation_reason || p.reason || dailyA?.reason || dailyA?.analysis?.reason || "";
    const coreInsight =
      p.core_insight || p.result || dailyA?.result || dailyA?.analysis?.result || "";
    const readingGuide =
      p.reading_guide ||
      p.reading_entry ||
      dailyA?.reading_entry ||
      dailyA?.analysis?.reading_entry ||
      "";

    list.push({
      ...p,
      isTopPick: false,
      recommendation_reason: reason,
      core_insight: coreInsight,
      reading_guide: readingGuide,
    });
  }

  return list;
}

/**
 * 解析并生成本期周报的结构化学术 Markdown 文档
 * @param {Object} options
 * @returns {Promise<string>}
 */
export async function generateWeeklyMarkdownDocument({
  weekId,
  websiteBase = getDefaultWebsiteBase(),
  archiveDir = DEFAULT_WEEKLY_ARCHIVES_DIR,
  dailyArchiveDir = DEFAULT_DAILY_ARCHIVES_DIR,
}) {
  const { weeklyData, dailyAnalysisMap, dailyEntryMap } = await loadWeeklyAndDailyData({
    weekId,
    archiveDir,
    dailyArchiveDir,
  });

  const base = sanitizeWebsiteBase(websiteBase);
  const dateRange = weeklyData.date_range || "";
  const topPicks = weeklyData.top_picks || [];
  const mustReads = topPicks.filter((p) => p.priority === "must_read");
  const worths = collectWorthKnowingPapers(weeklyData, dailyAnalysisMap);

  const weekZh = formatWeekIdZh(weekId);
  const weekLabel = weekZh ? `${weekZh} (${weekId})` : weekId;

  const lines = [];

  // Frontmatter & Header
  lines.push(`# 高能天体物理 arXiv 每周学术脉络 · ${weekLabel}`);
  lines.push(
    `> 报告周期：${weekLabel} ｜ 时间跨度：${dateRange} ｜ 纳入研读：${mustReads.length} 篇必读，${worths.length} 篇重点关注`
  );
  lines.push(`> 在线精读入口：${base}/arxiv-weekly/${weekId}/`);
  lines.push("");

  // 1. 本周精选一页速览（Quick Triage Matrix：标题 + 核心结论 + 主图 + 超链接）
  lines.push(`## ★ 本周精选速览矩阵 (At-a-Glance Visual Triage · 共 ${topPicks.length} 篇)`);
  lines.push(
    "以下矩阵汇总本周全部核心必读与特选关注论文的核心结论（Key Insight）、主图与原文/PDF直达链接，供 1 分钟快速判断是否深入阅读。\n"
  );
  for (let i = 0; i < topPicks.length; i++) {
    const p = topPicks[i];
    const aid = p.arxiv_id;
    const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
    const titleEn = p.title || aid;
    const tierBadge = p.priority === "must_read" ? "⭐ 必读" : "📌 关注";
    const dailyRec = dailyAnalysisMap.get(aid);
    const dailyA = dailyRec?.analysis?.analysis || dailyRec?.analysis || {};
    const figs = p.figures || dailyA.figures || [];
    const primaryFig = Array.isArray(figs) && figs.length > 0 ? figs[0] : null;
    const insight = p.core_insight || dailyA.result || p.recommendation_reason || "无";
    lines.push(
      `- **${String(i + 1).padStart(2, "0")}. [${tierBadge}] [arXiv:${aid}](https://arxiv.org/abs/${aid}) ${titleZh}**（*${titleEn}*）`
    );
    lines.push(`  - **Key Insight**：${insight}`);
    lines.push(
      `  - **直达链接**：[arXiv 摘要](https://arxiv.org/abs/${aid}) ｜ [PDF 原文](https://arxiv.org/pdf/${aid}) ｜ [${getBibliographicSourceName()}](${getBibliographicUrl(aid)}) ｜ [站内精读](${base}/arxiv-weekly/${weekId}/#paper-${aid})`
    );
    if (primaryFig?.url) {
      const figUrl = primaryFig.url.startsWith("http")
        ? primaryFig.url
        : `${base}${primaryFig.url}`;
      const figLabel = primaryFig.label || "Fig. 1";
      const figCore =
        deriveFigurePhysicalCore(primaryFig, { result: insight, title: titleEn }) || "";
      lines.push(`  - **核心图表 (${figLabel})**：![${figLabel}](${figUrl}) ${figCore}`);
    }
  }
  lines.push("");

  // 1. 本周综述（将 arXiv:XXXX.XXXXX 转化为站内精读锚点跳转链接）
  lines.push("## 1. 本周综述与宏观脉络");
  const rawExecMd = weeklyData.executive_summary || "暂无本周综述。";
  const linkedExecMd = rawExecMd.replace(
    /\barXiv:(\d{4}\.\d{4,5})\b/g,
    (_, id) => `[arXiv:${id} ↓](${base}/arxiv-weekly/${weekId}/#paper-${id})`
  );
  lines.push(linkedExecMd);
  lines.push("");

  // 2. ⭐ 核心必读精选解读（按专题分组展开全部精读细节）
  lines.push("## 2. ⭐ 核心必读文献深度解析 (Must-Read In-Depth Deep Dives · 按专题分组)");
  lines.push("本节精选最具物理突破、观测约束或模型创新的论文，按研究专题顺序展开完整精读细节。");
  lines.push("");

  const mustReadThemeGroups = groupPicksByTheme(mustReads, weeklyData);
  for (let gIdx = 0; gIdx < mustReadThemeGroups.length; gIdx++) {
    const group = mustReadThemeGroups[gIdx];
    lines.push(`### 🧭 专题 0${gIdx + 1}：${group.theme}`);
    if (group.description) {
      lines.push(`> ${group.description}\n`);
    }
    for (const p of group.picks) {
      const aid = p.arxiv_id;
      const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
      const titleEn = p.title || aid;
      const feed = dailyEntryMap.get(aid);
      const authors = (p.authors && p.authors.length > 0 ? p.authors : feed?.authors) || [];
      const authorStr = authors.slice(0, 5).join(", ") + (authors.length > 5 ? " 等" : "");
      const dailyA = dailyAnalysisMap.get(aid)?.analysis || {};

      lines.push(`#### [arXiv:${aid}](https://arxiv.org/abs/${aid}) ${titleZh}`);
      lines.push(`- **英文原题**：${titleEn}`);
      lines.push(`- **作者**：${authorStr}`);
      lines.push(
        `- **文献链接**：[arXiv 原文](https://arxiv.org/abs/${aid}) ｜ [${getBibliographicSourceName()}](${getBibliographicUrl(aid)}) ｜ [在线精读](${base}/arxiv-weekly/${weekId}/#paper-${aid})`
      );
      lines.push(`- **推荐理由**：${p.recommendation_reason || "无"}`);
      lines.push(`- **核心突破**：${p.core_insight || "无"}`);
      lines.push("");

      if (dailyA.problem) {
        lines.push(`##### 科学问题\n\n${dailyA.problem}\n`);
      }
      if (dailyA.method) {
        lines.push(`##### 观测与研究方法\n\n${dailyA.method}\n`);
      }
      if (dailyA.assumptions) {
        const ass = dailyA.assumptions;
        lines.push("##### 物理模型与关键假设\n");
        if (Array.isArray(ass)) {
          for (const item of ass) lines.push(`- ${item}`);
        } else {
          lines.push(String(ass));
        }
        lines.push("");
      }
      if (Array.isArray(dailyA.figures) && dailyA.figures.length > 0) {
        lines.push("##### 核心学术图表\n");
        for (let fIdx = 0; fIdx < dailyA.figures.length; fIdx++) {
          const fig = dailyA.figures[fIdx];
          const label = fig.label || `图 ${fIdx + 1}`;
          const badge = fig.category_badge ? ` (${fig.category_badge})` : "";
          const cleanCaption = fig.caption ? fig.caption.replace(/[\r\n]+/gu, " ") : "";
          const imgUrl = fig.url?.startsWith("http") ? fig.url : `${base}${fig.url || ""}`;
          lines.push(`![${label}${badge}](${imgUrl})`);
          if (cleanCaption) lines.push(`*${label}${badge}：${cleanCaption}*\n`);
        }
      }
      if (dailyA.result) {
        lines.push(`##### 关键结论与定量测量\n\n${dailyA.result}\n`);
      }
      if (dailyA.limits) {
        const lims = dailyA.limits;
        lines.push("##### 局限性与观测边界\n");
        if (Array.isArray(lims)) {
          for (const item of lims) lines.push(`- ${item}`);
        } else {
          lines.push(String(lims));
        }
        lines.push("");
      }
      if (p.reading_guide || dailyA.reading_entry) {
        lines.push(`##### 建议精读切入点\n\n${p.reading_guide || dailyA.reading_entry}\n`);
      }
      lines.push("---\n");
    }
  }

  // 3. 📌 本周重点关注文献（全量紧凑条目，精读不展开）
  lines.push(`## 3. 📌 本周重点关注文献 (Worth-Knowing Selected Works · 共 ${worths.length} 篇)`);
  lines.push(
    "以下文献针对特定机制或子方向提供重要观测线索与实测约束，保持精炼条目，不展开精读详情。\n"
  );

  for (const p of worths) {
    const aid = p.arxiv_id;
    const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
    const titleEn = p.title || aid;
    const feed = dailyEntryMap.get(aid);
    const authors = (p.authors && p.authors.length > 0 ? p.authors : feed?.authors) || [];
    const authorStr = authors.slice(0, 3).join(", ") + (authors.length > 3 ? " 等" : "");
    const pickBadge = p.isTopPick ? " [⭐ 重点关注]" : "";

    lines.push(`### [arXiv:${aid}](https://arxiv.org/abs/${aid}) ${titleZh}${pickBadge}`);
    lines.push(`- **英文原题**：${titleEn}`);
    lines.push(`- **作者**：${authorStr}`);
    if (p.recommendation_reason) {
      lines.push(`- **推荐理由**：${p.recommendation_reason}`);
    }
    if (p.core_insight) {
      lines.push(`- **核心要点**：${p.core_insight}`);
    }
    if (p.reading_guide) {
      lines.push(`- **阅读切入**：${p.reading_guide}`);
    }
    lines.push("");
  }

  lines.push(
    `---\n*AstroLineage 前沿学术雷达 · 报告自动编译生成 ｜ 包含 ${mustReads.length + worths.length} 篇精读文献*`
  );

  return lines.join("\n");
}

/**
 * 将本地图片转换为 Base64 Data URI
 * @param {string} src
 * @param {string[]} searchDirs
 * @returns {string}
 */
export function resolveImageBase64(src, searchDirs) {
  if (!src) return "";
  if (src.startsWith("data:")) return src;

  const cleanSrc = src.replace(/^\/+/u, "");
  for (const d of searchDirs) {
    const candidate = join(d, cleanSrc);
    if (existsSync(candidate)) {
      try {
        const bytes = readFileSync(candidate);
        const b64 = bytes.toString("base64");
        const ext = extname(candidate).replace(".", "").toLowerCase();
        const mime =
          ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "svg"
              ? "image/svg+xml"
              : "image/png";
        return `data:${mime};base64,{b64}`.replace("{b64}", b64);
      } catch {
        // 继续回退
      }
    }
  }
  return src;
}

/**
 * 生成专用学术出版物紧凑排版的周报 HTML
 * @param {Object} options
 * @returns {Promise<string>}
 */
export async function generatePublicationWeeklyHtml({
  weekId,
  websiteBase = getDefaultWebsiteBase(),
  distDir = DEFAULT_DIST_DIR,
  publicDir = DEFAULT_PUBLIC_DIR,
  archiveDir = DEFAULT_WEEKLY_ARCHIVES_DIR,
  dailyArchiveDir = DEFAULT_DAILY_ARCHIVES_DIR,
}) {
  const { weeklyData, dailyAnalysisMap, dailyEntryMap } = await loadWeeklyAndDailyData({
    weekId,
    archiveDir,
    dailyArchiveDir,
  });

  const base = sanitizeWebsiteBase(websiteBase);
  const dateRange = weeklyData.date_range || "";
  const topPicks = weeklyData.top_picks || [];
  const mustReads = topPicks.filter((p) => p.priority === "must_read");
  const worths = collectWorthKnowingPapers(weeklyData, dailyAnalysisMap);
  const weekZh = formatWeekIdZh(weekId);
  const weekLabel = weekZh ? `${weekZh} (${weekId})` : weekId;
  const searchDirs = [publicDir, distDir, resolve(".")];
  const katexCss = loadKatexPrintCss();

  const html = [];
  html.push(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>高能天体物理 arXiv 每周学术脉络 · ${weekLabel} | AstroLineage</title>
  <style>
    ${katexCss}

    @page {
      size: A4;
      margin: 10mm 10mm 10mm 10mm;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Source Han Sans CN", "Noto Sans CJK SC", Arial, sans-serif;
      line-height: 1.42;
      color: #0f172a;
      background: #ffffff;
      font-size: 8.4pt;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    a {
      color: #0284c7;
      text-decoration: underline;
    }
    .katex {
      font-size: 1.02em;
      text-rendering: auto;
    }
    .katex-display {
      margin: 4px 0;
      overflow-x: auto;
      overflow-y: hidden;
    }
    blockquote {
      margin: 6px 0;
      padding: 5px 10px;
      background: #f1f5f9;
      border-left: 3px solid #0284c7;
      border-radius: 3px;
      color: #334155;
      font-size: 8.2pt;
    }
    blockquote p {
      margin: 0;
    }
    ul, ol {
      margin: 2px 0 3px 0;
      padding-left: 16px;
    }
    li {
      margin-bottom: 1.5px;
    }
    .preprint-banner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 7.2pt;
      color: #64748b;
      letter-spacing: 0.3px;
      border-bottom: 1.5px solid #0f172a;
      padding-bottom: 3px;
      margin-bottom: 8px;
    }
    .preprint-banner strong {
      color: #0f172a;
    }
    .masthead {
      border-bottom: 2px solid #0284c7;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .masthead-title {
      font-family: "Source Han Serif CN", "Noto Serif CJK SC", "Songti SC", Georgia, "Times New Roman", serif;
      font-size: 14.5pt;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px 0;
      line-height: 1.3;
      letter-spacing: -0.2px;
    }
    .masthead-meta {
      font-size: 7.8pt;
      color: #475569;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .meta-tag {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 2px;
      padding: 1.5px 5px;
      font-size: 7.4pt;
      color: #334155;
    }
    .meta-tag strong {
      color: #0f172a;
    }
    .section-title {
      font-family: "Source Han Serif CN", "Noto Serif CJK SC", Georgia, serif;
      font-size: 10.8pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1.5px solid #0f172a;
      padding-bottom: 3px;
      margin: 12px 0 6px 0;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      page-break-after: avoid;
      break-after: avoid;
    }
    .section-title-sub {
      font-size: 8.8pt;
      font-weight: 700;
      color: #1e293b;
      margin: 8px 0 4px 0;
      page-break-after: avoid;
      break-after: avoid;
    }
    .executive-box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 3.5px solid #0f172a;
      border-radius: 2px;
      padding: 7px 10px;
      font-size: 8.2pt;
      line-height: 1.45;
      margin-bottom: 8px;
    }
    .executive-label {
      font-size: 7pt;
      font-weight: 700;
      letter-spacing: 0.6px;
      color: #0f172a;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .executive-box p {
      margin: 0 0 4px 0;
    }
    .executive-box p:last-child {
      margin-bottom: 0;
    }
    .theme-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin-bottom: 6px;
    }
    .theme-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-left: 3px solid #0284c7;
      border-radius: 2px;
      padding: 5px 8px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .theme-title {
      font-size: 8.8pt;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 2px 0;
    }
    .theme-summary {
      font-size: 7.8pt;
      color: #334155;
      margin: 0 0 3px 0;
      line-height: 1.38;
    }
    .theme-summary p {
      margin: 0;
    }
    .theme-papers {
      font-size: 7.4pt;
      color: #64748b;
    }
    .pdf-inline-jump {
      display: inline-block;
      font-family: monospace;
      font-size: 7.8pt;
      font-weight: 700;
      color: #0369a1;
      background: #e0f2fe;
      border: 1px solid #bae6fd;
      border-radius: 2.5px;
      padding: 0 3.5px;
      text-decoration: none;
    }
    .must-read-theme-header {
      background: linear-gradient(90deg, #eff6ff 0%, #f8fafc 100%);
      border-left: 3.5px solid #0284c7;
      border-radius: 0 3px 3px 0;
      padding: 5px 9px;
      margin: 8px 0 6px 0;
      break-after: avoid;
      page-break-after: avoid;
    }
    .must-read-theme-title {
      font-family: "Source Han Serif CN", "Noto Serif CJK SC", Georgia, serif;
      font-size: 9.4pt;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .must-read-theme-kicker {
      font-family: sans-serif;
      font-size: 6.8pt;
      font-weight: 800;
      color: #0369a1;
      background: #dbeafe;
      padding: 1px 4.5px;
      border-radius: 2px;
      text-transform: uppercase;
    }
    .must-read-theme-desc {
      font-size: 7.7pt;
      color: #334155;
      margin: 2px 0 0 0;
      line-height: 1.36;
    }
    .must-read-theme-desc p {
      margin: 0;
    }
    .must-read-card {
      border: 1.2px solid #cbd5e1;
      border-radius: 3px;
      padding: 8px 10px;
      margin-bottom: 10px;
      background: #ffffff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .paper-header {
      margin-bottom: 5px;
      border-bottom: 1px dashed #e2e8f0;
      padding-bottom: 4px;
    }
    .paper-badge-bar {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-bottom: 2px;
    }
    .badge-paper-num {
      background: #0f172a;
      color: #ffffff;
      font-size: 6.5pt;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 2px;
      letter-spacing: 0.3px;
    }
    .badge-must {
      background: #0284c7;
      color: #ffffff;
      font-size: 6.8pt;
      font-weight: 700;
      padding: 1.5px 5px;
      border-radius: 2px;
      text-transform: uppercase;
      display: inline-block;
      vertical-align: middle;
    }
    .paper-title-zh {
      font-family: "Source Han Serif CN", "Noto Serif CJK SC", "Songti SC", Georgia, serif;
      font-size: 10.8pt;
      font-weight: 700;
      color: #0f172a;
      margin: 2px 0;
      line-height: 1.35;
    }
    .paper-title-zh a {
      color: #0f172a;
      text-decoration: none;
    }
    .paper-title-zh a:hover {
      color: #0284c7;
      text-decoration: underline;
    }
    .paper-title-en {
      font-size: 8pt;
      color: #475569;
      font-style: italic;
      margin: 1px 0 2px 0;
      line-height: 1.28;
    }
    .paper-authors-bar {
      font-size: 7.6pt;
      color: #64748b;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .paper-links-bar a {
      color: #0284c7;
      text-decoration: underline;
    }
    .highlight-callout {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-left: 3.5px solid #0284c7;
      border-radius: 2px;
      padding: 5px 8px;
      margin-bottom: 5px;
      font-size: 8pt;
      line-height: 1.4;
    }
    .highlight-callout-header {
      font-size: 6.8pt;
      font-weight: 700;
      color: #0369a1;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 2px;
    }
    .deep-dive-cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
      margin-top: 4px;
    }
    .deep-dive-col {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .deep-dive-item {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 2px;
      padding: 4px 7px;
      height: 100%;
    }
    .deep-dive-label {
      font-size: 7.5pt;
      font-weight: 700;
      color: #334155;
      margin-bottom: 2px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 1.5px;
    }
    .deep-dive-content {
      font-size: 7.9pt;
      color: #1e293b;
      line-height: 1.38;
    }
    .deep-dive-content p {
      margin: 0 0 3px 0;
    }
    .deep-dive-content p:last-child {
      margin-bottom: 0;
    }
    .deep-dive-full {
      margin-top: 5px;
    }
    .deep-dive-result-box {
      background: #fffdf5;
      border: 1px solid #fed7aa;
      border-left: 3.5px solid #ea580c;
      border-radius: 2px;
      padding: 5px 8px;
    }
    .deep-dive-result-box .deep-dive-label {
      color: #c2410c;
      border-bottom: 1px solid #ffedd5;
    }
    .deep-dive-guide-box {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 3.5px solid #16a34a;
      border-radius: 2px;
      padding: 4px 8px;
      margin-top: 4px;
    }
    .deep-dive-guide-box .deep-dive-label {
      color: #15803d;
      border-bottom: 1px solid #dcfce7;
    }
    .figure-block {
      margin: 6px 0;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .figure-block img {
      max-width: 82%;
      max-height: 250px;
      height: auto;
      border: 1px solid #cbd5e1;
      border-radius: 2px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .figure-caption {
      font-size: 7.3pt;
      color: #475569;
      margin-top: 3px;
      line-height: 1.32;
      text-align: left;
      padding: 0 9%;
    }
    .worth-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin-top: 4px;
      margin-bottom: 8px;
    }
    .worth-card {
      border: 1px solid #cbd5e1;
      border-left: 3px solid #0284c7;
      border-radius: 2px;
      padding: 5px 8px;
      background: #ffffff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .badge-worth {
      background: #475569;
      color: #ffffff;
      font-size: 6.5pt;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 2px;
      margin-right: 4px;
      display: inline-block;
      vertical-align: middle;
    }
    .worth-title-zh {
      font-size: 8.6pt;
      font-weight: 700;
      color: #0f172a;
      display: inline;
    }
    .worth-meta {
      font-size: 7.3pt;
      color: #64748b;
      margin: 1.5px 0 2.5px 0;
    }
    .worth-desc {
      font-size: 7.7pt;
      color: #334155;
      margin: 1.5px 0;
      line-height: 1.35;
    }
    .compendium-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.4pt;
      line-height: 1.35;
      margin-top: 5px;
      margin-bottom: 10px;
      border: 1px solid #cbd5e1;
    }
    .compendium-table thead {
      display: table-header-group;
    }
    .compendium-table th {
      background: #0f172a;
      color: #f8fafc;
      font-weight: 700;
      text-align: left;
      padding: 4px 6px;
      border: 1px solid #334155;
      font-size: 7.2pt;
      letter-spacing: 0.3px;
    }
    .compendium-table td {
      padding: 4px 6px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
    }
    .compendium-table tbody tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .compendium-table tbody tr:nth-child(even) {
      background: #f8fafc;
    }
    .table-aid {
      font-family: monospace;
      font-size: 7.4pt;
      font-weight: 700;
      white-space: nowrap;
    }
    .table-date {
      font-size: 6.8pt;
      color: #64748b;
      white-space: nowrap;
    }
    .table-title-zh {
      font-weight: 700;
      color: #0f172a;
      line-height: 1.3;
    }
    .table-title-en {
      font-size: 7pt;
      color: #64748b;
      font-style: italic;
      line-height: 1.25;
      margin-top: 1px;
    }
    .table-authors {
      font-size: 6.9pt;
      color: #475569;
      margin-top: 2px;
    }
    .table-insight {
      color: #1e293b;
    }
    .footer {
      margin-top: 14px;
      border-top: 1.5px solid #0f172a;
      padding-top: 5px;
      font-size: 7.3pt;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Visual Triage Matrix (1-2 Page At-a-Glance Paper & Figure Index) */
    .triage-matrix-section {
      margin-bottom: 10px;
    }
    .triage-lead-bar {
      font-size: 7.6pt;
      color: #334155;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 3.5px solid #0284c7;
      border-radius: 2px;
      padding: 4px 8px;
      margin-bottom: 6px;
      line-height: 1.38;
    }
    .triage-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 5px;
    }
    .triage-card {
      border: 1px solid #cbd5e1;
      border-radius: 2.5px;
      padding: 4.5px 6.5px;
      background: #ffffff;
      break-inside: avoid;
      page-break-inside: avoid;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .triage-card.triage-must {
      border-left: 3px solid #0284c7;
      background: #fcfdff;
    }
    .triage-card.triage-worth {
      border-left: 3px solid #64748b;
    }
    .triage-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      margin-bottom: 2.5px;
      border-bottom: 1px dashed #e2e8f0;
      padding-bottom: 2px;
    }
    .triage-badges {
      display: inline-flex;
      align-items: center;
      gap: 3.5px;
      flex-wrap: wrap;
    }
    .triage-num {
      background: #0f172a;
      color: #ffffff;
      font-size: 6.2pt;
      font-weight: 700;
      padding: 0.5px 3.5px;
      border-radius: 2px;
      font-family: monospace;
    }
    .triage-tier-must {
      background: #0284c7;
      color: #ffffff;
      font-size: 6.2pt;
      font-weight: 700;
      padding: 0.5px 4px;
      border-radius: 2px;
    }
    .triage-tier-worth {
      background: #475569;
      color: #ffffff;
      font-size: 6.2pt;
      font-weight: 700;
      padding: 0.5px 4px;
      border-radius: 2px;
    }
    .triage-links {
      font-size: 6.6pt;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .triage-links a {
      color: #0284c7;
      text-decoration: underline;
      font-weight: 600;
    }
    .triage-links .triage-pdf-link {
      color: #dc2626;
    }
    .triage-links .triage-jump-link {
      color: #0f766e;
    }
    .triage-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 5px;
      align-items: start;
    }
    .triage-body.has-fig {
      grid-template-columns: minmax(0, 1fr) 86px;
    }
    .triage-main {
      min-width: 0;
    }
    .triage-title-zh {
      font-family: "Source Han Serif CN", "Noto Serif CJK SC", "Songti SC", Georgia, serif;
      font-size: 8.1pt;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.26;
      margin: 0 0 1px 0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .triage-title-zh a {
      color: #0f172a;
      text-decoration: none;
    }
    .triage-title-en {
      font-size: 6.7pt;
      color: #64748b;
      font-style: italic;
      line-height: 1.2;
      margin: 0 0 2.5px 0;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .triage-insight {
      font-size: 7.2pt;
      color: #1e293b;
      line-height: 1.32;
      background: #f8fafc;
      border-left: 2px solid #0284c7;
      padding: 2px 4.5px;
      border-radius: 1.5px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .triage-insight strong {
      color: #0369a1;
    }
    .triage-fig-box {
      width: 86px;
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 2px;
      padding: 2px;
      text-decoration: none;
      color: inherit;
    }
    .triage-fig-img-wrap {
      width: 80px;
      height: 56px;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .triage-fig-img-wrap img {
      max-width: 100%;
      max-height: 54px;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
    }
    .triage-fig-cap {
      font-size: 5.9pt;
      color: #475569;
      line-height: 1.15;
      margin-top: 1.5px;
      text-align: center;
      width: 100%;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div class="preprint-banner">
    <span><strong>AstroLineage Weekly Digest</strong> ｜ 高能天体物理前沿脉络研报</span>
    <span><strong>Vol. 2026 · ${weekId}</strong> ｜ 周期：${dateRange}</span>
  </div>

  <header class="masthead">
    <h1 class="masthead-title">高能天体物理 arXiv 每周学术脉络 · ${weekZh || weekId} 深度精读研报</h1>
    <div class="masthead-meta">
      <span class="meta-tag"><strong>报告周期：</strong>${weekLabel}</span>
      <span class="meta-tag"><strong>时间跨度：</strong>${dateRange}</span>
      <span class="meta-tag"><strong>纳入精读：</strong>${mustReads.length} 篇核心必读 ｜ ${worths.length} 篇重点关注</span>
      <span class="meta-tag"><strong>在线精读：</strong><a href="${base}/arxiv-weekly/${weekId}/">${base}/arxiv-weekly/${weekId}/</a></span>
    </div>
  </header>

  <section class="triage-matrix-section" id="visual-triage-matrix">
    <div class="section-title">
      <span>★ 本周精选速览矩阵 (At-a-Glance Visual Triage · 共 ${topPicks.length} 篇)</span>
      <span style="font-size: 7.4pt; color: #0284c7; font-family: sans-serif; font-weight: 700;">1-MINUTE VISUAL TRIAGE · KEY INSIGHTS &amp; FIGURES</span>
    </div>
    <div class="triage-lead-bar">
      <strong>快速研读指引：</strong>下表浓缩本周全部 ${mustReads.length} 篇核心必读与 ${topPicks.length - mustReads.length} 篇特选关注论文的<strong>一句话核心结论 (Key Insight)</strong>、<strong>关键科学图表</strong>与<strong>直达超链接</strong>（点击页内编号跳至精读详情，点击 arXiv / PDF 直达原文），助您在 1–2 页内快速判断哪些文章值得精读。
    </div>
    <div class="triage-grid">
`);

  for (let tIdx = 0; tIdx < topPicks.length; tIdx++) {
    const p = topPicks[tIdx];
    const aid = p.arxiv_id;
    const isMust = p.priority === "must_read";
    const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
    const titleEn = p.title || aid;
    const dailyRec = dailyAnalysisMap.get(aid);
    const dailyA = dailyRec?.analysis?.analysis || dailyRec?.analysis || {};
    const rawFigs = p.figures || dailyA.figures || [];
    const figs = Array.isArray(rawFigs) ? rawFigs.filter((f) => f && f.url) : [];
    const primaryFig = figs.length > 0 ? figs[0] : null;
    const rawThumb = primaryFig ? resolveImageBase64(primaryFig.url, searchDirs) : "";
    const b64Thumb = rawThumb.startsWith("data:") ? rawThumb : "";
    const figLabel = primaryFig?.label || "Fig. 1";
    const figBadge = primaryFig?.category_badge || "";
    const insightText =
      p.core_insight || dailyA.result || p.recommendation_reason || "详见正文解析";

    html.push(`
      <div class="triage-card ${isMust ? "triage-must" : "triage-worth"}">
        <div class="triage-card-top">
          <div class="triage-badges">
            <span class="triage-num">#${String(tIdx + 1).padStart(2, "0")}</span>
            <span class="${isMust ? "triage-tier-must" : "triage-tier-worth"}">${isMust ? "⭐ 必读" : "📌 关注"}</span>
            <a href="https://arxiv.org/abs/${aid}" style="font-family: monospace; font-size: 6.6pt; font-weight: 700; color: #334155; text-decoration: none;">arXiv:${aid}</a>
          </div>
          <div class="triage-links">
            <a href="#pdf-paper-${aid}" class="triage-jump-link">↓详情</a>
            <span>·</span>
            <a href="https://arxiv.org/abs/${aid}">arXiv</a>
            <span>·</span>
            <a href="https://arxiv.org/pdf/${aid}" class="triage-pdf-link">PDF</a>
            <span>·</span>
            <a href="${base}/arxiv-weekly/${weekId}/#paper-${aid}">网页</a>
          </div>
        </div>
        <div class="triage-body ${b64Thumb ? "has-fig" : ""}">
          <div class="triage-main">
            <div class="triage-title-zh"><a href="#pdf-paper-${aid}">${escapeHtml(titleZh)}</a></div>
            <div class="triage-title-en">${escapeHtml(titleEn)}</div>
            <div class="triage-insight"><strong>Key Insight：</strong>${renderInlineMarkdownWithMath(insightText)}</div>
          </div>
          ${
            b64Thumb
              ? `
          <a href="#pdf-paper-${aid}" class="triage-fig-box" title="点击跳转至页内图表与精读详情">
            <div class="triage-fig-img-wrap">
              <img src="${b64Thumb}" alt="${escapeHtml(figLabel)}" />
            </div>
            <div class="triage-fig-cap">${escapeHtml(figLabel)}${figBadge ? ` · ${escapeHtml(figBadge)}` : ""}</div>
          </a>`
              : ""
          }
        </div>
      </div>
`);
  }

  const renderedExecutiveHtml = renderMarkdownWithMath(
    weeklyData.executive_summary || "暂无本周综述。"
  ).replace(
    /\barXiv:(\d{4}\.\d{4,5})\b/g,
    (_, id) =>
      `<a href="#pdf-paper-${id}" class="pdf-inline-jump" title="跳转至本文下方深度精读">arXiv:${id} ↓</a>`
  );

  const mustReadThemeGroups = groupPicksByTheme(mustReads, weeklyData);

  html.push(`
    </div>
  </section>

  <section>
    <div class="section-title">
      <span>1. 本周综述与宏观脉络 (Executive Synthesis · 点击编号直达精读)</span>
      <span style="font-size: 7.4pt; color: #64748b; font-family: sans-serif; font-weight: normal;">EDITORIAL OVERVIEW</span>
    </div>
    <div class="executive-box">
      <div class="executive-label">ABSTRACT / 学术总览（点击文内 arXiv 编号 ↓ 可直接跳至下方详细精读）</div>
      ${renderedExecutiveHtml}
    </div>
  </section>

  <section>
    <div class="section-title">
      <span>2. ⭐ 核心必读文献深度解析 (Must-Read In-Depth Deep Dives · 按专题分组)</span>
      <span style="font-size: 7.4pt; color: #64748b; font-family: sans-serif; font-weight: normal;">${mustReads.length} ARTICLES IN ${mustReadThemeGroups.length} THEMES</span>
    </div>
`);

  let pIdx = 0;
  for (let gIdx = 0; gIdx < mustReadThemeGroups.length; gIdx++) {
    const group = mustReadThemeGroups[gIdx];
    const groupDescHtml = group.description
      ? renderInlineMarkdownWithMath(group.description).replace(
          /\barXiv:(\d{4}\.\d{4,5})\b/g,
          (_, id) => `<a href="#pdf-paper-${id}" class="pdf-inline-jump">arXiv:${id} ↓</a>`
        )
      : "";

    html.push(`
    <div class="must-read-theme-header">
      <div class="must-read-theme-title">
        <span class="must-read-theme-kicker">专题 0${gIdx + 1}</span>
        <span>${escapeHtml(group.theme)}</span>
        <span style="font-size: 7.2pt; font-weight: normal; color: #64748b; margin-left: auto;">本专题收录 ${group.picks.length} 篇必读文献</span>
      </div>
      ${groupDescHtml ? `<div class="must-read-theme-desc">${groupDescHtml}</div>` : ""}
    </div>
`);

    for (const p of group.picks) {
      pIdx++;
      const aid = p.arxiv_id;
      const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
      const titleEn = p.title || aid;
      const feed = dailyEntryMap.get(aid);
      const authors = (p.authors && p.authors.length > 0 ? p.authors : feed?.authors) || [];
      const authorStr = authors.slice(0, 5).join(", ") + (authors.length > 5 ? " 等" : "");
      const dailyA = dailyAnalysisMap.get(aid)?.analysis || {};

      html.push(`
    <article class="must-read-card" id="pdf-paper-${aid}">
      <div class="paper-header">
        <div class="paper-badge-bar">
          <span class="badge-paper-num">PAPER ${String(pIdx).padStart(2, "0")}</span>
          <span class="badge-must">⭐ 必读精选</span>
          <span style="font-size: 7.1pt; color: #0369a1; background: #e0f2fe; padding: 1px 4px; border-radius: 2px; font-weight: 600;">🧭 ${escapeHtml(group.theme)}</span>
          <span style="font-size: 7.4pt; color: #64748b; font-family: monospace;">arXiv:${aid}</span>
        </div>
        <h2 class="paper-title-zh"><a href="https://arxiv.org/abs/${aid}">[arXiv:${aid}] ${escapeHtml(titleZh)}</a></h2>
        <div class="paper-title-en">${escapeHtml(titleEn)}</div>
        <div class="paper-authors-bar">
          <span><strong>作者：</strong>${escapeHtml(authorStr)}</span>
          <span class="paper-links-bar">
            <a href="https://arxiv.org/abs/${aid}">arXiv 原文</a> ｜
            <a href="https://arxiv.org/pdf/${aid}">PDF 直达</a> ｜
            <a href="${getBibliographicUrl(aid)}">${escapeHtml(getBibliographicSourceName())}</a> ｜
            <a href="${base}/arxiv-weekly/${weekId}/#paper-${aid}">站内交互雷达</a>
          </span>
        </div>
      </div>

      <div class="highlight-callout">
        <div class="highlight-callout-header">RESEARCH HIGHLIGHT & BREAKTHROUGH / 核心突破与推荐理由</div>
        <div><strong>【核心突破】：</strong>${renderInlineMarkdownWithMath(p.core_insight || "无")}</div>
        <div style="margin-top: 2.5px;"><strong>【推荐理由】：</strong>${renderInlineMarkdownWithMath(p.recommendation_reason || "无")}</div>
      </div>

      <div class="deep-dive-cols">
        <div class="deep-dive-col">
          ${
            dailyA.problem
              ? `
          <div class="deep-dive-item">
            <div class="deep-dive-label">🔍 科学问题与背景 (Problem)</div>
            <div class="deep-dive-content">${renderMarkdownWithMath(dailyA.problem)}</div>
          </div>`
              : ""
          }
          ${
            dailyA.method
              ? `
          <div class="deep-dive-item">
            <div class="deep-dive-label">🛠️ 观测与研究方法 (Methodology)</div>
            <div class="deep-dive-content">${renderMarkdownWithMath(dailyA.method)}</div>
          </div>`
              : ""
          }
        </div>
        <div class="deep-dive-col">
          ${
            dailyA.assumptions
              ? `
          <div class="deep-dive-item">
            <div class="deep-dive-label">📐 物理模型与关键假设 (Models & Assumptions)</div>
            ${
              Array.isArray(dailyA.assumptions)
                ? `<ul style="margin: 0; padding-left: 16px;">${dailyA.assumptions.map((a) => `<li>${renderInlineMarkdownWithMath(a)}</li>`).join("")}</ul>`
                : `<div class="deep-dive-content">${renderMarkdownWithMath(dailyA.assumptions)}</div>`
            }
          </div>`
              : ""
          }
          ${
            dailyA.limits
              ? `
          <div class="deep-dive-item">
            <div class="deep-dive-label">⚠️ 局限性与观测边界 (Limits & Caveats)</div>
            ${
              Array.isArray(dailyA.limits)
                ? `<ul style="margin: 0; padding-left: 16px;">${dailyA.limits.map((l) => `<li>${renderInlineMarkdownWithMath(l)}</li>`).join("")}</ul>`
                : `<div class="deep-dive-content">${renderMarkdownWithMath(dailyA.limits)}</div>`
            }
          </div>`
              : ""
          }
        </div>
      </div>
`);

      if (Array.isArray(dailyA.figures) && dailyA.figures.length > 0) {
        for (let fIdx = 0; fIdx < dailyA.figures.length; fIdx++) {
          const fig = dailyA.figures[fIdx];
          const b64Src = resolveImageBase64(fig.url, searchDirs);
          if (!b64Src.startsWith("data:")) continue;
          const label = fig.label || `图 ${fIdx + 1}`;
          const badge = fig.category_badge ? ` [${fig.category_badge}]` : "";
          const caption = fig.caption || "";
          html.push(`
      <div class="figure-block">
        <img src="${b64Src}" alt="${escapeHtml(label)}" />
        <div class="figure-caption"><strong>${escapeHtml(label)}${escapeHtml(badge)}：</strong>${renderInlineMarkdownWithMath(caption)}</div>
      </div>
`);
        }
      }

      if (dailyA.result) {
        html.push(`
      <div class="deep-dive-full">
        <div class="deep-dive-result-box">
          <div class="deep-dive-label">📊 关键结论与定量测量 (Quantitative Results)</div>
          <div class="deep-dive-content">${renderMarkdownWithMath(dailyA.result)}</div>
        </div>
      </div>
`);
      }

      if (p.reading_guide || dailyA.reading_entry) {
        html.push(`
      <div class="deep-dive-guide-box">
        <div class="deep-dive-label">🎯 建议精读切入点 (Reading Guide)</div>
        <div class="deep-dive-content">${renderInlineMarkdownWithMath(p.reading_guide || dailyA.reading_entry)}</div>
      </div>
`);
      }

      html.push(`
    </article>
`);
    }
  }

  html.push(`
  </section>
`);

  // 3. 重点关注文献（分层展现：top_picks 精选卡片 + 其余文献学术表格）
  const topWorths = worths.filter((p) => p.isTopPick);
  const otherWorths = worths.filter((p) => !p.isTopPick);

  html.push(`
  <section>
    <div class="section-title">
      <span>3. 📌 本周重点关注文献 (Worth-Knowing Selected Works · 共 ${worths.length} 篇)</span>
      <span style="font-size: 7.4pt; color: #64748b; font-family: sans-serif; font-weight: normal;">STRUCTURED COMPENDIUM</span>
    </div>
    <p style="font-size: 7.8pt; color: #64748b; margin-top: -3px; margin-bottom: 8px;">以下文献针对特定物理机制或子方向提供重要观测线索与实测约束，采用前沿精选卡片与总览表格双轨呈现。</p>
`);

  if (topWorths.length > 0) {
    html.push(`
    <div class="section-title-sub">3.1 重点关注 · 特选导读 (Featured Highlights · 共 ${topWorths.length} 篇)</div>
    <div class="worth-grid">
`);

    for (const p of topWorths) {
      const aid = p.arxiv_id;
      const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
      const titleEn = p.title || aid;
      const feed = dailyEntryMap.get(aid);
      const authors = (p.authors && p.authors.length > 0 ? p.authors : feed?.authors) || [];
      const authorStr = authors.slice(0, 3).join(", ") + (authors.length > 3 ? " 等" : "");

      html.push(`
      <div class="worth-card" id="pdf-paper-${aid}">
        <div>
          <span class="badge-worth" style="background:#0284c7;color:#ffffff;">⭐ 重点关注</span>
          <div class="worth-title-zh"><a href="https://arxiv.org/abs/${aid}">[arXiv:${aid}] ${escapeHtml(titleZh)}</a></div>
        </div>
        <div class="worth-meta"><strong>原题：</strong>${escapeHtml(titleEn)} ｜ <strong>作者：</strong>${escapeHtml(authorStr)} ｜ <a href="https://arxiv.org/pdf/${aid}">PDF</a></div>
        ${p.recommendation_reason ? `<div class="worth-desc"><strong>【推荐理由】：</strong>${renderInlineMarkdownWithMath(p.recommendation_reason)}</div>` : ""}
        ${p.core_insight ? `<div class="worth-desc"><strong>【核心要点】：</strong>${renderInlineMarkdownWithMath(p.core_insight)}</div>` : ""}
        ${p.reading_guide ? `<div class="worth-desc" style="color: #64748b;"><strong>【阅读切入】：</strong>${renderInlineMarkdownWithMath(p.reading_guide)}</div>` : ""}
      </div>
`);
    }

    html.push(`
    </div>
`);
  }

  if (otherWorths.length > 0) {
    html.push(`
    <div class="section-title-sub">3.2 重点关注 · 全周论文简表 (Weekly Compendium · 共 ${otherWorths.length} 篇)</div>
    <table class="compendium-table">
      <thead>
        <tr>
          <th style="width: 14%;">arXiv ID / 日期</th>
          <th style="width: 32%;">文献题名与作者</th>
          <th style="width: 41%;">核心要点与观测约束</th>
          <th style="width: 13%;">阅读切入</th>
        </tr>
      </thead>
      <tbody>
`);

    for (const p of otherWorths) {
      const aid = p.arxiv_id;
      const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
      const titleEn = p.title || aid;
      const feed = dailyEntryMap.get(aid);
      const authors = (p.authors && p.authors.length > 0 ? p.authors : feed?.authors) || [];
      const authorStr = authors.slice(0, 3).join(", ") + (authors.length > 3 ? " 等" : "");
      const date = p.announcement_date || "";

      html.push(`
        <tr id="pdf-paper-${aid}">
          <td>
            <a href="https://arxiv.org/abs/${aid}" class="table-aid">arXiv:${aid}</a>
            ${date ? `<div class="table-date">${escapeHtml(date)}</div>` : ""}
          </td>
          <td>
            <div class="table-title-zh">${escapeHtml(titleZh)}</div>
            <div class="table-title-en">${escapeHtml(titleEn)}</div>
            <div class="table-authors">${escapeHtml(authorStr)}</div>
          </td>
          <td>
            <div class="table-insight">${renderInlineMarkdownWithMath(p.core_insight || p.recommendation_reason || "无详细解析。")}</div>
          </td>
          <td>
            <div style="font-size: 7.1pt; color: #475569;">${renderInlineMarkdownWithMath(p.reading_guide || "正文")}</div>
          </td>
        </tr>
`);
    }

    html.push(`
      </tbody>
    </table>
`);
  }

  html.push(`
  </section>

  <footer class="footer">
    <span>AstroLineage 学术雷达团队 · 期号 ${weekId} ｜ 矢量排版支持全文检索与超链接直达</span>
    <span>在线入口：<a href="${base}/arxiv-weekly/${weekId}/">${base}/arxiv-weekly/${weekId}/</a></span>
  </footer>
</body>
</html>
`);

  return html.join("\n");
}

/**
 * 编译生成指定周报的精读 PDF 报告与对应 Markdown 报告
 * @param {Object} options
 * @param {string} options.weekId
 * @param {string} [options.websiteBase]
 * @param {string} [options.distDir]
 * @param {string} [options.publicDir]
 * @param {boolean} [options.force]
 * @param {string} [options.chromiumPath]
 * @returns {Promise<{ weekId: string, pdfPath: string, pdfUrl: string, mdPath: string, fileSize: number, cached: boolean }>}
 */
export async function generateWeeklyPdf({
  weekId,
  websiteBase = getDefaultWebsiteBase(),
  distDir = DEFAULT_DIST_DIR,
  publicDir = DEFAULT_PUBLIC_DIR,
  force = false,
  chromiumPath = null,
}) {
  const binary = chromiumPath || findChromiumPath();

  const outPublicDir = join(publicDir, "arxiv-weekly", weekId);
  const outDistDir = join(distDir, "arxiv-weekly", weekId);
  const publicPdfPath = join(outPublicDir, `weekly-${weekId}.pdf`);
  const distPdfPath = join(outDistDir, `weekly-${weekId}.pdf`);
  const publicMdPath = join(outPublicDir, `weekly-${weekId}.md`);
  const distMdPath = join(outDistDir, `weekly-${weekId}.md`);

  const base = sanitizeWebsiteBase(websiteBase);
  const pdfUrl = `${base}/arxiv-weekly/${weekId}/weekly-${weekId}.pdf`;

  // 1. 命中缓存检查（纯只读，零落盘副作用）
  if (!force) {
    if (existsSync(publicPdfPath) && existsSync(publicMdPath)) {
      const st = await stat(publicPdfPath);
      if (st.size > 1000) {
        if (existsSync(distDir) && !existsSync(distPdfPath)) {
          await mkdir(outDistDir, { recursive: true });
          await copyFile(publicPdfPath, distPdfPath).catch(() => {});
        }
        return {
          weekId,
          pdfPath: publicPdfPath,
          pdfUrl,
          mdPath: publicMdPath,
          fileSize: st.size,
          cached: true,
        };
      }
    } else if (existsSync(distPdfPath) && existsSync(distMdPath)) {
      const st = await stat(distPdfPath);
      if (st.size > 1000) {
        await mkdir(outPublicDir, { recursive: true });
        await copyFile(distPdfPath, publicPdfPath).catch(() => {});
        if (!existsSync(publicMdPath)) {
          await copyFile(distMdPath, publicMdPath).catch(() => {});
        }
        return {
          weekId,
          pdfPath: distPdfPath,
          pdfUrl,
          mdPath: publicMdPath,
          fileSize: st.size,
          cached: true,
        };
      }
    }
  }

  // 2. 缓存未命中或强制重新生成：确保输出目录存在
  await mkdir(outPublicDir, { recursive: true });
  if (existsSync(distDir)) {
    await mkdir(outDistDir, { recursive: true });
  }

  // 3. 生成对应 Markdown 学术报告并写入
  const markdownContent = await generateWeeklyMarkdownDocument({
    weekId,
    websiteBase: base,
  });
  await writeFile(publicMdPath, markdownContent, "utf8");
  if (existsSync(distDir)) {
    await writeFile(distMdPath, markdownContent, "utf8");
  }

  // 3. 检查 Chromium 二进制环境
  if (!binary) {
    throw new Error(
      "未在系统中找到 Chromium/Chrome 二进制程序（请安装 chromium 或设置 CHROMIUM_PATH 环境变量）。"
    );
  }

  // 4. 生成专为学术印刷出版排版的 HTML 报告
  const html = await generatePublicationWeeklyHtml({
    weekId,
    websiteBase: base,
    distDir,
    publicDir,
  });

  const tmpHtmlPath = join(tmpdir(), `weekly-pub-${weekId}-${Date.now()}.html`);
  await writeFile(tmpHtmlPath, html, "utf8");

  try {
    const args = [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--allow-file-access-from-files",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-first-run",
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      `--print-to-pdf=${publicPdfPath}`,
      tmpHtmlPath,
    ];

    execFileSync(binary, args, { stdio: "ignore", timeout: 120000 });

    const st = await stat(publicPdfPath);
    if (st.size < 1000) {
      throw new Error(`生成 PDF 文件异常过小 (${st.size} 字节)`);
    }

    if (existsSync(distDir)) {
      await copyFile(publicPdfPath, distPdfPath).catch(() => {});
    }

    return {
      weekId,
      pdfPath: publicPdfPath,
      pdfUrl,
      mdPath: publicMdPath,
      fileSize: st.size,
      cached: false,
    };
  } finally {
    if (existsSync(tmpHtmlPath)) {
      await unlink(tmpHtmlPath).catch(() => {});
    }
  }
}

// CLI 直调支持
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const weekArg =
    args.find((a) => a.startsWith("--week="))?.slice(7) || args.find((a) => !a.startsWith("-"));
  const targetWeek = weekArg || "2026-W42";
  console.log(`[Weekly PDF] 正在生成周报 PDF 与 Markdown 研报: ${targetWeek}...`);
  generateWeeklyPdf({ weekId: targetWeek, force: true })
    .then((res) => {
      console.log(
        `[Weekly PDF] ✓ 编译成功: ${res.pdfPath} (${(res.fileSize / (1024 * 1024)).toFixed(2)} MB)`
      );
      console.log(`[Weekly PDF]   Markdown 源码: ${res.mdPath}`);
      console.log(`[Weekly PDF]   在线访问地址: ${res.pdfUrl}`);
    })
    .catch((err) => {
      console.error(`[Weekly PDF] ✗ 编译失败: ${err.message}`);
      process.exit(1);
    });
}
