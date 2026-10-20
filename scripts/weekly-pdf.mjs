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

  // 1. 本周综述
  lines.push("## 1. 本周综述与宏观脉络");
  lines.push(weeklyData.executive_summary || "暂无本周综述。");
  lines.push("");

  // 2. 前沿专题动态
  if (Array.isArray(weeklyData.thematic_highlights) && weeklyData.thematic_highlights.length > 0) {
    lines.push("## 2. 前沿专题动态与交叉脉络");
    for (let i = 0; i < weeklyData.thematic_highlights.length; i++) {
      const t = weeklyData.thematic_highlights[i];
      const pLinks = (t.paper_ids || [])
        .map((id) => `[arXiv:${id}](https://arxiv.org/abs/${id})`)
        .join(" ｜ ");
      lines.push(`### 专题 ${i + 1}：${t.theme_name}`);
      lines.push(t.summary || "");
      if (pLinks) {
        lines.push(`\n**代表文献**：${pLinks}`);
      }
      lines.push("");
    }
  }

  // 3. ⭐ 核心必读精选解读（必须展开全部精读细节）
  lines.push("## 3. ⭐ 核心必读文献深度解析 (Must-Read In-Depth Deep Dives)");
  lines.push("本节精选最具物理突破、观测约束或模型创新的论文，展开完整精读细节。");
  lines.push("");

  for (const p of mustReads) {
    const aid = p.arxiv_id;
    const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
    const titleEn = p.title || aid;
    const feed = dailyEntryMap.get(aid);
    const authors = (p.authors && p.authors.length > 0 ? p.authors : feed?.authors) || [];
    const authorStr = authors.slice(0, 5).join(", ") + (authors.length > 5 ? " 等" : "");
    const dailyA = dailyAnalysisMap.get(aid)?.analysis || {};

    lines.push(`### [arXiv:${aid}](https://arxiv.org/abs/${aid}) ${titleZh}`);
    lines.push(`- **英文原题**：${titleEn}`);
    lines.push(`- **作者**：${authorStr}`);
    lines.push(
      `- **文献链接**：[arXiv 原文](https://arxiv.org/abs/${aid}) ｜ [NASA ADS](https://ui.adsabs.harvard.edu/abs/arXiv:${aid}) ｜ [在线精读](${base}/arxiv-weekly/${weekId}/#paper-${aid})`
    );
    lines.push(`- **推荐理由**：${p.recommendation_reason || "无"}`);
    lines.push(`- **核心突破**：${p.core_insight || "无"}`);
    lines.push("");

    if (dailyA.problem) {
      lines.push(`#### 科学问题\n\n${dailyA.problem}\n`);
    }
    if (dailyA.method) {
      lines.push(`#### 观测与研究方法\n\n${dailyA.method}\n`);
    }
    if (dailyA.assumptions) {
      const ass = dailyA.assumptions;
      lines.push("#### 物理模型与关键假设\n");
      if (Array.isArray(ass)) {
        for (const item of ass) lines.push(`- ${item}`);
      } else {
        lines.push(String(ass));
      }
      lines.push("");
    }
    if (Array.isArray(dailyA.figures) && dailyA.figures.length > 0) {
      lines.push("#### 核心学术图表\n");
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
      lines.push(`#### 关键结论与定量测量\n\n${dailyA.result}\n`);
    }
    if (dailyA.limits) {
      const lims = dailyA.limits;
      lines.push("#### 局限性与观测边界\n");
      if (Array.isArray(lims)) {
        for (const item of lims) lines.push(`- ${item}`);
      } else {
        lines.push(String(lims));
      }
      lines.push("");
    }
    if (p.reading_guide || dailyA.reading_entry) {
      lines.push(`#### 建议精读切入点\n\n${p.reading_guide || dailyA.reading_entry}\n`);
    }
    lines.push("---\n");
  }

  // 4. 📌 本周重点关注文献（全量紧凑条目，精读不展开）
  lines.push(`## 4. 📌 本周重点关注文献 (Worth-Knowing Selected Works · 共 ${worths.length} 篇)`);
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
      font-family: "Noto Sans CJK SC", "Source Han Sans CN", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.42;
      color: #0f172a;
      background: #ffffff;
      font-size: 8.5pt;
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
      margin: 3px 0 4px 0;
      padding-left: 18px;
    }
    li {
      margin-bottom: 2px;
    }
    .masthead {
      border-bottom: 2px solid #0284c7;
      padding-bottom: 6px;
      margin-bottom: 10px;
    }
    .masthead-title {
      font-size: 14pt;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 3px 0;
      letter-spacing: -0.2px;
    }
    .masthead-meta {
      font-size: 8pt;
      color: #64748b;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 0;
    }
    .section-title {
      font-size: 10.5pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1.2px solid #e2e8f0;
      padding-bottom: 3px;
      margin: 12px 0 6px 0;
      page-break-after: avoid;
      break-after: avoid;
    }
    .executive-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 7px 10px;
      font-size: 8.3pt;
      line-height: 1.45;
      margin-bottom: 10px;
    }
    .executive-box p {
      margin: 0 0 4px 0;
    }
    .executive-box p:last-child {
      margin-bottom: 0;
    }
    .theme-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-left: 3px solid #0284c7;
      border-radius: 3px;
      padding: 6px 9px;
      margin-bottom: 6px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .theme-title {
      font-size: 9.2pt;
      font-weight: 700;
      color: #1e293b;
      margin: 0 0 2px 0;
    }
    .theme-summary {
      font-size: 8.1pt;
      color: #334155;
      margin: 0 0 3px 0;
      line-height: 1.4;
    }
    .theme-summary p {
      margin: 0;
    }
    .theme-papers {
      font-size: 7.8pt;
      color: #64748b;
    }
    .must-read-card {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 8px 10px;
      margin-bottom: 10px;
      background: #ffffff;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .paper-header {
      margin-bottom: 5px;
    }
    .badge-must {
      background: #0284c7;
      color: #ffffff;
      font-size: 7pt;
      font-weight: 700;
      padding: 1.5px 5px;
      border-radius: 2px;
      margin-right: 5px;
      text-transform: uppercase;
      display: inline-block;
      vertical-align: middle;
    }
    .paper-title-zh {
      font-size: 10.5pt;
      font-weight: 700;
      color: #0f172a;
      display: inline;
      vertical-align: middle;
    }
    .paper-title-en {
      font-size: 8pt;
      color: #475569;
      font-style: italic;
      margin: 2px 0 3px 0;
    }
    .paper-authors-bar {
      font-size: 7.8pt;
      color: #64748b;
      margin-bottom: 5px;
    }
    .highlight-callout {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-left: 3px solid #0284c7;
      border-radius: 3px;
      padding: 4px 7px;
      margin-bottom: 6px;
      font-size: 8.1pt;
      line-height: 1.38;
    }
    .highlight-callout p {
      margin: 0 0 2px 0;
    }
    .highlight-callout p:last-child {
      margin-bottom: 0;
    }
    .deep-dive-grid {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 5px;
    }
    .deep-dive-item {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 3px;
      padding: 4px 7px;
    }
    .deep-dive-label {
      font-size: 7.8pt;
      font-weight: 700;
      color: #334155;
      margin-bottom: 2px;
    }
    .deep-dive-content {
      font-size: 8.1pt;
      color: #1e293b;
      line-height: 1.4;
    }
    .deep-dive-content p {
      margin: 0 0 3px 0;
    }
    .deep-dive-content p:last-child {
      margin-bottom: 0;
    }
    .figure-block {
      margin: 6px 0;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .figure-block img {
      max-width: 72%;
      max-height: 200px;
      height: auto;
      border: 1px solid #e2e8f0;
      border-radius: 3px;
    }
    .figure-caption {
      font-size: 7.4pt;
      color: #64748b;
      margin-top: 3px;
      line-height: 1.3;
      text-align: left;
      padding: 0 4%;
    }
    .worth-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
      margin-top: 4px;
    }
    .worth-card {
      border: 1px solid #e2e8f0;
      border-left: 2.5px solid #94a3b8;
      border-radius: 3px;
      padding: 5px 8px;
      background: #fafafa;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .badge-worth {
      background: #64748b;
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
      font-size: 8.8pt;
      font-weight: 700;
      color: #1e293b;
      display: inline;
    }
    .worth-meta {
      font-size: 7.4pt;
      color: #64748b;
      margin: 1px 0 2px 0;
    }
    .worth-desc {
      font-size: 7.8pt;
      color: #334155;
      margin: 1.5px 0;
      line-height: 1.35;
    }
    .footer {
      margin-top: 14px;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
      font-size: 7.5pt;
      color: #94a3b8;
      text-align: center;
    }
  </style>
