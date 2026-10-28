/**
 * scripts/notification-egress.mjs
 *
 * Deep module encapsulating QQ Group publication notification, brief generation,
 * single-paper card formatting, group target routing, proactive dispatching, and administrative alerts.
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
import { validateDailyRadarPayload, normalizeArxivId } from "./daily-radar.mjs";
import { hashBody, readDailyArchive, readChannelShareUrl } from "./channel-publication.mjs";
import { readingExcerpt } from "./tencent-channel-publisher.mjs";
import {
  deriveDailyTitleCandidate,
  deriveWeeklyTitleCandidate,
  extractPaperTopic,
} from "./channel-title-policy.mjs";
import { formatAnnouncementInBeijing, resolveWebsiteUrls } from "../src/domain/academic-domain.mjs";
import { isLegacyChineseDate } from "../src/domain/language-cutover.mjs";
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
  const { publicBase: websiteBase, localBase: localWebsiteBase } = resolveWebsiteUrls(options);
  if (!(type === "daily" ? model : weekly)) {
    if (options.interactive) {
      if (type === "daily") {
        if (options.date) {
          const path = resolve(
            options.archiveRoot || "src/data/arxiv-archives/daily",
            `${options.date}.json`
          );
          if (existsSync(path)) {
            const bytes = await readFile(path);
            const arch = JSON.parse(bytes);
            const checked = validateDailyRadarPayload(arch.feed, arch.radar);
            if (checked.valid) {
              model = checked.model;
              date = options.date;
              publicationHash = hashBody(bytes);
            }
          }
        }
        if (!model) {
          let published;
          try {
            published = await (options.readEdition || readPublishedArxivEdition)({
              allowMissing: true,
            });
          } catch {}
          if (
            (!published?.feed || !published?.radar) &&
            existsSync(options.feedPath || "src/data/arxiv-daily.json")
          ) {
            try {
              const feed = JSON.parse(
                await readFile(options.feedPath || "src/data/arxiv-daily.json", "utf8")
              );
              const radar = existsSync(options.radarPath || "src/data/daily-radar.json")
                ? JSON.parse(
                    await readFile(options.radarPath || "src/data/daily-radar.json", "utf8")
                  )
                : { edition: { window: feed?.window }, analyses: [] };
              published = { feed, radar };
            } catch {}
          }
          const beijingToday = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Shanghai",
          }).format(new Date());
          date = options.date || published?.feed?.window?.announcement_date || beijingToday;
          const checked = validateDailyRadarPayload(published?.feed, published?.radar);
          if (!checked.valid) throw new Error("QQ_SOURCE_INVALID");
          model = checked.model;
          publicationHash = hashBody(
            JSON.stringify({ feed: published.feed, radar: published.radar })
          );
        }
      } else {
        const weeklyPath = options.week
          ? resolve(options.archiveRoot || "src/data/arxiv-archives/weekly", `${options.week}.json`)
          : options.weeklyPath || "src/data/arxiv-weekly.json";
        const bytes = await readFile(weeklyPath);
        weekly = JSON.parse(bytes);
        publicationHash = hashBody(bytes);
      }
    } else {
      if (!sourceBinding) {
        const website = JSON.parse(await readFile(".cache/notebooklm/website.json", "utf8"));
        if (website.status !== "success") throw new Error("QQ_SOURCE_BUILD_REQUIRED");
        sourceBinding = website.source_binding;
      }
      const { daily, weekly: weeklyBinding, archives, weeklyArchives, id } = sourceBinding || {};
      if (
        !daily?.generation_id ||
        !weeklyBinding?.hash ||
        !archives ||
        hashBody(
          JSON.stringify({
            daily,
            weekly: weeklyBinding,
            archives,
            ...(weeklyArchives ? { weeklyArchives } : {}),
          })
        ) !== id
      )
        throw new Error("QQ_SOURCE_BUILD_REQUIRED");
      if (type === "weekly") {
        const weeklyPath = options.week
          ? resolve(options.archiveRoot || "src/data/arxiv-archives/weekly", `${options.week}.json`)
          : options.weeklyPath || "src/data/arxiv-weekly.json";
        if ((await stat(weeklyPath)).size > 20_000_000) throw new Error("QQ_SOURCE_INVALID");
        const bytes = await readFile(weeklyPath);
        if (!options.week && hashBody(bytes) !== weeklyBinding.hash)
          throw new Error("QQ_SOURCE_BUILD_MISMATCH");
        weekly = JSON.parse(bytes);
        publicationHash = hashBody(bytes);
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
  }
  const inputChannelUrl = channelUrl || process.env.ASTRO_CHANNEL_URL;
  if (!inputChannelUrl) {
    channelUrl = (await readChannelShareUrl()) || "https://pd.qq.com/s/d4lw4zl0g";
  } else {
    channelUrl = await readChannelShareUrl({ url: inputChannelUrl });
  }
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
    const isLegacy = isLegacyChineseDate(weekly.week_id);
    const weeklyTitle = deriveWeeklyTitleCandidate(weekly.week_id, weekly);
    const weeklyPostUrl = resolveWeeklyFeedShareUrl(weekly.week_id, { fallbackUrl: channelUrl });
    if (isMarkdown) {
      lines.push(`# [${weeklyTitle}](${weeklyPostUrl})`, "");
      const topPick = (weekly.top_picks || [])[0];
      if (topPick) {
        const rev = topPick.revision || 1;
        const sourceLine = isLegacy
          ? `- **信源**: [arXiv:${topPick.arxiv_id}v${rev}](https://arxiv.org/abs/${topPick.arxiv_id}v${rev}) · [📄 PDF](https://arxiv.org/pdf/${topPick.arxiv_id}) · **频道交流**: [进入周报讨论帖](${weeklyPostUrl})`
          : `- **Source**: [arXiv:${topPick.arxiv_id}v${rev}](https://arxiv.org/abs/${topPick.arxiv_id}v${rev}) · [📄 PDF](https://arxiv.org/pdf/${topPick.arxiv_id}) · **Discussion**: [Join Weekly Discussion](${weeklyPostUrl})`;
        lines.push(sourceLine, "");
      }
      lines.push(
        isLegacy
          ? `📅 ${weekly.date_range || ""} · 研读共 ${(weekly.papers || []).length} 篇`
          : `📅 ${weekly.date_range || ""} · ${(weekly.papers || []).length} papers analyzed`,
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
        const cleanPickId = normalizeArxivId(pick.arxiv_id || "");
        if (!/^\d{4}\.\d{4,5}$/u.test(cleanPickId)) throw new Error("QQ_SOURCE_INVALID");
        const revision =
          pick.revision ||
          weekly.papers?.find((p) => normalizeArxivId(p.arxiv_id) === cleanPickId)?.revision ||
          1;
        const suffix = Number.isSafeInteger(revision) && revision > 0 ? `v${revision}` : "";
        const paperObj = weekly.papers?.find((p) => normalizeArxivId(p.arxiv_id) === cleanPickId);
        const authors = paperObj?.authors || pick.authors;
        const authorStr =
          Array.isArray(authors) && authors.length > 0
            ? authors.length > 2
              ? isLegacy
                ? `${authors[0]} 等`
                : `${authors[0]} et al.`
              : authors.join(", ")
            : "";
        const authorSuffix = authorStr ? ` (${authorStr})` : "";
        const paperPostUrl = resolvePaperFeedShareUrl(cleanPickId, { fallbackUrl: channelUrl });
        const mustReadHeader = isLegacy
          ? `### ⭐ 必读｜${extractPaperTopic(pick)}${authorSuffix}`
          : `### ⭐ Must Read | ${extractPaperTopic(pick)}${authorSuffix}`;
        const links = isLegacy
          ? [
              `- **arXiv 原文**: [arXiv:${cleanPickId}${suffix}](https://arxiv.org/abs/${cleanPickId}${suffix}) · [📄 PDF](https://arxiv.org/pdf/${cleanPickId})`,
              `- **频道研讨**: [进入对应频道研讨帖](${paperPostUrl})`,
              `- **网页精读**: [查看网页周报综述](${websiteBase}/arxiv-weekly/${weekly.week_id}/)`,
            ]
          : [
              `- **arXiv**: [arXiv:${cleanPickId}${suffix}](https://arxiv.org/abs/${cleanPickId}${suffix}) · [📄 PDF](https://arxiv.org/pdf/${cleanPickId})`,
              `- **Discussion**: [Join Channel Discussion](${paperPostUrl})`,
              `- **Web Brief**: [Read Web Weekly Synthesis](${websiteBase}/arxiv-weekly/${weekly.week_id}/)`,
            ];
        const insightLabel = isLegacy ? "【核心洞察】" : "[Key Insight]";
        const reasonLabel = isLegacy ? "【推荐理由】" : "[Recommendation]";
        lines.push(
          "---",
          mustReadHeader,
          `**[${pick.title || ""}](${pick.url || `https://arxiv.org/abs/${cleanPickId}${suffix}`})**`,
          ...links,
          "",
          `> **${insightLabel}** ${pick.core_insight || pick.reason || ""}`,
          `> **${reasonLabel}** ${pick.recommendation_reason || pick.reason || ""}`,
          ""
        );
      }

      if (worthKnowingPicks.length > 0) {
        lines.push("---", isLegacy ? "### 📌 关注" : "### 📌 Follow", "");
        for (const pick of worthKnowingPicks) {
          const cleanPickId = normalizeArxivId(pick.arxiv_id || "");
          const rev = pick.revision || 1;
          const paperPostUrl = resolvePaperFeedShareUrl(cleanPickId, { fallbackUrl: channelUrl });
          const discussLabel = isLegacy ? "频道交流" : "Discussion";
          lines.push(
            `- **${extractPaperTopic(pick)}** ｜ [${pick.title || ""}](${pick.url || `https://arxiv.org/abs/${cleanPickId}v${rev}`}) · [arXiv:${cleanPickId}](https://arxiv.org/abs/${cleanPickId}v${rev}) · [${discussLabel}](${paperPostUrl})`
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
        const cleanPickId = normalizeArxivId(pick.arxiv_id || "");
        if (!/^\d{4}\.\d{4,5}$/u.test(cleanPickId)) throw new Error("QQ_SOURCE_INVALID");
        const revision =
          pick.revision ||
          weekly.papers?.find((p) => normalizeArxivId(p.arxiv_id) === cleanPickId)?.revision;
        const suffix = Number.isSafeInteger(revision) && revision > 0 ? `v${revision}` : "";
        const paperObj = weekly.papers?.find((p) => normalizeArxivId(p.arxiv_id) === cleanPickId);
        const authors = paperObj?.authors || pick.authors;
        const authorStr =
          Array.isArray(authors) && authors.length > 0
            ? authors.length > 2
              ? isLegacy
                ? `${authors[0]} 等`
                : `${authors[0]} et al.`
              : authors.join(", ")
            : "";
        const authorSuffix = authorStr ? ` (${authorStr})` : "";
        const priorityLabel = isLegacy
          ? pick.priority === "must_read"
            ? "必读"
            : "关注"
          : pick.priority === "must_read"
            ? "Must Read"
            : "Follow";
        const originalLabel = isLegacy ? "原文" : "Original";
        lines.push(
          `• ${priorityLabel}｜${extractPaperTopic(pick)}${authorSuffix}`,
          readingExcerpt(pick.reason || pick.recommendation_reason || pick.core_insight),
          `${originalLabel}：https://arxiv.org/abs/${pick.arxiv_id}${suffix}`,
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
      const isLegacy = isLegacyChineseDate(date);
      brief = {
        status: "ready",
        intro: isLegacy
          ? `本期首看《${firstPaper.title}》等 ${count} 篇核心进展。`
          : `Featured reading: "${firstPaper.title}"${count > 1 ? ` and ${count - 1} other key developments` : ""}.`,
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
          ? isLegacy
            ? `包含 ${model.groups.worth_knowing.length} 篇重要进展。`
            : `Includes ${model.groups.worth_knowing.length} noteworthy developments.`
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
    const isLegacy = isLegacyChineseDate(date);
    if (isMarkdown) {
      const beijingInfo = formatAnnouncementInBeijing(date);
      const beijingShortDate = beijingInfo.shortDate || date.slice(5);
      const progressClaim = dailyTitle.replace(/^「[^」]+」/u, "");
      const displayDailyTitle = `「${beijingShortDate}」${progressClaim}`;

      lines.push(`# [${displayDailyTitle}](${channelUrl})`, "");
      const topPaper = (model.groups.must_read || [])[0] || (model.groups.worth_knowing || [])[0];
      if (topPaper) {
        const rev = topPaper.revision || 1;
        const sourceLine = isLegacy
          ? `- **信源**: [arXiv:${topPaper.arxiv_id}v${rev}](https://arxiv.org/abs/${topPaper.arxiv_id}v${rev}) · [📄 PDF](https://arxiv.org/pdf/${topPaper.arxiv_id}) · **频道交流**: [进入 QQ 频道讨论](${channelUrl})`
          : `- **Source**: [arXiv:${topPaper.arxiv_id}v${rev}](https://arxiv.org/abs/${topPaper.arxiv_id}v${rev}) · [📄 PDF](https://arxiv.org/pdf/${topPaper.arxiv_id}) · **Discussion**: [Join Channel Discussion](${channelUrl})`;
        lines.push(sourceLine, "");
      }
      if (fallbackInfo) {
        const fallbackNotice = isLegacy
          ? `> ℹ️ **【批次说明】** 因${fallbackInfo.reason}，本次推送上一期完整成果。`
          : `> ℹ️ **[Batch Note]** Due to ${fallbackInfo.reason}, delivering the previous complete edition.`;
        lines.push(fallbackNotice, "");
      }
      lines.push(`> ${brief.intro}`, "");

      const mustReadList = (model.groups.must_read || []).slice(0, 3);
      if (mustReadList.length > 0) {
        for (const paper of mustReadList) {
          const authors = paper.entry?.authors || paper.authors;
          const authorStr =
            Array.isArray(authors) && authors.length > 0
              ? authors.length > 2
                ? isLegacy
                  ? `${authors[0]} 等`
                  : `${authors[0]} et al.`
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
          const mustReadHeader = isLegacy
            ? `### ⭐ 必读｜[${extractPaperTopic(paper)}](${channelUrl})${authorSuffix}`
            : `### ⭐ Must Read | [${extractPaperTopic(paper)}](${channelUrl})${authorSuffix}`;
          const links = isLegacy
            ? [
                `- **arXiv 原文**: [arXiv:${paper.arxiv_id}v${paper.revision || 1}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1}) · [📄 PDF](https://arxiv.org/pdf/${paper.arxiv_id})`,
                `- **频道研讨**: [进入对应频道研讨帖](${channelUrl})`,
                `- **网页精读**: [查看网页完整图表与证据链](${websiteBase}/arxiv-daily/${date}/#${anchor})`,
              ]
            : [
                `- **arXiv**: [arXiv:${paper.arxiv_id}v${paper.revision || 1}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1}) · [📄 PDF](https://arxiv.org/pdf/${paper.arxiv_id})`,
                `- **Discussion**: [Join Channel Discussion](${channelUrl})`,
                `- **Web Brief**: [Read Full Brief & Evidence](${websiteBase}/arxiv-daily/${date}/#${anchor})`,
              ];
          const bgLabel = isLegacy ? "【背景】" : "[Background]";
          const resultLabel = isLegacy ? "【突破】" : "[Key Result]";
          const valueLabel = isLegacy ? "【价值】" : "[Why It Matters]";
          lines.push(
            "---",
            mustReadHeader,
            `**[${paper.title}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1})**`,
            ...links,
            "",
            problem ? `> **${bgLabel}** ${problem}\n` : "",
            result ? `> **${resultLabel}** ${result}\n` : "",
            reason ? `> **${valueLabel}** ${reason}\n` : ""
          );
        }
      } else {
        lines.push(
          isLegacy
            ? "> ℹ️ **【批次说明】** 当期无必读突破，关注以下进展。"
            : "> ℹ️ **[Batch Note]** No must-read breakthroughs in this edition; following these works.",
          ""
        );
      }

      const worthKnowingList = (model.groups.worth_knowing || []).slice(0, 5);
      if (worthKnowingList.length > 0) {
        if (mustReadList.length === 0) {
          for (const paper of worthKnowingList.slice(0, 3)) {
            const authors = paper.entry?.authors || paper.authors;
            const authorStr =
              Array.isArray(authors) && authors.length > 0
                ? authors.length > 2
                  ? isLegacy
                    ? `${authors[0]} 等`
                    : `${authors[0]} et al.`
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
            const followHeader = isLegacy
              ? `### 📌 关注｜[${extractPaperTopic(paper)}](${channelUrl})${authorSuffix}`
              : `### 📌 Follow | [${extractPaperTopic(paper)}](${channelUrl})${authorSuffix}`;
            const links = isLegacy
              ? [
                  `- **arXiv 原文**: [arXiv:${paper.arxiv_id}v${paper.revision || 1}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1}) · [📄 PDF](https://arxiv.org/pdf/${paper.arxiv_id})`,
                  `- **频道研讨**: [进入对应频道研讨帖](${channelUrl})`,
                  `- **网页精读**: [查看网页完整图表与证据链](${websiteBase}/arxiv-daily/${date}/#${anchor})`,
                ]
              : [
                  `- **arXiv**: [arXiv:${paper.arxiv_id}v${paper.revision || 1}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1}) · [📄 PDF](https://arxiv.org/pdf/${paper.arxiv_id})`,
                  `- **Discussion**: [Join Channel Discussion](${channelUrl})`,
                  `- **Web Brief**: [Read Full Brief & Evidence](${websiteBase}/arxiv-daily/${date}/#${anchor})`,
                ];
            const bgLabel = isLegacy ? "【背景】" : "[Background]";
            const progressLabel = isLegacy ? "【进展】" : "[Progress]";
            const valueLabel = isLegacy ? "【价值】" : "[Why It Matters]";
            lines.push(
              "---",
              followHeader,
              `**[${paper.title}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1})**`,
              ...links,
              "",
              problem ? `> **${bgLabel}** ${problem}\n` : "",
              result ? `> **${progressLabel}** ${result}\n` : "",
              reason ? `> **${valueLabel}** ${reason}\n` : ""
            );
          }
          if (worthKnowingList.length > 3) {
            lines.push("---", isLegacy ? "### 📌 关注" : "### 📌 Follow", "");
            for (const paper of worthKnowingList.slice(3)) {
              const topic = extractPaperTopic(paper);
              const rev = paper.revision || 1;
              const discussLabel = isLegacy ? "频道交流" : "Discussion";
              lines.push(
                `- **${topic}** ｜ [${paper.title}](https://arxiv.org/abs/${paper.arxiv_id}v${rev}) · [arXiv:${paper.arxiv_id}](https://arxiv.org/abs/${paper.arxiv_id}v${rev}) · [${discussLabel}](${channelUrl})`
              );
            }
            lines.push("");
          }
        } else {
          lines.push("---", isLegacy ? "### 📌 关注" : "### 📌 Follow", "");
          for (const paper of worthKnowingList) {
            const topic = extractPaperTopic(paper);
            const rev = paper.revision || 1;
            const discussLabel = isLegacy ? "频道交流" : "Discussion";
            lines.push(
              `- **${topic}** ｜ [${paper.title}](https://arxiv.org/abs/${paper.arxiv_id}v${rev}) · [arXiv:${paper.arxiv_id}](https://arxiv.org/abs/${paper.arxiv_id}v${rev}) · [${discussLabel}](${channelUrl})`
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
                ? isLegacy
                  ? `${authors[0]} 等`
                  : `${authors[0]} et al.`
                : authors.join(", ")
              : "";
          const authorSuffix = authorStr ? ` (${authorStr})` : "";
          const tag = isLegacy ? "必读" : "Must Read";
          const origLabel = isLegacy ? "原文" : "Original";
          lines.push(
            `• ${tag}｜${extractPaperTopic(paper)}${authorSuffix}`,
            sentence.text,
            `${origLabel}：https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision}`,
            ""
          );
        }
      } else {
        lines.push(
          isLegacy
            ? "【批次说明】当期无必读突破，关注以下进展。"
            : "[Batch Note] No must-read breakthroughs in this edition; following these works.",
          ""
        );
        for (const paper of (model.groups.worth_knowing || []).slice(0, 3)) {
          const authors = paper.entry?.authors || paper.authors;
          const authorStr =
            Array.isArray(authors) && authors.length > 0
              ? authors.length > 2
                ? isLegacy
                  ? `${authors[0]} 等`
                  : `${authors[0]} et al.`
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
          const tag = isLegacy ? "关注" : "Follow";
          const origLabel = isLegacy ? "原文" : "Original";
          lines.push(
            `• ${tag}｜${extractPaperTopic(paper)}${authorSuffix}`,
            typeof text === "string" ? text.slice(0, 150) : paper.title,
            `${origLabel}：https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision || 1}`,
            ""
          );
        }
      }
      if (
        mustReadList.length > 0 &&
        model.groups.worth_knowing?.length &&
        brief.worth_knowing_summary
      ) {
        lines.push(isLegacy ? "关注" : "Follow", readingExcerpt(brief.worth_knowing_summary), "");
      }
    }
  }
  const isLegacy = isLegacyChineseDate(type === "weekly" ? weekly.week_id : date);
  const channelState = options.delivery?.channel?.[type]?.status;
  if (channelState && !["success", "skipped"].includes(channelState))
    lines.push(
      isLegacy
        ? "频道部分内容待同步；以下网页导读已发布。"
        : "Channel content pending sync; web brief is published below.",
      ""
    );
  if (options.delivery?.notebooklm?.status && options.delivery.notebooklm.status !== "success")
    lines.push(isLegacy ? "NotebookLM 同步待恢复。" : "NotebookLM sync pending.", "");
  const route = type === "weekly" ? `arxiv-weekly/${weekly.week_id}` : `arxiv-daily/${date}`;
  if (isMarkdown) {
    if (isLegacy) {
      lines.push(
        "---",
        "",
        "### 📚 完整阅读入口",
        `- **公网在线阅读 (Cloudflare)**: [打开网页深度导读](${websiteBase}/${route}/)`,
        `- **校内/局域网直连**: [打开校内直连导读](${localWebsiteBase}/${route}/)`,
        `- **QQ 频道社区交流帖**: [进入频道讨论](${channelUrl})`
      );
    } else {
      lines.push(
        "---",
        "",
        "### 📚 Reading Access",
        `- **Online Reading (Cloudflare)**: [Read Full Brief](${websiteBase}/${route}/)`,
        `- **Direct / Local Network**: [Read Direct Brief](${localWebsiteBase}/${route}/)`,
        `- **QQ Channel Discussion**: [Join Channel Discussion](${channelUrl})`
      );
    }
  } else {
    if (isLegacy) {
      lines.push(
        "频道讨论",
        channelUrl,
        "",
        "公网完整导读 (Cloudflare)",
        `${websiteBase}/${route}/`,
        "",
        "校内/局域网直连",
        `${localWebsiteBase}/${route}/`
      );
    } else {
      lines.push(
        "Channel Discussion",
        channelUrl,
        "",
        "Online Reading (Cloudflare)",
        `${websiteBase}/${route}/`,
        "",
        "Direct / Local Network",
        `${localWebsiteBase}/${route}/`
      );
    }
  }
  const text = lines.filter((line) => line !== undefined).join("\n");
  if (Buffer.byteLength(text) > 12_000) throw new Error("QQ_NOTIFY_CONTENT_LIMIT");
  return options.withSourceIdentity ? { content: text, publicationHash } : text;
}

export function renderSinglePaperCardMarkdown(p, options = {}) {
  const a = p.analysis?.analysis || p.analysis || {};
  const date = options.date || p.dailyDate || new Date().toISOString().slice(0, 10);
  const isLegacy = isLegacyChineseDate(date);
  const { publicBase: websiteBase, localBase: localWebsiteBase } = resolveWebsiteUrls(options);
  const channelUrl = options.channelUrl || "https://pd.qq.com/s/7xr9egnly";
  const mustRead = p.analysis?.priority === "must_read" || p.priority === "must_read";
  const authorSuffix =
    Array.isArray(p.authors) && p.authors.length > 3 ? (isLegacy ? " 等" : " et al.") : "";
  const authorStr =
    Array.isArray(p.authors) && p.authors.length
      ? p.authors.slice(0, 3).join(", ") + authorSuffix
      : "";
  const problem = (a.problem?.detailed_text || a.problem?.problem || a.problem || "").trim();
  const result = (a.result?.detailed_text || a.result?.bluf || a.result || "").trim();
  const reason = (a.reason?.detailed_text || a.reason?.reason || a.reason || "").trim();
  const limits = [...(a.limits || []), ...(a.unresolved_checks || [])];
  const revision = p.revision || 1;
  const anchor = `radar-paper-${p.arxiv_id.replace(".", "-")}-v${revision}`;

  const headerTag = isLegacy
    ? mustRead
      ? "⭐ 必读"
      : "📌 关注"
    : mustRead
      ? "⭐ Must Read"
      : "📌 Follow";
  const authorLabel = isLegacy ? "作者" : "Authors";
  const authorVal = authorStr || (isLegacy ? "未说明" : "Not stated");
  const categoryLabel = isLegacy ? "分类" : "Category";
  const problemHeader = isLegacy ? "### 🎯 课题背景" : "### 🎯 Problem & Background";
  const problemFallback = isLegacy
    ? "未能从已检查材料中核实课题问题陈述。"
    : "Problem statement not verified from checked materials.";
  const resultHeader = isLegacy ? "### 🚀 核心突破" : "### 🚀 Key Result & Physical Mechanism";
  const resultFallback = isLegacy
    ? "详见原文推导与正文分析。"
    : "See original paper for derivations and analysis.";

  const lines = [
    `# ${headerTag}｜${p.title}`,
    "",
    `- **arXiv**: [${p.arxiv_id}v${revision}](https://arxiv.org/abs/${p.arxiv_id}v${revision}) · [📄 PDF](https://arxiv.org/pdf/${p.arxiv_id})`,
    `- **${authorLabel}**: ${authorVal}`,
    `- **${categoryLabel}**: ${p.primary_category || "astro-ph.HE"}`,
    "",
    "---",
    "",
    problemHeader,
    `> ${problem || problemFallback}`,
    "",
    resultHeader,
    `> ${result || resultFallback}`,
    "",
  ];

  if (reason) {
    const reasonHeader = isLegacy ? "### 💡 研读价值" : "### 💡 Why It Matters";
    lines.push(reasonHeader, `> ${reason}`, "");
  }

  if (limits.length) {
    const limitsHeader = isLegacy ? "### ⚠️ 限制与边界条件" : "### ⚠️ Limitations & Boundaries";
    lines.push(limitsHeader, "");
    for (const l of limits) {
      lines.push(`- ${typeof l === "string" ? l : l.text || JSON.stringify(l)}`);
    }
    lines.push("");
  }

  const paperPostUrl = resolvePaperFeedShareUrl(p.arxiv_id, { fallbackUrl: channelUrl });

  if (isLegacy) {
    lines.push(
      "---",
      "",
      "### 📚 完整阅读入口",
      `- **公网在线阅读 (Cloudflare)**: [打开网页深度导读](${websiteBase}/arxiv-daily/${date}/#${anchor})`,
      `- **校内/局域网直连**: [打开校内直连导读](${localWebsiteBase}/arxiv-daily/${date}/#${anchor})`,
      `- **QQ 频道社区交流帖**: [进入频道讨论](${paperPostUrl})`,
      `- **官方论文原文**: [arXiv:${p.arxiv_id}v${revision}](https://arxiv.org/abs/${p.arxiv_id}v${revision})`
    );
  } else {
    lines.push(
      "---",
      "",
      "### 📚 Reading Access",
      `- **Online Reading (Cloudflare)**: [Read Full Brief](${websiteBase}/arxiv-daily/${date}/#${anchor})`,
      `- **Direct / Local Network**: [Read Direct Brief](${localWebsiteBase}/arxiv-daily/${date}/#${anchor})`,
      `- **QQ Channel Discussion**: [Join Channel Discussion](${paperPostUrl})`,
      `- **Official Paper**: [arXiv:${p.arxiv_id}v${revision}](https://arxiv.org/abs/${p.arxiv_id}v${revision})`
    );
  }

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

export function resolveGroupTargets({
  args = [],
  specifiedGroup = null,
  env = process.env,
  userManager = defaultUserManager,
} = {}) {
  const isBroadcast = args.includes("--broadcast");
  const hasForce = args.includes("--force");
  const testGroup = env.QQ_TEST_GROUP_OPENID ? env.QQ_TEST_GROUP_OPENID.trim() : null;

  if (isBroadcast) {
    let targets = userManager.getNotificationGroupOpenids();
    if (targets.length === 0) {
      const fallback = env.QQ_NOTIFY_GROUP_OPENID || userManager.getLatestGroupOpenid();
      if (fallback) targets = [fallback.trim()];
    }
    return {
      isBroadcast: true,
      targets,
      guarded: false,
    };
  }

  // Not broadcast (Manual testing / single target mode)
  if (testGroup) {
    if (specifiedGroup && specifiedGroup !== testGroup) {
      if (!hasForce) {
        throw new Error(
          `QQ_TEST_GUARD_BLOCKED: 当前激活了测试群隔离保护 [${maskOpenid(testGroup)}]。为防止误打扰正式群，已阻断向非测试群 [${maskOpenid(specifiedGroup)}] 发送消息。若确需向该群发送，请增加 --force 参数。`
        );
      }
      return {
        isBroadcast: false,
        targets: [specifiedGroup],
        guarded: false,
        forced: true,
      };
    }
    return {
      isBroadcast: false,
      targets: [testGroup],
      guarded: true,
    };
  }

  // No test guard configured
  if (specifiedGroup) {
    return {
      isBroadcast: false,
      targets: [specifiedGroup],
      guarded: false,
    };
  }

  const latest = userManager.getLatestGroupOpenid();
  return {
    isBroadcast: false,
    targets: latest ? [latest] : [],
    guarded: false,
  };
}

export async function dispatchGroupProactiveSend({
  targets = [],
  content = "",
  sender = sendProactiveGroupMessage,
} = {}) {
  const outcomes = { success: [], failed: [] };
  for (const groupOpenid of targets) {
    try {
      const res = await sender({ groupOpenid, content });
      outcomes.success.push({ groupOpenid, receipt: res });
    } catch (err) {
      outcomes.failed.push({ groupOpenid, error: err.message });
    }
  }
  return outcomes;
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
