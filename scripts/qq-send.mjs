#!/usr/bin/env node
/**
 * AstroLineage QQ Bot 私信与群聊通知主动发送 CLI
 *
 * 用法:
 *   node scripts/qq-send.mjs "测试通知内容"                    # 自动发送私信给最近交互的用户 OpenID
 *   node scripts/qq-send.mjs --to <userOpenid> "测试内容"       # 发送私信给指定 OpenID
 *   node scripts/qq-send.mjs --group "群消息内容"              # 自动发送到最近交互的群聊 GroupOpenID
 *   node scripts/qq-send.mjs --group <groupOpenid> "内容"      # 发送到指定群聊
 *   node scripts/qq-send.mjs --list                            # 列出所有已记录的用户与群聊 OpenID
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defaultUserManager, maskOpenid } from "./qq-users.mjs";
import { sendProactiveC2CMessage } from "./qq-official-bot.mjs";
import {
  generateGroupBrief,
  renderSinglePaperCardMarkdown,
  generateSinglePaperCard,
  notifyGroupPublication,
  resolveGroupTargets,
  dispatchGroupProactiveSend,
  alertAdmin,
} from "./notification-egress.mjs";

export {
  generateGroupBrief,
  renderSinglePaperCardMarkdown,
  generateSinglePaperCard,
  notifyGroupPublication,
  resolveGroupTargets,
  dispatchGroupProactiveSend,
  alertAdmin,
};

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

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
    let specifiedGroup = null;
    let content = null;

    if (args.includes("--brief")) {
      const bIdx = args.indexOf("--brief");
      const bType = args[bIdx + 1] === "weekly" ? "weekly" : "daily";
      const dateArg = args.includes("--date") ? args[args.indexOf("--date") + 1] : undefined;
      const weekArg = args.includes("--week") ? args[args.indexOf("--week") + 1] : undefined;
      const isText = args.includes("--text");
      content = await generateGroupBrief(bType, {
        date: dateArg,
        week: weekArg,
        markdown: !isText,
      });
      const nextArg = args[gIdx + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        specifiedGroup = nextArg;
      }
    } else {
      const remaining = args.filter(
        (_, i) => i !== gIdx && !["--broadcast", "--force"].includes(args[i])
      );
      if (remaining.length === 1) {
        content = remaining[0];
      } else if (remaining.length >= 2) {
        specifiedGroup = remaining[0];
        content = remaining.slice(1).join(" ");
      }
    }

    if (!content) {
      console.log("群发消息用法:");
      console.log(
        '  node scripts/qq-send.mjs --group "群消息内容"             # 手动测试（自动定向至测试群）'
      );
      console.log(
        '  node scripts/qq-send.mjs --group --broadcast "群消息内容"   # 自动化广播（发送至所有已订阅群）'
      );
      console.log('  node scripts/qq-send.mjs --group <groupOpenid> "群消息"   # 发送到指定群');
      process.exit(1);
    }

    let targetResolution;
    try {
      targetResolution = resolveGroupTargets({
        args,
        specifiedGroup,
      });
    } catch (err) {
      console.error(`[qq-send] ✗ ${err.message}`);
      process.exit(1);
    }

    const { isBroadcast, targets, guarded, forced } = targetResolution;

    if (!targets || targets.length === 0) {
      console.error("[qq-send] 错误: 本地尚未记录任何群聊 GroupOpenID。");
      console.error(
        "请先在 QQ 群中 @机器人（例如发送 @astrolineage /id），系统将自动捕获并记录该群的 GroupOpenID。"
      );
      process.exit(1);
    }

    if (guarded) {
      console.log(
        `[qq-send] 🛡️ 调试测试保护已激活：自动定向至测试群 [${maskOpenid(targets[0])}]（正式全量广播请带 --broadcast）`
      );
    } else if (forced) {
      console.log(
        `[qq-send] ⚠️ 注意：已使用 --force 绕过测试群保护，正向指定群 [${maskOpenid(targets[0])}] 发送`
      );
    } else if (isBroadcast) {
      console.log(`[qq-send] 📢 正式广播模式激活：将向全部 ${targets.length} 个订阅群发送消息`);
    }

    console.log(
      `[qq-send] 群发内容预览: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`
    );

    const outcomes = await dispatchGroupProactiveSend({ targets, content });

    for (const item of outcomes.success) {
      console.log(
        `[qq-send] ✓ 群 [${maskOpenid(item.groupOpenid)}] 发送成功 (消息ID: ${item.receipt?.id || "ok"})`
      );
    }
    for (const item of outcomes.failed) {
      console.error(`[qq-send] ✗ 群 [${maskOpenid(item.groupOpenid)}] 发送失败: ${item.error}`);
    }

    if (outcomes.success.length === 0 && outcomes.failed.length > 0) {
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
