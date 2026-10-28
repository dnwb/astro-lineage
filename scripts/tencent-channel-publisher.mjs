import { readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { validateDailyRadarPayload } from "./daily-radar.mjs";
import { readPublishedArxivEdition } from "./arxiv-daily.mjs";
import {
  TOPICS,
  TOPIC_LABELS,
  routePaper,
  hashBody,
  markerFor,
  readDailyArchive,
  listDailyArchives,
  withPublicationLedger,
  capturePublishedSourceBinding,
  DAILY_BRIEF_CHANNEL_ID,
  GENERAL_CHANNEL_ID,
  resolvePublicationTarget,
} from "./channel-publication.mjs";
import {
  deriveDailyTitleCandidate,
  derivePaperTitleCandidate,
  deriveWeeklyTitleCandidate,
  extractPaperTopic,
  formatDailyTitle,
  validateTitleOverride,
} from "./channel-title-policy.mjs";
import { resolvePaperTitleZhAsync, resolvePaperTitleZhSync } from "./paper-translation.mjs";
import { isLegacyChineseDate } from "../src/domain/language-cutover.mjs";
import { TencentGuildAdapter } from "./intelligence-egress.mjs";
import {
  getDefaultWebsiteBase,
  getDefaultLocalWebsiteBase,
  deriveFigurePhysicalCore,
} from "../src/domain/academic-domain.mjs";
export { extractPaperTopic, DAILY_BRIEF_CHANNEL_ID, GENERAL_CHANNEL_ID, resolvePublicationTarget };

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

const DEFAULT_GUILD_ID = process.env.TENCENT_GUILD_ID || "";
const DEFAULT_DAILY_CHANNEL_ID = process.env.TENCENT_DAILY_CHANNEL_ID || "";
const DEFAULT_WEEKLY_CHANNEL_ID = process.env.TENCENT_WEEKLY_CHANNEL_ID || "";
const PUBLIC_SITE_URL = getDefaultWebsiteBase();
const LOCAL_SITE_URL = getDefaultLocalWebsiteBase();
const SITE_BASE_URL = PUBLIC_SITE_URL;

const RADAR_PATH = resolve(fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url)));
const FEED_PATH = resolve(fileURLToPath(new URL("../src/data/arxiv-daily.json", import.meta.url)));
const WEEKLY_PATH = resolve(
  fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url))
);
const DEFAULT_CACHE_ROOT = resolve(
  fileURLToPath(new URL("../.cache/channel-publication", import.meta.url))
);
const DEFAULT_ARCHIVE_ROOT = resolve(
  fileURLToPath(new URL("../src/data/arxiv-archives/daily", import.meta.url))
);
const DEFAULT_DIST_ROOT = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const WEBSITE_BUILD_PATH = resolve(
  fileURLToPath(new URL("../.cache/notebooklm/website.json", import.meta.url))
);
const DEFAULT_PUBLIC_ROOT = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const DEFAULT_FIGURE_REVIEW_PATH = resolve(
  fileURLToPath(new URL("./channel-figure-reviews.json", import.meta.url))
);

function requireSourceBinding(sourceBinding) {
  const { daily, weekly, archives, id } = sourceBinding || {};
  const payloadToHash = {
    daily,
    weekly,
    archives,
    ...(sourceBinding?.weeklyArchives ? { weeklyArchives: sourceBinding.weeklyArchives } : {}),
  };
  const legacyPayload = { daily, weekly, archives };
  if (
    !daily?.generation_id ||
    !/^[a-f0-9]{64}$/u.test(daily.hash || "") ||
    !/^[a-f0-9]{64}$/u.test(weekly?.hash || "") ||
    !archives ||
    typeof archives !== "object" ||
    (hashBody(JSON.stringify(payloadToHash)) !== id &&
      hashBody(JSON.stringify(legacyPayload)) !== id)
  )
    throw new Error("CHANNEL_SOURCE_BUILD_REQUIRED");
}

const runCli = TencentGuildAdapter.defaultCliRunner;

function cleanMath(text) {
  if (!text) return "";
  return String(text).replace(/\\\\/g, "\\");
}

function paperReaderTitle(item, options = {}) {
  return derivePaperTitleCandidate(item, options);
}

export function derivePaperContentTitle(item, options = {}) {
  return paperReaderTitle(item, options);
}

function dailyBriefItem(model, date) {
  let brief = model.opening_brief;
  if (brief?.status !== "ready") {
    try {
      const archive = readDailyArchive(date);
      if (archive?.radar?.opening_brief?.status === "ready") {
        brief = archive.radar.opening_brief;
      }
    } catch {}
  }
  if (brief?.status !== "ready" && model.groups?.must_read?.length) {
    const isLegacy = isLegacyChineseDate(date);
    const count = (model.groups.must_read.length || 0) + (model.groups.worth_knowing?.length || 0);
    brief = {
      status: "ready",
      intro: isLegacy
        ? `本期首看《${model.groups.must_read[0].title}》等 ${count} 篇核心进展。`
        : `Featured reading: "${model.groups.must_read[0].title}"${count > 1 ? ` and ${count - 1} other key developments` : ""}.`,
      must_read: model.groups.must_read.map((p) => {
        const a = p.analysis?.analysis || p.analysis || {};
        const text = a.result?.detailed_text || a.result?.bluf || a.result || p.title;
        return {
          arxiv_id: p.arxiv_id,
          revision: p.revision,
          text: typeof text === "string" ? text.slice(0, 150) : p.title,
        };
      }),
      worth_knowing_summary: model.groups.worth_knowing?.length
        ? isLegacy
          ? `包含 ${model.groups.worth_knowing.length} 篇重要进展。`
          : `Includes ${model.groups.worth_knowing.length} noteworthy developments.`
        : "",
      skim_summary: "",
    };
  }
  if (brief?.status !== "ready") throw new Error("CHANNEL_BRIEF_UNAVAILABLE");
  const papers = [...(model.groups.must_read || []), ...(model.groups.worth_knowing || [])];
  let title;
  try {
    title = deriveDailyContentTitle(date, papers, brief);
  } catch (error) {
    const topic = papers[0] ? extractPaperTopic(papers[0]) : "";
    const candidate = topic ? `${topic}最新突破进展` : "高能天体物理前沿文献精读";
    title = formatDailyTitle(date, candidate);
  }
  const isLegacy = isLegacyChineseDate(date);
  const lines = isLegacy
    ? [`发布日期：${date}`, "", "## 本期导读", "", brief.intro, ""]
    : [`Date: ${date}`, "", "## Daily Overview", "", brief.intro, ""];
  if (brief.must_read?.length) {
    lines.push(isLegacy ? "## 必读核心突破" : "## Must-Read Papers", "");
    for (const sentence of brief.must_read) {
      const paper = papers.find(
        (p) => p.arxiv_id === sentence.arxiv_id && p.revision === sentence.revision
      );
      if (!paper) continue;
      const anchor = `radar-paper-${paper.arxiv_id.replace(".", "-")}-v${paper.revision}`;
      const originalLabel = isLegacy ? "原文" : "Original";
      lines.push(
        `### [${paperReaderTitle(paper)}](${SITE_BASE_URL}/arxiv-daily/${date}/#${anchor})`,
        "",
        `${sentence.text} [${originalLabel}](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision})`,
        ""
      );
    }
  }
  if (model.groups.worth_knowing?.length && brief.worth_knowing_summary)
    lines.push(
      isLegacy ? "## 其他值得关注" : "## Other Followed Works",
      "",
      brief.worth_knowing_summary.replace(/；其余见下方卡片[。.]?$/u, isLegacy ? "。" : "."),
      ""
    );
  if (model.groups.skip?.length && brief.skim_summary)
    lines.push(isLegacy ? "## 略读线索" : "## Skim Notes", "", brief.skim_summary, "");
  if (isLegacy) {
    lines.push(
      "---",
      "",
      "## 阅读入口",
      `- **公网在线阅读 (Cloudflare)**: [打开网页深度导读](${PUBLIC_SITE_URL}/arxiv-daily/${date}/)`,
      `- **校内/局域网直连**: [打开校内直连导读](${LOCAL_SITE_URL}/arxiv-daily/${date}/)`,
      `- **QQ 频道社区交流帖**: [进入频道讨论](https://pd.qq.com/s/7xr9egnly)`,
      "",
      "每篇论文的版本、实际阅读范围与未核查项见网页原记录；本摘要不代表独立验证。"
    );
  } else {
    lines.push(
      "---",
      "",
      "## Reading Access",
      `- **Online Reading (Cloudflare)**: [Read Full Daily Brief](${PUBLIC_SITE_URL}/arxiv-daily/${date}/)`,
      `- **Direct / Local Network**: [Read Direct Brief](${LOCAL_SITE_URL}/arxiv-daily/${date}/)`,
      `- **QQ Channel Discussion**: [Join Channel Discussion](https://pd.qq.com/s/7xr9egnly)`,
      "",
      "Refer to original web records for paper versions, reading coverage, and unverified points. Summaries do not constitute independent verification."
    );
  }
  return {
    identity: `daily-summary:${date}`,
    topic: { primary: "daily" },
    title,
    body: lines.join("\n"),
  };
}

export function deriveDailyContentTitle(batchDate, highlights, brief) {
  return deriveDailyTitleCandidate(batchDate, highlights, brief);
}

export function deriveWeeklyContentTitle(weekId, weekly) {
  return deriveWeeklyTitleCandidate(weekId, weekly);
}

function useSourceBoundTitleOverride(kind, titleOverride, identity, sourceTitle) {
  const validated = validateTitleOverride(kind, titleOverride, identity);
  if (validated !== sourceTitle) throw new Error("CHANNEL_TITLE_OVERRIDE_SOURCE_MISMATCH");
  return validated;
}

export async function generateDailyMarkdown({
  titleOverride,
  radar,
  feed,
  radarPath = RADAR_PATH,
  feedPath = FEED_PATH,
} = {}) {
  const radarData = radar || JSON.parse(await readFile(radarPath, "utf8"));
  const feedData = feed || JSON.parse(await readFile(feedPath, "utf8"));

  const batchDate = feedData.window?.announcement_date || new Date().toISOString().slice(0, 10);
  const totalEntries = feedData.entries?.length || 0;

  const validation = validateDailyRadarPayload(feedData, radarData);
  if (!validation.valid)
    throw new Error(`CHANNEL_SOURCE_INVALID:${validation.diagnostics.join(",")}`);
  const model = validation.model;

  const mustRead = model.groups.must_read || [];
  const worthKnowing = model.groups.worth_knowing || [];
  const highlights = [...mustRead, ...worthKnowing];

  const item = dailyBriefItem(model, batchDate);
  const postTitle =
    titleOverride === undefined
      ? item.title
      : useSourceBoundTitleOverride("daily", titleOverride, batchDate, item.title);
  const md = item.body;
  return { batchDate, totalEntries, highlights, postTitle, md };
}

