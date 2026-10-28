/**
 * src/domain/channel-document.mjs
 *
 * Domain-Driven Section AST for Channel Posts and Notification Egress.
 * Decouples message assembly from raw string slicing (indexOf / replace)
 * and guarantees bidirectional compatibility across language cutovers.
 */

import { isLegacyChineseDate } from "./language-cutover.mjs";
import {
  deriveFigurePhysicalCore,
  getDefaultWebsiteBase,
  getDefaultLocalWebsiteBase,
} from "./academic-domain.mjs";

export const READING_ANCHORS = Object.freeze([
  "\n---\n\n## 📚 阅读入口",
  "\n---\n\n## 阅读入口",
  "\n---\n\n## 📖 Reading Access",
  "\n---\n\n## Reading Access",
  "\n---\n\n## 📖 Reading Entry",
  "\n---\n\n## Reading Entry",
]);

export const BADGE_MAP = Object.freeze({
  数据拟合与模型对比: "Model vs Data Fitting",
  物理模型示意图: "Physical Model Schematic",
  核心物理演化图: "Physical Evolution",
  核心物理结果: "Physical Result",
  核心观测结果: "Observational Evidence",
  "观测总体曲线/能谱": "Observational Light Curve / SED",
});

const TOPIC_CHINESE_LABELS = Object.freeze({
  R1: "中央引擎与能量注入",
  R2: "伽马射线暴与相对论喷流",
  R3: "超新星与星周介质作用",
  R4: "脉冲星风与高能双星",
  R5: "磁星爆发与快速射电暴",
  R6: "致密环境与多信使暂现源",
  R7: "X射线时变、能谱与致密双星",
});

function claimText(value) {
  return String(value ?? "").trim();
}

/**
 * Searches for a reading anchor within a Markdown string.
 * @param {string} body
 * @param {number} [start=0]
 * @returns {{ index: number, anchor: string, isEn: boolean } | null}
 */
export function findReadingAnchor(body, start = 0) {
  const text = String(body ?? "");
  for (const anchor of READING_ANCHORS) {
    const idx = text.indexOf(anchor, start);
    if (idx >= 0) {
      return {
        index: idx,
        anchor,
        isEn: /reading/iu.test(anchor),
      };
    }
  }
  return null;
}

/**
 * Builds an immutable ChannelPostDraft with explicit Section AST nodes.
 * @param {object} item
 * @param {string} date
 * @param {string} [topic]
 * @param {object} [options]
 * @returns {object} ChannelPostDraft
 */
export function buildChannelPostDraft(item, date, topic, options = {}) {
  const a = item.analysis?.analysis || item.analysis || {};
  const coverage = item.analysis?.coverage || {};
  const mustRead = item.analysis?.priority === "must_read";
  const version = `arXiv:${item.arxiv_id}v${item.revision}`;
  const anchor = `radar-paper-${String(item.arxiv_id).replace(".", "-")}-v${item.revision}`;
  const isLegacy = isLegacyChineseDate(date);

  const readerReason = claimText(a.reason)
    .replace(/\bR1[–—-]R7\b/gu, "课题组各研究方向")
    .replace(/\bR[1-7]\b/gu, (id) => TOPIC_CHINESE_LABELS[id] || id);

  const authorStr =
    Array.isArray(item.authors) && item.authors.length
      ? ` · ${item.authors.slice(0, 3).join(", ")}${item.authors.length > 3 ? " 等" : ""}`
      : "";

  const problem = claimText(a.problem?.detailed_text || a.problem?.problem || a.problem || "");
  const result = claimText(a.result?.detailed_text || a.result?.bluf || a.result || "");
  const channelUrl = options.channelUrl || "https://pd.qq.com/s/7xr9egnly";
  const publicSiteUrl = options.publicSiteUrl || getDefaultWebsiteBase();
  const localSiteUrl = options.localSiteUrl || getDefaultLocalWebsiteBase();

  const problemFallback = isLegacy
    ? "未能从已检查材料中核实课题问题陈述。"
    : "Problem statement not verified from checked materials.";
  const resultFallback = isLegacy
    ? "详见原文推导与正文分析。"
    : "See original paper for derivations and analysis.";

  const tag = isLegacy ? (mustRead ? "必读" : "关注") : mustRead ? "Must Read" : "Follow";

  const rawLimits = [...(a.limits || []), ...(a.unresolved_checks || [])];
  const limits = rawLimits
    .map((l) => claimText(typeof l === "string" ? l : l.text || JSON.stringify(l)))
    .filter(Boolean);

  const sections = [
    {
      type: "header",
      tag,
      author: authorStr,
    },
    {
      type: "problem",
      text: problem || problemFallback,
    },
    {
      type: "result",
      text: result || resultFallback,
    },
  ];

  if (readerReason) {
    sections.push({
      type: "reason",
      text: readerReason,
    });
  }

  if (limits.length > 0) {
    sections.push({
      type: "limits",
      items: limits,
    });
  }

  sections.push({
    type: "reading",
    version,
    anchor,
    channelUrl,
    publicSiteUrl,
    localSiteUrl,
    date,
    title: item.title,
    coverageLabel: coverage.label || coverage.level || (isLegacy ? "完整正文" : "Full text"),
  });

  return {
    arxiv_id: item.arxiv_id,
    revision: item.revision,
    date,
    topic,
    isLegacy,
    sections,
  };
}

