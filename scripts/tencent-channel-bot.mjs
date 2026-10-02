#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

import {
  normalizeModelName,
  SITE_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_EFFORT,
  loadAcademicKnowledge,
  callChatCompletion,
} from "./agent-core.mjs";

const DEFAULT_GUILD_ID = process.env.TENCENT_GUILD_ID || "612912874093545504";

const STATE_PATH = resolve(fileURLToPath(new URL("../src/data/tencent-bot-state.json", import.meta.url)));

async function runCli(args, { input = null, timeout = 30000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const stdio = [input ? "pipe" : "ignore", "pipe", "pipe"];
    const proc = spawn("tencent-channel-cli", args, { stdio });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`tencent-channel-cli timed out after ${timeout}ms`));
    }, timeout);

    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    }

    proc.stdout.on("data", (chunk) => { stdout += chunk; });
    proc.stderr.on("data", (chunk) => { stderr += chunk; });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`tencent-channel-cli exited with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

async function loadState() {
  try {
    if (existsSync(STATE_PATH)) {
      const data = JSON.parse(await readFile(STATE_PATH, "utf8"));
      return {
        replied_comments: new Set(data.replied_comments || []),
        replied_feeds: new Set(data.replied_feeds || []),
        replied_notices: new Set(data.replied_notices || []),
        last_check: data.last_check || null,
      };
    }
  } catch {}
  return {
    replied_comments: new Set(),
    replied_feeds: new Set(),
    replied_notices: new Set(),
    last_check: null,
  };
}

async function saveState(state) {
  const data = {
    replied_comments: Array.from(state.replied_comments),
    replied_feeds: Array.from(state.replied_feeds),
    replied_notices: Array.from(state.replied_notices),
    last_check: new Date().toISOString(),
  };
  await writeFile(STATE_PATH, JSON.stringify(data, null, 2), "utf8");
}


async function getBotUserInfo() {
  try {
    const res = await runCli(["manage", "get-user-info", "-j"]);
    const parsed = JSON.parse(res.stdout);
    return {
      id: "144115221380239833", // Default known bot tinyid
      nickname: parsed.data?.global_nickname || parsed.data?.nickname || "astrolineage",
    };
  } catch {
    return {
      id: "144115221380239833",
      nickname: "astrolineage",
    };
  }
}

export async function runAgentCycle({
  guildId = DEFAULT_GUILD_ID,
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  dryRun = false,
  verbose = false,
} = {}) {
  const state = await loadState();
  const botUser = await getBotUserInfo();
  const knowledge = await loadAcademicKnowledge();

  console.log(`[Agent Bot] 正在检查腾讯频道互动消息与评论 (频道: ${guildId}, 机器人: ${botUser.nickname}, 模型: ${model}, effort: ${effort})...`);

  // 1. 获取主页动态与各版块帖子
  let feeds = [];
  try {
    const feedsRes = await runCli(["feed", "get-guild-feeds", "--guild-id", String(guildId), "-j"]);
    const parsed = JSON.parse(feedsRes.stdout);
    feeds = parsed.data?.feeds || [];
  } catch (err) {
    console.warn(`[Agent Bot] 获取主页帖子列表失败: ${err.message}`);
  }

  let handledCount = 0;

  for (const feed of feeds) {
    const feedId = feed.feed_id;
    const feedAuthorId = feed.author_id;
    const feedCreateTime = feed.create_time_raw || String(Math.floor(Date.now() / 1000));
    const channelId = feed.channel_id || "742956201";

    // 检查是否有新评论
    if ((feed.comment_count || 0) > 0) {
      let comments = [];
      try {
        const commentsRes = await runCli([
          "feed", "get-feed-comments",
          "--feed-id", feedId,
          "--guild-id", String(guildId),
          "--reply-list-num", "10",
          "-j",
        ]);
        const parsed = JSON.parse(commentsRes.stdout);
        comments = parsed.data?.comments || [];
      } catch (err) {
        if (verbose) console.warn(`[Agent Bot] 获取帖子 ${feedId} 评论失败: ${err.message}`);
      }

      for (const comment of comments) {
        const commentId = comment.comment_id;
        const commentAuthorId = comment.author_id;
        const commentAuthorNick = comment.author || "学者";
        const commentContent = comment.content_text || comment.content?.text || "";

        // 跳过机器人自己的评论
        if (commentAuthorId === botUser.id) {
          continue;
        }

        // 判断是否需要回复：
        // 1. 评论中包含 @astrolineage 或 @机器人
        // 2. 或者该帖子本身是机器人发布的（每日导读/学术周报），读者在评论区提出问题或讨论
        const isMentioned = commentContent.includes(`@${botUser.nickname}`) ||
          commentContent.includes("@机器人") ||
          commentContent.includes("@[astrolineage]");
        const isFeedByBot = feedAuthorId === botUser.id;

        if ((isMentioned || isFeedByBot) && !state.replied_comments.has(commentId)) {
          console.log(`[Agent Bot] 发现待回复评论 [${commentAuthorNick}]: "${commentContent.slice(0, 50)}" (来自帖子: ${feed.title || feedId})`);

          const systemPrompt = `你是由前沿高能天体物理课题组打造的 AstroLineage 学术智能体（Research Agent）。
