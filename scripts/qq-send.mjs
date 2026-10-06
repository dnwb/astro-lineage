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
import { defaultUserManager } from "./qq-users.mjs";
import { sendProactiveC2CMessage, sendProactiveGroupMessage } from "./qq-official-bot.mjs";
import { readPublishedArxivEdition, acquireRefreshLock, releaseRefreshLock, writeJsonAtomically } from "./arxiv-daily.mjs";
import { validateDailyRadarPayload } from "./daily-radar.mjs";
import { hashBody, readDailyArchive, readChannelShareUrl } from "./channel-publication.mjs";
import { readingExcerpt } from "./tencent-channel-publisher.mjs";
import { deriveDailyTitleCandidate, deriveWeeklyTitleCandidate, extractPaperTopic } from "./channel-title-policy.mjs";

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

export async function generateGroupBrief(type = "daily", options = {}) {
  if (!["daily", "weekly"].includes(type)) throw new Error("QQ_NOTIFY_KIND_INVALID");
  let { dailyModel: model, weekly, date, sourceBinding, channelUrl } = options;
  let publicationHash;
  const websiteBase = (options.websiteBase || process.env.SITE_BASE_URL || process.env.ASTRO_SITE_URL || "http://localhost:4321").replace(/\/+$/u, "");
  if (!(type === "daily" ? model : weekly)) {
    if (!sourceBinding) {
      const website = JSON.parse(await readFile(".cache/notebooklm/website.json", "utf8"));
      if (website.status !== "success") throw new Error("QQ_SOURCE_BUILD_REQUIRED");
      sourceBinding = website.source_binding;
    }
    const { daily, weekly: weeklyBinding, archives, id } = sourceBinding || {};
    if (!daily?.generation_id || !weeklyBinding?.hash || !archives || hashBody(JSON.stringify({ daily, weekly: weeklyBinding, archives })) !== id) throw new Error("QQ_SOURCE_BUILD_REQUIRED");
    if (type === "weekly") {
      const weeklyPath = options.weeklyPath || "src/data/arxiv-weekly.json";
      if ((await stat(weeklyPath)).size > 20_000_000) throw new Error("QQ_SOURCE_INVALID");
      const bytes = await readFile(weeklyPath);
      if (hashBody(bytes) !== weeklyBinding.hash) throw new Error("QQ_SOURCE_BUILD_MISMATCH");
      weekly = JSON.parse(bytes);
      publicationHash = weeklyBinding.hash;
    } else {
      const published = await (options.readEdition || readPublishedArxivEdition)();
      if (published.generation_id !== daily.generation_id || hashBody(JSON.stringify({ feed: published.feed, radar: published.radar })) !== daily.hash) throw new Error("QQ_SOURCE_BUILD_MISMATCH");
      date = published.feed.window?.announcement_date;
      if (!/^\d{4}-\d\d-\d\d$/u.test(date || "")) throw new Error("QQ_SOURCE_INVALID");
      if (archives[date]) {
        const path = resolve(options.archiveRoot || "src/data/arxiv-archives/daily", `${date}.json`);
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
  try { channelAddress = new URL(channelUrl); readerAddress = new URL(websiteBase); } catch { throw new Error("QQ_CHANNEL_LINK_REQUIRED"); }
  if (channelAddress.protocol !== "https:" || channelAddress.hostname !== "pd.qq.com" || channelAddress.username || channelAddress.password) throw new Error("QQ_CHANNEL_LINK_REQUIRED");
  if (!["http:", "https:"].includes(readerAddress.protocol) || readerAddress.username || readerAddress.password || readerAddress.search || readerAddress.hash) throw new Error("QQ_SOURCE_INVALID");
  const lines = [];
  if (type === "weekly") {
    if (!/^\d{4}-W\d\d$/u.test(weekly.week_id || "") || !weekly.executive_summary) throw new Error("QQ_SOURCE_INVALID");
    lines.push(deriveWeeklyTitleCandidate(weekly.week_id, weekly), weekly.date_range || "", "", readingExcerpt(weekly.executive_summary), "");
    for (const pick of (weekly.top_picks || []).slice(0, 3)) {
      if (!/^\d{4}\.\d{4,5}$/u.test(pick.arxiv_id || "")) throw new Error("QQ_SOURCE_INVALID");
      const revision = pick.revision || weekly.papers?.find(p => p.arxiv_id === pick.arxiv_id)?.revision;
      const suffix = Number.isSafeInteger(revision) && revision > 0 ? `v${revision}` : "";
      const paperObj = weekly.papers?.find(p => p.arxiv_id === pick.arxiv_id);
      const authors = paperObj?.authors || pick.authors;
      const authorStr = Array.isArray(authors) && authors.length > 0 ? (authors.length > 2 ? `${authors[0]} 等` : authors.join(", ")) : "";
      const authorSuffix = authorStr ? ` (${authorStr})` : "";
      lines.push(`• ${pick.priority === "must_read" ? "必读" : "关注"}｜${extractPaperTopic(pick)}${authorSuffix}`, readingExcerpt(pick.reason || pick.recommendation_reason || pick.core_insight), `原文：https://arxiv.org/abs/${pick.arxiv_id}${suffix}`, "");
    }
  } else {
    if (!/^\d{4}-\d\d-\d\d$/u.test(date || "") || model.opening_brief?.status !== "ready") throw new Error("QQ_SOURCE_INVALID");
    const papers = [...model.groups.must_read, ...model.groups.worth_knowing];
    lines.push(deriveDailyTitleCandidate(date, papers, model.opening_brief), date, "", model.opening_brief.intro, "");
    for (const sentence of model.opening_brief.must_read.slice(0, 3)) {
      const paper = model.groups.must_read.find(p => p.arxiv_id === sentence.arxiv_id && p.revision === sentence.revision);
      if (!paper) throw new Error("QQ_SOURCE_INVALID");
      const authors = paper.entry?.authors;
      const authorStr = Array.isArray(authors) && authors.length > 0 ? (authors.length > 2 ? `${authors[0]} 等` : authors.join(", ")) : "";
      const authorSuffix = authorStr ? ` (${authorStr})` : "";
      lines.push(`• 必读｜${extractPaperTopic(paper)}${authorSuffix}`, sentence.text, `原文：https://arxiv.org/abs/${paper.arxiv_id}v${paper.revision}`, "");
    }
    if (model.groups.worth_knowing.length && model.opening_brief.worth_knowing_summary) lines.push("其他关注", readingExcerpt(model.opening_brief.worth_knowing_summary), "");
  }
  const channelState = options.delivery?.channel?.[type]?.status;
  if (channelState && !["success", "skipped"].includes(channelState)) lines.push("频道部分内容待同步；以下网页导读已发布。", "");
  if (options.delivery?.notebooklm?.status && options.delivery.notebooklm.status !== "success") lines.push("NotebookLM 同步待恢复。", "");
  const route = type === "weekly" ? `arxiv-weekly/${weekly.week_id}` : `arxiv-daily/${date}`;
  lines.push("频道讨论", channelUrl, "", "完整导读 · 图表、推导与证据", `${websiteBase}/${route}/`);
  const text = lines.filter(line => line !== undefined).join("\n");
  if (Buffer.byteLength(text) > 12_000) throw new Error("QQ_NOTIFY_CONTENT_LIMIT");
  return options.withSourceIdentity ? { content: text, publicationHash } : text;
}

export async function notifyGroupPublication({ kinds, sourceBinding, delivery, cache = ".cache/notebooklm/qq-notifications", enabled = process.env.QQ_GROUP_NOTIFY_ENABLED === "true", groupOpenid = process.env.QQ_NOTIFY_GROUP_OPENID, brief = generateGroupBrief, send = sendProactiveGroupMessage } = {}) {
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => !["daily", "weekly"].includes(kind)) || new Set(kinds).size !== kinds.length) throw new Error("QQ_NOTIFY_KIND_INVALID");
  const targets = {}, outbox = {};
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const lock = resolve(cache, "notify.lock");
  await acquireRefreshLock(lock);
  try {
    let ledger;
    try {
      const bytes = await readFile(resolve(cache, "ledger.json"), "utf8");
      if (Buffer.byteLength(bytes) > 1_000_000) throw new Error("QQ_NOTIFY_LEDGER_INVALID");
      ledger = JSON.parse(bytes);
    }
    catch (error) { if (error.code === "ENOENT") ledger = { version: 1, items: {} }; else return { status: "blocked", code: "QQ_NOTIFY_LEDGER_INVALID", targets }; }
    if (ledger?.version !== 1 || !ledger.items || typeof ledger.items !== "object" || Array.isArray(ledger.items)) return { status: "blocked", code: "QQ_NOTIFY_LEDGER_INVALID", targets };
    const save = async () => { await writeJsonAtomically(resolve(cache, "ledger.json"), ledger); await chmod(resolve(cache, "ledger.json"), 0o600); };
    for (const kind of kinds) {
      let content, publicationHash;
      try {
        const prepared = await brief(kind, { sourceBinding, delivery, withSourceIdentity: true });
        content = typeof prepared === "string" ? prepared : prepared?.content;
        publicationHash = typeof prepared === "string" ? sourceBinding?.[kind]?.hash : prepared?.publicationHash;
      }
      catch (error) {
        const safe = new Set(["QQ_SOURCE_BUILD_REQUIRED", "QQ_SOURCE_BUILD_MISMATCH", "QQ_SOURCE_INVALID", "QQ_CHANNEL_LINK_REQUIRED", "QQ_NOTIFY_CONTENT_LIMIT"]);
        targets[kind] = { status: "blocked", code: safe.has(error.message) ? error.message : "QQ_NOTIFY_PREPARATION_FAILED" }; continue;
      }
      if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content) > 12_000) { targets[kind] = { status: "blocked", code: "QQ_NOTIFY_CONTENT_LIMIT" }; continue; }
      outbox[kind] = { content, hash: hashBody(content), prepared_at: new Date().toISOString() };
      if (!enabled) { targets[kind] = { status: "waiting_permission" }; continue; }
      if (typeof groupOpenid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(groupOpenid)) { targets[kind] = { status: "blocked", code: "QQ_GROUP_TARGET_REQUIRED" }; continue; }
      if (typeof publicationHash !== "string" || !/^[a-f0-9]{64}$/u.test(publicationHash)) { targets[kind] = { status: "blocked", code: "QQ_SOURCE_BUILD_REQUIRED" }; continue; }
      const groupHash = createHash("sha256").update(groupOpenid).digest("hex");
      // Delivery warnings can change on retry without creating a new publication.
      const key = `${kind}:${groupHash}:${publicationHash}`;
      const previous = ledger.items[key];
      if (previous?.status === "sent") { targets[kind] = { status: "unchanged" }; continue; }
      if (previous) { targets[kind] = { status: "blocked", code: "QQ_NOTIFY_UNKNOWN_OUTCOME" }; continue; }
      ledger.items[key] = { status: "intent", content_hash: outbox[kind].hash, created_at: new Date().toISOString() }; await save();
      try {
        const receipt = await send({ groupOpenid, content });
        if (!receipt?.id) throw new Error("QQ_NOTIFY_UNKNOWN_OUTCOME");
        ledger.items[key] = { status: "sent", content_hash: outbox[kind].hash, sent_at: new Date().toISOString() }; await save();
        targets[kind] = { status: "success" };
      } catch (error) {
        // A definite HTTP rejection did not commit a message; transport errors might have.
        if (/^发送主动群消息失败 HTTP (?:400|401|403|404|429):/u.test(error?.message || "")) {
          delete ledger.items[key]; await save();
          targets[kind] = { status: "blocked", code: "QQ_NOTIFY_REMOTE_REJECTED" };
        } else targets[kind] = { status: "blocked", code: "QQ_NOTIFY_UNKNOWN_OUTCOME" };
      }
    }
    await writeJsonAtomically(resolve(cache, "outbox.json"), outbox); await chmod(resolve(cache, "outbox.json"), 0o600);
    const allSuccess = kinds.every(kind => ["success", "unchanged"].includes(targets[kind]?.status));
    const anyBlocked = kinds.some(kind => targets[kind]?.status === "blocked");
    return { status: allSuccess ? "success" : anyBlocked ? "blocked" : "waiting_permission", targets };
  } finally { await releaseRefreshLock(lock); }
}

