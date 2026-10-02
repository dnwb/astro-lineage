import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { validateDailyRadarPayload } from "./daily-radar.mjs";
import { readPublishedArxivEdition } from "./arxiv-daily.mjs";
import { TOPICS, routePaper, hashBody, markerFor, readDailyArchive, listDailyArchives, withPublicationLedger, capturePublishedSourceBinding } from "./channel-publication.mjs";

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

  if (highlights.length === 0) {
    return { batchDate, totalEntries, highlights, postTitle: "", md: "" };
  }

  const postTitle = titleOverride || deriveDailyContentTitle(batchDate, highlights);

  let md = `# 🌅 ${postTitle.replace(/【|】/gu, "").trim()}\n\n`;
  md += `**发布日期**：${batchDate} | **本期概览**：arXiv 官方共发布 ${totalEntries} 篇论文，AI 研判筛选出 **${mustRead.length}** 篇重点必读、**${worthKnowing.length}** 篇值得关注。\n\n`;
  md += `---\n\n`;

  for (let i = 0; i < highlights.length; i++) {
    const item = highlights[i];
    const priority = item.analysis?.priority || (i < mustRead.length ? "must_read" : "worth_knowing");
    const priorityTag = priority === "must_read" ? "🔴【必读·重点突破】" : "🟡【值得关注】";
    const authors = (item.authors || []).slice(0, 3).join(", ") + ((item.authors || []).length > 3 ? " 等" : "");
    const analysisObj = item.analysis?.analysis || item.analysis || {};

    md += `### ${i + 1}. ${priorityTag} ${item.title || item.arxiv_id}\n`;
    md += `* **arXiv 编号**：[arXiv:${item.arxiv_id}](https://arxiv.org/abs/${item.arxiv_id}) | [校园网导读看板](${SITE_BASE_URL}/arxiv-daily/${batchDate}#paper-${item.arxiv_id})\n`;
    if (authors) md += `* **作者团队**：${authors}\n`;
    if (analysisObj.reason) md += `* **研读定位**：${cleanMath(analysisObj.reason)}\n`;
    if (analysisObj.result) md += `* **核心突破**：${cleanMath(analysisObj.result)}\n`;
    if (analysisObj.reading_entry) md += `* **阅读抓手**：${cleanMath(analysisObj.reading_entry)}\n`;
    md += `\n`;
  }

  md += `---\n\n`;
  md += `* 课题组每日雷达完整看板：[AstroLineage 每日雷达](${SITE_BASE_URL}/arxiv-daily/${batchDate})\n`;
  md += `* 课题组前沿脉络知识库主页：[AstroLineage 首页](${SITE_BASE_URL}/)\n`;

  return { batchDate, totalEntries, highlights, postTitle, md };
}