你正在与课题组同学或学术频道的学者在腾讯频道帖子下学术互动。
后台采用 ${model}（reasoning_effort=${effort}）思考架构，你需要给出严谨、深刻、兼具物理图像与学术前沿视角的回答。

${knowledge}

回答准则：
1. 学术严谨，直奔物理核心，符合高能天体物理科研人员学风。
2. 抓住核心动力学与多信使机制（如中心引擎注入、喷流相对论流体力学、激波破裂、辐射转移、光变曲线演化等）。
3. 视情况推荐 AstroLineage 校园网平台页面（如 [AstroLineage 每日雷达](${SITE_BASE_URL}/arxiv-daily/) 或 [前沿学术周报](${SITE_BASE_URL}/arxiv-weekly/)），方便读者深入研读。
4. 控制回答长度适中（约 200~400 字以内），适合在频道评论区快速阅读。
5. 不需要精准礼貌称呼或刻意寒暄（严禁前置“@[某某]”、“尊敬的学者”、“你好”等套话），直接以科研同行讨论方式切入物理本质展开回答。
`;

          const userPrompt = `帖子主题：${feed.title || "学术讨论"}
帖子摘要：${(feed.content_snippet || "").slice(0, 200)}
讨论者提问/评论内容：${commentContent}

请作为 AstroLineage 智能体，直接给出有物理深度且清晰的回复，无需客套称呼。`;

          try {
            console.log(`[Agent Bot] 正在调用 ${model} (effort=${effort}) 思考并生成学术解答...`);
            const answer = await callChatCompletion({
              prompt: userPrompt,
              systemPrompt,
              model,
              effort,
            });

            console.log(`[Agent Bot] 解答生成完毕: "${answer.slice(0, 60)}..."`);

            if (dryRun) {
              console.log(`[Agent Bot] [预演模式] 将发表回复到评论 ${commentId}:`, answer);
            } else {
              const replyRes = await runCli([
                "feed", "do-reply",
                "--feed-id", feedId,
                "--feed-author-id", feedAuthorId,
                "--feed-create-time", String(feedCreateTime),
                "--comment-id", commentId,
                "--comment-author-id", commentAuthorId,
                "--comment-create-time", String(comment.create_time_raw || Math.floor(Date.now() / 1000)),
                "--replier-id", botUser.id,
                "--target-user-id", commentAuthorId,
                "--target-user-nick", commentAuthorNick,
                "--guild-id", String(guildId),
                "--channel-id", String(channelId),
                "--content", answer,
                "--json",
              ]);
              console.log(`[Agent Bot] ✓ 回复成功:`, replyRes.stdout);
            }

            state.replied_comments.add(commentId);
            await saveState(state);
            handledCount++;
          } catch (replyErr) {
            console.error(`[Agent Bot] ✗ 回复评论失败: ${replyErr.message}`);
          }
        }
      }
    }

    // 如果是他人发表的独立主贴且 @ 了机器人
    if (feedAuthorId !== botUser.id && !state.replied_feeds.has(feedId)) {
      const feedTitle = feed.title || "";
      const feedSnippet = feed.content_snippet || "";
      const isMentioned = feedTitle.includes(`@${botUser.nickname}`) ||
        feedSnippet.includes(`@${botUser.nickname}`) ||
        feedSnippet.includes("@机器人");

      if (isMentioned) {
        console.log(`[Agent Bot] 发现 @ 机器人的独立主题帖 [${feed.author}]: "${feedTitle}"`);

        const systemPrompt = `你是 AstroLineage 高能天体物理学术智能体，正在腾讯频道为读者研读文献与探讨物理问题。采用 ${model}（reasoning_effort=${effort}）思考架构。
