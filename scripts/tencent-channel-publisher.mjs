import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { validateDailyRadarPayload } from "./daily-radar.mjs";
import { readPublishedArxivEdition } from "./arxiv-daily.mjs";
import { TOPICS, TOPIC_LABELS, routePaper, hashBody, markerFor, readDailyArchive, listDailyArchives, withPublicationLedger, capturePublishedSourceBinding } from "./channel-publication.mjs";

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

const DEFAULT_GUILD_ID = process.env.TENCENT_GUILD_ID || "612912874093545504";
const DEFAULT_DAILY_CHANNEL_ID = process.env.TENCENT_DAILY_CHANNEL_ID || "742956201";
const DEFAULT_WEEKLY_CHANNEL_ID = process.env.TENCENT_WEEKLY_CHANNEL_ID || "742956302";
const SITE_BASE_URL = (process.env.SITE_BASE_URL || process.env.ASTRO_SITE_URL || "http://10.131.43.83:4321").replace(/\/+$/u, "");

const RADAR_PATH = resolve(fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url)));
const FEED_PATH = resolve(fileURLToPath(new URL("../src/data/arxiv-daily.json", import.meta.url)));
const WEEKLY_PATH = resolve(fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url)));
const DEFAULT_CACHE_ROOT = resolve(fileURLToPath(new URL("../.cache/channel-publication", import.meta.url)));
const DEFAULT_ARCHIVE_ROOT = resolve(fileURLToPath(new URL("../src/data/arxiv-archives/daily", import.meta.url)));
const DEFAULT_DIST_ROOT = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const WEBSITE_BUILD_PATH = resolve(fileURLToPath(new URL("../.cache/notebooklm/website.json", import.meta.url)));

function requireSourceBinding(sourceBinding) {
  const { daily, weekly, archives, id } = sourceBinding || {};
  if (!daily?.generation_id || !/^[a-f0-9]{64}$/u.test(daily.hash || "") ||
      !/^[a-f0-9]{64}$/u.test(weekly?.hash || "") || !archives || typeof archives !== "object" ||
      hashBody(JSON.stringify({ daily, weekly, archives })) !== id) throw new Error("CHANNEL_SOURCE_BUILD_REQUIRED");
}

async function runCli(args) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn("tencent-channel-cli", args, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    const stop = () => {
      try { if (process.platform !== "win32") process.kill(-proc.pid, "SIGKILL"); else proc.kill("SIGKILL"); } catch {}
    };
    const timer = setTimeout(() => { stop(); reject(new Error("CHANNEL_TIMEOUT")); }, 120_000);
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    const append = (chunk, target) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1_000_000) { stop(); reject(new Error("CHANNEL_OUTPUT_LIMIT")); return; }
      if (target === "stdout") stdout += chunk; else stderr += chunk;
    };
    proc.stdout.on("data", (chunk) => append(chunk, "stdout"));
    proc.stderr.on("data", (chunk) => append(chunk, "stderr"));
    proc.on("error", () => { clearTimeout(timer); reject(new Error("CHANNEL_RUNTIME_UNAVAILABLE")); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          const response = JSON.parse(stdout);
          if (Number(response?.retCode) === 153) { reject(new Error("CHANNEL_RATE_LIMIT")); return; }
          if (!(response?.success === true || Number(response?.retCode) === 0) || response?.success === false || response?.error) { reject(new Error("CHANNEL_REMOTE_REJECTED")); return; }
          resolvePromise(response);
        } catch { reject(new Error("CHANNEL_RESPONSE_INVALID")); }
      } else {
        try {
          if (Number(JSON.parse(stdout).retCode) === 153) { reject(new Error("CHANNEL_RATE_LIMIT")); return; }
        } catch {}
        reject(new Error(`CHANNEL_CLI_EXIT_${code}`));
      }
    });
  });
}

function cleanMath(text) {
  if (!text) return "";
  return String(text).replace(/\\\\/g, "\\");
}

function paperReaderTitle(item, topic = routePaper(item)) {
  const problem = String(item.analysis?.analysis?.problem || "").replace(/\s+/gu, " ").trim();
  const headline = /\p{Script=Han}/u.test(problem) ? Array.from(problem).slice(0, 54).join("") + (Array.from(problem).length > 54 ? "…" : "") : `文献导读 · arXiv:${item.arxiv_id}`;
  return `【${TOPIC_LABELS[topic.primary] || "待分类"}】${headline}`;
}

function dailyBriefItem(model, date) {
  const brief = model.opening_brief;
  if (brief?.status !== "ready") throw new Error("CHANNEL_BRIEF_UNAVAILABLE");
  const title = `每日导读 · ${date}`;
  const papers = [...model.groups.must_read, ...model.groups.worth_knowing];
  const lines = [`# ${title}`, "", "## 本期导读", "", brief.intro, ""];
  if (brief.must_read.length) {
    lines.push("## 必读：先了解这几篇", "");
    for (const sentence of brief.must_read) {
      const paper = papers.find(p => p.arxiv_id === sentence.arxiv_id && p.revision === sentence.revision);
      if (!paper) throw new Error("CHANNEL_BRIEF_UNAVAILABLE");
      const anchor = `radar-paper-${paper.arxiv_id.replace(".", "-")}-v${paper.revision}`;
      lines.push(`**[${paperReaderTitle(paper)}](${SITE_BASE_URL}/arxiv-daily/${date}/#${anchor})**`, "", `${sentence.text} [原文](https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision})`, "");
    }
  }
  if (model.groups.worth_knowing.length && brief.worth_knowing_summary) lines.push("## 其他值得关注", "", brief.worth_knowing_summary.replace(/；其余见下方卡片[。.]?$/u, "。"), "");
  if (model.groups.skip.length && brief.skim_summary) lines.push("## 略读线索", "", brief.skim_summary, "");
  lines.push(`[完整网页导读](${SITE_BASE_URL}/arxiv-daily/${date}/)`, "", "每篇论文的版本、实际阅读范围与未核查项见网页原记录；本摘要不代表独立验证。");
  return { identity: `daily-summary:${date}`, topic: { primary: "daily" }, title, body: lines.join("\n") };
}

