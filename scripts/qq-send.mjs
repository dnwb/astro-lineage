#!/usr/bin/env node
/**
 * AstroLineage QQ Bot 私信与群聊通知主动发送工具
 *
 * 用法:
 *   node scripts/qq-send.mjs "测试通知内容"                    # 自动发送私信给最近交互的用户 OpenID
 *   node scripts/qq-send.mjs --to <userOpenid> "测试内容"       # 发送私信给指定 OpenID
 *   node scripts/qq-send.mjs --group "群消息内容"              # 自动发送到最近交互的群聊 GroupOpenID
 *   node scripts/qq-send.mjs --group <groupOpenid> "内容"      # 发送到指定群聊
 *   node scripts/qq-send.mjs --list                            # 列出所有已记录的用户与群聊 OpenID
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFile, mkdir, chmod, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { defaultUserManager, maskOpenid } from "./qq-users.mjs";
import { sendProactiveC2CMessage, sendProactiveGroupMessage } from "./qq-official-bot.mjs";
import {
  readPublishedArxivEdition,
  acquireRefreshLock,
  releaseRefreshLock,
  writeJsonAtomically,
} from "./arxiv-daily.mjs";
import { validateDailyRadarPayload } from "./daily-radar.mjs";
import { hashBody, readDailyArchive, readChannelShareUrl } from "./channel-publication.mjs";
import { readingExcerpt } from "./tencent-channel-publisher.mjs";
import {
  deriveDailyTitleCandidate,
  deriveWeeklyTitleCandidate,
  extractPaperTopic,
} from "./channel-title-policy.mjs";
import { formatAnnouncementInBeijing } from "../src/domain/academic-domain.mjs";
import { OfficialQqBotAdapter, dispatchIntelligence } from "./intelligence-egress.mjs";
import {
  resolveFeedShareUrl,
  resolveWeeklyFeedShareUrl,
  resolvePaperFeedShareUrl,
  resolveDailySummaryShareUrl,
} from "./channel-feed-resolver.mjs";

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

export async function generateGroupBrief(type = "daily", options = {}) {
  if (!["daily", "weekly"].includes(type)) throw new Error("QQ_NOTIFY_KIND_INVALID");
  let { dailyModel: model, weekly, date, sourceBinding, channelUrl } = options;
  let publicationHash;
  const websiteBase = (
    options.websiteBase ||
    process.env.SITE_BASE_URL ||
    process.env.ASTRO_SITE_URL ||
    "http://localhost:4321"
  ).replace(/\/+$/u, "");
  if (!(type === "daily" ? model : weekly)) {
    if (!sourceBinding) {
      const website = JSON.parse(await readFile(".cache/notebooklm/website.json", "utf8"));
      if (website.status !== "success") throw new Error("QQ_SOURCE_BUILD_REQUIRED");
      sourceBinding = website.source_binding;
    }
    const { daily, weekly: weeklyBinding, archives, id } = sourceBinding || {};
    if (
      !daily?.generation_id ||
      !weeklyBinding?.hash ||
      !archives ||
      hashBody(JSON.stringify({ daily, weekly: weeklyBinding, archives })) !== id
    )
      throw new Error("QQ_SOURCE_BUILD_REQUIRED");
    if (type === "weekly") {
      const weeklyPath = options.weeklyPath || "src/data/arxiv-weekly.json";
      if ((await stat(weeklyPath)).size > 20_000_000) throw new Error("QQ_SOURCE_INVALID");
      const bytes = await readFile(weeklyPath);
      if (hashBody(bytes) !== weeklyBinding.hash) throw new Error("QQ_SOURCE_BUILD_MISMATCH");
      weekly = JSON.parse(bytes);
      publicationHash = weeklyBinding.hash;
    } else {
      const published = await (options.readEdition || readPublishedArxivEdition)();
      if (
        published.generation_id !== daily.generation_id ||
        hashBody(JSON.stringify({ feed: published.feed, radar: published.radar })) !== daily.hash
      )
        throw new Error("QQ_SOURCE_BUILD_MISMATCH");
      date = published.feed.window?.announcement_date;
      if (!/^\d{4}-\d\d-\d\d$/u.test(date || "")) throw new Error("QQ_SOURCE_INVALID");
      if (archives[date]) {
        const path = resolve(
          options.archiveRoot || "src/data/arxiv-archives/daily",
          `${date}.json`
        );
        const bytes = await readFile(path);
        if (hashBody(bytes) !== archives[date]) throw new Error("QQ_SOURCE_BUILD_MISMATCH");
        model = await readDailyArchive(path, date, options.distRoot || "dist", bytes);
        publicationHash = archives[date];
      } else {
        const checked = validateDailyRadarPayload(published.feed, published.radar);
        if (!checked.valid) throw new Error("QQ_SOURCE_INVALID");
        model = checked.model;
        publicationHash = daily.hash;
      }
    }
  }
  channelUrl = await readChannelShareUrl({ url: channelUrl || process.env.ASTRO_CHANNEL_URL });
  let channelAddress, readerAddress;
  try {
    channelAddress = new URL(channelUrl);
    readerAddress = new URL(websiteBase);
  } catch {
    throw new Error("QQ_CHANNEL_LINK_REQUIRED");
  }
  if (
    channelAddress.protocol !== "https:" ||
    channelAddress.hostname !== "pd.qq.com" ||
    channelAddress.username ||
    channelAddress.password
  )
    throw new Error("QQ_CHANNEL_LINK_REQUIRED");
  if (
    !["http:", "https:"].includes(readerAddress.protocol) ||
    readerAddress.username ||
    readerAddress.password ||
    readerAddress.search ||
    readerAddress.hash
  )
    throw new Error("QQ_SOURCE_INVALID");
  const isMarkdown = options.format === "markdown" || options.markdown === true;
  const lines = [];
  if (type === "weekly") {
    if (!/^\d{4}-W\d\d$/u.test(weekly.week_id || "") || !weekly.executive_summary)
      throw new Error("QQ_SOURCE_INVALID");
    const weeklyTitle = deriveWeeklyTitleCandidate(weekly.week_id, weekly);
    const weeklyPostUrl = resolveWeeklyFeedShareUrl(weekly.week_id, { fallbackUrl: channelUrl });
    if (isMarkdown) {
      lines.push(`# [${weeklyTitle}](${weeklyPostUrl})`, "");
      const topPick = (weekly.top_picks || [])[0];
      if (topPick) {
        const rev = topPick.revision || 1;
        lines.push(
          `- **信源**: [arXiv:${topPick.arxiv_id}v${rev}](https://arxiv.org/abs/${topPick.arxiv_id}v${rev}) · [📄 PDF](https://arxiv.org/pdf/${topPick.arxiv_id}) · **频道交流**: [进入周报讨论帖](${weeklyPostUrl})`,
          ""
        );
      }
      lines.push(
        `📅 ${weekly.date_range || ""} · 研读共 ${(weekly.papers || []).length} 篇`,
        "",
        `> ${weekly.executive_summary}`,
        ""
      );

      const mustReadPicks = (weekly.top_picks || [])
        .filter((p) => p.priority === "must_read")
        .slice(0, 3);
      const worthKnowingPicks = (weekly.top_picks || [])
        .filter((p) => p.priority !== "must_read")
        .slice(0, 5);
      const targetPicks =
        mustReadPicks.length > 0 ? mustReadPicks : (weekly.top_picks || []).slice(0, 1);

      for (const pick of targetPicks) {
        if (!/^\d{4}\.\d{4,5}$/u.test(pick.arxiv_id || "")) throw new Error("QQ_SOURCE_INVALID");
        const revision =
          pick.revision || weekly.papers?.find((p) => p.arxiv_id === pick.arxiv_id)?.revision || 1;
        const suffix = Number.isSafeInteger(revision) && revision > 0 ? `v${revision}` : "";
        const paperObj = weekly.papers?.find((p) => p.arxiv_id === pick.arxiv_id);
        const authors = paperObj?.authors || pick.authors;
        const authorStr =
          Array.isArray(authors) && authors.length > 0
            ? authors.length > 2
              ? `${authors[0]} 等`
              : authors.join(", ")
            : "";
        const authorSuffix = authorStr ? ` (${authorStr})` : "";
        const paperPostUrl = resolvePaperFeedShareUrl(pick.arxiv_id, { fallbackUrl: channelUrl });
        lines.push(
          "---",
          `### ⭐ 必读｜${extractPaperTopic(pick)}${authorSuffix}`,
          `**[${pick.title || ""}](${pick.url || `https://arxiv.org/abs/${pick.arxiv_id}${suffix}`})**`,
          `- **arXiv 原文**: [arXiv:${pick.arxiv_id}${suffix}](https://arxiv.org/abs/${pick.arxiv_id}${suffix}) · [📄 PDF](https://arxiv.org/pdf/${pick.arxiv_id})`,
          `- **频道研讨**: [进入对应频道研讨帖](${paperPostUrl})`,
          `- **网页精读**: [查看网页周报综述](${websiteBase}/arxiv-weekly/${weekly.week_id}/)`,
          "",
          `> **【核心洞察】** ${pick.core_insight || pick.reason || ""}`,
          `> **【推荐理由】** ${pick.recommendation_reason || pick.reason || ""}`,
          ""
        );
      }

      if (worthKnowingPicks.length > 0) {
        lines.push("---", "### 📌 关注", "");
        for (const pick of worthKnowingPicks) {
          const rev = pick.revision || 1;
          const paperPostUrl = resolvePaperFeedShareUrl(pick.arxiv_id, { fallbackUrl: channelUrl });
          lines.push(
            `- **${extractPaperTopic(pick)}** ｜ [${pick.title || ""}](${pick.url || `https://arxiv.org/abs/${pick.arxiv_id}v${rev}`}) · [arXiv:${pick.arxiv_id}](https://arxiv.org/abs/${pick.arxiv_id}v${rev}) · [频道交流](${paperPostUrl})`
          );
        }
        lines.push("");
      }
    } else {
      lines.push(
        weeklyTitle,
        weekly.date_range || "",
        "",
        readingExcerpt(weekly.executive_summary),
        ""
      );
      for (const pick of (weekly.top_picks || []).slice(0, 3)) {
        if (!/^\d{4}\.\d{4,5}$/u.test(pick.arxiv_id || "")) throw new Error("QQ_SOURCE_INVALID");
        const revision =
          pick.revision || weekly.papers?.find((p) => p.arxiv_id === pick.arxiv_id)?.revision;
        const suffix = Number.isSafeInteger(revision) && revision > 0 ? `v${revision}` : "";
        const paperObj = weekly.papers?.find((p) => p.arxiv_id === pick.arxiv_id);
        const authors = paperObj?.authors || pick.authors;
        const authorStr =
          Array.isArray(authors) && authors.length > 0
            ? authors.length > 2
              ? `${authors[0]} 等`
              : authors.join(", ")
            : "";
        const authorSuffix = authorStr ? ` (${authorStr})` : "";
        lines.push(
          `• ${pick.priority === "must_read" ? "必读" : "关注"}｜${extractPaperTopic(pick)}${authorSuffix}`,
          readingExcerpt(pick.reason || pick.recommendation_reason || pick.core_insight),
          `原文：https://arxiv.org/abs/${pick.arxiv_id}${suffix}`,
          ""
        );
      }
    }
  } else {
    let brief = model.opening_brief;
    let fallbackInfo = null;
    const requestedDate = options.date || date;
    if (!/^\d{4}-\d\d-\d\d$/u.test(date || "")) throw new Error("QQ_SOURCE_INVALID");
    if (options.date && /^\d{4}-\d\d-\d\d$/u.test(options.date)) {
      date = options.date;
      try {
        const archivePath = resolve(
          fileURLToPath(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url))
        );
        const bytes = await readFile(archivePath);
        model = await readDailyArchive(archivePath, date, options.distRoot || "dist", bytes);
        brief = model.opening_brief;
      } catch {}
    }
    if (brief?.status !== "ready") {
      try {
        const archiveDir = resolve(
          fileURLToPath(new URL("../src/data/arxiv-archives/daily", import.meta.url))
        );
        const files = (await (await import("node:fs/promises")).readdir(archiveDir))
          .filter((f) => f.endsWith(".json"))
          .sort()
          .reverse();
        for (const f of files) {
          const archivePath = resolve(archiveDir, f);
          const bytes = await readFile(archivePath);
          const archive = JSON.parse(bytes);
          const b = archive?.radar?.opening_brief || archive?.opening_brief;
          if (b?.status === "ready") {
            const candidateDate = f.replace(/\.json$/u, "");
            model = await readDailyArchive(
              archivePath,
              candidateDate,
              options.distRoot || "dist",
              bytes
            );
            brief = model.opening_brief?.status === "ready" ? model.opening_brief : b;
            if (candidateDate !== requestedDate) {
              fallbackInfo = {
                requestedDate,
                fallbackDate: candidateDate,
                reason: "当期官方（arXiv）休刊或无新增论文公布",
              };
            }
            date = candidateDate;
            break;
          }
        }
      } catch {}
    }
    if (
      brief?.status !== "ready" &&
      (model.groups?.must_read?.length || 0) + (model.groups?.worth_knowing?.length || 0) > 0
    ) {
      const firstPaper = model.groups?.must_read?.[0] || model.groups?.worth_knowing?.[0];
      const count =
        (model.groups?.must_read?.length || 0) + (model.groups?.worth_knowing?.length || 0);
      brief = {
        status: "ready",
        intro: `本期首看《${firstPaper.title}》等 ${count} 篇核心进展。`,
        must_read: (model.groups?.must_read || []).map((p) => {
          const a = p.analysis?.analysis || p.analysis || {};
          const text = a.result?.detailed_text || a.result?.bluf || a.result || p.title;
          return {
            arxiv_id: p.arxiv_id,
            revision: p.revision,
            text: typeof text === "string" ? text.slice(0, 150) : p.title,
          };
        }),
        worth_knowing_summary: model.groups?.worth_knowing?.length
          ? `包含 ${model.groups.worth_knowing.length} 篇重要进展。`
          : "",
      };
    }
    if (brief?.status !== "ready") throw new Error("QQ_SOURCE_INVALID");
    let dailyTitle;
    try {
      const papers = [...(model.groups.must_read || []), ...(model.groups.worth_knowing || [])];
      dailyTitle = deriveDailyTitleCandidate(date, papers, brief);
    } catch (titleErr) {
      const topPaper = (model.groups.must_read || [])[0] || (model.groups.worth_knowing || [])[0];
      if (topPaper && brief?.status === "ready") {
        const topic = extractPaperTopic(topPaper);
        dailyTitle = `「${date}」${topic}`;
      } else {
        const archiveDir = resolve(
          fileURLToPath(new URL("../src/data/arxiv-archives/daily", import.meta.url))
        );
        const files = (await (await import("node:fs/promises")).readdir(archiveDir))
          .filter((f) => f.endsWith(".json") && f !== `${date}.json`)
          .sort()
          .reverse();
        for (const f of files) {
          try {
            const prevDate = f.replace(/\.json$/u, "");
            const archivePath = resolve(archiveDir, f);
            const bytes = await readFile(archivePath);
            const prevModel = await readDailyArchive(
              archivePath,
              prevDate,
              options.distRoot || "dist",
              bytes
            );
            const prevBrief =
              prevModel.opening_brief?.status === "ready"
                ? prevModel.opening_brief
                : JSON.parse(bytes).radar?.opening_brief;
            const prevPapers = [
              ...(prevModel.groups.must_read || []),
              ...(prevModel.groups.worth_knowing || []),
            ];
            if (prevBrief?.status === "ready" && prevPapers.length > 0) {
              dailyTitle = deriveDailyTitleCandidate(prevDate, prevPapers, prevBrief);
              const hasApiFailure = (model?.radar?.analyses || []).some(
                (a) => a.status === "failed"
              );
              const originalReason = hasApiFailure
                ? "当期论文深度研读出现异常，正在等待恢复"
                : brief?.status !== "ready"
                  ? "当期前沿论文研判正在处理中"
                  : "当期官方（arXiv）休刊或无新增论文公布";
              fallbackInfo = {
                requestedDate: date,
                fallbackDate: prevDate,
                reason: originalReason,
              };
              date = prevDate;
              model = prevModel;
              brief = prevBrief;
              break;
            }
          } catch {}
        }
        if (!dailyTitle) throw titleErr;
      }
    }
    if (isMarkdown) {
      const beijingInfo = formatAnnouncementInBeijing(date);
      const beijingShortDate = beijingInfo.shortDate || date.slice(5);
      const progressClaim = dailyTitle.replace(/^「[^」]+」/u, "");
      const displayDailyTitle = `「${beijingShortDate}」${progressClaim}`;

      lines.push(`# [${displayDailyTitle}](${channelUrl})`, "");
      const topPaper = (model.groups.must_read || [])[0] || (model.groups.worth_knowing || [])[0];
      if (topPaper) {
        const rev = topPaper.revision || 1;
        lines.push(
          `- **信源**: [arXiv:${topPaper.arxiv_id}v${rev}](https://arxiv.org/abs/${topPaper.arxiv_id}v${rev}) · [📄 PDF](https://arxiv.org/pdf/${topPaper.arxiv_id}) · **频道交流**: [进入 QQ 频道讨论](${channelUrl})`,
          ""
        );
      }
      if (fallbackInfo) {
        lines.push(`> ℹ️ **【批次说明】** 因${fallbackInfo.reason}，本次推送上一期完整成果。`, "");
      }
      lines.push(`> ${brief.intro}`, "");

      const mustReadList = (model.groups.must_read || []).slice(0, 3);
      if (mustReadList.length > 0) {
        for (const paper of mustReadList) {
          const authors = paper.entry?.authors || paper.authors;
          const authorStr =
            Array.isArray(authors) && authors.length > 0
              ? authors.length > 2
                ? `${authors[0]} 等`
                : authors.join(", ")
              : "";
          const authorSuffix = authorStr ? ` · ${authorStr}` : "";
          const a = paper.analysis?.analysis || paper.analysis || {};
          const problem = (
            a.problem?.detailed_text ||
            a.problem?.problem ||
            a.problem ||
            ""
          ).trim();
          const result = (a.result?.detailed_text || a.result?.bluf || a.result || "").trim();
          const reason = (a.reason?.detailed_text || a.reason?.reason || a.reason || "").trim();
          const anchor = `radar-paper-${paper.arxiv_id.replace(".", "-")}-v${paper.revision || 1}`;
          lines.push(
            "---",
            `### ⭐ 必读｜[${extractPaperTopic(paper)}](${channelUrl})${authorSuffix}`,
            `**[${paper.title}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1})**`,
            `- **arXiv 原文**: [arXiv:${paper.arxiv_id}v${paper.revision || 1}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1}) · [📄 PDF](https://arxiv.org/pdf/${paper.arxiv_id})`,
            `- **频道研讨**: [进入对应频道研讨帖](${channelUrl})`,
            `- **网页精读**: [查看网页完整图表与证据链](${websiteBase}/arxiv-daily/${date}/#${anchor})`,
            "",
            problem ? `> **【背景】** ${problem}\n` : "",
            result ? `> **【突破】** ${result}\n` : "",
            reason ? `> **【价值】** ${reason}\n` : ""
          );
        }
      } else {
        lines.push("> ℹ️ **【批次说明】** 当期无必读突破，关注以下进展。", "");
      }

      const worthKnowingList = (model.groups.worth_knowing || []).slice(0, 5);
      if (worthKnowingList.length > 0) {
        if (mustReadList.length === 0) {
          for (const paper of worthKnowingList.slice(0, 3)) {
            const authors = paper.entry?.authors || paper.authors;
            const authorStr =
              Array.isArray(authors) && authors.length > 0
                ? authors.length > 2
                  ? `${authors[0]} 等`
                  : authors.join(", ")
                : "";
            const authorSuffix = authorStr ? ` · ${authorStr}` : "";
            const a = paper.analysis?.analysis || paper.analysis || {};
            const problem = (
              a.problem?.detailed_text ||
              a.problem?.problem ||
              a.problem ||
              ""
            ).trim();
            const result = (
              a.result?.detailed_text ||
              a.result?.bluf ||
              a.result ||
              a.research_progress ||
              ""
            ).trim();
            const reason = (a.reason?.detailed_text || a.reason?.reason || a.reason || "").trim();
            const anchor = `radar-paper-${paper.arxiv_id.replace(".", "-")}-v${paper.revision || 1}`;
            lines.push(
              "---",
              `### 📌 关注｜[${extractPaperTopic(paper)}](${channelUrl})${authorSuffix}`,
              `**[${paper.title}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1})**`,
              `- **arXiv 原文**: [arXiv:${paper.arxiv_id}v${paper.revision || 1}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1}) · [📄 PDF](https://arxiv.org/pdf/${paper.arxiv_id})`,
              `- **频道研讨**: [进入对应频道研讨帖](${channelUrl})`,
              `- **网页精读**: [查看网页完整图表与证据链](${websiteBase}/arxiv-daily/${date}/#${anchor})`,
              "",
              problem ? `> **【背景】** ${problem}\n` : "",
              result ? `> **【进展】** ${result}\n` : "",
              reason ? `> **【价值】** ${reason}\n` : ""
            );
          }
          if (worthKnowingList.length > 3) {
            lines.push("---", "### 📌 关注", "");
            for (const paper of worthKnowingList.slice(3)) {
              const topic = extractPaperTopic(paper);
              const rev = paper.revision || 1;
              lines.push(
                `- **${topic}** ｜ [${paper.title}](https://arxiv.org/abs/${paper.arxiv_id}v${rev}) · [arXiv:${paper.arxiv_id}](https://arxiv.org/abs/${paper.arxiv_id}v${rev}) · [频道交流](${channelUrl})`
              );
            }
            lines.push("");
          }
        } else {
          lines.push("---", "### 📌 关注", "");
          for (const paper of worthKnowingList) {
            const topic = extractPaperTopic(paper);
            const rev = paper.revision || 1;
            lines.push(
              `- **${topic}** ｜ [${paper.title}](https://arxiv.org/abs/${paper.arxiv_id}v${rev}) · [arXiv:${paper.arxiv_id}](https://arxiv.org/abs/${paper.arxiv_id}v${rev}) · [频道交流](${channelUrl})`
            );
          }
          lines.push("");
        }
      }
    } else {
      lines.push(dailyTitle, date, "", brief.intro, "");
      const mustReadList = (brief.must_read || []).slice(0, 3);
      if (mustReadList.length > 0) {
        for (const sentence of mustReadList) {
          const paper = (model.groups.must_read || []).find(
            (p) => p.arxiv_id === sentence.arxiv_id && p.revision === sentence.revision
          );
          if (!paper) throw new Error("QQ_SOURCE_INVALID");
          const authors = paper.entry?.authors || paper.authors;
          const authorStr =
            Array.isArray(authors) && authors.length > 0
              ? authors.length > 2
                ? `${authors[0]} 等`
                : authors.join(", ")
              : "";
          const authorSuffix = authorStr ? ` (${authorStr})` : "";
          lines.push(
            `• 必读｜${extractPaperTopic(paper)}${authorSuffix}`,
            sentence.text,
            `原文：https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision}`,
            ""
          );
        }
      } else {
        lines.push("【批次说明】当期无必读突破，关注以下进展。", "");
        for (const paper of (model.groups.worth_knowing || []).slice(0, 3)) {
          const authors = paper.entry?.authors || paper.authors;
          const authorStr =
            Array.isArray(authors) && authors.length > 0
              ? authors.length > 2
                ? `${authors[0]} 等`
                : authors.join(", ")
              : "";
          const authorSuffix = authorStr ? ` (${authorStr})` : "";
          const a = paper.analysis?.analysis || paper.analysis || {};
          const text =
            a.result?.detailed_text ||
            a.result?.bluf ||
            a.result ||
            a.research_progress ||
            paper.title;
          lines.push(
            `• 关注｜${extractPaperTopic(paper)}${authorSuffix}`,
            typeof text === "string" ? text.slice(0, 150) : paper.title,
            `原文：https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1}`,
            ""
          );
        }
      }
      if (
        mustReadList.length > 0 &&
        model.groups.worth_knowing?.length &&
        brief.worth_knowing_summary
      ) {
        lines.push("关注", readingExcerpt(brief.worth_knowing_summary), "");
      }
    }
  }
  const channelState = options.delivery?.channel?.[type]?.status;
  if (channelState && !["success", "skipped"].includes(channelState))
    lines.push("频道部分内容待同步；以下网页导读已发布。", "");
  if (options.delivery?.notebooklm?.status && options.delivery.notebooklm.status !== "success")
    lines.push("NotebookLM 同步待恢复。", "");
  const route = type === "weekly" ? `arxiv-weekly/${weekly.week_id}` : `arxiv-daily/${date}`;
  if (isMarkdown) {
    lines.push(
      "---",
      "",
      "### 📚 完整阅读入口",
      `- **内网/校内完整网页与图表**: [打开网页深度导读](${websiteBase}/${route}/)`,
      `- **QQ 频道社区交流帖**: [进入频道讨论](${channelUrl})`
    );
  } else {
    lines.push(
      "频道讨论",
      channelUrl,
      "",
      "完整导读 · 图表、推导与证据",
      `${websiteBase}/${route}/`
    );
  }
  const text = lines.filter((line) => line !== undefined).join("\n");
  if (Buffer.byteLength(text) > 12_000) throw new Error("QQ_NOTIFY_CONTENT_LIMIT");
  return options.withSourceIdentity ? { content: text, publicationHash } : text;
}

export function renderSinglePaperCardMarkdown(p, options = {}) {
  const a = p.analysis?.analysis || p.analysis || {};
  const date = options.date || p.dailyDate || new Date().toISOString().slice(0, 10);
  const websiteBase = (
    process.env.SITE_BASE_URL ||
    process.env.ASTRO_SITE_URL ||
    "http://10.131.43.83:4321"
  ).replace(/\/+$/u, "");
  const channelUrl = options.channelUrl || "https://pd.qq.com/s/7xr9egnly";
  const mustRead = p.analysis?.priority === "must_read" || p.priority === "must_read";
  const authorStr =
    Array.isArray(p.authors) && p.authors.length
      ? p.authors.slice(0, 3).join(", ") + (p.authors.length > 3 ? " 等" : "")
      : "";
  const problem = (a.problem?.detailed_text || a.problem?.problem || a.problem || "").trim();
  const result = (a.result?.detailed_text || a.result?.bluf || a.result || "").trim();
  const reason = (a.reason?.detailed_text || a.reason?.reason || a.reason || "").trim();
  const limits = [...(a.limits || []), ...(a.unresolved_checks || [])];
  const revision = p.revision || 1;
  const anchor = `radar-paper-${p.arxiv_id.replace(".", "-")}-v${revision}`;

  const lines = [
    `# ${mustRead ? "⭐ 必读" : "📌 关注"}｜${p.title}`,
    "",
    `- **arXiv**: [${p.arxiv_id}v${revision}](https://arxiv.org/abs/${p.arxiv_id}v${revision}) · [📄 PDF](https://arxiv.org/pdf/${p.arxiv_id})`,
    `- **作者**: ${authorStr || "未说明"}`,
    `- **分类**: ${p.primary_category || "astro-ph.HE"}`,
    "",
    "---",
    "",
    "### 🎯 课题背景",
    `> ${problem || "未能从已检查材料中核实课题问题陈述。"}`,
    "",
    "### 🚀 核心突破",
    `> ${result || "详见原文推导与正文分析。"}`,
    "",
  ];

  if (reason) {
    lines.push("### 💡 研读价值", `> ${reason}`, "");
  }

  if (limits.length) {
    lines.push("### ⚠️ 限制与边界条件", "");
    for (const l of limits) {
      lines.push(`- ${typeof l === "string" ? l : l.text || JSON.stringify(l)}`);
    }
    lines.push("");
  }

  const paperPostUrl = resolvePaperFeedShareUrl(p.arxiv_id, { fallbackUrl: channelUrl });

  lines.push(
    "---",
    "",
    "### 📚 完整阅读入口",
    `- **内网/校内完整网页与图表**: [打开网页深度导读](${websiteBase}/arxiv-daily/${date}/#${anchor})`,
    `- **QQ 频道社区交流帖**: [进入频道讨论](${paperPostUrl})`,
    `- **官方论文原文**: [arXiv:${p.arxiv_id}v${revision}](https://arxiv.org/abs/${p.arxiv_id}v${revision})`
  );

  return lines.join("\n");
}

export async function generateSinglePaperCard(arxivId, options = {}) {
  const cleanId = String(arxivId || "")
    .trim()
    .replace(/^arXiv:/i, "")
    .replace(/v\d+$/i, "");
  const fs = await import("node:fs/promises");
  let paper = null,
    date = null;
  const archiveDir = resolve(
    fileURLToPath(new URL("../src/data/arxiv-archives/daily", import.meta.url))
  );
  try {
    const files = (await fs.readdir(archiveDir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    for (const f of files) {
      const data = JSON.parse(await fs.readFile(resolve(archiveDir, f), "utf8"));
      const found = (data.feed?.entries || []).find((e) => e.arxiv_id === cleanId);
      if (found) {
        const a = (data.radar?.analyses || []).find((x) => x.arxiv_id === cleanId);
        paper = { ...found, analysis: a || found.analysis };
        date = data.date;
        break;
      }
    }
  } catch {}
  if (!paper) {
    try {
      const feed = JSON.parse(
        await fs.readFile(
          resolve(fileURLToPath(new URL("../src/data/arxiv-daily.json", import.meta.url))),
          "utf8"
        )
      );
      const radar = JSON.parse(
        await fs.readFile(
          resolve(fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url))),
          "utf8"
        )
      );
      const found = (feed.entries || []).find((e) => e.arxiv_id === cleanId);
      if (found) {
        const a = (radar.analyses || []).find((x) => x.arxiv_id === cleanId);
        paper = { ...found, analysis: a || found.analysis };
        date = feed.window?.announcement_date || new Date().toISOString().slice(0, 10);
      }
    } catch {}
  }
  if (!paper) throw new Error("PAPER_NOT_FOUND");
  return renderSinglePaperCardMarkdown(paper, { date, ...options });
}

export async function notifyGroupPublication({
  kinds,
  sourceBinding,
  delivery,
  cache = ".cache/notebooklm/qq-notifications",
  enabled = process.env.QQ_GROUP_NOTIFY_ENABLED === "true",
  groupOpenid,
  groupOpenids,
  brief = generateGroupBrief,
  send = sendProactiveGroupMessage,
  markdown = true,
} = {}) {
  if (
    !Array.isArray(kinds) ||
    !kinds.length ||
    kinds.some((kind) => !["daily", "weekly"].includes(kind)) ||
    new Set(kinds).size !== kinds.length
  )
    throw new Error("QQ_NOTIFY_KIND_INVALID");

  // Determine target group list
  let targetGroups = [];
  if (Array.isArray(groupOpenids) && groupOpenids.length > 0) {
    targetGroups = groupOpenids.map((g) => (typeof g === "string" ? g.trim() : "")).filter(Boolean);
  } else if (groupOpenid !== undefined) {
    targetGroups =
      typeof groupOpenid === "string" && groupOpenid.trim() ? [groupOpenid.trim()] : [""];
  } else {
    targetGroups = defaultUserManager.getNotificationGroupOpenids();
    if (targetGroups.length === 0) {
      const fallback =
        process.env.QQ_NOTIFY_GROUP_OPENID || defaultUserManager.getLatestGroupOpenid();
      if (fallback) targetGroups = [fallback.trim()];
    }
  }

  const targets = {},
    outbox = {};
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const lock = resolve(cache, "notify.lock");
  await acquireRefreshLock(lock);
  try {
    let ledger;
    try {
      const bytes = await readFile(resolve(cache, "ledger.json"), "utf8");
      if (Buffer.byteLength(bytes) > 1_000_000) throw new Error("QQ_NOTIFY_LEDGER_INVALID");
      ledger = JSON.parse(bytes);
    } catch (error) {
      if (error.code === "ENOENT") ledger = { version: 1, items: {} };
      else return { status: "blocked", code: "QQ_NOTIFY_LEDGER_INVALID", targets };
    }
    if (
      ledger?.version !== 1 ||
      !ledger.items ||
      typeof ledger.items !== "object" ||
      Array.isArray(ledger.items)
    )
      return { status: "blocked", code: "QQ_NOTIFY_LEDGER_INVALID", targets };
    const save = async () => {
      await writeJsonAtomically(resolve(cache, "ledger.json"), ledger);
      await chmod(resolve(cache, "ledger.json"), 0o600);
    };

    for (const kind of kinds) {
      let content, publicationHash;
      try {
        const prepared = await brief(kind, {
          sourceBinding,
          delivery,
          withSourceIdentity: true,
          markdown,
        });
        content = typeof prepared === "string" ? prepared : prepared?.content;
        publicationHash =
          typeof prepared === "string" ? sourceBinding?.[kind]?.hash : prepared?.publicationHash;
      } catch (error) {
        const safe = new Set([
          "QQ_SOURCE_BUILD_REQUIRED",
          "QQ_SOURCE_BUILD_MISMATCH",
          "QQ_SOURCE_INVALID",
          "QQ_CHANNEL_LINK_REQUIRED",
          "QQ_NOTIFY_CONTENT_LIMIT",
        ]);
        targets[kind] = {
          status: "blocked",
          code: safe.has(error.message) ? error.message : "QQ_NOTIFY_PREPARATION_FAILED",
        };
        continue;
      }
      if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > 12_000) {
        targets[kind] = { status: "blocked", code: "QQ_NOTIFY_CONTENT_LIMIT" };
        continue;
      }
      outbox[kind] = { content, hash: hashBody(content), prepared_at: new Date().toISOString() };
      if (!enabled) {
        targets[kind] = { status: "waiting_permission" };
        continue;
      }
      if (
        targetGroups.length === 0 ||
        targetGroups.some((g) => !/^[a-zA-Z0-9_-]{1,128}$/u.test(g))
      ) {
        targets[kind] = { status: "blocked", code: "QQ_GROUP_TARGET_REQUIRED" };
        continue;
      }
      if (typeof publicationHash !== "string" || !/^[a-f0-9]{64}$/u.test(publicationHash)) {
        targets[kind] = { status: "blocked", code: "QQ_SOURCE_BUILD_REQUIRED" };
        continue;
      }

      // Send to each target group
      const perGroupOutcomes = [];
      for (const targetG of targetGroups) {
        const groupHash = createHash("sha256").update(targetG).digest("hex");
        const key = `${kind}:${groupHash}:${publicationHash}`;
        const previous = ledger.items[key];
        if (previous?.status === "sent") {
          perGroupOutcomes.push({ groupOpenid: targetG, status: "unchanged" });
          continue;
        }
        if (previous) {
          perGroupOutcomes.push({
            groupOpenid: targetG,
            status: "blocked",
            code: "QQ_NOTIFY_UNKNOWN_OUTCOME",
          });
          continue;
        }
        ledger.items[key] = {
          status: "intent",
          content_hash: outbox[kind].hash,
          created_at: new Date().toISOString(),
        };
        await save();
        try {
          const receipt = await send({ groupOpenid: targetG, content });
          if (!receipt?.id) throw new Error("QQ_NOTIFY_UNKNOWN_OUTCOME");
          ledger.items[key] = {
            status: "sent",
            content_hash: outbox[kind].hash,
            sent_at: new Date().toISOString(),
          };
          await save();
          perGroupOutcomes.push({ groupOpenid: targetG, status: "success" });
        } catch (error) {
          if (/^发送主动群消息失败 HTTP (?:400|401|403|404|429):/u.test(error?.message || "")) {
            delete ledger.items[key];
            await save();
            perGroupOutcomes.push({
              groupOpenid: targetG,
              status: "blocked",
              code: "QQ_NOTIFY_REMOTE_REJECTED",
            });
          } else {
            perGroupOutcomes.push({
              groupOpenid: targetG,
              status: "blocked",
              code: "QQ_NOTIFY_UNKNOWN_OUTCOME",
            });
          }
        }
      }

      if (targetGroups.length === 1) {
        targets[kind] = perGroupOutcomes[0];
      } else {
        const allSentOrUnchanged = perGroupOutcomes.every((o) =>
          ["success", "unchanged"].includes(o.status)
        );
        const anyBlockedGroup = perGroupOutcomes.find((o) => o.status === "blocked");
        targets[kind] = {
          status: allSentOrUnchanged
            ? "success"
            : anyBlockedGroup
              ? "blocked"
              : "waiting_permission",
          ...(anyBlockedGroup ? { code: anyBlockedGroup.code } : {}),
          groups: perGroupOutcomes,
        };
      }
    }
    await writeJsonAtomically(resolve(cache, "outbox.json"), outbox);
    await chmod(resolve(cache, "outbox.json"), 0o600);
    const allSuccess = kinds.every((kind) =>
      ["success", "unchanged"].includes(targets[kind]?.status)
    );
    const anyBlocked = kinds.some((kind) => targets[kind]?.status === "blocked");
    return {
      status: allSuccess ? "success" : anyBlocked ? "blocked" : "waiting_permission",
      targets,
    };
  } finally {
    await releaseRefreshLock(lock);
  }
}

export async function alertAdmin(subject, details = "") {
  const adminOpenid = process.env.QQ_ADMIN_OPENID || defaultUserManager.getLatestUserOpenid();
  if (!adminOpenid) {
    console.error("[qq-send:alert] 未找到管理员 OpenID，跳过告警");
    return { success: false, reason: "no_admin_openid" };
  }
  const payload = {
    id: `alert:${Date.now()}`,
    kind: "alert",
    title: subject,
    body_markdown: details || subject,
  };
  const adapter = new OfficialQqBotAdapter({
    adminOpenid,
    sender: ({ userOpenid, content }) => sendProactiveC2CMessage({ userOpenid, content }),
    enabled: true,
  });
  console.log(`[qq-send:alert] 发送运维告警至管理员 (${adminOpenid}): ${subject}`);
  const res = await adapter.publish(payload);
  return { success: res.status === "success", ...res };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);

  if (args.includes("--alert")) {
    const aIdx = args.indexOf("--alert");
    const subject = args[aIdx + 1] || "系统告警通知";
    const details = args.slice(aIdx + 2).join(" ");
    try {
      const res = await alertAdmin(subject, details);
      console.log(`[qq-send] ✓ 管理员运维告警发送成功！`);
      console.log(res);
      process.exit(0);
    } catch (err) {
      console.error(`[qq-send] ✗ 管理员运维告警发送失败: ${err.message}`);
      process.exit(1);
    }
  }

  if (args.includes("--add-group")) {
    const idx = args.indexOf("--add-group");
    const target = args[idx + 1];
    const name = args[idx + 2] && !args[idx + 2].startsWith("-") ? args[idx + 2] : undefined;
    if (!target) {
      console.error("[qq-send] 用法: node scripts/qq-send.mjs --add-group <groupOpenid> [名称]");
      process.exit(1);
    }
    const ok = defaultUserManager.subscribeGroup(target, { name });
    if (ok) {
      console.log(`[qq-send] ✓ 成功添加/启用群聊订阅: ${maskOpenid(target)}`);
    } else {
      console.error(`[qq-send] ✗ 添加群聊失败，无效的 GroupOpenID`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (args.includes("--remove-group")) {
    const idx = args.indexOf("--remove-group");
    const target = args[idx + 1];
    if (!target) {
      console.error("[qq-send] 用法: node scripts/qq-send.mjs --remove-group <groupOpenid>");
      process.exit(1);
    }
    const ok = defaultUserManager.unsubscribeGroup(target);
    if (ok) {
      console.log(`[qq-send] ✓ 成功取消群聊订阅: ${maskOpenid(target)}`);
    } else {
      console.error(`[qq-send] ✗ 未找到该群聊记录`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (args.includes("--list") || args.includes("-l")) {
    const users = defaultUserManager.getUsers();
    const groups = defaultUserManager.getGroups();
    const uEntries = Object.entries(users);
    const gEntries = Object.entries(groups);

    console.log(`[qq-send] 用户列表：共记录 ${uEntries.length} 个用户 OpenID`);
    for (const [id, u] of uEntries) {
      console.log(`  - UserOpenID: ${maskOpenid(id)}`);
      console.log(
        `    交互: ${u.interaction_count} 次 | 最近: ${new Date(u.last_seen).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
      );
      if (u.last_query) console.log(`    最后提问: ${u.last_query}`);
    }

    console.log(`\n[qq-send] 群聊列表：共记录 ${gEntries.length} 个群聊 GroupOpenID`);
    for (const [id, g] of gEntries) {
      const statusLabel = g.subscribed === false ? "[已停用订阅]" : "[已启用订阅]";
      const nameLabel = g.name ? ` (${g.name})` : "";
      console.log(`  - GroupOpenID: ${maskOpenid(id)}${nameLabel} ${statusLabel}`);
      console.log(
        `    交互: ${g.interaction_count} 次 | 最近: ${new Date(g.last_seen).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
      );
      if (g.last_query) console.log(`    最后提问: ${g.last_query}`);
    }
    process.exit(0);
  }

  // Group Mode
  if (args.includes("--group") || args.includes("-g")) {
    const gIdx = args.indexOf("--group") !== -1 ? args.indexOf("--group") : args.indexOf("-g");
    let targetGroup = null;
    let content = null;

    if (args.includes("--brief")) {
      const bIdx = args.indexOf("--brief");
      const bType = args[bIdx + 1] === "weekly" ? "weekly" : "daily";
      const dateArg = args.includes("--date") ? args[args.indexOf("--date") + 1] : undefined;
      const isText = args.includes("--text");
      content = await generateGroupBrief(bType, { date: dateArg, markdown: !isText });
      const nextArg = args[gIdx + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        targetGroup = nextArg;
      } else {
        targetGroup = defaultUserManager.getLatestGroupOpenid();
      }
    } else {
      const remaining = args.filter((_, i) => i !== gIdx);
      if (remaining.length === 1) {
        content = remaining[0];
        targetGroup = defaultUserManager.getLatestGroupOpenid();
      } else if (remaining.length >= 2) {
        targetGroup = remaining[0];
        content = remaining.slice(1).join(" ");
      }
    }

    if (!content) {
      console.log("群发消息用法:");
      console.log(
        '  node scripts/qq-send.mjs --group "群消息内容"             # 发送到最近互动的群'
      );
      console.log('  node scripts/qq-send.mjs --group <groupOpenid> "群消息"   # 发送到指定群');
      process.exit(1);
    }

    if (!targetGroup) {
      console.error("[qq-send] 错误: 本地尚未记录任何群聊 GroupOpenID。");
      console.error(
        "请先在 QQ 群中 @机器人（例如发送 @astrolineage /id），系统将自动捕获并记录该群的 GroupOpenID。"
      );
      process.exit(1);
    }

    console.log(`[qq-send] 目标群聊 GroupOpenID: ${maskOpenid(targetGroup)}`);
    console.log(`[qq-send] 群发内容: ${content}`);

    try {
      const res = await sendProactiveGroupMessage({ groupOpenid: targetGroup, content });
      console.log(`[qq-send] ✓ 群消息发送成功！`);
      console.log(res);
    } catch (err) {
      console.error(`[qq-send] ✗ 群消息发送失败: ${err.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // C2C Private Message Mode
  let targetOpenid = null;
  let content = null;

  if (args.includes("--to")) {
    const toIdx = args.indexOf("--to");
    targetOpenid = args[toIdx + 1];
    content = args
      .filter((_, i) => i !== toIdx && i !== toIdx + 1)
      .join(" ")
      .trim();
  } else {
    targetOpenid = defaultUserManager.getLatestUserOpenid();
    content = args.join(" ").trim();
  }

  if (!content) {
    console.log("私信消息用法:");
    console.log('  node scripts/qq-send.mjs "消息内容"                 # 发送私信给最近互动的用户');
    console.log('  node scripts/qq-send.mjs --to <userOpenid> "消息"   # 发送私信给指定用户');
    console.log('  node scripts/qq-send.mjs --group "群消息内容"       # 主动发送群聊消息');
    console.log(
      "  node scripts/qq-send.mjs --list                     # 查看所有已记录的用户与群聊"
    );
    process.exit(1);
  }

  if (!targetOpenid) {
    console.error("[qq-send] 错误: 本地尚未记录任何用户 OpenID。");
    console.error(
      "请先在手机或电脑 QQ 上给官方机器人 astrolineage 发送任意私聊消息（例如发送 /id），系统将自动捕获并记录您的 OpenID。"
    );
    process.exit(1);
  }

  console.log(`[qq-send] 目标用户 OpenID: ${maskOpenid(targetOpenid)}`);
  console.log(`[qq-send] 私信内容: ${content}`);

  try {
    const res = await sendProactiveC2CMessage({ userOpenid: targetOpenid, content });
    console.log(`[qq-send] ✓ 私信发送成功！`);
    console.log(res);
  } catch (err) {
    console.error(`[qq-send] ✗ 私信发送失败: ${err.message}`);
    process.exit(1);
  }
}