</head>
<body>
  <header class="masthead">
    <h1 class="masthead-title">高能天体物理 arXiv 每周学术脉络 · ${weekZh || weekId} 深度精读研报</h1>
    <div class="masthead-meta">
      <span><strong>报告周期：</strong>${weekLabel}</span>
      <span><strong>时间跨度：</strong>${dateRange}</span>
      <span><strong>纳入精读：</strong>${mustReads.length} 篇必读 ｜ ${worths.length} 篇重点关注</span>
      <span><strong>在线精读：</strong><a href="${base}/arxiv-weekly/${weekId}/">${base}/arxiv-weekly/${weekId}/</a></span>
    </div>
  </header>

  <section>
    <div class="section-title">1. 本周综述与宏观脉络 (Executive Synthesis)</div>
    <div class="executive-box">${renderMarkdownWithMath(weeklyData.executive_summary || "暂无本周综述。")}</div>
  </section>

  <section>
    <div class="section-title">2. 前沿专题动态与交叉脉络 (Thematic Highlights)</div>
`);

  for (let i = 0; i < (weeklyData.thematic_highlights || []).length; i++) {
    const t = weeklyData.thematic_highlights[i];
    const pLinks = (t.paper_ids || [])
      .map((pid) => `<a href="https://arxiv.org/abs/${pid}">arXiv:${pid}</a>`)
      .join(" ｜ ");
    html.push(`
    <div class="theme-card">
      <div class="theme-title">专题 ${i + 1}：${t.theme_name || ""}</div>
      <div class="theme-summary">${renderMarkdownWithMath(t.summary || "")}</div>
      <div class="theme-papers"><strong>代表文献：</strong>${pLinks}</div>
    </div>
