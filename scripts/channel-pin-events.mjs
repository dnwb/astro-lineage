#!/usr/bin/env node
/**
 * AstroLineage 腾讯频道热点事件置顶/公告管理 CLI
 *
 * 用途：
 * 一键将“瞬变源 Top 5”高能热点事件帖子置顶为频道全局公告帖，或取消置顶。
 * 遵循 STE 技术协议与安全守卫。
 */

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { pinFeed } from "./tencent-channel-publisher.mjs";
import { withPublicationLedger } from "./channel-publication.mjs";
import { TencentGuildAdapter } from "./intelligence-egress.mjs";

const DEFAULT_CACHE_ROOT = resolve(
  fileURLToPath(new URL("../.cache/channel-publication", import.meta.url))
);
const DEFAULT_GUILD_ID = process.env.TENCENT_GUILD_ID || "612912874093545504";
const runCli = TencentGuildAdapter.defaultCliRunner;

export async function manageHotEventPin({
  guildId = DEFAULT_GUILD_ID,
  cacheRoot = DEFAULT_CACHE_ROOT,
  unpin = false,
  dryRun = false,
  cli = runCli,
} = {}) {
  const action = unpin ? 2 : 1;
  const actionName = unpin ? "取消置顶" : "置顶";

  return await withPublicationLedger(cacheRoot, guildId, async (records, save) => {
    const item = records["events:top5"];
    if (!item || !item.feed_id || !item.create_time) {
      throw new Error(
        "CHANNEL_PIN_EVENTS_NOT_PUBLISHED: 账本中未找到已发布的 events:top5 帖子，请先运行发布管道。"
      );
    }

    const channelId = String(item.channel_id || "742956201");
    const feedId = String(item.feed_id);
    const createTime = String(item.create_time);

    let authorId = "144115221380239833";
    try {
      const detailRes = await cli([
        "feed",
        "get-feed-detail",
        "--guild-id",
        String(guildId),
        "--channel-id",
        channelId,
        "--feed-id",
        feedId,
        "--json",
      ]);
      const data = JSON.parse(detailRes.stdout || "{}");
      const feed = data.data?.feed || data.data || {};
      authorId = feed.author_id ?? feed.author?.user_id ?? authorId;
    } catch (err) {
      // 容错使用已记录的默认发帖人 ID
    }

    if (dryRun) {
      console.log(
        `[DRY-RUN] 拟执行${actionName}: feedId=${feedId}, channelId=${channelId}, userId=${authorId}, createTime=${createTime}, action=${action}`
      );
      return { success: true, dryRun: true, feedId, action, actionName };
    }

    console.log(`[channel-pin] 正在执行${actionName}帖子: ${feedId} (${createTime})...`);
    const res = await pinFeed({
      guildId,
      channelId,
      feedId,
      userId: authorId,
      createTime,
      action,
      topType: 1,
      cli,
      dryRun: false,
    });

    item.pinned = !unpin;
    item.pinned_at = new Date().toISOString();
    await save();

    console.log(`[channel-pin] ✓ 帖子${actionName}成功！(feed_id=${feedId})`);
    return { success: true, feedId, action, actionName, res };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { values } = parseArgs({
    options: {
      "guild-id": { type: "string", default: DEFAULT_GUILD_ID },
      "cache-root": { type: "string", default: DEFAULT_CACHE_ROOT },
      unpin: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  try {
    await manageHotEventPin({
      guildId: values["guild-id"],
      cacheRoot: values["cache-root"],
      unpin: values.unpin,
      dryRun: values["dry-run"],
    });
  } catch (err) {
    console.error(`[channel-pin Error] ${err.message}`);
    process.exit(1);
  }
}