export async function generateWeeklyMarkdown({
  titleOverride,
  weekly: weeklyInput,
  weeklyPath = WEEKLY_PATH,
} = {}) {
  const weekly = weeklyInput || JSON.parse(await readFile(weeklyPath, "utf8"));
  const weekId = weekly.week_id || "本周";
  const dateRange = weekly.date_range || "";

  const sourceTitle = deriveWeeklyContentTitle(weekId, weekly);
  const postTitle =
    titleOverride === undefined
      ? sourceTitle
      : useSourceBoundTitleOverride("weekly", titleOverride, weekId, sourceTitle);

  const isLegacy = isLegacyChineseDate(weekId);
  let md = `${dateRange}\n\n`;

  if (weekly.executive_summary) {
    md += isLegacy ? `## 本周导读\n\n` : `## Weekly Overview\n\n`;
    md += `${weekly.executive_summary}\n\n`;
  }

  if (Array.isArray(weekly.top_picks) && weekly.top_picks.length > 0) {
    md += isLegacy ? `## 建议优先阅读\n\n` : `## Top Picks\n\n`;
    for (const pick of weekly.top_picks) {
      const tag = isLegacy
        ? pick.priority === "must_read"
          ? "必读"
          : "关注"
        : pick.priority === "must_read"
          ? "Must Read"
          : "Follow";
      const paperObj = (weekly.papers || []).find((p) => p.arxiv_id === pick.arxiv_id);
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
      md += `**${tag} · [arXiv:${pick.arxiv_id}](https://arxiv.org/abs/${pick.arxiv_id})**${authorSuffix}\n\n`;
      if (pick.title) md += `*${pick.title}*\n\n`;
      const reason = pick.reason || pick.recommendation_reason || pick.core_insight;
      if (reason) md += `${reason}\n\n`;
    }
    md += `\n`;
  }

  if (Array.isArray(weekly.thematic_highlights) && weekly.thematic_highlights.length > 0) {
    md += isLegacy ? `## 各主题进展\n\n` : `## Thematic Developments\n\n`;
    for (const theme of weekly.thematic_highlights) {
      const papers = (theme.paper_ids || [])
        .map((id) => {
          const found = (weekly.papers || []).find((p) => p.arxiv_id === id);
          const authorStr =
            found && Array.isArray(found.authors) && found.authors.length > 0
              ? isLegacy
                ? ` (${found.authors[0]} 等)`
                : ` (${found.authors[0]} et al.)`
              : "";
          return `[arXiv:${id}${authorStr}](https://arxiv.org/abs/${id})`;
        })
        .join(", ");
      md += `### ${theme.theme_name}\n\n`;
      md += `${theme.summary}\n\n`;
      if (papers) md += isLegacy ? `相关论文：${papers}\n` : `Related Papers: ${papers}\n`;
      md += `\n`;
    }
  }

  if (Array.isArray(weekly.lineage_connections) && weekly.lineage_connections.length > 0) {
    md += isLegacy
      ? `---\n\n## 📚 经典学术脉络传承与对照\n\n`
      : `---\n\n## 📚 Academic Lineage & Comparisons\n\n`;
    for (const conn of weekly.lineage_connections) {
      const classicLabel = isLegacy ? "经典文献" : "Classic Work";
      md += `* **[${conn.classic_work || classicLabel}]** ⟵ **[arXiv:${conn.new_arxiv_id}]**\n`;
      md += `  ${cleanMath(conn.relationship)}\n`;
    }
    md += `\n`;
  }

  if (isLegacy) {
    md += `---\n\n## 阅读入口\n`;
    md += `- **公网在线阅读 (Cloudflare)**: [打开网页深度周报](${PUBLIC_SITE_URL}/arxiv-weekly/${weekId}/)\n`;
    md += `- **校内/局域网直连**: [打开校内直连周报](${LOCAL_SITE_URL}/arxiv-weekly/${weekId}/)\n`;
    md += `- **QQ 频道社区交流帖**: [进入频道讨论](https://pd.qq.com/s/7xr9egnly)\n`;
    md += `- **课题组前沿脉络知识库主页**: [公网主页](${PUBLIC_SITE_URL}/) | [校内直连](${LOCAL_SITE_URL}/)\n`;
  } else {
    md += `---\n\n## Reading Access\n`;
    md += `- **Online Reading (Cloudflare)**: [Read Full Weekly Report](${PUBLIC_SITE_URL}/arxiv-weekly/${weekId}/)\n`;
    md += `- **Direct / Local Network**: [Read Direct Weekly Report](${LOCAL_SITE_URL}/arxiv-weekly/${weekId}/)\n`;
    md += `- **QQ Channel Discussion**: [Join Channel Discussion](https://pd.qq.com/s/7xr9egnly)\n`;
    md += `- **Research Lineage Knowledge Base**: [Online Home](${PUBLIC_SITE_URL}/) | [Direct Home](${LOCAL_SITE_URL}/)\n`;
  }

  return { weekId, dateRange, postTitle, md };
}

function payload(response) {
  if (typeof response?.stdout === "string") response = JSON.parse(response.stdout);
  if (Number(response?.retCode) === 153) throw new Error("CHANNEL_RATE_LIMIT");
  if (
    (response?.retCode !== undefined && Number(response.retCode) !== 0) ||
    response?.success === false ||
    response?.error
  )
    throw new Error("CHANNEL_REMOTE_REJECTED");
  return response?.data ?? response;
}

function remoteIdentity(value) {
  const feed = value?.feed ?? value?.feed_info ?? value;
  const id = feed?.feed_id ?? feed?.feedId ?? feed?.id;
  const time = feed?.create_time_raw ?? feed?.create_time ?? feed?.createTime;
  return id && time
    ? {
        feed_id: String(id),
        create_time: String(time),
        channel_id: String(feed.channel_id ?? feed.channelId ?? ""),
      }
    : null;
}

function remoteBody(value) {
  const feed = value?.feed ?? value?.feed_info ?? value;
  return (
    feed?.markdown_content ??
    feed?.markdownContent ??
    feed?.content?.markdown_content ??
    feed?.content?.text ??
    feed?.content ??
    ""
  );
}

function remoteTitle(value) {
  const feed = value?.feed ?? value?.feed_info ?? value;
  return feed?.title ?? feed?.feed_title ?? "";
}

function remoteHasMedia(value) {
  const feed = value?.feed ?? value?.feed_info ?? value;
  return ["image_paths", "images", "media"].some(
    (key) => Array.isArray(feed?.[key]) && feed[key].length > 0
  );
}

export function matchesManagedBody(value, identity, hash) {
  if (!/^[a-f0-9]{64}$/u.test(hash || "")) return false;
  const body = String(value);
  const suffix = `\n\n${markerFor(identity, hash)}`;
  return body.endsWith(suffix) && hashBody(body.slice(0, -suffix.length)) === hash;
}

function remoteMediaFingerprint(value) {
  const feed = value?.feed ?? value?.feed_info ?? value;
  const fields = ["image_paths", "images", "media"].map((key) => feed?.[key]);
  const populated = fields.filter((value) => Array.isArray(value) && value.length);
  if (!populated.length || populated.some((media) => media.length !== 1)) return null;
  const media = populated[0];
  const references = media.map((item) =>
    typeof item === "string" ? item : (item?.url ?? item?.picUrl ?? item?.pic_url ?? item?.path)
  );
  if (references.some((reference) => typeof reference !== "string" || !reference)) return null;
  return hashBody(JSON.stringify(references));
}

function figureReadbackProblem(current, expectedRemote, identity, title, existing, channelId) {
  const expectedIdentity = remoteIdentity(expectedRemote);
  const currentIdentity = remoteIdentity(current);
  if (
    !expectedIdentity ||
    !currentIdentity ||
    currentIdentity.feed_id !== expectedIdentity.feed_id ||
    currentIdentity.create_time !== expectedIdentity.create_time ||
    currentIdentity.channel_id !== String(channelId)
  ) {
    return "CHANNEL_REMOTE_IDENTITY_DRIFT";
  }
  if (!matchesManagedBody(remoteBody(current), identity, existing.hash))
    return "CHANNEL_REMOTE_BODY_DRIFT";
  if (remoteTitle(current) !== title) return "CHANNEL_REMOTE_TITLE_DRIFT";
  const currentMediaFingerprint = remoteMediaFingerprint(current);
  if (!currentMediaFingerprint)
    return existing.status === "intent"
      ? "CHANNEL_CREATE_MEDIA_UNVERIFIED"
      : "CHANNEL_REMOTE_MEDIA_DRIFT";
  if (!existing.figure_media_sha256) {
    return existing.status === "intent"
      ? "CHANNEL_CREATE_MEDIA_BASELINE_MISSING"
      : "CHANNEL_REMOTE_MEDIA_BASELINE_MISSING";
  }
  if (currentMediaFingerprint !== existing.figure_media_sha256) return "CHANNEL_REMOTE_MEDIA_DRIFT";
  return null;
}

export const READING_ANCHORS = Object.freeze([
  "\n---\n\n## 📚 阅读入口",
  "\n---\n\n## 阅读入口",
  "\n---\n\n## 📖 Reading Access",
  "\n---\n\n## Reading Access",
  "\n---\n\n## 📖 Reading Entry",
  "\n---\n\n## Reading Entry",
]);

export function findReadingAnchor(body, start = 0) {
  const text = String(body);
  for (const anchor of READING_ANCHORS) {
    const idx = text.indexOf(anchor, start);
    if (idx >= 0) {
      return {
        index: idx,
        anchor,
        isEn: /reading/i.test(anchor),
      };
    }
  }
  return null;
}

export function bodyWithoutManagedFigure(value) {
  const body = String(value);
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
  )
    return null;
  return body.slice(0, start) + body.slice(end);
}

async function scanFeeds(cli, guildId, channelId) {
  const all = [];
  let cursor = "";
  let emptyPages = 0;
  const seenCursor = new Set();
  const seenId = new Set();
  for (let page = 0; page < 30; page += 1) {
    const args = [
      "feed",
      "get-channel-timeline-feeds",
      "--guild-id",
      String(guildId),
      "--channel-id",
      String(channelId),
      "--count",
      "50",
      "--json",
    ];
    if (cursor) args.push("--feed-attach-info", cursor);
    const data = payload(await cli(args));
    const feeds = Array.isArray(data) ? data : (data?.feeds ?? data?.feed_list ?? data?.list ?? []);
    if (!Array.isArray(feeds)) throw new Error("CHANNEL_PAGINATION_INVALID");
    let added = 0;
    for (const feed of feeds) {
      const identity = remoteIdentity(feed);
      if (identity?.channel_id && identity.channel_id !== String(channelId))
        return { feeds: all, complete: false };
      if (identity && !seenId.has(identity.feed_id)) {
        seenId.add(identity.feed_id);
        all.push({ ...identity, channel_id: String(channelId), raw: feed });
        added += 1;
      }
    }
    const next = String(data?.feed_attch_info ?? data?.feed_attach_info ?? "");
    if (data?.has_more === false || (!data?.has_more && !next))
      return { feeds: all, complete: true };
    emptyPages = added ? 0 : emptyPages + 1;
    if (emptyPages >= 2) return { feeds: all, complete: false };
    if (!next || next === cursor || seenCursor.has(next)) return { feeds: all, complete: false };
    seenCursor.add(next);
    cursor = next;
  }
  return { feeds: all, complete: false };
}