/**
 * Inserts a reviewed figure section into the draft AST deterministically.
 * @param {object} draft
 * @param {object} figure
 * @param {object} [context]
 * @returns {object} next draft
 */
export function attachReviewedFigure(draft, figure, context = {}) {
  if (!figure) return draft;
  const isEn = !draft.isLegacy;
  const caption = String(figure.caption || "")
    .replace(/\r?\n/gu, " ")
    .trim();
  const physicalCore = (
    figure.physical_core ||
    deriveFigurePhysicalCore(figure, context, { lang: isEn ? "en" : "zh" }) ||
    ""
  ).trim();

  const rawBadge =
    figure.category_badge || figure.label || (isEn ? "Scientific Figure" : "科学图表");
  const badge = isEn ? BADGE_MAP[rawBadge] || rawBadge : rawBadge;

  const figureSection = {
    type: "figure",
    label: figure.label || "Fig.",
    badge,
    caption,
    physical_core: physicalCore,
  };

  const nextSections = draft.sections.filter((s) => s.type !== "figure");
  const readingIdx = nextSections.findIndex((s) => s.type === "reading");
  if (readingIdx >= 0) {
    nextSections.splice(readingIdx, 0, figureSection);
  } else {
    nextSections.push(figureSection);
  }

  return {
    ...draft,
    sections: nextSections,
  };
}

/**
 * Removes any figure section from the draft AST.
 * @param {object} draft
 * @returns {object} next draft
 */
export function stripReviewedFigure(draft) {
  return {
    ...draft,
    sections: draft.sections.filter((s) => s.type !== "figure"),
  };
}

/**
 * Renders a ChannelPostDraft into standardized Markdown.
 * @param {object} draft
 * @returns {string}
 */
export function renderChannelMarkdown(draft) {
  const isLegacy = draft.isLegacy;
  const lines = [];

  for (const section of draft.sections) {
    switch (section.type) {
      case "header":
        lines.push(`**${section.tag}**${section.author}`, "");
        break;

      case "problem":
        lines.push(
          isLegacy ? "## 课题背景" : "## Problem & Background",
          "",
          `> ${section.text}`,
          ""
        );
        break;

      case "result":
        lines.push(
          isLegacy ? "## 核心突破" : "## Key Result & Physical Mechanism",
          "",
          `> ${section.text}`,
          ""
        );
        break;

      case "reason":
        lines.push(isLegacy ? "## 研读价值" : "## Why It Matters", "", `> ${section.text}`, "");
        break;

      case "figure": {
        const heading = isLegacy ? "## 关键图像" : "## Key Figure";
        const coreSection = section.physical_core
          ? isLegacy
            ? `> **物理核心（${section.badge}）**：${section.physical_core}\n>\n`
            : `> **Physical Core (${section.badge})**: ${section.physical_core}\n>\n`
          : "";
        const captionLine = isLegacy
          ? `> 原文 ${section.label} 图注（作者报告）：${section.caption}`
          : `> Original ${section.label} Caption (author-reported): ${section.caption}`;
        lines.push(heading, "", "[(0,0)](@img)", "", `${coreSection}${captionLine}`, "");
        break;
      }

      case "limits":
        lines.push(
          isLegacy ? "## 限制与边界" : "## Limitations & Boundaries",
          "",
          ...section.items.map((it) => `- ${it}`),
          ""
        );
        break;

      case "reading": {
        lines.push(
          "---",
          "",
          isLegacy ? "## 阅读入口" : "## Reading Access",
          "",
          isLegacy
            ? `- **公网在线阅读 (Cloudflare)**: [打开网页深度导读](${section.publicSiteUrl}/arxiv-daily/${section.date}/#${section.anchor})`
            : `- **Online Reading (Cloudflare)**: [Read Full Brief](${section.publicSiteUrl}/arxiv-daily/${section.date}/#${section.anchor})`,
          isLegacy
            ? `- **校内/局域网直连**: [打开校内直连导读](${section.localSiteUrl}/arxiv-daily/${section.date}/#${section.anchor})`
            : `- **Direct / Local Network**: [Read Direct Brief](${section.localSiteUrl}/arxiv-daily/${section.date}/#${section.anchor})`,
          isLegacy
            ? `- **QQ 频道社区交流帖**: [进入频道讨论](${section.channelUrl})`
            : `- **QQ Channel Discussion**: [Join Channel Discussion](${section.channelUrl})`,
          isLegacy
            ? `- **官方论文原文**: [${section.version}](https://arxiv.org/abs/${draft.arxiv_id}v${draft.revision}) · [📄 PDF](https://arxiv.org/pdf/${draft.arxiv_id})`
            : `- **Official Paper**: [${section.version}](https://arxiv.org/abs/${draft.arxiv_id}v${draft.revision}) · [📄 PDF](https://arxiv.org/pdf/${draft.arxiv_id})`,
          "",
          isLegacy ? `原标题：${section.title}` : `Title: ${section.title}`,
          "",
          isLegacy
            ? `实际阅读范围：${section.coverageLabel}。本帖摘录作者报告的结果；完整条件与图表见网页原记录。`
            : `Reading coverage: ${section.coverageLabel}. Excerpted from author reports; see website for full conditions and figures.`
        );
        break;
      }

      default:
        break;
    }
  }

  return lines.join("\n").replace(/\n{3,}/gu, "\n\n");
}