export async function generateWeeklyMarkdown({ titleOverride, weekly: weeklyInput, weeklyPath = WEEKLY_PATH } = {}) {
  const weekly = weeklyInput || JSON.parse(await readFile(weeklyPath, "utf8"));
  const weekId = weekly.week_id || "本周";
  const dateRange = weekly.date_range || "";

  const postTitle = titleOverride || deriveWeeklyContentTitle(weekId, weekly);

  let md = `# 🌌 ${postTitle.replace(/【|】/gu, "").trim()}\n\n`;
  md += `**统计区间**：${dateRange}（涵盖当周周一至周四全部发布批次）\n\n`;

  if (weekly.executive_summary) {
    md += `## 📋 宏观学术态势综述\n\n`;
    md += `${cleanMath(weekly.executive_summary)}\n\n`;
  }

  if (Array.isArray(weekly.top_picks) && weekly.top_picks.length > 0) {
    md += `---\n\n## 🌟 本周重点精选论文 (Top Picks)\n\n`;
    for (const pick of weekly.top_picks) {
      const tag = pick.priority === "must_read" ? "🔴【必读】" : "🟡【关注】";
      const authors = Array.isArray(pick.authors) && pick.authors.length > 0
        ? pick.authors.slice(0, 3).join(", ") + (pick.authors.length > 3 ? " 等" : "")
        : "";
      md += `* ${tag} **[${pick.title || pick.arxiv_id}](https://arxiv.org/abs/${pick.arxiv_id})**\n`;
      if (authors) md += `  * 作者：${authors}\n`;
      const reason = pick.reason || pick.recommendation_reason;
      if (reason) md += `  * 研读定位：${cleanMath(reason)}\n`;
    }
    md += `\n`;
  }

  if (Array.isArray(weekly.thematic_highlights) && weekly.thematic_highlights.length > 0) {
    md += `---\n\n## 🔬 本周核心专题突破与因果链演进\n\n`;
    for (const theme of weekly.thematic_highlights) {
      const papers = (theme.paper_ids || []).map((id) => {
        const found = (weekly.papers || []).find((p) => p.arxiv_id === id);
        const authorStr = found && Array.isArray(found.authors) && found.authors.length > 0
          ? ` (${found.authors[0]} 等)`
          : "";
        return `[arXiv:${id}${authorStr}](https://arxiv.org/abs/${id})`;
      }).join(", ");
      md += `### ▸ ${theme.theme_name}\n`;
      md += `${cleanMath(theme.summary)}\n`;
      if (papers) md += `* **涉及文献**：${papers}\n`;
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
  md += `* 课题组学术周报完整专栏：[AstroLineage 前沿周报库](${SITE_BASE_URL}/arxiv-weekly/)\n`;
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
      if (identity && !seenId.has(identity.feed_id)) { seenId.add(identity.feed_id); all.push({ ...identity, raw: feed }); added += 1; }
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

async function detail(cli, guildId, feed) {
  return payload(await cli(["feed", "get-feed-detail", "--guild-id", String(guildId), "--channel-id", String(feed.channel_id), "--feed-id", feed.feed_id, "--json"]));
}

function paperMarkdown(item, date, topic) {
  const a = item.analysis.analysis;
  const coverage = item.analysis.coverage;
  const version = `arXiv:${item.arxiv_id}v${item.revision}`;
  const anchor = `radar-paper-${item.arxiv_id.replace(".", "-")}-v${item.revision}`;
  const lines = [`# ${item.title}`, "", `**${item.analysis.priority === "must_read" ? "重点必读" : "值得关注"}** · ${topic.primary}${topic.related.length ? `（相关：${topic.related.join("、")}）` : ""}`, "", `**原文版本**：[${version}](https://arxiv.org/abs/${item.arxiv_id}v${item.revision})`, `**导读**：[${date} 已发布页面](${SITE_BASE_URL}/arxiv-daily/${date}#${anchor})`, `**核读范围**：${coverage.label || coverage.level || "未说明"}`, "", `**研读定位**：${cleanMath(a.reason)}`, `**问题**：${cleanMath(a.problem)}`, `**结果**：${cleanMath(a.result)}`];
  if (a.assumptions?.length) lines.push(`**假设**：${a.assumptions.map(cleanMath).join("；")}`);
  if (a.limits?.length) lines.push(`**限制**：${a.limits.map(cleanMath).join("；")}`);
  if (a.unresolved_checks?.length) lines.push(`**未核查**：${a.unresolved_checks.map(cleanMath).join("；")}`);
  lines.push("", "以上是指定版本与已检查材料范围内的导读，并非独立复算或同行评审。");
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
    const start = backfill ? Math.min(ledger.backfill_cursor || 0, items.length) : 0;
    const list = items.slice(start, start + limit);
    result.remaining = Math.max(0, items.length - start - list.length);
    if (result.remaining && !backfill) result.success = false;
    const scans = new Map();
    let stoppedAt = null;
    for (const item of list) {
      const { identity, body, title, topic } = item;
      const target = kind === "weekly" ? channelId : channelIds[topic.primary];
      if (kind === "daily" && !topic.primary) { pending(result, identity, "CHANNEL_TOPIC_UNRESOLVED"); continue; }
      if (!target && !dryRun) { pending(result, identity, "CHANNEL_SECTION_MISSING"); continue; }
      const hash = hashBody(body);
      const marked = `${body}\n\n${markerFor(identity, hash)}`;
      if (Array.from(title).length > 200 || Array.from(marked).length > 10_000) { pending(result, identity, "CHANNEL_CONTENT_LIMIT"); continue; }
      const existing = records[identity];
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
            const inventory = await scanFeeds(cli, guildId, String(target));
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
          const scanKey = kind === "weekly" ? String(channelId) : String(target);
          if (!scans.has(scanKey)) scans.set(scanKey, await scanFeeds(cli, guildId, scanKey));
          for (const candidate of scans.get(scanKey).feeds) {
            const found = await detail(cli, guildId, candidate);
            const currentBody = String(remoteBody(found));
            if (matchesManagedBody(currentBody, identity, hash)) { remote = candidate; break; }
            if (kind === "weekly" && currentBody === body && String(found.title ?? found.feed?.title ?? "") === title) { remote = candidate; break; }
            if (kind === "weekly" && existing?.status !== "intent" && (currentBody.includes(item.week_id) || remoteTitle(found).includes(item.week_id))) { pending(result, identity, "CHANNEL_WEEKLY_AMBIGUOUS"); remote = "pending_weekly"; break; }
            if (kind === "daily" && currentBody.includes(`arXiv:${item.arxiv_id}v${item.revision}`) && currentBody === body) { remote = candidate; break; }
          }
          if (remote === "pending_weekly") continue;
          if (!remote && !scans.get(scanKey).complete) { pending(result, identity, existing?.status === "intent" ? "CHANNEL_UNKNOWN_OUTCOME" : "CHANNEL_PAGINATION_INCOMPLETE"); continue; }
        }
        if (existing?.status === "intent" && !remote) { pending(result, identity, "CHANNEL_UNKNOWN_OUTCOME"); continue; }
        if (remote) {
          const current = await detail(cli, guildId, remote);
          if (String(remoteBody(current)) !== marked) {
            records[identity] = { ...existing, hash, status: "intent", feed_id: remote.feed_id, create_time: remote.create_time, channel_id: remote.channel_id }; await save();
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
    if (backfill && !dryRun) { ledger.backfill_cursor = start + (stoppedAt ?? list.length) >= items.length ? 0 : start + (stoppedAt ?? list.length); await save(); }
    return result;
  });
}

export async function provisionTopicChannels({ guildId = DEFAULT_GUILD_ID, cacheRoot = DEFAULT_CACHE_ROOT, cli = runCli, dryRun = false } = {}) {
  const data = payload(await cli(["manage", "get-guild-channel-list", "--guild-id", String(guildId), "--json"]));
  const channels = Array.isArray(data) ? data : data?.channels ?? data?.channel_list ?? [];
  if (!Array.isArray(channels)) throw new Error("CHANNEL_SECTION_LIST_INVALID");
  const ids = {};
  for (const [key, label] of TOPICS) {
    const title = `${key} ${label}`;
    const matches = channels.filter((entry) => String(entry.channel_name ?? entry.name ?? "").replace(/&amp;/gu, "&") === title);
    if (matches.length > 1) throw new Error("CHANNEL_SECTION_AMBIGUOUS");
    const current = matches[0];
    if (current) ids[key] = String(current.channel_id ?? current.id);
    else if (!dryRun) {
      const created = payload(await cli(["manage", "create-channel", "--guild-id", String(guildId), "--channel-name", title, "--json"]));
      const id = created?.channel_id ?? created?.channel?.channel_id;
      if (!id) throw new Error("CHANNEL_SECTION_CREATE_INVALID");
      ids[key] = String(id);
    }
    if (ids[key] && !dryRun) {
      const trusted = await withPublicationLedger(cacheRoot, guildId, async (_items, _save, ledger) => ledger.managed_sections?.[ids[key]]?.verified_empty === true);
      if (trusted) continue;
      const inventory = await scanFeeds(cli, guildId, ids[key]);
      if (inventory.complete && inventory.feeds.length === 0) await withPublicationLedger(cacheRoot, guildId, async (_items, save, ledger) => {
        ledger.managed_sections ??= {};
        ledger.managed_sections[ids[key]] = { verified_empty: true, topic: key };
        await save();
      });
    }
  }
  return ids;
}

export async function publishDailyFeed({ feedPath = FEED_PATH, radarPath = RADAR_PATH, artifactRoot, distRoot = DEFAULT_DIST_ROOT, source, readEdition = readPublishedArxivEdition, sourceBinding, channelIds, ...options } = {}) {
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
    if (items.length === 0) return null;
    const ids = channelIds ?? (options.dryRun ? {} : await provisionTopicChannels(options));
    return await publishItems(items, { ...options, channelIds: ids });
  } catch (error) { return { ...summary(), success: false, pending: 1, errors: [error.message] }; }
}

function dailyItems(model, date) {
  return [...model.groups.must_read, ...model.groups.worth_knowing].map((item) => {
    const topic = routePaper(item);
    const identity = `daily:${item.arxiv_id}v${item.revision}`;
    return { identity, arxiv_id: item.arxiv_id, revision: item.revision, paper_title: item.title, topic, title: `【${topic.primary || "待分类"}】${item.title}`, body: paperMarkdown(item, date, topic) };
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

export async function publishHistoricalFeeds({ archiveRoot = DEFAULT_ARCHIVE_ROOT, distRoot = DEFAULT_DIST_ROOT, from = "2026-09-07", through = "2026-10-01", limit = 50, dryRun = false, channelIds, sourceBinding, ...options } = {}) {
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
        for (const [group, target, kind] of [[model.groups.must_read, must, "must_read"], [model.groups.worth_knowing, worth, "worth_knowing"]]) {
          for (const paper of group) {
            const item = dailyItems({ groups: { must_read: kind === "must_read" ? [paper] : [], worth_knowing: kind === "worth_knowing" ? [paper] : [] } }, date)[0];
            if (!seen.has(item.identity)) { seen.add(item.identity); target.push(item); }
          }
        }
      } catch (error) { invalid.push({ date, reason: error.message }); }
    }
    const ids = channelIds ?? (dryRun ? {} : await provisionTopicChannels(options));
    const result = await publishItems([...must, ...worth], { ...options, channelIds: ids, dryRun, limit, backfill: true });
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
  if (["daily", "weekly", "backfill", "--backfill"].includes(task)) {
    try {
      const website = JSON.parse(await readFile(WEBSITE_BUILD_PATH, "utf8"));
      if (website.status !== "success") throw new Error();
      sourceBinding = website.source_binding;
      requireSourceBinding(sourceBinding);
    } catch { throw new Error("CHANNEL_SOURCE_BUILD_REQUIRED"); }
  }
  if (task === "daily") {
    console.log(JSON.stringify(await publishDailyFeed({ dryRun, legacyBindings, sourceBinding })));
  } else if (task === "weekly") {
    console.log(JSON.stringify(await publishWeeklyFeed({ dryRun, sourceBinding, legacyBindings })));
  } else if (task === "provision") {
    console.log(JSON.stringify(await provisionTopicChannels({ dryRun })));
  } else if (task === "backfill" || task === "--backfill") {
    const index = process.argv.indexOf("--limit");
    const limit = index < 0 ? 20 : Number(process.argv[index + 1]);
    const currentBinding = await capturePublishedSourceBinding();
    if (currentBinding.id !== sourceBinding.id) throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
    console.log(JSON.stringify(await publishHistoricalFeeds({ dryRun, limit, legacyBindings, sourceBinding })));
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
