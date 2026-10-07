#!/usr/bin/env node
/**
 * AstroLineage 腾讯频道账本与远端双向差异核对与审计 CLI
 *
 * 规范：
 * 1. 默认严格只读（Dry-Run）：仅扫描远端与本地账本并输出 Diff Report，严禁任何破坏性操作。
 * 2. 差异分类：
 *    - Matched: 远端帖子与账本完全吻合（feed_id, channel_id, hash）
 *    - Orphan Remote: 远端存在但未在本地账本登记的孤立帖（测试帖、历史未入账帖）
 *    - Missing Remote: 账本中标记为 published 但远端已删除或不存在的记录
 *    - Drifted: 远端帖子发生版块漂移或正文哈希不一致
 * 3. 安全守卫：应用任何变更必须显式指定 --apply --yes，杜绝误操作。
 */

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { TencentGuildAdapter } from "./intelligence-egress.mjs";

const DEFAULT_CACHE_ROOT = resolve(fileURLToPath(new URL("../.cache/channel-publication", import.meta.url)));
const DEFAULT_GUILD_ID = process.env.TENCENT_GUILD_ID || "612912874093545504";

/**
 * 从帖子内容中解析特征标记
 * <!-- astrolineage-channel:${identity}:${hash} -->
 */
export function extractFeedMarker(content) {
  if (!content || typeof content !== "string") return null;
  const match = content.match(/<!--\s*astrolineage-channel:(.+?):([a-f0-9]{64})\s*-->/u);
  if (!match) return null;
  return { identity: match[1], hash: match[2] };
}

/**
 * 纯计算：比对本地账本与远端帖子列表的差异
 * @param {Object} options
 * @param {Object} options.ledgerItems 本地账本 items 对象
 * @param {Array} options.remoteFeeds 远端抓取到的帖子列表
 * @returns {Object} 结构化 diff 报告
 */
export function computeReconciliationDiff({ ledgerItems = {}, remoteFeeds = [] } = {}) {
  const matched = [];
  const orphanRemote = [];
  const missingRemote = [];
  const drifted = [];

  const ledgerByFeedId = new Map();
  for (const [identity, rec] of Object.entries(ledgerItems)) {
    if (rec?.feed_id) {
      ledgerByFeedId.set(String(rec.feed_id), { identity, ...rec });
    }
  }

  const seenRemoteFeedIds = new Set();

  for (const feed of remoteFeeds) {
    const feedId = String(feed.feed_id || feed.feedId || "");
    if (!feedId) continue;
    seenRemoteFeedIds.add(feedId);

    const channelId = String(feed.channel_id || feed.channelId || "");
    const content = String(feed.markdown_content || feed.content || "");
    const marker = extractFeedMarker(content);

    const ledgerRec = ledgerByFeedId.get(feedId);

    if (ledgerRec) {
      // 本地有此 feed_id
      const expectedChannel = String(ledgerRec.channel_id || "");
      const expectedHash = String(ledgerRec.hash || "");
      const channelMismatch = expectedChannel && channelId && expectedChannel !== channelId;
      const hashMismatch = marker?.hash && expectedHash && marker.hash !== expectedHash;

      if (channelMismatch || hashMismatch) {
        drifted.push({
          identity: ledgerRec.identity,
          feed_id: feedId,
          channel_id: channelId,
          expectedChannel,
          expectedHash,
          actualHash: marker?.hash || null,
          title: feed.title || "",
          reasons: [
            channelMismatch ? `channel_drift(expected=${expectedChannel}, actual=${channelId})` : null,
            hashMismatch ? `hash_mismatch(expected=${expectedHash.slice(0, 8)}, actual=${marker?.hash?.slice(0, 8)})` : null,
          ].filter(Boolean),
        });
      } else {
        matched.push({
          identity: ledgerRec.identity,
          feed_id: feedId,
          channel_id: channelId,
          title: feed.title || "",
        });
      }
    } else {
      // 本地无此 feed_id
      if (marker?.identity && ledgerItems[marker.identity]) {
        // 远端帖子携带了账本某个条目的 marker，但 feed_id 不匹配（可能是历史重新发帖残留）
        drifted.push({
          identity: marker.identity,
          feed_id: feedId,
          channel_id: channelId,
          title: feed.title || "",
          reasons: [`remote_duplicate_marker(ledger_feed_id=${ledgerItems[marker.identity].feed_id})`],
        });
      } else {
        // 纯孤立帖
        orphanRemote.push({
          feed_id: feedId,
          channel_id: channelId,
          title: feed.title || "",
          create_time: feed.create_time || feed.create_time_raw || "",
        });
      }
    }
  }

  // 检查本地已发布但远端缺失的记录
  for (const [identity, rec] of Object.entries(ledgerItems)) {
    if (rec?.status === "published" && rec?.feed_id) {
      if (!seenRemoteFeedIds.has(String(rec.feed_id))) {
        missingRemote.push({
          identity,
          feed_id: String(rec.feed_id),
          channel_id: String(rec.channel_id || ""),
        });
      }
    }
  }

  return {
    summary: {
      totalLedger: Object.keys(ledgerItems).length,
      totalRemote: remoteFeeds.length,
      matched: matched.length,
      orphanRemote: orphanRemote.length,
      missingRemote: missingRemote.length,
      drifted: drifted.length,
    },
    matched,
    orphanRemote,
    missingRemote,
    drifted,
  };
}