/**
 * Universal figure attacher supporting both ChannelPostDraft AST and raw Markdown string.
 * @param {string | object} bodyOrDraft
 * @param {object} figure
 * @param {object} [context]
 * @returns {string}
 */
export function bodyWithReviewedFigure(bodyOrDraft, figure, context = {}) {
  const body =
    bodyOrDraft && typeof bodyOrDraft === "object" && Array.isArray(bodyOrDraft.sections)
      ? renderChannelMarkdown(bodyOrDraft)
      : String(bodyOrDraft ?? "");

  const reading = findReadingAnchor(body);
  if (!reading) throw new Error("CHANNEL_FIGURE_BODY_ANCHOR_MISSING");
  const marker = reading.anchor;
  const caption = String(figure.caption || "")
    .replace(/\r?\n/gu, " ")
    .trim();
  const isEn = reading.isEn;
  const physicalCore = (
    figure.physical_core ||
    deriveFigurePhysicalCore(figure, context, { lang: isEn ? "en" : "zh" }) ||
    ""
  ).trim();

  const rawBadge =
    figure.category_badge || figure.label || (isEn ? "Scientific Figure" : "科学图表");
  const badge = isEn ? BADGE_MAP[rawBadge] || rawBadge : rawBadge;
  const coreSection = physicalCore
    ? isEn
      ? `> **Physical Core (${badge})**: ${physicalCore}\n>\n`
      : `> **物理核心（${badge}）**：${physicalCore}\n>\n`
    : "";
  const heading = isEn ? "## Key Figure" : "## 关键图像";
  const captionLine = isEn
    ? `> Original ${figure.label} Caption (author-reported): ${caption}`
    : `> 原文 ${figure.label} 图注（作者报告）：${caption}`;
  return body.replace(
    marker,
    `\n\n${heading}\n\n[(0,0)](@img)\n\n${coreSection}${captionLine}${marker}`
  );
}

/**
 * Universal figure stripper supporting both ChannelPostDraft AST and raw Markdown string.
 * @param {string | object} value
 * @returns {string | null}
 */
export function bodyWithoutManagedFigure(value) {
  if (value && typeof value === "object" && Array.isArray(value.sections)) {
    const stripped = stripReviewedFigure(value);
    return renderChannelMarkdown(stripped);
  }

  const body = String(value ?? "");
  let figurePrefix = "\n\n## 关键图像\n\n[(0,0)](@img)\n\n";
  let start = body.indexOf(figurePrefix);
  if (start < 0) {
    figurePrefix = "\n\n## Key Figure\n\n[(0,0)](@img)\n\n";
    start = body.indexOf(figurePrefix);
  }
  if (start < 0 || start !== body.lastIndexOf(figurePrefix)) return null;
  const reading = findReadingAnchor(body, start);
  if (!reading) return null;
  const end = reading.index;
  const figureContent = body.slice(start + figurePrefix.length, end).trim();
  if (
    !figureContent.includes("图注（作者报告）：") &&
    !figureContent.includes("Caption (author-reported):")
  ) {
    return null;
  }
  return body.slice(0, start) + body.slice(end);
}