`);
  }

  html.push(`
  </section>

  <section>
    <div class="section-title">3. ⭐ 核心必读文献深度解析 (Must-Read In-Depth Deep Dives)</div>
`);

  for (const p of mustReads) {
    const aid = p.arxiv_id;
    const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
    const titleEn = p.title || aid;
    const feed = dailyEntryMap.get(aid);
    const authors = (p.authors && p.authors.length > 0 ? p.authors : feed?.authors) || [];
    const authorStr = authors.slice(0, 5).join(", ") + (authors.length > 5 ? " 等" : "");
    const dailyA = dailyAnalysisMap.get(aid)?.analysis || {};

    html.push(`
    <article class="must-read-card">
      <div class="paper-header">
        <span class="badge-must">⭐ 必读精选</span>
        <h2 class="paper-title-zh"><a href="https://arxiv.org/abs/${aid}">[arXiv:${aid}] ${titleZh}</a></h2>
        <div class="paper-title-en">${titleEn}</div>
        <div class="paper-authors-bar">
          <strong>作者：</strong>${authorStr} ｜
          <a href="https://arxiv.org/abs/${aid}">arXiv 原文</a> ｜
          <a href="https://ui.adsabs.harvard.edu/abs/arXiv:${aid}">NASA ADS</a> ｜
          <a href="${base}/arxiv-weekly/${weekId}/#paper-${aid}">站内交互雷达</a>
        </div>
      </div>

      <div class="highlight-callout">
        <div><strong>【推荐理由】：</strong>${renderInlineMarkdownWithMath(p.recommendation_reason || "无")}</div>
        <div style="margin-top: 3px;"><strong>【核心突破】：</strong>${renderInlineMarkdownWithMath(p.core_insight || "无")}</div>
      </div>

      <div class="deep-dive-grid">
`);

    if (dailyA.problem) {
      html.push(`
        <div class="deep-dive-item">
          <div class="deep-dive-label">🔍 科学问题 (Problem)</div>
          <div class="deep-dive-content">${renderMarkdownWithMath(dailyA.problem)}</div>
        </div>
`);
    }
    if (dailyA.method) {
      html.push(`
        <div class="deep-dive-item">
          <div class="deep-dive-label">🛠️ 观测与研究方法 (Methodology)</div>
          <div class="deep-dive-content">${renderMarkdownWithMath(dailyA.method)}</div>
        </div>
`);
    }
    if (dailyA.assumptions) {
      const ass = dailyA.assumptions;
      const assStr = Array.isArray(ass)
        ? `<ul style="margin: 0; padding-left: 18px;">${ass.map((a) => `<li>${renderInlineMarkdownWithMath(a)}</li>`).join("")}</ul>`
        : `<div class="deep-dive-content">${renderMarkdownWithMath(ass)}</div>`;
      html.push(`
        <div class="deep-dive-item">
          <div class="deep-dive-label">📐 物理模型与关键假设 (Models & Assumptions)</div>
          ${assStr}
        </div>