export async function alertAdmin(subject, details = "") {
  const adminOpenid = process.env.QQ_ADMIN_OPENID || defaultUserManager.getLatestUserOpenid();
  if (!adminOpenid) {
    console.error("[qq-send:alert] 未找到管理员 OpenID，跳过告警");
    return { success: false, reason: "no_admin_openid" };
  }
  const timestamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const content = [
    `⚠️ 【AstroLineage 运维告警】`,
    `时间：${timestamp}`,
    `主题：${subject}`,
    details ? `详情：${details}` : null,
    `请及时检查系统服务与日志。`,
  ].filter(Boolean).join("\n");

  console.log(`[qq-send:alert] 发送运维告警至管理员 (${adminOpenid}): ${subject}`);
  return await sendProactiveC2CMessage({ userOpenid: adminOpenid, content });
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

  if (args.includes("--list") || args.includes("-l")) {
  const users = defaultUserManager.getUsers();
  const groups = defaultUserManager.getGroups();
  const uEntries = Object.entries(users);
  const gEntries = Object.entries(groups);

  console.log(`[qq-send] 用户列表：共记录 ${uEntries.length} 个用户 OpenID`);
  for (const [id, u] of uEntries) {
    console.log(`  - UserOpenID: ${id}`);
    console.log(`    交互: ${u.interaction_count} 次 | 最近: ${new Date(u.last_seen).toLocaleString()}`);
    if (u.last_query) console.log(`    最后提问: ${u.last_query}`);
  }

  console.log(`\n[qq-send] 群聊列表：共记录 ${gEntries.length} 个群聊 GroupOpenID`);
  for (const [id, g] of gEntries) {
    console.log(`  - GroupOpenID: ${id}`);
    console.log(`    交互: ${g.interaction_count} 次 | 最近: ${new Date(g.last_seen).toLocaleString()}`);
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
    content = await generateGroupBrief(bType);
    targetGroup = defaultUserManager.getLatestGroupOpenid();
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
    console.log('  node scripts/qq-send.mjs --group "群消息内容"             # 发送到最近互动的群');
    console.log('  node scripts/qq-send.mjs --group <groupOpenid> "群消息"   # 发送到指定群');
    process.exit(1);
  }

  if (!targetGroup) {
    console.error("[qq-send] 错误: 本地尚未记录任何群聊 GroupOpenID。");
    console.error("请先在 QQ 群中 @机器人（例如发送 @astrolineage /id），系统将自动捕获并记录该群的 GroupOpenID。");
    process.exit(1);
  }

  console.log(`[qq-send] 目标群聊 GroupOpenID: ${targetGroup}`);
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
  content = args.filter((_, i) => i !== toIdx && i !== toIdx + 1).join(" ").trim();
} else {
  targetOpenid = defaultUserManager.getLatestUserOpenid();
  content = args.join(" ").trim();
}

if (!content) {
  console.log("私信消息用法:");
  console.log('  node scripts/qq-send.mjs "消息内容"                 # 发送私信给最近互动的用户');
  console.log('  node scripts/qq-send.mjs --to <userOpenid> "消息"   # 发送私信给指定用户');
  console.log('  node scripts/qq-send.mjs --group "群消息内容"       # 主动发送群聊消息');
  console.log("  node scripts/qq-send.mjs --list                     # 查看所有已记录的用户与群聊");
  process.exit(1);
}

if (!targetOpenid) {
  console.error("[qq-send] 错误: 本地尚未记录任何用户 OpenID。");
  console.error("请先在手机或电脑 QQ 上给官方机器人 astrolineage 发送任意私聊消息（例如发送 /id），系统将自动捕获并记录您的 OpenID。");
  process.exit(1);
}

console.log(`[qq-send] 目标用户 OpenID: ${targetOpenid}`);
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