export function extractPaperTopic(item) {
  const title = item.title || "";
  const analysis = item.analysis?.analysis || item.analysis || {};
  const problem = analysis.problem || "";
  const reason = analysis.reason || "";
  const full = `${title} ${problem} ${reason}`;

  if (/FRB|快速射电暴/i.test(full)) {
    if (/透镜|lensing/i.test(full)) return "FRB等离子体透镜效应";
    if (/PRS|持续射电源/i.test(full)) return "FRB宿主与PRS关联";
    return "快速射电暴辐射机制";
  }
  if (/脉冲星|pulsar|吸积柱|accretion column/i.test(full)) {
    if (/吸积柱|accretion column/i.test(full)) return "X射线脉冲星高吸积柱模型";
    return "脉冲星高能辐射";
  }
  if (/GRB|伽马暴|gamma-ray burst/i.test(full)) {
    if (/超长|month-long|长时标|engine/i.test(full)) return "超长GRB长时标引擎";
    return "伽马射线暴物理机制";
  }
  if (/CSM|星周介质|致密星周/i.test(full)) {
    return "超新星致密星周相互作用(CSM)";
  }
  if (/坍缩星|collapsar|踢速|kick/i.test(full)) {
    return "坍缩星爆炸与黑洞踢速";
  }
  if (/暗物质|dark matter/i.test(full)) {
    return "白矮星暗物质探测";
  }
  if (/Sgr A\*|人马座/i.test(full)) {
    return "Sgr A*近视界偏振与磁场";
  }
  if (/AGN|NGC\s*\d+|变脸|changing look/i.test(full)) {
    return "变面AGN吸积与失败风";
  }
  if (problem) {
    const clean = problem.replace(/^(论文(旨在|试图|直接|关注)|如何利用|研究)/u, "").replace(/[。！？].*$/u, "").trim();
    if (clean.length > 4 && clean.length <= 20) return clean;
  }
  return title.slice(0, 24);
}

export function deriveDailyContentTitle(batchDate, highlights) {
  if (!highlights || highlights.length === 0) {
    return `【AstroLineage每日精选】${batchDate} · 暂无重点关注爆发源`;
  }
  const mustRead = highlights.filter((h) => h.analysis?.priority === "must_read" || h.priority === "must_read");
  const focus = mustRead.length > 0 ? mustRead : highlights.slice(0, 2);
  const topics = [...new Set(focus.map(extractPaperTopic).filter(Boolean))];
  const summary = topics.slice(0, 2).join("与");
  return summary ? `【AstroLineage每日精选】${batchDate} · ${summary}` : `【AstroLineage每日精选】${batchDate} 重点文献`;
}

export function deriveWeeklyContentTitle(weekId, weekly) {
  const highlights = weekly.thematic_highlights || [];
  if (highlights.length > 0) {
    const topics = highlights
      .map((t) => t.theme_name.replace(/（.*）/u, "").replace(/与/g, "/").trim())
      .filter(Boolean);
    const summary = topics.slice(0, 2).join("与");
    if (summary) {
      return `【AstroLineage周报】${weekId} · ${summary}`;
    }
  }
  return `【AstroLineage周报】${weekId} (${weekly.date_range || ""}) 学术脉络总结`;
}