`);
    }

    if (Array.isArray(dailyA.figures) && dailyA.figures.length > 0) {
      for (let fIdx = 0; fIdx < dailyA.figures.length; fIdx++) {
        const fig = dailyA.figures[fIdx];
        const b64Src = resolveImageBase64(fig.url, searchDirs);
        const label = fig.label || `图 ${fIdx + 1}`;
        const badge = fig.category_badge ? ` [${fig.category_badge}]` : "";
        const caption = fig.caption || "";
        html.push(`
        <div class="figure-block">
          <img src="${b64Src}" alt="${label}" />
          <div class="figure-caption"><strong>${label}${badge}：</strong>${renderInlineMarkdownWithMath(caption)}</div>
        </div>
`);
      }
    }

    if (dailyA.result) {
      html.push(`
        <div class="deep-dive-item">
          <div class="deep-dive-label">📊 关键结论与定量测量 (Quantitative Results)</div>
          <div class="deep-dive-content">${renderMarkdownWithMath(dailyA.result)}</div>
        </div>
`);
    }
    if (dailyA.limits) {
      const lims = dailyA.limits;
      const limStr = Array.isArray(lims)
        ? `<ul style="margin: 0; padding-left: 18px;">${lims.map((l) => `<li>${renderInlineMarkdownWithMath(l)}</li>`).join("")}</ul>`
        : `<div class="deep-dive-content">${renderMarkdownWithMath(lims)}</div>`;
      html.push(`
        <div class="deep-dive-item">
          <div class="deep-dive-label">⚠️ 局限性与观测边界 (Limits & Caveats)</div>
          ${limStr}
        </div>
`);
    }
    if (p.reading_guide || dailyA.reading_entry) {
      html.push(`
        <div class="deep-dive-item" style="border-left: 3px solid #0284c7;">
          <div class="deep-dive-label">🎯 建议精读切入点 (Reading Guide)</div>
          <div class="deep-dive-content">${renderInlineMarkdownWithMath(p.reading_guide || dailyA.reading_entry)}</div>
        </div>
`);
    }

    html.push(`
      </div>
    </article>
`);
  }

  html.push(`
  </section>

  <section>
    <div class="section-title">4. 📌 本周重点关注文献 (Worth-Knowing Works · 共 ${worths.length} 篇)</div>
    <p style="font-size: 8pt; color: #64748b; margin-top: -3px; margin-bottom: 8px;">以下文献针对特定机制或子方向提供重要观测线索与实测约束，保持精炼条目，不展开精读详情。</p>
    <div class="worth-grid">
`);

  for (const p of worths) {
    const aid = p.arxiv_id;
    const titleZh = resolvePaperTitleZhSync(p) || p.title || aid;
    const titleEn = p.title || aid;
    const feed = dailyEntryMap.get(aid);
    const authors = (p.authors && p.authors.length > 0 ? p.authors : feed?.authors) || [];
    const authorStr = authors.slice(0, 3).join(", ") + (authors.length > 3 ? " 等" : "");

    html.push(`
      <div class="worth-card">
        <div>
          <span class="${p.isTopPick ? "badge-must" : "badge-worth"}" style="${p.isTopPick ? "background:#fef3c7;color:#92400e;border-color:#fde68a;" : ""}">${p.isTopPick ? "⭐ 重点关注" : "📌 关注"}</span>
          <div class="worth-title-zh"><a href="https://arxiv.org/abs/${aid}">[arXiv:${aid}] ${escapeHtml(titleZh)}</a></div>
        </div>
        <div class="worth-meta"><strong>原题：</strong>${escapeHtml(titleEn)} ｜ <strong>作者：</strong>${escapeHtml(authorStr)}</div>
        ${p.recommendation_reason ? `<div class="worth-desc"><strong>【推荐理由】：</strong>${renderInlineMarkdownWithMath(p.recommendation_reason)}</div>` : ""}
        ${p.core_insight ? `<div class="worth-desc"><strong>【核心要点】：</strong>${renderInlineMarkdownWithMath(p.core_insight)}</div>` : ""}
        ${p.reading_guide ? `<div class="worth-desc" style="color: #64748b;"><strong>【阅读切入】：</strong>${renderInlineMarkdownWithMath(p.reading_guide)}</div>` : ""}
      </div>
`);
  }

  html.push(`
    </div>
  </section>

  <footer class="footer">
    AstroLineage 学术雷达团队研报 · 本期编号 ${weekId} ｜ 报告内所有 arXiv 及站内链接均支持直接点击跳转
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

    execFileSync(binary, args, { stdio: "ignore", timeout: 45000 });

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
  const targetWeek = args[0] || "2026-W42";
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