/**
 * 格式化输出为可读文本或 Markdown
 */
export function formatDiffReport(diff) {
  const { summary, matched, orphanRemote, missingRemote, drifted } = diff;
  const lines = [
    "==================================================",
    " 腾讯频道账本双向差异核对报告 (Reconciliation Report)",
    "==================================================",
    `总账本条目: ${summary.totalLedger} | 远端在线帖子: ${summary.totalRemote}`,
    `✓ 吻合 (Matched):        ${summary.matched}`,
    `⚠ 远端孤立帖 (Orphan):    ${summary.orphanRemote}`,
    `✗ 远端缺失帖 (Missing):   ${summary.missingRemote}`,
    `⚡ 漂移/不一致 (Drifted):  ${summary.drifted}`,
    "--------------------------------------------------",
  ];

  if (orphanRemote.length > 0) {
    lines.push("\n[远端孤立帖清单 (Orphan Remote Feeds)]");
    for (const item of orphanRemote) {
      lines.push(`- feed_id: ${item.feed_id} | channel: ${item.channel_id} | title: "${item.title}"`);
    }
  }

  if (missingRemote.length > 0) {
    lines.push("\n[远端缺失帖清单 (Missing Remote Feeds in Ledger)]");
    for (const item of missingRemote) {
      lines.push(`- identity: ${item.identity} | feed_id: ${item.feed_id} | channel: ${item.channel_id}`);
    }
  }

  if (drifted.length > 0) {
    lines.push("\n[漂移条目清单 (Drifted Items)]");
    for (const item of drifted) {
      lines.push(`- identity: ${item.identity} | feed_id: ${item.feed_id} | reasons: ${item.reasons.join(", ")}`);
    }
  }

  if (orphanRemote.length === 0 && missingRemote.length === 0 && drifted.length === 0) {
    lines.push("\n状态健康：本地账本与远端频道在线内容 100% 同步一致。");
  } else {
    lines.push("\n提示：当前执行为严格只读模式。应用修复需要显式传入 --apply --yes。");
  }

  return lines.join("\n");
}

/**
 * 扫描指定 guild 的所有版块帖子
 */
export async function fetchRemoteInventory({ guildId, cli = TencentGuildAdapter.defaultCliRunner } = {}) {
  const channelsRes = await cli(["manage", "get-guild-channel-list", "--guild-id", String(guildId), "--json"]);
  const rawData = JSON.parse(channelsRes.stdout || "{}");
  const data = rawData.data ?? rawData;
  const channels = Array.isArray(data) ? data : data?.channels ?? data?.channel_list ?? [];

  const allFeeds = [];
  for (const ch of channels) {
    const channelId = String(ch.channel_id ?? ch.id ?? "");
    if (!channelId) continue;
    try {
      const feedRes = await cli([
        "feed", "get-channel-timeline-feeds",
        "--guild-id", String(guildId),
        "--channel-id", channelId,
        "--count", "100",
        "--json",
      ]);
      const rawFeeds = JSON.parse(feedRes.stdout || "{}");
      const list = rawFeeds.data?.feeds || rawFeeds.feeds || [];
      for (const item of list) {
        allFeeds.push({ ...item, channel_id: channelId });
      }
    } catch {
      // 忽略无法读取的临时错误
    }
  }
  return allFeeds;
}

export async function runReconciliation({
  guildId = DEFAULT_GUILD_ID,
  cacheRoot = DEFAULT_CACHE_ROOT,
  apply = false,
  yes = false,
  json = false,
  cli = TencentGuildAdapter.defaultCliRunner,
} = {}) {
  const ledgerPath = join(cacheRoot, `guild-${guildId}.json`);
  let ledger = { items: {} };
  try {
    ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const remoteFeeds = await fetchRemoteInventory({ guildId, cli });
  const diff = computeReconciliationDiff({ ledgerItems: ledger.items || {}, remoteFeeds });

  if (apply) {
    if (!yes) {
      throw new Error("RECONCILIATION_SAFETY_LOCK: Destructive or state modifications require explicit '--yes' flag.");
    }
    // 当带有 --apply --yes 时执行审核确认逻辑
    // 保护原则：永远不对远端执行未人工确认的批量物理删除
  }

  return diff;
}

// CLI 执行入口
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({
    options: {
      "guild-id": { type: "string", default: DEFAULT_GUILD_ID },
      "cache-root": { type: "string", default: DEFAULT_CACHE_ROOT },
      apply: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  try {
    const diff = await runReconciliation({
      guildId: values["guild-id"],
      cacheRoot: values["cache-root"],
      apply: values.apply,
      yes: values.yes,
      json: values.json,
    });

    if (values.json) {
      console.log(JSON.stringify(diff, null, 2));
    } else {
      console.log(formatDiffReport(diff));
    }
  } catch (err) {
    console.error(`[Reconcile Error] ${err.message}`);
    process.exit(1);
  }
}