${knowledge}
请直接给出深刻、权威、有条理的物理机制解答，篇幅约 200~400 字。无需礼貌寒暄或客套称呼（严禁使用“@[某某]”、“尊敬的学者”等），直接切入核心学术问题展开分析。`;

        const userPrompt = `用户主题帖标题：${feedTitle}\n正文片段：${feedSnippet}\n请针对用户提出的问题进行深入解答，无需客套称呼。`;

        try {
          console.log(`[Agent Bot] 正在调用 ${model} (effort=${effort}) 生成主贴回复...`);
          const answer = await callChatCompletion({
            prompt: userPrompt,
            systemPrompt,
            model,
            effort,
          });

          if (dryRun) {
            console.log(`[Agent Bot] [预演模式] 将对主贴发表评论:`, answer);
          } else {
            const commentRes = await runCli([
              "feed", "do-comment",
              "--feed-id", feedId,
              "--feed-create-time", String(feedCreateTime),
              "--guild-id", String(guildId),
              "--channel-id", String(channelId),
              "--content", answer,
              "--json",
            ]);
            console.log(`[Agent Bot] ✓ 评论成功:`, commentRes.stdout);
          }

          state.replied_feeds.add(feedId);
          await saveState(state);
          handledCount++;
        } catch (postErr) {
          console.error(`[Agent Bot] ✗ 对主贴发表评论失败: ${postErr.message}`);
        }
      }
    }
  }

  // 2. 检查互动通知（get-notices）
  try {
    const noticesRes = await runCli(["feed", "get-notices", "--guild-id", String(guildId), "-j"]);
    const parsed = JSON.parse(noticesRes.stdout);
    const notices = parsed.data?.notices || parsed.data?.notice_list || [];
    if (Array.isArray(notices) && notices.length > 0) {
      console.log(`[Agent Bot] 扫描到 ${notices.length} 条互动通知。`);
      // 如果将来通知列表中包含未处理的 @ 或回复，可在此做精准补漏
    }
  } catch {}

  console.log(`[Agent Bot] 本轮检查完成，共处理并回复 ${handledCount} 条互动。`);
  return handledCount;
}

// CLI 执行入口
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const isOnce = args.includes("--once") || args.includes("-1");
  const dryRun = args.includes("--dry-run") || args.includes("-d");
  const verbose = args.includes("--verbose") || args.includes("-v");

  let model = DEFAULT_MODEL;
  let effort = DEFAULT_EFFORT;
  let intervalSeconds = 30;
  for (const arg of args) {
    if (arg.startsWith("--interval=")) {
      intervalSeconds = parseInt(arg.slice("--interval=".length), 10) || 30;
    } else if (arg.startsWith("--model=")) {
      model = normalizeModelName(arg.slice("--model=".length));
    } else if (arg.startsWith("--effort=")) {
      effort = arg.slice("--effort=".length);
    } else if (arg.startsWith("--reasoning-effort=")) {
      effort = arg.slice("--reasoning-effort=".length);
    }
  }

  if (isOnce) {
    await runAgentCycle({ model, effort, dryRun, verbose });
    process.exit(0);
  } else {
    console.log(`[Agent Bot] 启动守护进程模式 (模型: ${model}, effort: ${effort}, 轮询间隔: ${intervalSeconds}秒, 退出请按 Ctrl+C)...`);
    let running = true;

    const cleanup = () => {
      console.log(`\n[Agent Bot] 正在停止守护进程...`);
      running = false;
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    while (running) {
      try {
        await runAgentCycle({ model, effort, dryRun, verbose });
      } catch (err) {
        console.error(`[Agent Bot] 轮询周期发生异常:`, err.message);
      }
      if (running) {
        await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
      }
    }
  }
}