export async function generateDailyMarkdown({ titleOverride, radar, feed, radarPath = RADAR_PATH, feedPath = FEED_PATH } = {}) {
  const radarData = radar || JSON.parse(await readFile(radarPath, "utf8"));
  const feedData = feed || JSON.parse(await readFile(feedPath, "utf8"));

  const batchDate = feedData.window?.announcement_date || new Date().toISOString().slice(0, 10);
  const totalEntries = feedData.entries?.length || 0;

  const validation = validateDailyRadarPayload(feedData, radarData);
  if (!validation.valid) throw new Error(`CHANNEL_SOURCE_INVALID:${validation.diagnostics.join(",")}`);
  const model = validation.model;

  const mustRead = model.groups.must_read || [];
  const worthKnowing = model.groups.worth_knowing || [];
  const highlights = [...mustRead, ...worthKnowing];

  const item = dailyBriefItem(model, batchDate);
  const postTitle = titleOverride || item.title;
  const md = item.body.replace(/^# .*$/mu, `# ${postTitle}`);
  return { batchDate, totalEntries, highlights, postTitle, md };
}

export async function generateWeeklyMarkdown({ titleOverride, weekly: weeklyInput, weeklyPath = WEEKLY_PATH } = {}) {
  const weekly = weeklyInput || JSON.parse(await readFile(weeklyPath, "utf8"));
  const weekId = weekly.week_id || "本周";
  const dateRange = weekly.date_range || "";

  const postTitle = titleOverride || `每周摘要 · ${weekId}`;

  let md = `# ${postTitle}\n\n${dateRange}\n\n`;

  if (weekly.executive_summary) {
    md += `## 本周导读\n\n`;
    md += `${weekly.executive_summary}\n\n`;
  }

  if (Array.isArray(weekly.top_picks) && weekly.top_picks.length > 0) {
    md += `## 建议优先阅读\n\n`;
    for (const pick of weekly.top_picks) {
      const tag = pick.priority === "must_read" ? "必读" : "关注";
      md += `**${tag} · [arXiv:${pick.arxiv_id}](https://arxiv.org/abs/${pick.arxiv_id})**\n\n`;
      const reason = pick.reason || pick.recommendation_reason;
      if (reason) md += `${reason}\n\n`;
    }
    md += `\n`;
  }

  if (Array.isArray(weekly.thematic_highlights) && weekly.thematic_highlights.length > 0) {
    md += `## 各主题进展\n\n`;
    for (const theme of weekly.thematic_highlights) {
      const papers = (theme.paper_ids || []).map((id) => {
        const found = (weekly.papers || []).find((p) => p.arxiv_id === id);
        const authorStr = found && Array.isArray(found.authors) && found.authors.length > 0
          ? ` (${found.authors[0]} 等)`
          : "";
        return `[arXiv:${id}${authorStr}](https://arxiv.org/abs/${id})`;
      }).join(", ");
      md += `### ${theme.theme_name}\n\n`;
      md += `${theme.summary}\n\n`;
      if (papers) md += `相关论文：${papers}\n`;
      md += `\n`;
    }
  }

  if (Array.isArray(weekly.lineage_connections) && weekly.lineage_connections.length > 0) {
    md += `---\n\n## 📚 经典学术脉络传承与对照\n\n`;
    for (const conn of weekly.lineage_connections) {
      md += `* **[${conn.classic_work || "经典文献"}]** ⟵ **[arXiv:${conn.new_arxiv_id}]**\n`;
      md += `  ${cleanMath(conn.relationship)}\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;
  md += `[完整网页周报](${SITE_BASE_URL}/arxiv-weekly/${weekId}/)\n`;
  md += `* 课题组前沿脉络知识库主页：[AstroLineage 首页](${SITE_BASE_URL}/)\n`;

  return { weekId, dateRange, postTitle, md };
}

function payload(response) {
  if (typeof response?.stdout === "string") response = JSON.parse(response.stdout);
  if (Number(response?.retCode) === 153) throw new Error("CHANNEL_RATE_LIMIT");
  if (response?.retCode !== undefined && Number(response.retCode) !== 0 || response?.success === false || response?.error) throw new Error("CHANNEL_REMOTE_REJECTED");
  return response?.data ?? response;
}

function remoteIdentity(value) {
  const feed = value?.feed ?? value?.feed_info ?? value;
  const id = feed?.feed_id ?? feed?.feedId ?? feed?.id;
  const time = feed?.create_time_raw ?? feed?.create_time ?? feed?.createTime;
  return id && time ? { feed_id: String(id), create_time: String(time), channel_id: String(feed.channel_id ?? feed.channelId ?? "") } : null;
}

function remoteBody(value) {
  const feed = value?.feed ?? value?.feed_info ?? value;
  return feed?.markdown_content ?? feed?.markdownContent ?? feed?.content?.markdown_content ?? feed?.content?.text ?? feed?.content ?? "";
}

function remoteTitle(value) {
  const feed = value?.feed ?? value?.feed_info ?? value;
  return feed?.title ?? feed?.feed_title ?? "";
}

function matchesManagedBody(value, identity, hash) {
  if (!hash) return false;
  const suffix = `\n\n${markerFor(identity, hash)}`;
  const body = String(value);
  return body.endsWith(suffix) && hashBody(body.slice(0, -suffix.length)) === hash;
}

async function scanFeeds(cli, guildId, channelId) {
  const all = [];
  let cursor = "";
  let emptyPages = 0;
  const seenCursor = new Set();
  const seenId = new Set();
  for (let page = 0; page < 30; page += 1) {
    const args = ["feed", "get-channel-timeline-feeds", "--guild-id", String(guildId), "--channel-id", String(channelId), "--count", "50", "--json"];
    if (cursor) args.push("--feed-attach-info", cursor);
    const data = payload(await cli(args));
    const feeds = Array.isArray(data) ? data : data?.feeds ?? data?.feed_list ?? data?.list ?? [];
    if (!Array.isArray(feeds)) throw new Error("CHANNEL_PAGINATION_INVALID");
    let added = 0;
    for (const feed of feeds) {
      const identity = remoteIdentity(feed);
      if (identity?.channel_id && identity.channel_id !== String(channelId)) return { feeds: all, complete: false };
      if (identity && !seenId.has(identity.feed_id)) { seenId.add(identity.feed_id); all.push({ ...identity, channel_id: String(channelId), raw: feed }); added += 1; }
    }
    const next = String(data?.feed_attch_info ?? data?.feed_attach_info ?? "");
    if (data?.has_more === false || (!data?.has_more && !next)) return { feeds: all, complete: true };
    emptyPages = added ? 0 : emptyPages + 1;
    if (emptyPages >= 2) return { feeds: all, complete: false };
    if (!next || next === cursor || seenCursor.has(next)) return { feeds: all, complete: false };
    seenCursor.add(next);
    cursor = next;
  }
  return { feeds: all, complete: false };
}

function channelName(value) { return String(value ?? "").replace(/&amp;/gu, "&"); }

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
    const args = ["feed", "get-guild-feeds", "--guild-id", String(guildId), "--get-type", "2", "--count", "100", "--json"];
    if (cursor) args.push("--feed-attach-info", cursor);
    const data = payload(await cli(args));
    const feeds = Array.isArray(data) ? data : data?.feeds ?? data?.feed_list ?? data?.list;
    if (!Array.isArray(feeds)) return { feeds: all, complete: false };
    let added = 0;
    for (const feed of feeds) {
      const identity = remoteIdentity(feed);
      const id = names.get(channelName(feed.channel_name ?? feed.channelName));
      if (!identity || !id || identity.channel_id && identity.channel_id !== id) return { feeds: all, complete: false };
      if (seenIds.has(identity.feed_id) && seenIds.get(identity.feed_id) !== id) return { feeds: all, complete: false };
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
    const data = fallback.channels ? null : payload(await cli(["manage", "get-guild-channel-list", "--guild-id", String(guildId), "--json"]));
    const channels = fallback.channels ?? (Array.isArray(data) ? data : data?.channels ?? data?.channel_list);
    fallback.inventory = Array.isArray(channels) ? await scanGuildFeeds(cli, guildId, channels) : { feeds: [], complete: false };
  }
  if (!fallback.inventory.complete || !fallback.inventory.channelIds.has(String(channelId))) return section;
  const feeds = fallback.inventory.feeds.filter((feed) => feed.channel_id === String(channelId));
  if (section.feeds.some((feed) => !feeds.some((entry) => entry.feed_id === feed.feed_id))) return section;
  return { feeds, complete: true };
}

async function detail(cli, guildId, feed) {
  return payload(await cli(["feed", "get-feed-detail", "--guild-id", String(guildId), "--channel-id", String(feed.channel_id), "--feed-id", feed.feed_id, "--json"]));
}

function paperMarkdown(item, date, topic) {
  const a = item.analysis.analysis;
  const coverage = item.analysis.coverage;
  const version = `arXiv:${item.arxiv_id}v${item.revision}`;
  const anchor = `radar-paper-${item.arxiv_id.replace(".", "-")}-v${item.revision}`;
  const lines = [`# ${paperReaderTitle(item, topic)}`, "", `**${item.analysis.priority === "must_read" ? "必读" : "关注"}** · ${TOPIC_LABELS[topic.primary] || "待分类"}`, "", "## 研究了什么", "", a.problem, "", "## 作者报告的结果", "", a.result, "", "## 为什么值得读", "", a.reason, ""];
  if (topic.related.length) lines.push(`相关主题：${topic.related.map(id => TOPIC_LABELS[id]).join("、")}`, "");
  if (a.reading_entry) lines.push("## 建议阅读入口", "", a.reading_entry, "");
  for (const [label, values] of [["核心假设", a.assumptions], ["限制与边界", a.limits], ["尚未核查", a.unresolved_checks]]) {
    if (values?.length) lines.push(`## ${label}`, "", ...values.flatMap(value => [`- ${value}`, ""]));
  }
  lines.push("---", "", `原标题：${item.title}`, "", `[${version}](https://arxiv.org/abs/${item.arxiv_id}v${item.revision}) · [网页导读](${SITE_BASE_URL}/arxiv-daily/${date}/#${anchor})`, "", `实际阅读范围：${coverage.label || coverage.level || "未说明"}；检查材料：${(coverage.inspected_sections || []).join("、")}`, "", "中文标题为研究问题导读，不是原题译文。以上内容限于已检查材料，并非独立复算或同行评审。");
  return lines.join("\n");
}

function matchesLegacyPaper(body, item) {
  const text = String(body);
  const ids = [...text.matchAll(/(?:arXiv:|arxiv\.org\/abs\/)(\d{4}\.\d{4,5})(?:v(\d+))?/giu)];
  const versions = ids.filter((match) => match[1] === item.arxiv_id && Number(match[2]) === Number(item.revision));
  return ids.length > 0 && ids.every((match) => match[1] === item.arxiv_id) && versions.length > 0 && text.includes(item.paper_title);
}

function summary() { return { success: true, published: 0, updated: 0, unchanged: 0, pending: 0, remaining: 0, errors: [], pending_items: [] }; }
function pending(result, identity, reason) { result.pending += 1; result.pending_items.push({ identity, reason }); result.success = false; }

async function publishItems(items, { guildId = DEFAULT_GUILD_ID, channelIds = {}, channelId, legacyBindings, cacheRoot = DEFAULT_CACHE_ROOT, cli = runCli, dryRun = false, limit = 50, kind = "daily", backfill = false } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("CHANNEL_LIMIT_INVALID");
  if (!legacyBindings) {
    try { legacyBindings = JSON.parse(await readFile(join(cacheRoot, "legacy-bindings.json"), "utf8")); }
    catch (error) { if (error?.code !== "ENOENT") throw new Error("CHANNEL_LEGACY_BINDINGS_INVALID"); legacyBindings = {}; }
  }
  if (!legacyBindings || typeof legacyBindings !== "object" || Array.isArray(legacyBindings)) throw new Error("CHANNEL_LEGACY_BINDINGS_INVALID");
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
    for (const item of list) {
      const { identity, body, title, topic } = item;
      const target = kind === "daily" ? channelIds[topic.primary] : channelId;
      if (kind === "daily" && !topic.primary) { pending(result, identity, "CHANNEL_TOPIC_UNRESOLVED"); continue; }
      if (!target && !dryRun) { pending(result, identity, "CHANNEL_SECTION_MISSING"); continue; }
      const hash = hashBody(body);
      const marked = `${body}\n\n${markerFor(identity, hash)}`;
      if (Array.from(title).length > 200 || Array.from(marked).length > 10_000) { pending(result, identity, "CHANNEL_CONTENT_LIMIT"); continue; }
      let existing = records[identity];
      if (existing?.status === "published" && existing.hash === hash && existing.channel_id === String(target)) { result.unchanged += 1; continue; }
      if (dryRun) { result.pending_items.push({ identity, reason: existing?.feed_id ? "would_update" : "would_publish" }); continue; }
      try {
        let remote = existing?.feed_id ? { feed_id: existing.feed_id, create_time: existing.create_time, channel_id: existing.channel_id } : null;
        let movedThisTime = false;
        const binding = legacyBindings[identity];
        if (existing?.status === "intent" && existing.operation === "move") {
          const moved = { feed_id: existing.feed_id, create_time: existing.create_time, channel_id: String(target) };
          try {
            const found = await detail(cli, guildId, moved);
            const actual = String(remoteBody(found));
            if (matchesManagedBody(actual, identity, hash) ||
                matchesManagedBody(actual, identity, existing.from_hash) ||
                actual === binding?.content && remoteTitle(found) === binding?.title) remote = moved;
            else { pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME"); continue; }
          } catch {
            const inventory = await scanSectionFeeds(cli, guildId, String(target), fallback);
            if (!inventory.complete || inventory.feeds.some((feed) => feed.feed_id === moved.feed_id)) { pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME"); continue; }
            const old = { ...moved, channel_id: existing.channel_id };
            let oldBody;
            try {
              const found = await detail(cli, guildId, old);
              oldBody = String(remoteBody(found));
              if (!(oldBody === binding?.content && remoteTitle(found) === binding?.title || matchesManagedBody(oldBody, identity, existing.from_hash))) { pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME"); continue; }
            } catch { pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME"); continue; }
            payload(await cli(["feed", "move-feed", "--guild-id", String(guildId), "--channel-id", String(target), "--original-channel-id", String(old.channel_id), "--feed-id", old.feed_id, "--json"]));
            const verified = await detail(cli, guildId, moved);
            if (String(remoteBody(verified)) !== oldBody) throw new Error("CHANNEL_MOVE_UNVERIFIED");
            remote = moved;
            movedThisTime = true;
          }
        }
        if (!remote && binding && existing?.status !== "intent") {
          const confirmed = await detail(cli, guildId, binding);
          const identityMatches = kind === "weekly" ? binding.week_id === item.week_id && String(binding.content).includes(item.week_id) : matchesLegacyPaper(binding.content, item);
          if (!binding.owner_verified || String(binding.guild_id) !== String(guildId) || String(remoteBody(confirmed)) !== binding.content || remoteTitle(confirmed) !== binding.title || !identityMatches) { pending(result, identity, "CHANNEL_LEGACY_MISMATCH"); continue; }
          if (kind === "weekly" && String(binding.channel_id) !== String(target)) { pending(result, identity, "CHANNEL_LEGACY_MISMATCH"); continue; }
          if (String(binding.channel_id) !== String(target)) {
            records[identity] = { hash, status: "intent", operation: "move", feed_id: String(binding.feed_id), create_time: String(binding.create_time), channel_id: String(binding.channel_id) }; await save();
            try { payload(await cli(["feed", "move-feed", "--guild-id", String(guildId), "--channel-id", String(target), "--original-channel-id", String(binding.channel_id), "--feed-id", String(binding.feed_id), "--json"])); }
            catch (error) {
              if (error.message === "CHANNEL_REMOTE_REJECTED") {
                const old = await detail(cli, guildId, binding);
                if (String(remoteBody(old)) === binding.content && remoteTitle(old) === binding.title) { delete records[identity]; await save(); }
              }
              throw error;
            }
            const moved = { feed_id: String(binding.feed_id), create_time: String(binding.create_time), channel_id: String(target) };
            const verified = await detail(cli, guildId, moved);
            if (String(remoteBody(verified)) !== binding.content || remoteTitle(verified) !== binding.title) throw new Error("CHANNEL_MOVE_UNVERIFIED");
            remote = moved;
            movedThisTime = true;
          } else remote = binding;
        }
        if (remote && String(remote.channel_id) !== String(target) && existing?.status === "published") {
          const before = await detail(cli, guildId, remote);
          const priorBody = String(remoteBody(before));
          if (!matchesManagedBody(priorBody, identity, existing.hash)) { pending(result, identity, "CHANNEL_REMOTE_MISMATCH"); continue; }
          records[identity] = { ...existing, hash, status: "intent", operation: "move", from_hash: existing.hash }; await save();
          try { payload(await cli(["feed", "move-feed", "--guild-id", String(guildId), "--channel-id", String(target), "--original-channel-id", String(remote.channel_id), "--feed-id", remote.feed_id, "--json"])); }
          catch (error) {
            if (error.message === "CHANNEL_REMOTE_REJECTED") {
              const old = await detail(cli, guildId, remote);
              if (String(remoteBody(old)) === priorBody) { records[identity] = existing; await save(); }
            }
            throw error;
          }
          const moved = { ...remote, channel_id: String(target) };
          const verified = await detail(cli, guildId, moved);
          if (String(remoteBody(verified)) !== priorBody) throw new Error("CHANNEL_MOVE_UNVERIFIED");
          remote = moved;
          movedThisTime = true;
        }
        if (remote && String(remote.channel_id) !== String(target)) { pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME"); continue; }
        const managed = ledger.managed_sections?.[String(target)];
        if (!remote && (existing?.status === "intent" || !existing && !(managed?.verified_empty === true && managed.topic === topic?.primary))) {
          const scanKey = String(target);
          if (!scans.has(scanKey)) scans.set(scanKey, await scanSectionFeeds(cli, guildId, scanKey, fallback));
          if (["events", "brief"].includes(kind)) {
            const matches = [];
            let invalidMarker = false;
            for (const candidate of scans.get(scanKey).feeds) {
              const found = await detail(cli, guildId, candidate);
              const currentBody = String(remoteBody(found));
              const priorHash = currentBody.match(/([a-f0-9]{64}) -->$/u)?.[1];
              if (matchesManagedBody(currentBody, identity, priorHash)) matches.push({ candidate, priorHash });
              else if (currentBody.includes(`<!-- astrolineage-channel:${identity}:`)) invalidMarker = true;
            }
            if (invalidMarker) { pending(result, identity, "CHANNEL_REMOTE_MISMATCH"); continue; }
            if (matches.length > 1 || matches.length && !scans.get(scanKey).complete) { pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME"); continue; }
            if (matches.length === 1) {
              remote = matches[0].candidate;
              existing = { ...existing, hash: matches[0].priorHash, from_hash: matches[0].priorHash };
            }
          }
          if (!remote) {
            for (const candidate of scans.get(scanKey).feeds) {
              const found = await detail(cli, guildId, candidate);
              const currentBody = String(remoteBody(found));
              if (matchesManagedBody(currentBody, identity, hash)) { remote = candidate; break; }
              if (kind === "weekly" && currentBody === body && String(found.title ?? found.feed?.title ?? "") === title) { remote = candidate; break; }
              if (kind === "weekly" && existing?.status !== "intent" && (currentBody.includes(item.week_id) || remoteTitle(found).includes(item.week_id))) { pending(result, identity, "CHANNEL_WEEKLY_AMBIGUOUS"); remote = "pending_weekly"; break; }
              if (kind === "daily" && currentBody.includes(`arXiv:${item.arxiv_id}v${item.revision}`) && currentBody === body) { remote = candidate; break; }
            }
          }
          if (remote === "pending_weekly") continue;
          if (!remote && !scans.get(scanKey).complete) { pending(result, identity, existing?.status === "intent" ? "CHANNEL_UNKNOWN_OUTCOME" : "CHANNEL_PAGINATION_INCOMPLETE"); continue; }
        }
        if (existing?.status === "intent" && !remote) { pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME"); continue; }
        if (remote) {
          const current = await detail(cli, guildId, remote);
          const currentBody = String(remoteBody(current));
          if (currentBody !== marked) {
            const priorHash = existing?.status === "intent" ? existing.from_hash : existing?.hash;
            if (existing && !(matchesManagedBody(currentBody, identity, priorHash) || binding && currentBody === binding.content && remoteTitle(current) === binding.title)) {
              pending(result, identity, "CHANNEL_REMOTE_MISMATCH"); continue;
            }
            records[identity] = { ...existing, hash, from_hash: priorHash, status: "intent", feed_id: remote.feed_id, create_time: remote.create_time, channel_id: remote.channel_id }; await save();
            payload(await cli(["feed", "alter-feed", "--guild-id", String(guildId), "--channel-id", String(remote.channel_id), "--feed-id", remote.feed_id, "--create-time", remote.create_time, "--title", title, "--markdown-content", marked, "--json"]));
            result.updated += 1;
          } else if (movedThisTime) result.updated += 1;
          else result.unchanged += 1;
          records[identity] = { hash, status: "published", feed_id: remote.feed_id, create_time: remote.create_time, channel_id: remote.channel_id }; await save();
        } else {
          records[identity] = { hash, status: "intent", channel_id: String(target) }; await save();
          const created = remoteIdentity(payload(await cli(["feed", "publish-feed", "--guild-id", String(guildId), "--channel-id", String(target), "--title", title, "--markdown-content", marked, "--json"])));
          if (!created) throw new Error("CHANNEL_CREATE_IDENTITY_MISSING");
          records[identity] = { hash, status: "published", feed_id: created.feed_id, create_time: created.create_time, channel_id: String(target) }; await save();
          result.published += 1;
        }
      } catch (error) {
        if (error.message === "CHANNEL_RATE_LIMIT" && !existing && records[identity]?.status === "intent" && !records[identity].feed_id) { delete records[identity]; await save(); }
        pending(result, identity, error.message || "CHANNEL_FAILED"); result.errors.push(error.message || "CHANNEL_FAILED");
        if (error.message === "CHANNEL_RATE_LIMIT") { stoppedAt = list.indexOf(item); break; }
      }
    }
    if (stoppedAt !== null) result.remaining += list.length - stoppedAt;
    if (backfill && !dryRun) { ledger[cursorKey] = start + (stoppedAt ?? list.length) >= items.length ? 0 : start + (stoppedAt ?? list.length); await save(); }
    return result;
  });
}

export async function provisionTopicChannels({ guildId = DEFAULT_GUILD_ID, cacheRoot = DEFAULT_CACHE_ROOT, cli = runCli, dryRun = false, rename = false } = {}) {
  const data = payload(await cli(["manage", "get-guild-channel-list", "--guild-id", String(guildId), "--json"]));
  const channels = Array.isArray(data) ? data : data?.channels ?? data?.channel_list ?? [];
  if (!Array.isArray(channels)) throw new Error("CHANNEL_SECTION_LIST_INVALID");
  const ids = {};
  const fallback = { channels };
  for (const [key, label] of TOPICS) {
    const title = TOPIC_LABELS[key];
    const matches = channels.filter((entry) => [title, `${key} ${label}`].includes(channelName(entry.channel_name ?? entry.name)));
    if (matches.length > 1) throw new Error("CHANNEL_SECTION_AMBIGUOUS");
    const current = matches[0];
    if (current) {
      ids[key] = String(current.channel_id ?? current.id);
      if (rename && !dryRun && channelName(current.channel_name ?? current.name) !== title) {
        payload(await cli(["manage", "modify-channel", "--guild-id", String(guildId), "--channel-id", ids[key], "--channel-name", title, "--json"]));
        current.channel_name = title;
        delete fallback.inventory;
      }
    }
    else if (!dryRun) {
      const created = payload(await cli(["manage", "create-channel", "--guild-id", String(guildId), "--channel-name", title, "--json"]));
      const id = created?.channel_id ?? created?.channel?.channel_id;
      if (!id) throw new Error("CHANNEL_SECTION_CREATE_INVALID");
      ids[key] = String(id);
    }
    if (ids[key] && !dryRun) {
      const trusted = await withPublicationLedger(cacheRoot, guildId, async (_items, _save, ledger) => ledger.managed_sections?.[ids[key]]?.verified_empty === true);
      if (trusted) continue;
      const inventory = await scanSectionFeeds(cli, guildId, ids[key], fallback);
      if (inventory.complete && inventory.feeds.length === 0) await withPublicationLedger(cacheRoot, guildId, async (_items, save, ledger) => {
        ledger.managed_sections ??= {};
        ledger.managed_sections[ids[key]] = { verified_empty: true, topic: key };
        await save();
      });
    }
  }
  return ids;
}

export async function publishDailyFeed({ feedPath = FEED_PATH, radarPath = RADAR_PATH, artifactRoot, distRoot = DEFAULT_DIST_ROOT, source, readEdition = readPublishedArxivEdition, sourceBinding, channelIds, includeBrief = false, dailyChannelId = DEFAULT_DAILY_CHANNEL_ID, ...options } = {}) {
  try {
    if (!source) requireSourceBinding(sourceBinding);
    const edition = source ?? await readEdition({ output: feedPath, radarOutput: radarPath, artifactRoot });
    if (!source && (!edition.generation_id || !edition.pointer)) throw new Error("CHANNEL_SOURCE_UNPUBLISHED");
    if (!source && (sourceBinding.daily.generation_id !== edition.generation_id || sourceBinding.daily.hash !== hashBody(JSON.stringify({ feed: edition.feed, radar: edition.radar })))) throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
    const checked = validateDailyRadarPayload(edition.feed, edition.radar);
    if (!checked.valid) throw new Error(`CHANNEL_SOURCE_INVALID:${checked.diagnostics.join(",")}`);
    const date = edition.feed.window?.announcement_date;
    if (!/^\d{4}-\d\d-\d\d$/u.test(date || "")) throw new Error("CHANNEL_SOURCE_DATE_INVALID");
    await stat(join(distRoot, "arxiv-daily", date, "index.html"));
    const items = dailyItems(checked.model, date);
    let briefError;
    if (includeBrief) {
      try { items.unshift(dailyBriefItem(checked.model, date)); }
      catch (error) { briefError = error.message; }
    }
    if (items.length === 0 && !briefError) return null;
    const ids = channelIds ?? (options.dryRun ? {} : await provisionTopicChannels(options));
    const result = await publishItems(items, { ...options, channelIds: { ...ids, daily: dailyChannelId } });
    if (briefError) { pending(result, `daily-summary:${date}`, briefError); result.errors.push(briefError); }
    return result;
  } catch (error) { return { ...summary(), success: false, pending: 1, errors: [error.message] }; }
}

function dailyItems(model, date) {
  return [...model.groups.must_read, ...model.groups.worth_knowing].map((item) => {
    const topic = routePaper(item);
    const identity = `daily:${item.arxiv_id}v${item.revision}`;
    return { identity, arxiv_id: item.arxiv_id, revision: item.revision, paper_title: item.title, topic, title: paperReaderTitle(item, topic), body: paperMarkdown(item, date, topic) };
  });
}

export async function alterDailyFeed({
  guildId = DEFAULT_GUILD_ID,
  channelId = DEFAULT_DAILY_CHANNEL_ID,
  feedId,
  createTime,
  titleOverride,
} = {}) {
  if (!feedId || !createTime) throw new Error("alterDailyFeed requires feedId and createTime");
  const { postTitle, md } = await generateDailyMarkdown({ titleOverride });

  console.log(`[publisher] 正在更新每日帖子 ${feedId} (新标题: ${postTitle})...`);
  const res = await runCli([
    "feed", "alter-feed",
    "--guild-id", String(guildId),
    "--channel-id", String(channelId),
    "--feed-id", String(feedId),
    "--create-time", String(createTime),
    "--title", postTitle,
    "--markdown-content", md,
    "--json",
  ]);

  console.log(`[publisher] 帖子更新成功`);
  return res;
}

export async function publishWeeklyFeed({
  guildId = DEFAULT_GUILD_ID,
  channelId = DEFAULT_WEEKLY_CHANNEL_ID,
  titleOverride,
  weeklyPath = WEEKLY_PATH,
  distRoot = DEFAULT_DIST_ROOT,
  cacheRoot,
  cli,
  dryRun,
  sourceBinding,
  legacyBindings,
} = {}) {
  try {
    requireSourceBinding(sourceBinding);
    if ((await stat(weeklyPath)).size > 20_000_000) throw new Error("CHANNEL_WEEKLY_INVALID");
    const weeklyBytes = await readFile(weeklyPath);
    if (sourceBinding.weekly.hash !== hashBody(weeklyBytes)) throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
    const weekly = JSON.parse(weeklyBytes);
    if (!/^\d{4}-W\d\d$/u.test(weekly.week_id || "") || !weekly.executive_summary) throw new Error("CHANNEL_WEEKLY_INVALID");
    await stat(join(distRoot, "arxiv-weekly", weekly.week_id, "index.html"));
    const { weekId, postTitle, md } = await generateWeeklyMarkdown({ weekly, titleOverride });
    return await publishItems([{ identity: `weekly:${weekId}`, week_id: weekId, body: md, title: postTitle }], { guildId, channelId, cacheRoot, cli, dryRun, legacyBindings, kind: "weekly" });
  } catch (error) { return { ...summary(), success: false, pending: 1, errors: [error.message] }; }
}

export async function publishEventRanking({ sourceBinding, eventSnapshot, eventsPath = join(DEFAULT_DIST_ROOT, "api/v1/events.json"), channelId = DEFAULT_DAILY_CHANNEL_ID, ...options } = {}) {
  try {
    requireSourceBinding(sourceBinding);
    if (eventSnapshot?.error === "CHANNEL_EVENTS_INVALID") throw new Error("CHANNEL_EVENTS_INVALID");
    if (!/^[a-f0-9]{64}$/u.test(eventSnapshot?.hash || "")) throw new Error("CHANNEL_EVENTS_BUILD_REQUIRED");
    if ((await stat(eventsPath)).size > 20_000_000) throw new Error("CHANNEL_EVENTS_INVALID");
    const bytes = await readFile(eventsPath);
    if (hashBody(bytes) !== eventSnapshot.hash) throw new Error("CHANNEL_EVENTS_BUILD_MISMATCH");
    const data = JSON.parse(bytes);
    if (!Array.isArray(data.events) || !Number.isFinite(Date.parse(data.generated_at)) || data.generated_at !== eventSnapshot.generated_at) throw new Error("CHANNEL_EVENTS_INVALID");
    const top = data.events.slice(0, 5);
    const seen = new Set();
    const title = "活跃瞬变源 · 文献热度 Top 5";
    const lines = [`# ${title}`, "", `数据更新：${data.generated_at}`, "", "榜单与网页使用同一构建快照。热度表示本地近期文献讨论，按现有 7 天半衰期衰减；不等于物理重要性，也不表示事件刚刚爆发。", ""];
    for (const [index, event] of top.entries()) {
      if (typeof event.event_id !== "string" || !event.event_id.trim() || seen.has(event.event_id) || !Number.isFinite(event.heat_score) || event.heat_score < 0 || !Number.isInteger(event.paper_count) || event.paper_count < 0 || !/^\d{4}-\d\d-\d\d$/u.test(event.last_updated || "") || !Array.isArray(event.papers)) throw new Error("CHANNEL_EVENTS_INVALID");
      seen.add(event.event_id);
      lines.push(`## ${index + 1}. ${event.event_id}`, "", `**热度 ${event.heat_score}** · ${event.paper_count} 篇关联文献 · 最近文献更新 ${event.last_updated}`, "");
      const paper = event.papers.find(p => ["must_read", "worth_knowing"].includes(p.priority) && /^\d{4}\.\d{4,5}$/u.test(p.arxiv_id || ""));
      if (paper) lines.push(paper.bluf_problem || "", "", `[近期关联论文 arXiv:${paper.arxiv_id}](https://arxiv.org/abs/${paper.arxiv_id})`, "");
    }
    if (!top.length) lines.push("当前没有可展示的事件，不补造排名。", "");
    lines.push(`[网页事件榜单](${SITE_BASE_URL}/agent/)`);
    return await publishItems([{ identity: "events:top5", title, body: lines.join("\n") }], { ...options, channelId, kind: "events" });
  } catch (error) { return { ...summary(), success: false, pending: 1, errors: [error.message] }; }
}

export async function publishHistoricalFeeds({ archiveRoot = DEFAULT_ARCHIVE_ROOT, distRoot = DEFAULT_DIST_ROOT, from = "2026-09-07", through = "2026-10-01", limit = 50, dryRun = false, channelIds, sourceBinding, briefs = false, channelId = DEFAULT_DAILY_CHANNEL_ID, ...options } = {}) {
  try {
    requireSourceBinding(sourceBinding);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("CHANNEL_LIMIT_INVALID");
    const names = await listDailyArchives(archiveRoot, from, through);
    const must = [];
    const worth = [];
    const seen = new Set();
    const invalid = [];
    for (const name of names) {
      const date = name.slice(0, 10);
      try {
        const bytes = await readFile(join(archiveRoot, name));
        if (!sourceBinding.archives[date] || hashBody(bytes) !== sourceBinding.archives[date]) throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
        const model = await readDailyArchive(join(archiveRoot, name), date, distRoot, bytes);
        if (briefs) { must.push(dailyBriefItem(model, date)); continue; }
        for (const [group, target, kind] of [[model.groups.must_read, must, "must_read"], [model.groups.worth_knowing, worth, "worth_knowing"]]) {
          for (const paper of group) {
            const item = dailyItems({ groups: { must_read: kind === "must_read" ? [paper] : [], worth_knowing: kind === "worth_knowing" ? [paper] : [] } }, date)[0];
            if (!seen.has(item.identity)) { seen.add(item.identity); target.push(item); }
          }
        }
      } catch (error) { invalid.push({ date, reason: error.message }); }
    }
    const ids = channelIds ?? (dryRun || briefs ? {} : await provisionTopicChannels(options));
    const result = await publishItems([...must, ...worth], { ...options, channelIds: ids, channelId, kind: briefs ? "brief" : "daily", dryRun, limit, backfill: true });
    for (const item of invalid) pending(result, item.date, item.reason);
    return result;
  } catch (error) { return { ...summary(), success: false, pending: 1, errors: [error.message] }; }
}

export async function alterWeeklyFeed({
  guildId = DEFAULT_GUILD_ID,
  channelId = DEFAULT_WEEKLY_CHANNEL_ID,
  feedId,
  createTime,
  titleOverride,
} = {}) {
  if (!feedId || !createTime) throw new Error("alterWeeklyFeed requires feedId and createTime");
  const { postTitle, md } = await generateWeeklyMarkdown({ titleOverride });

  console.log(`[publisher] 正在更新周报帖子 ${feedId} (新标题: ${postTitle})...`);
  const res = await runCli([
    "feed", "alter-feed",
    "--guild-id", String(guildId),
    "--channel-id", String(channelId),
    "--feed-id", String(feedId),
    "--create-time", String(createTime),
    "--title", postTitle,
    "--markdown-content", md,
    "--json",
  ]);

  console.log(`[publisher] 周报帖子更新成功`);
  return res;
}

export async function deleteFeed({
  guildId = DEFAULT_GUILD_ID,
  channelId,
  feedId,
  createTime,
}) {
  if (!channelId || !feedId || !createTime) throw new Error("deleteFeed requires channelId, feedId, and createTime");
  console.log(`[publisher] 正在删除帖子 ${feedId} (${createTime}) 来自版块 ${channelId}...`);
  const res = await runCli([
    "feed", "del-feed",
    "--guild-id", String(guildId),
    "--channel-id", String(channelId),
    "--feed-id", String(feedId),
    "--create-time", String(createTime),
    "--yes",
    "--json",
  ]);
  console.log(`[publisher] 帖子删除成功`);
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const task = process.argv[2] || "daily";
  const dryRun = process.argv.includes("--dry-run");
  const bindingIndex = process.argv.indexOf("--legacy-bindings");
  const legacyBindings = bindingIndex < 0 ? undefined : JSON.parse(await readFile(resolve(process.argv[bindingIndex + 1]), "utf8"));
  let sourceBinding;
  let eventSnapshot;
  if (["daily", "weekly", "events", "backfill", "--backfill"].includes(task)) {
    try {
      const website = JSON.parse(await readFile(WEBSITE_BUILD_PATH, "utf8"));
      if (website.status !== "success") throw new Error();
      sourceBinding = website.source_binding;
      eventSnapshot = website.events;
      requireSourceBinding(sourceBinding);
    } catch { throw new Error("CHANNEL_SOURCE_BUILD_REQUIRED"); }
  }
  if (task === "daily") {
    console.log(JSON.stringify(await publishDailyFeed({ dryRun, legacyBindings, sourceBinding, includeBrief: true })));
  } else if (task === "weekly") {
    console.log(JSON.stringify(await publishWeeklyFeed({ dryRun, sourceBinding, legacyBindings })));
  } else if (task === "provision") {
    console.log(JSON.stringify(await provisionTopicChannels({ dryRun, rename: true })));
  } else if (task === "events") {
    console.log(JSON.stringify(await publishEventRanking({ dryRun, sourceBinding, eventSnapshot })));
  } else if (task === "backfill" || task === "--backfill") {
    const index = process.argv.indexOf("--limit");
    const limit = index < 0 ? 20 : Number(process.argv[index + 1]);
    const currentBinding = await capturePublishedSourceBinding();
    if (currentBinding.id !== sourceBinding.id) throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
    console.log(JSON.stringify(await publishHistoricalFeeds({ dryRun, limit, legacyBindings, sourceBinding, briefs: process.argv.includes("--briefs") })));
  } else if (task === "alter-daily") {
    const feedId = process.argv[3];
    const createTime = process.argv[4];
    await alterDailyFeed({ feedId, createTime });
  } else if (task === "alter-weekly") {
    const feedId = process.argv[3];
    const createTime = process.argv[4];
    await alterWeeklyFeed({ feedId, createTime });
  } else {
    console.error(`未知任务类型: ${task}。可用参数: daily, weekly, alter-daily <feedId> <createTime>, alter-weekly <feedId> <createTime>`);
    process.exit(1);
  }
}
