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
import { defaultUserManager } from "./qq-users.mjs";
import { sendProactiveC2CMessage, sendProactiveGroupMessage } from "./qq-official-bot.mjs";
import { readPublishedArxivEdition } from "./arxiv-daily.mjs";
import { buildDailyRadarModel } from "./daily-radar.mjs";

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

export async function generateGroupBrief(type = "daily") {
  if (type === "weekly") {
    const weekly = JSON.parse(readFileSync("src/data/arxiv-weekly.json", "utf8"));
    const topPicks = weekly.top_picks || [];
    const lines = [
      `📢 【AstroLineage 每周学术脉络简报】`,
      `周期：${weekly.week_id} (${weekly.date_range})`,
      `本周收录已研判论文：${weekly.statistics?.total_analyzed ?? 0} 篇（精读 ${weekly.statistics?.must_read_count ?? 0} 篇，关注 ${weekly.statistics?.worth_knowing_count ?? 0} 篇）`,
      ``,
      `🎯 本周重点精选工作：`,
    ];
    for (const p of topPicks.slice(0, 5)) {
      lines.push(`• [${p.priority === "must_read" ? "必读" : "关注"}] arXiv:${p.arxiv_id}`);
      lines.push(`  ${p.title}`);
      if (p.core_insight) lines.push(`  突破：${p.core_insight}`);
    }
    lines.push(``);
    lines.push(`📖 完整结构化周报与全景矩阵：`);
    lines.push(`http://10.131.43.83:4321/arxiv-weekly/${weekly.week_id}/`);
    return lines.join("\n");
  } else {
    let feed, radar;
    try {
      const published = await readPublishedArxivEdition();
      feed = published?.feed;
      radar = published?.radar;
    } catch {}
    feed ||= JSON.parse(readFileSync("src/data/arxiv-daily.json", "utf8"));
    radar ||= JSON.parse(readFileSync("src/data/daily-radar.json", "utf8"));
    const model = buildDailyRadarModel(feed, radar);
    const date = radar.edition?.window?.announcement_date || feed.window?.announcement_date || new Date().toISOString().slice(0, 10);
    const mr = model.groups.must_read;
    const wk = model.groups.worth_knowing;
    const skip = model.groups.skip;
    const total = (feed.entries || []).length;
    const feedMap = new Map((feed.entries || []).map((e) => [e.arxiv_id, e]));

    const lines = [
      `📅 【AstroLineage 每日学术导读简报】`,
      `批次：${date} (${total} 篇候选)`,
      `研判分布：必读 ${mr.length} 篇 | 重点追踪 ${wk.length} 篇 | 快速浏览 ${skip.length} 篇`,
      ``,
    ];

    if (mr.length > 0) {
      lines.push(`🔥 必读论文推荐：`);
      for (const a of mr.slice(0, 4)) {
        const entry = feedMap.get(a.arxiv_id);
        const guide = a.analysis?.analysis || a.analysis || {};
        lines.push(`• arXiv:${a.arxiv_id} - ${entry?.title || ""}`);
        if (guide.result) lines.push(`  结论：${guide.result.slice(0, 85)}...`);
      }
      lines.push(``);
    }

    if (wk.length > 0 && mr.length < 3) {
      lines.push(`💡 重点追踪：`);
      for (const a of wk.slice(0, 3)) {
        const entry = feedMap.get(a.arxiv_id);
        const guide = a.analysis?.analysis || a.analysis || {};
        lines.push(`• arXiv:${a.arxiv_id} - ${entry?.title || ""}`);
        if (guide.result) lines.push(`  要点：${guide.result.slice(0, 75)}...`);
      }
      lines.push(``);
    }

    lines.push(`🌐 校园网完整导读与科学证据：`);
    lines.push(`http://10.131.43.83:4321/arxiv-daily/${date}/`);
    return lines.join("\n");
  }
}

export async function alertAdmin(subject, details = "") {
  const adminOpenid = process.env.QQ_ADMIN_OPENID || defaultUserManager.getLatestUserOpenid() || "4D18DE64E4A033C91FEFB68DC98BF5D7";
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