function channelName(value) {
  return String(value ?? "").replace(/&amp;/gu, "&");
}

async function scanGuildFeeds(cli, guildId, channels) {
  const names = new Map();
  const channelIds = new Set();
  for (const channel of channels) {
    const name = channelName(channel.channel_name ?? channel.name);
    const id = String(channel.channel_id ?? channel.id ?? "");
    if (!name || !id || names.has(name)) return { feeds: [], complete: false };
    names.set(name, id);
    channelIds.add(id);
  }
  const all = [];
  const seenIds = new Map();
  const seenCursors = new Set();
  let cursor = "";
  let emptyPages = 0;
  for (let page = 0; page < 30; page += 1) {
    const args = [
      "feed",
      "get-guild-feeds",
      "--guild-id",
      String(guildId),
      "--get-type",
      "2",
      "--count",
      "100",
      "--json",
    ];
    if (cursor) args.push("--feed-attach-info", cursor);
    const data = payload(await cli(args));
    const feeds = Array.isArray(data) ? data : (data?.feeds ?? data?.feed_list ?? data?.list);
    if (!Array.isArray(feeds)) return { feeds: all, complete: false };
    let added = 0;
    for (const feed of feeds) {
      const identity = remoteIdentity(feed);
      const id = names.get(channelName(feed.channel_name ?? feed.channelName));
      if (!identity || !id || (identity.channel_id && identity.channel_id !== id))
        return { feeds: all, complete: false };
      if (seenIds.has(identity.feed_id) && seenIds.get(identity.feed_id) !== id)
        return { feeds: all, complete: false };
      if (!seenIds.has(identity.feed_id)) {
        seenIds.set(identity.feed_id, id);
        all.push({ ...identity, channel_id: id, raw: feed });
        added += 1;
      }
    }
    if (data?.has_more === false) return { feeds: all, complete: true, channelIds };
    emptyPages = added ? 0 : emptyPages + 1;
    if (emptyPages >= 2) return { feeds: all, complete: false };
    const next = String(data?.feed_attach_info ?? data?.feed_attch_info ?? "");
    if (!next || next === cursor || seenCursors.has(next)) return { feeds: all, complete: false };
    seenCursors.add(next);
    cursor = next;
  }
  return { feeds: all, complete: false };
}

async function scanSectionFeeds(cli, guildId, channelId, fallback) {
  const section = await scanFeeds(cli, guildId, channelId);
  if (section.complete) return section;
  if (!fallback.inventory) {
    const data = fallback.channels
      ? null
      : payload(
          await cli(["manage", "get-guild-channel-list", "--guild-id", String(guildId), "--json"])
        );
    const channels =
      fallback.channels ?? (Array.isArray(data) ? data : (data?.channels ?? data?.channel_list));
    fallback.inventory = Array.isArray(channels)
      ? await scanGuildFeeds(cli, guildId, channels)
      : { feeds: [], complete: false };
  }
  if (!fallback.inventory.complete || !fallback.inventory.channelIds.has(String(channelId)))
    return section;
  const feeds = fallback.inventory.feeds.filter((feed) => feed.channel_id === String(channelId));
  if (section.feeds.some((feed) => !feeds.some((entry) => entry.feed_id === feed.feed_id)))
    return section;
  return { feeds, complete: true };
}

async function detail(cli, guildId, feed) {
  return payload(
    await cli([
      "feed",
      "get-feed-detail",
      "--guild-id",
      String(guildId),
      "--channel-id",
      String(feed.channel_id),
      "--feed-id",
      feed.feed_id,
      "--json",
    ])
  );
}

function claimText(value) {
  if (typeof value === "string") return value.trim();
  const text = value?.detailed_text || value?.bluf || value?.result;
  return typeof text === "string" ? text.trim() : "";
}

function claimSentences(value) {
  return (
    claimText(value)
      .match(/[^。！？\n]+[。！？]?/gu)
      ?.map((text) => text.trim())
      .filter(Boolean) || []
  );
}

export function readingExcerpt(value) {
  const first = claimSentences(value)[0] || "";
  // A colon introduces the following paragraph/list; it is not a complete summary.
  return /[:：]$/u.test(first)
    ? claimSentences(
        claimText(value)
          .replace(/\n\s*[-*]\s+/gu, " ")
          .replace(/\n+/gu, " ")
      )[0] || first
    : first;
}

export function paperMarkdown(item, date, topic, options = {}) {
  const a = item.analysis?.analysis || item.analysis || {};
  const coverage = item.analysis?.coverage || {};
  const mustRead = item.analysis?.priority === "must_read";
  const version = `arXiv:${item.arxiv_id}v${item.revision}`;
  const anchor = `radar-paper-${item.arxiv_id.replace(".", "-")}-v${item.revision}`;
  const readerReason = claimText(a.reason)
    .replace(/\bR1[–—-]R7\b/gu, "课题组各研究方向")
    .replace(/\bR[1-7]\b/gu, (id) => TOPIC_LABELS[id]);
  const author =
    Array.isArray(item.authors) && item.authors.length
      ? ` · ${item.authors.slice(0, 3).join(", ")}${item.authors.length > 3 ? " 等" : ""}`
      : "";
  const problem = claimText(a.problem?.detailed_text || a.problem?.problem || a.problem || "");
  const result = claimText(a.result?.detailed_text || a.result?.bluf || a.result || "");
  const channelUrl = options.channelUrl || "https://pd.qq.com/s/7xr9egnly";

  const isLegacy = isLegacyChineseDate(date);
  const problemFallback = isLegacy
    ? "未能从已检查材料中核实课题问题陈述。"
    : "Problem statement not verified from checked materials.";
  const resultFallback = isLegacy
    ? "详见原文推导与正文分析。"
    : "See original paper for derivations and analysis.";

  const tag = isLegacy ? (mustRead ? "必读" : "关注") : mustRead ? "Must Read" : "Follow";

  const lines = [
    `**${tag}**${author}`,
    "",
    isLegacy ? "## 课题背景" : "## Problem & Background",
    "",
    `> ${problem || problemFallback}`,
    "",
    isLegacy ? "## 核心突破" : "## Key Result & Physical Mechanism",
    "",
    `> ${result || resultFallback}`,
    "",
  ];

  if (readerReason) {
    lines.push(isLegacy ? "## 研读价值" : "## Why It Matters", "", `> ${readerReason}`, "");
  }

  const limits = [...(a.limits || []), ...(a.unresolved_checks || [])];
  if (limits.length) {
    lines.push(isLegacy ? "## 限制与边界" : "## Limitations & Boundaries", "");
    for (const l of limits) {
      lines.push(`- ${claimText(typeof l === "string" ? l : l.text || JSON.stringify(l))}`);
    }
    lines.push("");
  }

  if (isLegacy) {
    lines.push(
      "---",
      "",
      "## 阅读入口",
      "",
      `- **公网在线阅读 (Cloudflare)**: [打开网页深度导读](${PUBLIC_SITE_URL}/arxiv-daily/${date}/#${anchor})`,
      `- **校内/局域网直连**: [打开校内直连导读](${LOCAL_SITE_URL}/arxiv-daily/${date}/#${anchor})`,
      `- **QQ 频道社区交流帖**: [进入频道讨论](${channelUrl})`,
      `- **官方论文原文**: [${version}](https://arxiv.org/abs/${item.arxiv_id}v${item.revision}) · [📄 PDF](https://arxiv.org/pdf/${item.arxiv_id})`,
      "",
      `原标题：${item.title}`,
      "",
      `实际阅读范围：${coverage.label || coverage.level || "完整正文"}。本帖摘录作者报告的结果；完整条件与图表见网页原记录。`
    );
  } else {
    lines.push(
      "---",
      "",
      "## Reading Access",
      "",
      `- **Online Reading (Cloudflare)**: [Read Full Brief](${PUBLIC_SITE_URL}/arxiv-daily/${date}/#${anchor})`,
      `- **Direct / Local Network**: [Read Direct Brief](${LOCAL_SITE_URL}/arxiv-daily/${date}/#${anchor})`,
      `- **QQ Channel Discussion**: [Join Channel Discussion](${channelUrl})`,
      `- **Official Paper**: [${version}](https://arxiv.org/abs/${item.arxiv_id}v${item.revision}) · [📄 PDF](https://arxiv.org/pdf/${item.arxiv_id})`,
      "",
      `Title: ${item.title}`,
      "",
      `Reading coverage: ${coverage.label || coverage.level || "Full text"}. Excerpted from author reports; see website for full conditions and figures.`
    );
  }

  return lines.join("\n");
}

function matchesLegacyPaper(body, item) {
  const text = String(body);
  const ids = [...text.matchAll(/(?:arXiv:|arxiv\.org\/abs\/)(\d{4}\.\d{4,5})(?:v(\d+))?/giu)];
  const versions = ids.filter(
    (match) => match[1] === item.arxiv_id && Number(match[2]) === Number(item.revision)
  );
  return (
    ids.length > 0 &&
    ids.every((match) => match[1] === item.arxiv_id) &&
    versions.length > 0 &&
    text.includes(item.paper_title)
  );
}

function summary() {
  return {
    success: true,
    published: 0,
    updated: 0,
    unchanged: 0,
    pending: 0,
    remaining: 0,
    errors: [],
    pending_items: [],
  };
}
function pending(result, identity, reason) {
  result.pending += 1;
  result.pending_items.push({ identity, reason });
  result.success = false;
}

export function bodyWithReviewedFigure(body, figure, context = {}) {
  const reading = findReadingAnchor(body);
  if (!reading) throw new Error("CHANNEL_FIGURE_BODY_ANCHOR_MISSING");
  const marker = reading.anchor;
  const caption = String(figure.caption).replace(/\r?\n/gu, " ").trim();
  const isEn = reading.isEn;
  const physicalCore = (
    figure.physical_core ||
    deriveFigurePhysicalCore(figure, context, { lang: isEn ? "en" : "zh" }) ||
    ""
  ).trim();
  const BADGE_MAP = {
    数据拟合与模型对比: "Model vs Data Fitting",
    物理模型示意图: "Physical Model Schematic",
    核心物理演化图: "Physical Evolution",
    核心物理结果: "Physical Result",
    核心观测结果: "Observational Evidence",
    "观测总体曲线/能谱": "Observational Light Curve / SED",
  };
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
  return String(body).replace(
    marker,
    `\n\n${heading}\n\n[(0,0)](@img)\n\n${coreSection}${captionLine}${marker}`
  );
}

async function publishItems(
  items,
  {
    guildId = DEFAULT_GUILD_ID,
    channelIds = {},
    channelId,
    fallbackChannelId,
    legacyBindings,
    cacheRoot = DEFAULT_CACHE_ROOT,
    cli = runCli,
    dryRun = false,
    limit = 50,
    kind = "daily",
    backfill = false,
    allowExistingBodyEdits = false,
  } = {}
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("CHANNEL_LIMIT_INVALID");
  if (!legacyBindings) {
    try {
      legacyBindings = JSON.parse(await readFile(join(cacheRoot, "legacy-bindings.json"), "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("CHANNEL_LEGACY_BINDINGS_INVALID");
      legacyBindings = {};
    }
  }
  if (!legacyBindings || typeof legacyBindings !== "object" || Array.isArray(legacyBindings))
    throw new Error("CHANNEL_LEGACY_BINDINGS_INVALID");
  return withPublicationLedger(cacheRoot, guildId, async (records, save, ledger) => {
    const result = summary();
    const cursorKey = kind === "brief" ? "brief_cursor" : "backfill_cursor";
    const start = backfill ? Math.min(ledger[cursorKey] || 0, items.length) : 0;
    const list = items.slice(start, start + limit);
    result.remaining = Math.max(0, items.length - start - list.length);
    if (result.remaining && !backfill) result.success = false;
    const scans = new Map();
    const fallback = {};
    let stoppedAt = null;
    let firstFailedIndex = null;
    let currentItem = null;
    const reportPending = (identity, reason) => {
      if (firstFailedIndex === null && currentItem) firstFailedIndex = list.indexOf(currentItem);
      pending(result, identity, reason);
    };
    for (const item of list) {
      currentItem = item;
      const { identity, title, topic } = item;
      if (item.title_error) {
        reportPending(identity, item.title_error);
        continue;
      }
      let target;
      if (kind === "daily") {
        try {
          const resolved = resolvePublicationTarget(item, {
            channelIds: channelId
              ? { ...channelIds, daily: channelIds.daily || channelId }
              : channelIds,
            fallbackChannelId,
          });
          target = resolved.target;
        } catch (error) {
          if (error.message?.includes("CHANNEL_ROUTING_VIOLATION")) {
            reportPending(identity, "CHANNEL_ROUTING_VIOLATION");
            continue;
          }
          throw error;
        }
      } else {
        target = channelId;
      }
      if (kind === "daily" && !target && !dryRun) {
        if (!topic?.primary && !fallbackChannelId && !channelIds[GENERAL_CHANNEL_ID]) {
          reportPending(identity, "CHANNEL_TOPIC_UNRESOLVED");
          continue;
        }
        reportPending(identity, "CHANNEL_SECTION_MISSING");
        continue;
      }
      let existing = records[identity];
      let figure = null;
      let retainPublishedFigure = false;
      if (existing?.figure_sha256) {
        if (!item.figure && existing.status === "published") retainPublishedFigure = true;
        else if (!item.figure || item.figure.sha256 !== existing.figure_sha256) {
          if (allowExistingBodyEdits && item.figure) {
            figure = item.figure;
          } else {
            reportPending(identity, "CHANNEL_FIGURE_REVIEW_MISMATCH");
            continue;
          }
        } else figure = item.figure;
      } else if (!existing && !legacyBindings[identity]) {
        figure = item.figure || null;
      } else if (allowExistingBodyEdits && item.figure) {
        figure = item.figure;
      }
      const body = figure ? bodyWithReviewedFigure(item.body, figure, item) : item.body;
      const hash = hashBody(body);
      const marked = `${body}\n\n${markerFor(identity, hash)}`;
      if (Array.from(title).length > 200 || Array.from(marked).length > 10_000) {
        reportPending(identity, "CHANNEL_CONTENT_LIMIT");
        continue;
      }
      const unchangedPublished =
        existing?.status === "published" &&
        existing.hash === hash &&
        existing.channel_id === String(target);
      const unchangedPublishedFigure = unchangedPublished && existing.figure_sha256;
      if (dryRun) {
        result.pending_items.push({
          identity,
          reason:
            retainPublishedFigure || unchangedPublishedFigure
              ? "would_verify_existing_figure"
              : unchangedPublished
                ? "would_verify_existing"
                : existing?.feed_id
                  ? "would_update"
                  : "would_publish",
        });
        continue;
      }
      try {
        let remote = existing?.feed_id
          ? {
              feed_id: existing.feed_id,
              create_time: existing.create_time,
              channel_id: existing.channel_id,
            }
          : null;
        let movedThisTime = false;
        const binding = legacyBindings[identity];
        if (existing?.status === "intent" && existing.operation === "move") {
          const moved = {
            feed_id: existing.feed_id,
            create_time: existing.create_time,
            channel_id: String(target),
          };
          try {
            const found = await detail(cli, guildId, moved);
            const actual = String(remoteBody(found));
            if (
              matchesManagedBody(actual, identity, hash) ||
              matchesManagedBody(actual, identity, existing.from_hash) ||
              (actual === binding?.content && remoteTitle(found) === binding?.title)
            )
              remote = moved;
            else {
              pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME");
              continue;
            }
          } catch {
            const inventory = await scanSectionFeeds(cli, guildId, String(target), fallback);
            if (
              !inventory.complete ||
              inventory.feeds.some((feed) => feed.feed_id === moved.feed_id)
            ) {
              pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME");
              continue;
            }
            const old = { ...moved, channel_id: existing.channel_id };
            let oldBody;
            try {
              const found = await detail(cli, guildId, old);
              oldBody = String(remoteBody(found));
              if (existing.figure_sha256) {
                const prior = existing.from_hash
                  ? { ...existing, hash: existing.from_hash }
                  : existing;
                const figureProblem = figureReadbackProblem(
                  found,
                  old,
                  identity,
                  title,
                  prior,
                  existing.channel_id
                );
                if (figureProblem) {
                  pending(result, identity, figureProblem);
                  continue;
                }
              } else if (!(
                (oldBody === binding?.content && remoteTitle(found) === binding?.title) ||
                matchesManagedBody(oldBody, identity, existing.from_hash)
              )) {
                pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME");
                continue;
              }
            } catch {
              pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME");
              continue;
            }
            payload(
              await cli([
                "feed",
                "move-feed",
                "--guild-id",
                String(guildId),
                "--channel-id",
                String(target),
                "--original-channel-id",
                String(old.channel_id),
                "--feed-id",
                old.feed_id,
                "--json",
              ])
            );
            const verified = await detail(cli, guildId, moved);
            if (String(remoteBody(verified)) !== oldBody)
              throw new Error("CHANNEL_MOVE_UNVERIFIED");
            remote = moved;
            movedThisTime = true;
          }
        }
        if (!remote && binding && existing?.status !== "intent") {
          const confirmed = await detail(cli, guildId, binding);
          const identityMatches =
            kind === "weekly"
              ? binding.week_id === item.week_id && String(binding.content).includes(item.week_id)
              : matchesLegacyPaper(binding.content, item);
          if (
            !binding.owner_verified ||
            String(binding.guild_id) !== String(guildId) ||
            String(remoteBody(confirmed)) !== binding.content ||
            remoteTitle(confirmed) !== binding.title ||
            !identityMatches
          ) {
            pending(result, identity, "CHANNEL_LEGACY_MISMATCH");
            continue;
          }
          if (kind === "weekly" && String(binding.channel_id) !== String(target)) {
            pending(result, identity, "CHANNEL_LEGACY_MISMATCH");
            continue;
          }
          if (String(binding.channel_id) !== String(target)) {
            records[identity] = {
              hash,
              status: "intent",
              operation: "move",
              feed_id: String(binding.feed_id),
              create_time: String(binding.create_time),
              channel_id: String(binding.channel_id),
            };
            await save();
            try {
              payload(
                await cli([
                  "feed",
                  "move-feed",
                  "--guild-id",
                  String(guildId),
                  "--channel-id",
                  String(target),
                  "--original-channel-id",
                  String(binding.channel_id),
                  "--feed-id",
                  String(binding.feed_id),
                  "--json",
                ])
              );
            } catch (error) {
              if (error.message === "CHANNEL_REMOTE_REJECTED") {
                const old = await detail(cli, guildId, binding);
                if (
                  String(remoteBody(old)) === binding.content &&
                  remoteTitle(old) === binding.title
                ) {
                  delete records[identity];
                  await save();
                }
              }
              throw error;
            }
            const moved = {
              feed_id: String(binding.feed_id),
              create_time: String(binding.create_time),
              channel_id: String(target),
            };
            const verified = await detail(cli, guildId, moved);
            if (
              String(remoteBody(verified)) !== binding.content ||
              remoteTitle(verified) !== binding.title
            )
              throw new Error("CHANNEL_MOVE_UNVERIFIED");
            remote = moved;
            movedThisTime = true;
          } else remote = binding;
        }
        if (
          remote &&
          String(remote.channel_id) !== String(target) &&
          existing?.status === "published"
        ) {
          const before = await detail(cli, guildId, remote);
          const priorBody = String(remoteBody(before));
          if (existing.figure_sha256) {
            const figureProblem = figureReadbackProblem(
              before,
              remote,
              identity,
              title,
              existing,
              remote.channel_id
            );
            if (figureProblem) {
              pending(result, identity, figureProblem);
              continue;
            }
          }
          if (!matchesManagedBody(priorBody, identity, existing.hash)) {
            pending(result, identity, "CHANNEL_REMOTE_MISMATCH");
            continue;
          }
          records[identity] = {
            ...existing,
            hash,
            status: "intent",
            operation: "move",
            from_hash: existing.hash,
          };
          await save();
          try {
            payload(
              await cli([
                "feed",
                "move-feed",
                "--guild-id",
                String(guildId),
                "--channel-id",
                String(target),
                "--original-channel-id",
                String(remote.channel_id),
                "--feed-id",
                remote.feed_id,
                "--json",
              ])
            );
          } catch (error) {
            if (error.message === "CHANNEL_REMOTE_REJECTED") {
              const old = await detail(cli, guildId, remote);
              if (String(remoteBody(old)) === priorBody) {
                records[identity] = existing;
                await save();
              }
            }
            throw error;
          }
          const moved = { ...remote, channel_id: String(target) };
          const verified = await detail(cli, guildId, moved);
          if (String(remoteBody(verified)) !== priorBody)
            throw new Error("CHANNEL_MOVE_UNVERIFIED");
          remote = moved;
          movedThisTime = true;
        }
        if (remote && String(remote.channel_id) !== String(target)) {
          pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME");
          continue;
        }
        const managed = ledger.managed_sections?.[String(target)];
        if (
          !remote &&
          (existing?.status === "intent" ||
            (!existing && !(managed?.verified_empty === true && managed.topic === topic?.primary)))
        ) {
          const scanKey = String(target);
          if (!scans.has(scanKey))
            scans.set(scanKey, await scanSectionFeeds(cli, guildId, scanKey, fallback));
          if (["events", "brief"].includes(kind)) {
            const matches = [];
            let invalidMarker = false;
            for (const candidate of scans.get(scanKey).feeds) {
              const found = await detail(cli, guildId, candidate);
              const currentBody = String(remoteBody(found));
              const priorHash = currentBody.match(/([a-f0-9]{64}) -->$/u)?.[1];
              if (matchesManagedBody(currentBody, identity, priorHash))
                matches.push({ candidate, priorHash });
              else if (currentBody.includes(`<!-- astrolineage-channel:${identity}:`))
                invalidMarker = true;
            }
            if (invalidMarker) {
              pending(result, identity, "CHANNEL_REMOTE_MISMATCH");
              continue;
            }
            if (matches.length > 1 || (matches.length && !scans.get(scanKey).complete)) {
              pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME");
              continue;
            }
            if (matches.length === 1) {
              remote = matches[0].candidate;
              existing = {
                ...existing,
                hash: matches[0].priorHash,
                from_hash: matches[0].priorHash,
              };
            }
          }
          if (!remote) {
            const figureIntent = existing?.status === "intent" && existing.figure_sha256;
            const exactFigureMatches = [];
            let invalidFigureMarker = false;
            for (const candidate of scans.get(scanKey).feeds) {
              const found = await detail(cli, guildId, candidate);
              const currentBody = String(remoteBody(found));
              if (matchesManagedBody(currentBody, identity, hash)) {
                if (figureIntent) exactFigureMatches.push(candidate);
                else {
                  remote = candidate;
                  break;
                }
              } else if (
                figureIntent &&
                currentBody.includes(`<!-- astrolineage-channel:${identity}:`)
              )
                invalidFigureMarker = true;
              if (
                kind === "weekly" &&
                currentBody === body &&
                String(found.title ?? found.feed?.title ?? "") === title
              ) {
                remote = candidate;
                break;
              }
              if (
                kind === "weekly" &&
                existing?.status !== "intent" &&
                (currentBody.includes(item.week_id) || remoteTitle(found).includes(item.week_id))
              ) {
                pending(result, identity, "CHANNEL_WEEKLY_AMBIGUOUS");
                remote = "pending_weekly";
                break;
              }
              if (
                kind === "daily" &&
                currentBody.includes(`arXiv:${item.arxiv_id}v${item.revision}`) &&
                currentBody === body
              ) {
                remote = candidate;
                break;
              }
            }
            if (
              figureIntent &&
              (invalidFigureMarker ||
                !scans.get(scanKey).complete ||
                exactFigureMatches.length !== 1)
            ) {
              pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME");
              continue;
            }
            if (figureIntent) remote = exactFigureMatches[0];
          }
          if (remote === "pending_weekly") continue;
          if (!remote && !scans.get(scanKey).complete) {
            pending(
              result,
              identity,
              existing?.status === "intent"
                ? "CHANNEL_UNKNOWN_OUTCOME"
                : "CHANNEL_PAGINATION_INCOMPLETE"
            );
            continue;
          }
        }
        if (existing?.status === "intent" && !remote) {
          pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME");
          continue;
        }
        if (remote) {
          const current = await detail(cli, guildId, remote);
          const currentBody = String(remoteBody(current));
          const currentIdentity = remoteIdentity(current);
          if (existing?.figure_sha256) {
            const figureProblem = figureReadbackProblem(
              current,
              remote,
              identity,
              title,
              existing,
              target
            );
            if (figureProblem) {
              pending(result, identity, figureProblem);
              continue;
            }
          }
          if (
            existing?.status === "published" &&
            currentBody === marked &&
            remoteTitle(current) !== title
          ) {
            pending(result, identity, "CHANNEL_REMOTE_TITLE_DRIFT");
            continue;
          }
          const retainedFigureIsUnchanged =
            retainPublishedFigure &&
            existing?.status === "published" &&
            existing.channel_id === String(target) &&
            currentIdentity?.feed_id === String(existing.feed_id) &&
            currentIdentity.create_time === String(existing.create_time) &&
            currentIdentity.channel_id === String(target) &&
            remoteTitle(current) === title &&
            remoteHasMedia(current) &&
            matchesManagedBody(currentBody, identity, existing.hash) &&
            bodyWithoutManagedFigure(currentBody) ===
              `${body}\n\n${markerFor(identity, existing.hash)}`;
          if (retainedFigureIsUnchanged) {
            result.unchanged += 1;
            continue;
          }
          let alterResponse;
          if (currentBody !== marked) {
            const priorHash = existing?.status === "intent" ? existing.from_hash : existing?.hash;
            if (
              existing &&
              !(
                matchesManagedBody(currentBody, identity, priorHash) ||
                (binding &&
                  currentBody === binding.content &&
                  remoteTitle(current) === binding.title)
              )
            ) {
              pending(result, identity, "CHANNEL_REMOTE_MISMATCH");
              continue;
            }
            if (!allowExistingBodyEdits && kind !== "events") {
              pending(result, identity, "CHANNEL_EXISTING_BODY_EDIT_REQUIRES_APPROVAL");
              continue;
            }
            records[identity] = {
              ...existing,
              hash,
              from_hash: priorHash,
              status: "intent",
              feed_id: remote.feed_id,
              create_time: remote.create_time,
              channel_id: remote.channel_id,
            };
            await save();
            const alterArgs = [
              "feed",
              "alter-feed",
              "--guild-id",
              String(guildId),
              "--channel-id",
              String(remote.channel_id),
              "--feed-id",
              remote.feed_id,
              "--create-time",
              remote.create_time,
              "--title",
              title,
              "--markdown-content",
              marked,
            ];
            if (figure) {
              alterArgs.push("--clear-images", "--image", figure.path);
            }
            alterArgs.push("--json");
            alterResponse = payload(await cli(alterArgs));
            result.updated += 1;
          } else if (movedThisTime) result.updated += 1;
          else result.unchanged += 1;
          let shareUrl = existing?.share_url;
          if (!shareUrl && remote?.feed_id && remote?.channel_id) {
            try {
              const shareRes = payload(
                await cli([
                  "feed",
                  "get-feed-share-url",
                  "--guild-id",
                  String(guildId),
                  "--channel-id",
                  String(remote.channel_id),
                  "--feed-id",
                  String(remote.feed_id),
                  "--json",
                ])
              );
              if (shareRes?.share_url) shareUrl = shareRes.share_url;
            } catch {}
          }
          let figureMediaSha256 = existing?.figure_media_sha256;
          if (figure) {
            const updatedFeed = await detail(cli, guildId, remote);
            figureMediaSha256 =
              remoteMediaFingerprint(updatedFeed) ||
              (alterResponse ? remoteMediaFingerprint(alterResponse) : null) ||
              figureMediaSha256;
            if (!figureMediaSha256 && !dryRun) {
              throw new Error("CHANNEL_FIGURE_DELIVERY_UNVERIFIED");
            }
          }
          records[identity] = {
            hash,
            status: "published",
            feed_id: remote.feed_id,
            create_time: remote.create_time,
            channel_id: remote.channel_id,
            ...(shareUrl ? { share_url: shareUrl } : {}),
            ...(figure
              ? {
                  figure_sha256: figure.sha256,
                  figure_media_sha256: figureMediaSha256,
                }
              : {}),
          };
          await save();
        } else {
          records[identity] = {
            hash,
            status: "intent",
            channel_id: String(target),
            ...(figure ? { figure_sha256: figure.sha256 } : {}),
          };
          await save();
          const args = [
            "feed",
            "publish-feed",
            "--guild-id",
            String(guildId),
            "--channel-id",
            String(target),
            "--title",
            title,
            "--markdown-content",
            marked,
          ];
          if (figure) args.push("--image", figure.path);
          args.push("--json");
          const createdResponse = payload(await cli(args));
          const created = remoteIdentity(createdResponse);
          if (!created) throw new Error("CHANNEL_CREATE_IDENTITY_MISSING");
          let figureMediaSha256;
          if (figure) {
            const publishedFeed = await detail(cli, guildId, {
              ...created,
              channel_id: String(target),
            });
            const verified = remoteIdentity(publishedFeed);
            const responseMediaFingerprint = remoteMediaFingerprint(createdResponse);
            const responseHasMedia = remoteHasMedia(createdResponse);
            figureMediaSha256 = remoteMediaFingerprint(publishedFeed);
            if (
              !verified ||
              verified.feed_id !== created.feed_id ||
              verified.create_time !== created.create_time ||
              verified.channel_id !== String(target) ||
              !figureMediaSha256 ||
              !responseHasMedia ||
              !responseMediaFingerprint ||
              responseMediaFingerprint !== figureMediaSha256
            ) {
              pending(result, identity, "CHANNEL_CREATE_MEDIA_UNVERIFIED");
              continue;
            }
            if (!matchesManagedBody(remoteBody(publishedFeed), identity, hash)) {
              pending(result, identity, "CHANNEL_CREATE_BODY_UNVERIFIED");
              continue;
            }
            if (remoteTitle(publishedFeed) !== title) {
              pending(result, identity, "CHANNEL_CREATE_TITLE_UNVERIFIED");
              continue;
            }
            records[identity] = {
              ...records[identity],
              feed_id: created.feed_id,
              create_time: created.create_time,
              channel_id: String(target),
              figure_media_sha256: figureMediaSha256,
            };
            await save();
          }
          let shareUrl = null;
          try {
            const shareRes = payload(
              await cli([
                "feed",
                "get-feed-share-url",
                "--guild-id",
                String(guildId),
                "--channel-id",
                String(target),
                "--feed-id",
                String(created.feed_id),
                "--json",
              ])
            );
            if (shareRes?.share_url) shareUrl = shareRes.share_url;
          } catch {}
          records[identity] = {
            hash,
            status: "published",
            feed_id: created.feed_id,
            create_time: created.create_time,
            channel_id: String(target),
            ...(shareUrl ? { share_url: shareUrl } : {}),
            ...(figure
              ? { figure_sha256: figure.sha256, figure_media_sha256: figureMediaSha256 }
              : {}),
          };
          await save();
          result.published += 1;
        }
      } catch (error) {
        if (
          error.message === "CHANNEL_RATE_LIMIT" &&
          !existing &&
          records[identity]?.status === "intent" &&
          !records[identity].feed_id
        ) {
          delete records[identity];
          await save();
        }
        reportPending(identity, error.message || "CHANNEL_FAILED");
        result.errors.push(error.message || "CHANNEL_FAILED");
        if (error.message === "CHANNEL_RATE_LIMIT") {
          stoppedAt = list.indexOf(item);
          break;
        }
      }
    }
    const effectiveStopped = stoppedAt !== null ? stoppedAt : firstFailedIndex;
    if (effectiveStopped !== null) result.remaining += list.length - effectiveStopped;
    if (backfill && !dryRun) {
      ledger[cursorKey] =
        start + (effectiveStopped ?? list.length) >= items.length
          ? 0
          : start + (effectiveStopped ?? list.length);
      await save();
    }
    return result;
  });
}

export async function provisionTopicChannels({
  guildId = DEFAULT_GUILD_ID,
  cacheRoot = DEFAULT_CACHE_ROOT,
  cli = runCli,
  dryRun = false,
  rename = false,
} = {}) {
  const data = payload(
    await cli(["manage", "get-guild-channel-list", "--guild-id", String(guildId), "--json"])
  );
  const channels = Array.isArray(data) ? data : (data?.channels ?? data?.channel_list ?? []);
  if (!Array.isArray(channels)) throw new Error("CHANNEL_SECTION_LIST_INVALID");
  const ids = {};
  const fallback = { channels };
  for (const [key, label] of TOPICS) {
    const title = TOPIC_LABELS[key];
    const matches = channels.filter((entry) =>
      [title, `${key} ${label}`].includes(channelName(entry.channel_name ?? entry.name))
    );
    if (matches.length > 1) throw new Error("CHANNEL_SECTION_AMBIGUOUS");
    const current = matches[0];
    if (current) {
      ids[key] = String(current.channel_id ?? current.id);
      if (rename && !dryRun && channelName(current.channel_name ?? current.name) !== title) {
        payload(
          await cli([
            "manage",
            "modify-channel",
            "--guild-id",
            String(guildId),
            "--channel-id",
            ids[key],
            "--channel-name",
            title,
            "--json",
          ])
        );
        current.channel_name = title;
        delete fallback.inventory;
      }
    } else if (!dryRun) {
      const created = payload(
        await cli([
          "manage",
          "create-channel",
          "--guild-id",
          String(guildId),
          "--channel-name",
          title,
          "--json",
        ])
      );
      const id = created?.channel_id ?? created?.channel?.channel_id;
      if (!id) throw new Error("CHANNEL_SECTION_CREATE_INVALID");
      ids[key] = String(id);
    }
    if (ids[key] && !dryRun) {
      const trusted = await withPublicationLedger(
        cacheRoot,
        guildId,
        async (_items, _save, ledger) =>
          ledger.managed_sections?.[ids[key]]?.verified_empty === true
      );
      if (trusted) continue;
      const inventory = await scanSectionFeeds(cli, guildId, ids[key], fallback);
      if (inventory.complete && inventory.feeds.length === 0)
        await withPublicationLedger(cacheRoot, guildId, async (_items, save, ledger) => {
          ledger.managed_sections ??= {};
          ledger.managed_sections[ids[key]] = { verified_empty: true, topic: key };
          await save();
        });
    }
  }
  return ids;
}

export async function publishDailyFeed({
  feedPath = FEED_PATH,
  radarPath = RADAR_PATH,
  artifactRoot,
  archiveRoot = DEFAULT_ARCHIVE_ROOT,
  distRoot = DEFAULT_DIST_ROOT,
  source,
  readEdition = readPublishedArxivEdition,
  sourceBinding,
  channelIds,
  includeBrief = false,
  mustReadOnly = true,
  dailyChannelId = DEFAULT_DAILY_CHANNEL_ID,
  resolveFigure = resolveReviewedFigure,
  cacheRoot = DEFAULT_CACHE_ROOT,
  ...options
} = {}) {
  try {
    if (!source) requireSourceBinding(sourceBinding);
    const edition =
      source ?? (await readEdition({ output: feedPath, radarOutput: radarPath, artifactRoot }));
    if (!source && (!edition.generation_id || !edition.pointer))
      throw new Error("CHANNEL_SOURCE_UNPUBLISHED");
    if (
      !source &&
      (sourceBinding.daily.generation_id !== edition.generation_id ||
        sourceBinding.daily.hash !==
          hashBody(JSON.stringify({ feed: edition.feed, radar: edition.radar })))
    )
      throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
    const checked = validateDailyRadarPayload(edition.feed, edition.radar);
    if (!checked.valid) throw new Error(`CHANNEL_SOURCE_INVALID:${checked.diagnostics.join(",")}`);
    const date = edition.feed.window?.announcement_date;
    if (!/^\d{4}-\d\d-\d\d$/u.test(date || "")) throw new Error("CHANNEL_SOURCE_DATE_INVALID");
    await stat(join(distRoot, "arxiv-daily", date, "index.html"));
    const items = await dailyItems(checked.model, date, resolveFigure, {
      distRoot,
      cacheRoot,
      cachePath: cacheRoot ? join(cacheRoot, "paper-translations.json") : undefined,
      mustReadOnly,
    });
    let briefError;
    if (includeBrief) {
      try {
        let briefModel = checked.model;
        if (!source && sourceBinding.archives[date]) {
          const bytes = await readFile(join(archiveRoot, `${date}.json`));
          if (hashBody(bytes) !== sourceBinding.archives[date])
            throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
          briefModel = await readDailyArchive(
            join(archiveRoot, `${date}.json`),
            date,
            distRoot,
            bytes
          );
        }
        items.unshift(dailyBriefItem(briefModel, date));
      } catch (error) {
        briefError = error.message;
      }
    }
    if (items.length === 0 && !briefError) return null;
    const ids = channelIds ?? (options.dryRun ? {} : await provisionTopicChannels(options));
    const result = await publishItems(items, {
      ...options,
      cacheRoot,
      channelIds: { ...ids, daily: dailyChannelId },
    });
    if (briefError) {
      pending(result, `daily-summary:${date}`, briefError);
      result.errors.push(briefError);
    }
    return result;
  } catch (error) {
    return { ...summary(), success: false, pending: 1, errors: [error.message] };
  }
}

export async function resolveReviewedFigure(
  item,
  {
    publicRoot = DEFAULT_PUBLIC_ROOT,
    distRoot = DEFAULT_DIST_ROOT,
    reviewPath = DEFAULT_FIGURE_REVIEW_PATH,
    manifest: manifestInput,
  } = {}
) {
  const record = item.analysis || {};
  const analysis = record.analysis || {};
  const priority = record.priority || item.priority;
  if (priority !== "must_read" || record.coverage?.level !== "full_body")
    return { image: null, diagnostic: "figure_not_full_body_must_read" };
  const figures = Array.isArray(analysis.figures) ? analysis.figures : [];
  if (!figures.length) return { image: null, diagnostic: "figure_source_missing" };
  let manifest = manifestInput;
  if (!manifest) {
    try {
      if ((await stat(reviewPath)).size > 1_000_000)
        return { image: null, diagnostic: "figure_review_manifest_too_large" };
      manifest = JSON.parse(await readFile(reviewPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        manifest = null;
      } else {
        return { image: null, diagnostic: "figure_review_manifest_invalid" };
      }
    }
  }
  if (manifest && (manifest.version !== 1 || !Array.isArray(manifest.figures)))
    return { image: null, diagnostic: "figure_review_manifest_invalid" };
  const arxivId = String(item.arxiv_id || "");
  const revision = Number(item.revision);
  const sourceFingerprint = record.source_fingerprint;
  const sourceVersion = record.coverage?.source_version;
  if (
    !/^\d{4}\.\d{4,5}$/u.test(arxivId) ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    sourceVersion !== `arXiv:${arxivId}v${revision}` ||
    !/^[a-f0-9]{64}$/u.test(sourceFingerprint || "")
  ) {
    return { image: null, diagnostic: "figure_source_identity_invalid" };
  }
  let publicRootReal;
  try {
    publicRootReal = await realpath(publicRoot);
  } catch {
    return { image: null, diagnostic: "figure_public_root_missing" };
  }
  let distRootReal;
  try {
    distRootReal = await realpath(distRoot);
  } catch {
    return { image: null, diagnostic: "figure_dist_root_missing" };
  }
  for (const figure of figures) {
    const url = String(figure?.url || "");
    const label = String(figure?.label || "");
    const caption = String(figure?.caption || "").trim();
    const labelNumber = label.match(/^Fig\.\s*(\d+)$/u)?.[1];
    const captionNumber = caption.match(/^Figure\s*(\d+)\s*:/iu)?.[1];
    if (
      !labelNumber ||
      captionNumber !== labelNumber ||
      !caption ||
      !new RegExp(
        `^/arxiv-figures/${arxivId.replaceAll(".", "\\.")}/[A-Za-z0-9][A-Za-z0-9._-]*$`,
        "u"
      ).test(url)
    )
      continue;
    const resolvedPath = resolve(publicRoot, `.${url}`);
    const builtPath = resolve(distRoot, `.${url}`);
    const review = manifest?.figures?.find(
      (candidate) =>
        candidate.arxiv_id === arxivId &&
        Number(candidate.revision) === revision &&
        candidate.source_fingerprint === sourceFingerprint &&
        candidate.url === url &&
        candidate.label === label &&
        candidate.caption_sha256 === hashBody(caption) &&
        candidate.visual_match === "confirmed" &&
        candidate.review_method === "human_visual_comparison" &&
        typeof candidate.reviewed_by === "string" &&
        candidate.reviewed_by.trim() !== "" &&
        /^[a-f0-9]{64}$/u.test(candidate.asset_sha256 || "")
    );
    let assetPath;
    try {
      assetPath = await realpath(resolvedPath);
    } catch {
      continue;
    }
    const assetRelative = relative(publicRootReal, assetPath);
    if (
      !assetRelative ||
      assetRelative === ".." ||
      assetRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    )
      continue;
    let bytes;
    try {
      bytes = await readFile(assetPath);
    } catch {
      continue;
    }
    const assetSha256 = hashBody(bytes);

    if (review) {
      if (assetSha256 !== review.asset_sha256) continue;
      let builtAssetPath;
      try {
        builtAssetPath = await realpath(builtPath);
      } catch {
        continue;
      }
      const builtRelative = relative(distRootReal, builtAssetPath);
      if (
        !builtRelative ||
        builtRelative === ".." ||
        builtRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
      )
        continue;
      let builtBytes;
      try {
        builtBytes = await readFile(builtAssetPath);
      } catch {
        continue;
      }
      if (hashBody(builtBytes) !== review.asset_sha256) continue;
      const physicalCore = deriveFigurePhysicalCore(figure, {
        result: analysis.result || record.result,
        problem: analysis.problem || record.problem,
        assumptions: analysis.assumptions || record.assumptions,
        limits: analysis.limits || record.limits,
      });
      return {
        image: {
          path: assetPath,
          url,
          label,
          caption,
          category: figure.category,
          category_badge: figure.category_badge || figure.categoryBadge,
          physical_core: physicalCore,
          sha256: review.asset_sha256,
        },
        diagnostic: null,
      };
    }

    // Option B: Automated attachment if paper not explicitly in review manifest
    const paperHasManifestReview = manifest?.figures?.some(
      (candidate) => candidate.arxiv_id === arxivId && Number(candidate.revision) === revision
    );
    if (paperHasManifestReview) {
      continue;
    }

    // Provenance & revision binding check
    if (figure.revision !== undefined && Number(figure.revision) !== revision) {
      continue;
    }
    if (
      figure.source_version !== undefined &&
      figure.source_version !== `arXiv:${arxivId}v${revision}`
    ) {
      continue;
    }
    if (figure.asset_sha256 !== undefined && figure.asset_sha256 !== assetSha256) {
      continue;
    }

    // Check builtPath if present in distRoot
    try {
      const builtAssetPath = await realpath(builtPath);
      const builtRelative = relative(distRootReal, builtAssetPath);
      if (
        !builtRelative ||
        builtRelative === ".." ||
        builtRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
      ) {
        continue;
      }
      const builtBytes = await readFile(builtAssetPath);
      if (hashBody(builtBytes) !== assetSha256) {
        continue;
      }
    } catch {
      // If dist asset does not exist yet (pre-build), public asset is valid
    }

    const physicalCore = deriveFigurePhysicalCore(figure, {
      result: analysis.result || record.result,
      problem: analysis.problem || record.problem,
      assumptions: analysis.assumptions || record.assumptions,
      limits: analysis.limits || record.limits,
    });

    return {
      image: {
        path: assetPath,
        url,
        label,
        caption,
        category: figure.category,
        category_badge: figure.category_badge || figure.categoryBadge,
        physical_core: physicalCore,
        sha256: assetSha256,
      },
      diagnostic: null,
    };
  }
  return { image: null, diagnostic: "figure_review_or_asset_mismatch" };
}

async function dailyItems(model, date, resolveFigure = resolveReviewedFigure, figureOptions = {}) {
  const papers = figureOptions.mustReadOnly
    ? model.groups.must_read || []
    : [...(model.groups.must_read || []), ...(model.groups.worth_knowing || [])];
  return Promise.all(
    papers.map(async (item) => {
      const topic = routePaper(item);
      const identity = `daily:${item.arxiv_id}v${item.revision}`;
      let title;
      try {
        if (!resolvePaperTitleZhSync(item, figureOptions)) {
          if (figureOptions.translate === true) {
            await resolvePaperTitleZhAsync(item, figureOptions);
          }
        }
        title = paperReaderTitle(item, figureOptions);
      } catch (error) {
        return {
          identity,
          topic,
          title_error: error.message || "CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED",
        };
      }
      const { image } = await resolveFigure(item, figureOptions);
      return {
        identity,
        arxiv_id: item.arxiv_id,
        revision: item.revision,
        paper_title: item.title,
        topic,
        title,
        body: paperMarkdown(item, date, topic),
        figure: image,
      };
    })
  );
}

export async function alterDailyFeed() {
  throw new Error("CHANNEL_DIRECT_EDIT_DISABLED");
}

export async function publishWeeklyFeed({
  guildId = DEFAULT_GUILD_ID,
  channelId = DEFAULT_WEEKLY_CHANNEL_ID,
  titleOverride,
  weekId: targetWeekId,
  archiveWeeklyRoot = resolve(
    fileURLToPath(new URL("../src/data/arxiv-archives/weekly", import.meta.url))
  ),
  weeklyPath = WEEKLY_PATH,
  distRoot = DEFAULT_DIST_ROOT,
  cacheRoot = DEFAULT_CACHE_ROOT,
  cli = runCli,
  dryRun = false,
  sourceBinding,
  legacyBindings,
  allowExistingBodyEdits = false,
  pin = false,
} = {}) {
  try {
    requireSourceBinding(sourceBinding);
    let resolvedWeeklyPath = weeklyPath;
    if (targetWeekId) {
      if (!/^\d{4}-W\d\d$/u.test(targetWeekId)) throw new Error("CHANNEL_WEEKLY_INVALID");
      resolvedWeeklyPath = join(archiveWeeklyRoot, `${targetWeekId}.json`);
    }
    if ((await stat(resolvedWeeklyPath)).size > 20_000_000)
      throw new Error("CHANNEL_WEEKLY_INVALID");
    const weeklyBytes = await readFile(resolvedWeeklyPath);
    const weeklyBytesHash = hashBody(weeklyBytes);
    if (!targetWeekId) {
      if (sourceBinding.weekly.hash !== weeklyBytesHash)
        throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
    } else {
      const expectedHash =
        sourceBinding.weeklyArchives?.[targetWeekId] ||
        (sourceBinding.weekly?.hash && sourceBinding.weekly?.week_id === targetWeekId
          ? sourceBinding.weekly.hash
          : undefined);
      if (expectedHash && expectedHash !== weeklyBytesHash)
        throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
      if (!expectedHash && sourceBinding.weeklyArchives)
        throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
    }
    const weekly = JSON.parse(weeklyBytes);
    if (!/^\d{4}-W\d\d$/u.test(weekly.week_id || "") || !weekly.executive_summary)
      throw new Error("CHANNEL_WEEKLY_INVALID");
    await stat(join(distRoot, "arxiv-weekly", weekly.week_id, "index.html"));
    const { weekId, postTitle, md } = await generateWeeklyMarkdown({ weekly, titleOverride });
    const res = await publishItems(
      [{ identity: `weekly:${weekId}`, week_id: weekId, body: md, title: postTitle }],
      {
        guildId,
        channelId,
        cacheRoot,
        cli,
        dryRun,
        legacyBindings,
        kind: "weekly",
        allowExistingBodyEdits,
      }
    );
    if (pin && (res.published > 0 || res.unchanged > 0 || res.updated > 0)) {
      await withPublicationLedger(cacheRoot, guildId, async (records, save, ledger) => {
        const item = records[`weekly:${weekId}`];
        if (item?.feed_id && item?.create_time) {
          let authorId = item.author_id || process.env.TENCENT_BOT_USER_ID || "";
          if (!authorId && !dryRun) {
            try {
              const detailRes = await (cli || runCli)([
                "feed",
                "get-feed-detail",
                "--guild-id",
                String(guildId),
                "--channel-id",
                String(channelId),
                "--feed-id",
                String(item.feed_id),
                "--json",
              ]);
              const rawData =
                typeof detailRes?.stdout === "string" ? JSON.parse(detailRes.stdout) : detailRes;
              const feedData = rawData?.data?.feed || rawData?.feed || rawData?.data || rawData;
              authorId = feedData?.author_id ?? feedData?.author?.user_id ?? authorId;
            } catch {}
          }
          if (!authorId) authorId = process.env.TENCENT_BOT_USER_ID || "";

          if (ledger.pinned_weekly && ledger.pinned_weekly.feed_id !== item.feed_id) {
            try {
              await pinFeed({
                guildId,
                feedId: ledger.pinned_weekly.feed_id,
                userId: ledger.pinned_weekly.author_id || authorId,
                createTime: ledger.pinned_weekly.create_time,
                action: 2,
                topType: 1,
                cli: cli || runCli,
                dryRun,
              });
            } catch (err) {
              console.warn(`[publisher] Failed to unpin previous weekly feed: ${err.message}`);
            }
          }

          try {
            await pinFeed({
              guildId,
              feedId: item.feed_id,
              userId: authorId,
              createTime: item.create_time,
              action: 1,
              topType: 1,
              cli: cli || runCli,
              dryRun,
            });
            ledger.pinned_weekly = {
              feed_id: item.feed_id,
              author_id: authorId,
              create_time: item.create_time,
              channel_id: String(channelId),
              week_id: weekId,
            };
            item.author_id = authorId;
            await save();
          } catch (pinErr) {
            console.warn(
              `[publisher] Failed to pin weekly feed ${item.feed_id}: ${pinErr.message}`
            );
          }
        }
      });
    }
    return res;
  } catch (error) {
    return { ...summary(), success: false, pending: 1, errors: [error.message] };
  }
}

export function renderEventRankingPost(data) {
  if (!Array.isArray(data?.events) || !Number.isFinite(Date.parse(data.generated_at)))
    throw new Error("CHANNEL_EVENTS_INVALID");
  const top = data.events.slice(0, 5);
  const seen = new Set();
  const title = "瞬变源 Top 5";
  const lines = [
    `数据更新：${data.generated_at}`,
    "",
    "榜单与网页使用同一构建快照。热度表示本地近期文献讨论，按现有 7 天半衰期衰减；不等于物理重要性，也不表示事件刚刚爆发。",
    "",
  ];
  for (const [index, event] of top.entries()) {
    if (
      typeof event.event_id !== "string" ||
      !event.event_id.trim() ||
      seen.has(event.event_id) ||
      !Number.isFinite(event.heat_score) ||
      event.heat_score < 0 ||
      !Number.isInteger(event.paper_count) ||
      event.paper_count < 0 ||
      !/^\d{4}-\d\d-\d\d$/u.test(event.last_updated || "") ||
      !Array.isArray(event.papers)
    )
      throw new Error("CHANNEL_EVENTS_INVALID");
    seen.add(event.event_id);
    lines.push(
      `## ${index + 1}. ${event.event_id}`,
      "",
      `**热度 ${event.heat_score}** · ${event.paper_count} 篇关联文献 · 最近文献更新 ${event.last_updated}`,
      ""
    );
    const paper = event.papers.find(
      (p) =>
        ["must_read", "worth_knowing"].includes(p.priority) &&
        /^\d{4}\.\d{4,5}$/u.test(p.arxiv_id || "")
    );
    if (paper)
      lines.push(
        paper.bluf_problem || "",
        "",
        `[近期关联论文 arXiv:${paper.arxiv_id}](https://arxiv.org/abs/${paper.arxiv_id})`,
        ""
      );
  }
  if (!top.length) lines.push("当前没有可展示的事件，不补造排名。", "");
  lines.push(`[网页事件榜单](${SITE_BASE_URL}/agent/)`);
  return { title, body: lines.join("\n") };
}

export async function publishEventRanking({
  sourceBinding,
  eventSnapshot,
  eventsPath = join(DEFAULT_DIST_ROOT, "api/v1/events.json"),
  channelId = DEFAULT_DAILY_CHANNEL_ID,
  pin = false,
  guildId = DEFAULT_GUILD_ID,
  cacheRoot = DEFAULT_CACHE_ROOT,
  cli = runCli,
  dryRun = false,
  ...options
} = {}) {
  try {
    requireSourceBinding(sourceBinding);
    if (eventSnapshot?.error === "CHANNEL_EVENTS_INVALID")
      throw new Error("CHANNEL_EVENTS_INVALID");
    if (!/^[a-f0-9]{64}$/u.test(eventSnapshot?.hash || ""))
      throw new Error("CHANNEL_EVENTS_BUILD_REQUIRED");
    if ((await stat(eventsPath)).size > 20_000_000) throw new Error("CHANNEL_EVENTS_INVALID");
    const bytes = await readFile(eventsPath);
    if (hashBody(bytes) !== eventSnapshot.hash) throw new Error("CHANNEL_EVENTS_BUILD_MISMATCH");
    const data = JSON.parse(bytes);
    if (data.generated_at !== eventSnapshot.generated_at) throw new Error("CHANNEL_EVENTS_INVALID");
    const post = renderEventRankingPost(data);
    const result = await publishItems([{ identity: "events:top5", ...post }], {
      ...options,
      channelId,
      kind: "events",
      guildId,
      cacheRoot,
      cli,
      dryRun,
    });
    if (pin && !dryRun && result.success) {
      await withPublicationLedger(cacheRoot, guildId, async (records, save) => {
        const item = records["events:top5"];
        if (item?.feed_id && item?.create_time) {
          let authorId = process.env.TENCENT_BOT_USER_ID || "";
          try {
            const detailRes = await detail(cli, guildId, item);
            authorId =
              detailRes?.feed?.author_id ??
              detailRes?.feed?.author?.user_id ??
              detailRes?.author_id ??
              authorId;
          } catch {}
          await pinFeed({
            guildId,
            channelId: item.channel_id || channelId,
            feedId: item.feed_id,
            userId: authorId,
            createTime: item.create_time,
            action: 1,
            topType: 1,
            cli,
          });
          item.pinned = true;
          item.pinned_at = new Date().toISOString();
          await save();
        }
      });
    }
    return result;
  } catch (error) {
    return { ...summary(), success: false, pending: 1, errors: [error.message] };
  }
}

export async function publishHistoricalFeeds({
  archiveRoot = DEFAULT_ARCHIVE_ROOT,
  distRoot = DEFAULT_DIST_ROOT,
  from = "2026-09-07",
  through = "9999-99-99",
  limit = 50,
  dryRun = false,
  channelIds,
  sourceBinding,
  briefs = false,
  mustReadOnly = true,
  cursor = true,
  channelId = DEFAULT_DAILY_CHANNEL_ID,
  resolveFigure = resolveReviewedFigure,
  cacheRoot = DEFAULT_CACHE_ROOT,
  ...options
} = {}) {
  try {
    requireSourceBinding(sourceBinding);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new Error("CHANNEL_LIMIT_INVALID");
    const names = await listDailyArchives(archiveRoot, from, through);
    const must = [];
    const worth = [];
    const seen = new Set();
    const invalid = [];
    for (const name of names) {
      const date = name.slice(0, 10);
      try {
        const bytes = await readFile(join(archiveRoot, name));
        if (!sourceBinding.archives[date] || hashBody(bytes) !== sourceBinding.archives[date])
          throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
        const model = await readDailyArchive(join(archiveRoot, name), date, distRoot, bytes);
        if (briefs) {
          must.push(dailyBriefItem(model, date));
          continue;
        }
        for (const [group, target, kind] of [
          [model.groups.must_read, must, "must_read"],
          [model.groups.worth_knowing, worth, "worth_knowing"],
        ]) {
          if (mustReadOnly && kind !== "must_read") continue;
          for (const paper of group) {
            const item = (
              await dailyItems(
                {
                  groups: {
                    must_read: kind === "must_read" ? [paper] : [],
                    worth_knowing: kind === "worth_knowing" ? [paper] : [],
                  },
                },
                date,
                resolveFigure,
                {
                  distRoot,
                  cacheRoot,
                  cachePath: cacheRoot ? join(cacheRoot, "paper-translations.json") : undefined,
                }
              )
            )[0];
            if (!seen.has(item.identity)) {
              seen.add(item.identity);
              target.push(item);
            }
          }
        }
      } catch (error) {
        invalid.push({ date, reason: error.message });
      }
    }
    const ids = channelIds ?? (dryRun || briefs ? {} : await provisionTopicChannels(options));
    const result = await publishItems([...must, ...worth], {
      ...options,
      cacheRoot,
      channelIds: ids,
      channelId,
      kind: briefs ? "brief" : "daily",
      dryRun,
      limit,
      backfill: cursor,
    });
    for (const item of invalid) pending(result, item.date, item.reason);
    return result;
  } catch (error) {
    return { ...summary(), success: false, pending: 1, errors: [error.message] };
  }
}

export async function alterWeeklyFeed() {
  throw new Error("CHANNEL_DIRECT_EDIT_DISABLED");
}

export async function deleteFeed({ guildId = DEFAULT_GUILD_ID, channelId, feedId, createTime }) {
  if (!channelId || !feedId || !createTime)
    throw new Error("deleteFeed requires channelId, feedId, and createTime");
  console.log(`[publisher] 正在删除帖子 ${feedId} (${createTime}) 来自版块 ${channelId}...`);
  const res = await runCli([
    "feed",
    "del-feed",
    "--guild-id",
    String(guildId),
    "--channel-id",
    String(channelId),
    "--feed-id",
    String(feedId),
    "--create-time",
    String(createTime),
    "--yes",
    "--json",
  ]);
  console.log(`[publisher] 帖子删除成功`);
  return res;
}

export async function pinFeed({
  guildId = DEFAULT_GUILD_ID,
  channelId,
  feedId,
  userId,
  createTime,
  action = 1,
  topType = 1,
  cli = runCli,
  dryRun = false,
} = {}) {
  if (!guildId || !feedId || !userId || !createTime) {
    throw new Error("pinFeed requires guildId, feedId, userId, and createTime");
  }
  if (dryRun) {
    return { success: true, dryRun: true, action: Number(action), feedId: String(feedId) };
  }
  const args = [
    "feed",
    "top-feed",
    "--guild-id",
    String(guildId),
    "--feed-id",
    String(feedId),
    "--user-id",
    String(userId),
    "--create-time",
    String(createTime),
    "--action",
    String(action),
    "--top-type",
    String(topType),
    "--json",
  ];
  const res = await cli(args);
  return payload(res);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const task = process.argv[2] || "daily";
  const dryRun = process.argv.includes("--dry-run");
  const bindingIndex = process.argv.indexOf("--legacy-bindings");
  const legacyBindings =
    bindingIndex < 0
      ? undefined
      : JSON.parse(await readFile(resolve(process.argv[bindingIndex + 1]), "utf8"));
  let sourceBinding;
  let eventSnapshot;
  if (["daily", "weekly", "events", "backfill", "--backfill"].includes(task)) {
    try {
      const website = JSON.parse(await readFile(WEBSITE_BUILD_PATH, "utf8"));
      if (website.status !== "success") throw new Error();
      sourceBinding = website.source_binding;
      eventSnapshot = website.events;
      requireSourceBinding(sourceBinding);
    } catch {
      throw new Error("CHANNEL_SOURCE_BUILD_REQUIRED");
    }
  }
  if (task === "daily" || task === "preliminary") {
    const mustReadOnly =
      !process.argv.includes("--include-worth-knowing") && !process.argv.includes("--all-levels");
    const includeBrief =
      (process.argv.includes("--include-brief") || task !== "preliminary") &&
      !process.argv.includes("--skip-brief");
    console.log(
      JSON.stringify(
        await publishDailyFeed({
          dryRun,
          legacyBindings,
          sourceBinding,
          includeBrief,
          mustReadOnly,
        })
      )
    );
  } else if (task === "weekly") {
    const weekIndex = process.argv.indexOf("--week");
    const targetWeekId = weekIndex >= 0 ? process.argv[weekIndex + 1] : undefined;
    const allowExistingBodyEdits = process.argv.includes("--allow-existing-body-edits");
    const pin = process.argv.includes("--pin")
      ? true
      : process.argv.includes("--no-pin")
        ? false
        : !targetWeekId;
    console.log(
      JSON.stringify(
        await publishWeeklyFeed({
          dryRun,
          sourceBinding,
          legacyBindings,
          weekId: targetWeekId,
          allowExistingBodyEdits,
          pin,
        })
      )
    );
  } else if (task === "provision") {
    console.log(JSON.stringify(await provisionTopicChannels({ dryRun, rename: true })));
  } else if (task === "events") {
    console.log(
      JSON.stringify(await publishEventRanking({ dryRun, sourceBinding, eventSnapshot }))
    );
  } else if (task === "backfill" || task === "--backfill") {
    const index = process.argv.indexOf("--limit");
    const limit = index < 0 ? 50 : Number(process.argv[index + 1]);
    const fromIndex = process.argv.indexOf("--from");
    const from = fromIndex < 0 ? undefined : process.argv[fromIndex + 1];
    const throughIndex = process.argv.indexOf("--through");
    const through = throughIndex < 0 ? undefined : process.argv[throughIndex + 1];
    const mustReadOnly =
      !process.argv.includes("--include-worth-knowing") && !process.argv.includes("--all-levels");
    const allowExistingBodyEdits = process.argv.includes("--allow-existing-body-edits");
    const currentBinding = await capturePublishedSourceBinding();
    if (currentBinding.id !== sourceBinding.id) throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
    const cursor = !process.argv.includes("--no-cursor") && from === undefined;
    console.log(
      JSON.stringify(
        await publishHistoricalFeeds({
          dryRun,
          from,
          through,
          limit,
          legacyBindings,
          sourceBinding,
          briefs: process.argv.includes("--briefs"),
          mustReadOnly,
          allowExistingBodyEdits,
          cursor,
        })
      )
    );
  } else if (task === "alter-daily") {
    const feedId = process.argv[3];
    const createTime = process.argv[4];
    await alterDailyFeed({ feedId, createTime });
  } else if (task === "alter-weekly") {
    const feedId = process.argv[3];
    const createTime = process.argv[4];
    await alterWeeklyFeed({ feedId, createTime });
  } else {
    console.error(`未知任务类型: ${task}。可用参数: daily, preliminary, weekly, events, backfill`);
    process.exit(1);
  }
}
