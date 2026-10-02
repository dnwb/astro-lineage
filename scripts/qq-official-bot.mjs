#!/usr/bin/env node
/**
 * AstroLineage 官方 QQ 机器人接入适配器 (QQ Open Platform Official Bot)
 * 
 * 基于腾讯 QQ 开放平台官方 WebSocket Gateway 与 REST API，支持：
 * 1. QQ 频道公域 @ 消息 (AT_MESSAGE_CREATE)
 * 2. QQ 群聊 @ 消息 (GROUP_AT_MESSAGE_CREATE)
 * 3. QQ C2C 私聊消息 (C2C_MESSAGE_CREATE)
 * 
 * 对接 scripts/agent-core.mjs（模型问答 + 已发布导读状态 / 可见书目，不是全文 RAG）
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAcademicAnswer } from "./agent-core.mjs";
import { createSessionMemory } from "./qq-memory.mjs";
import { defaultUserManager } from "./qq-users.mjs";

// Node >=22.20 provides WebSocket; no undeclared ws package is needed.
async function request(url, options = {}) {
  return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20_000) });
}

// Bounded, process-local replay guard; restart durability is deliberately not claimed.
const seenMessages = new Map();
let activeReplies = 0;
export function claimMessage(id, now = Date.now()) {
  if (!id) return false;
  for (const [key, expires] of seenMessages) if (expires <= now) seenMessages.delete(key);
  if (seenMessages.has(id)) return false;
  if (seenMessages.size >= 2000) return false;
  seenMessages.set(id, now + 30 * 60_000);
  return true;
}

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

const APP_ID = process.env.QQ_APP_ID || "";
const BOT_TOKEN = process.env.QQ_BOT_TOKEN || "";
const APP_SECRET = process.env.QQ_APP_SECRET || "";
const IS_SANDBOX = process.env.QQ_BOT_SANDBOX === "true";

const API_BASE = IS_SANDBOX
  ? "https://sandbox.api.sgroup.qq.com"
  : "https://api.sgroup.qq.com";

// Intents 事件掩码
// PUBLIC_GUILD_MESSAGES = 1 << 30 (1073741824) - 频道公域
// GROUP_AND_C2C_EVENT   = 1 << 25 (33554432)   - QQ群及单聊
// DIRECT_MESSAGE        = 1 << 12 (4096)       - 频道私信
const INTENTS = (1 << 30) | (1 << 25) | (1 << 12);

let accessTokenCache = null;
let accessTokenExpiresAt = 0;

const sessionMemory = createSessionMemory(fileURLToPath(new URL("../.cache/qq-bot/memory/", import.meta.url)));

/**
 * 获取官方开放平台 Access Token (OAuth2 Client Credentials)
 */
async function getAppAccessToken() {
  if (!APP_ID || !APP_SECRET) {
    return null;
  }
  const now = Date.now();
  if (accessTokenCache && accessTokenExpiresAt > now + 60000) {
    return accessTokenCache;
  }

  try {
    const res = await request("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: APP_ID, clientSecret: APP_SECRET }),
    });

    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Token HTTP ${res.status}`);
    }

    const json = await res.json();
    if (!json.access_token) {
      throw new Error("未返回 access_token");
    }

    accessTokenCache = json.access_token;
    accessTokenExpiresAt = now + (Number(json.expires_in) || 7200) * 1000;
    console.log(`[QQ Official Bot] 成功获取/刷新官方 AccessToken (有效期至 ${new Date(accessTokenExpiresAt).toLocaleTimeString()})`);
    return accessTokenCache;
  } catch (err) {
    console.error(`[QQ Official Bot] 获取 AccessToken 失败: ${err.message}`);
    return null;
  }
}

/**
 * 组装官方 API 请求 Header
 */
async function getAuthHeader() {
  const token = await getAppAccessToken();
  if (token) {
    return `QQBot ${token}`;
  }
  if (APP_ID && BOT_TOKEN) {
    return `Bot ${APP_ID}.${BOT_TOKEN}`;
  }
  throw new Error("缺少 QQ 机器人配置 (需配置 QQ_APP_ID 与 QQ_APP_SECRET，或 QQ_BOT_TOKEN)");
}

/**
 * 查询官方网关 WebSocket 地址
 */
async function getGatewayUrl() {
  const auth = await getAuthHeader();
  const res = await request(`${API_BASE}/gateway`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`查询网关失败 HTTP ${res.status}`);
  }
  const json = await res.json();
  if (typeof json.url !== "string" || !json.url.startsWith("wss://")) throw new Error("Invalid secure gateway URL");
  return json.url;
}

/**
 * 清除消息中的 @机器人 占位符
 */
export function cleanMessageContent(rawText) {
  if (!rawText) return "";
  return rawText
    .replace(/<@!\d+>/g, "")
    .replace(/@\S+/g, "")
    .trim();
}

/**
 * 回复 QQ 群聊消息
 */
async function replyGroupMessage({ groupOpenid, msgId, content }) {
  const auth = await getAuthHeader();
  const url = `${API_BASE}/v2/groups/${groupOpenid}/messages`;
  const res = await request(url, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_type: 0,
      msg_id: msgId,
    }),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`回复群消息失败 HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * 回复 QQ 频道子频道消息
 */
async function replyChannelMessage({ channelId, msgId, content }) {
  const auth = await getAuthHeader();
  const url = `${API_BASE}/channels/${channelId}/messages`;
  const res = await request(url, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_id: msgId,
    }),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`回复频道消息失败 HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * 回复 C2C 私聊消息
 */
async function replyC2CMessage({ userOpenid, msgId, content }) {
  const auth = await getAuthHeader();
  const url = `${API_BASE}/v2/users/${userOpenid}/messages`;
  const res = await request(url, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_type: 0,
      msg_id: msgId,
    }),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`回复私聊失败 HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * 主动推送 C2C 私聊消息
 */
export async function sendProactiveC2CMessage({ userOpenid, content, msgSeq }) {
  const auth = await getAuthHeader();
  const url = `${API_BASE}/v2/users/${userOpenid}/messages`;
  const res = await request(url, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_type: 0,
      msg_seq: msgSeq || Math.floor(Date.now() / 1000),
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`发送主动私聊失败 HTTP ${res.status}: ${errText}`);
  }
  return await res.json();
}

/**
 * 主动推送 QQ 群聊消息
 */
export async function sendProactiveGroupMessage({ groupOpenid, content, msgSeq }) {
  const auth = await getAuthHeader();
  const url = `${API_BASE}/v2/groups/${groupOpenid}/messages`;
  const res = await request(url, {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_type: 0,
      msg_seq: msgSeq || Math.floor(Date.now() / 1000),
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`发送主动群消息失败 HTTP ${res.status}: ${errText}`);
  }
  return await res.json();
}

/**
 * 启动官方 QQ 机器人 Gateway 长连接
 */
export async function startOfficialBot({ dryRun = false, WebSocketImpl = WebSocket, gateway = getGatewayUrl, authorize = getAuthHeader, answer = generateAcademicAnswer, memory = sessionMemory, users = defaultUserManager } = {}) {
  if (!APP_ID && gateway === getGatewayUrl) {
    console.warn(`[QQ Official Bot] 警告: 未在环境变量检测到 QQ_APP_ID。`);
    console.warn(`[QQ Official Bot] 请在 .env 中设置 QQ_APP_ID、QQ_APP_SECRET 或 QQ_BOT_TOKEN。`);
    console.warn(`[QQ Official Bot] 申请途径: https://q.qq.com/ (QQ 开放平台 -> 应用管理 -> 机器人配置)`);
    throw new Error("QQ_APP_ID is not configured");
  }

  const gatewayUrl = await gateway();
  console.log(`[QQ Official Bot] 正在连接官方网关: ${gatewayUrl} (沙箱模式: ${IS_SANDBOX})...`);

  const ws = new WebSocketImpl(gatewayUrl);
  const sweepMemory = () => {
    try { memory.sweep(); } catch { console.warn("[QQ Official Bot] Memory cleanup failed; inspect local storage"); }
  };
  sweepMemory();
  const memoryTimer = setInterval(sweepMemory, 60 * 60_000);
  memoryTimer.unref();
  let heartbeatTimer = null;
  let heartbeatAcknowledged = true;
  let lastSeq = null;
  let sessionId = null;

  ws.addEventListener("open", () => {
    console.log(`[QQ Official Bot] WebSocket 连接已建立，等待 Hello 握手...`);
  });

  ws.addEventListener("message", async ({ data }) => {
    let handlingReply = false;
    try {
      const payload = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
      const { op, d, s, t } = payload;
      if (s !== undefined && s !== null) lastSeq = s;

      switch (op) {
        case 10: { // Hello
          const heartbeatInterval = d.heartbeat_interval || 45000;
          console.log(`[QQ Official Bot] 握手成功，心跳周期: ${heartbeatInterval}ms，正在发送 Identify 认证...`);

          // 启动心跳
          clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocketImpl.OPEN) {
              if (!heartbeatAcknowledged) { ws.close(); return; }
              heartbeatAcknowledged = false;
              ws.send(JSON.stringify({ op: 1, d: lastSeq }));
            }
          }, heartbeatInterval);

          // 发送 Identify 认证
          const auth = await authorize();
          ws.send(JSON.stringify({
            op: 2,
            d: {
              token: auth,
              intents: INTENTS,
              shard: [0, 1],
            },
          }));
          break;
        }

        case 11: { // Heartbeat ACK
          heartbeatAcknowledged = true;
          break;
        }

        case 7: // Reconnect
        case 9: // Invalid session: re-identify on a fresh connection.
          ws.close();
          break;

        case 0: { // Dispatch 业务事件
          if (["GROUP_AT_MESSAGE_CREATE", "AT_MESSAGE_CREATE", "C2C_MESSAGE_CREATE"].includes(t)) {
            if (activeReplies >= 4 || typeof d?.content !== "string" || d.content.length > 4096 || !d.id || !claimMessage(`${t}:${d.id}`)) break;
            activeReplies++;
            handlingReply = true;
          }
          console.log(`[QQ Official Bot] 收到 Dispatch 事件: ${t}`);
          if (t === "READY") {
            sessionId = d.session_id;
            console.log(`[QQ Official Bot] ✓ 机器人登录就绪！Bot名称: ${d.user?.username || "AstroBot"} (ID: ${d.user?.id}, Session: ${sessionId})`);
          } else if (t === "GROUP_AT_MESSAGE_CREATE") {
            const query = cleanMessageContent(d.content);
            const groupOpenid = d.group_openid;
            const authorId = d.author?.member_openid || d.author?.id;
            const sessionKey = `group_${groupOpenid}_${authorId}`;
            const msgId = d.id;
            console.log("[QQ Official Bot] 收到 QQ 群 @ 提问");

            if (groupOpenid) {
              try {
                users.recordGroup(groupOpenid, { last_query: query });
              } catch (recErr) {
                console.warn("[QQ Official Bot] 记录 groupOpenid 失败:", recErr.message);
              }
            }

            if (query && groupOpenid && authorId) {
              if (/^\/(start|help|id|groupid)$/i.test(query)) {
                try {
                  const replyText = `👋 大家好！我是 AstroLineage 高能天体物理学术助手。\n\n在群里 @ 我并附带论文题目、arXiv 编号或具体物理问题（例如：“@我 总结今天的必读论文”），我会结合每日雷达与学术脉络知识库为大家提供研讨解答！`;
                  if (!dryRun) {
                    await replyGroupMessage({ groupOpenid, msgId, content: replyText });
                    console.log(`[QQ Official Bot] ✓ 已回复群 /start 欢迎消息（已自动记录群 ID）`);
                  }
                  memory.append(sessionKey, "user", query);
                  memory.append(sessionKey, "assistant", replyText);
                } catch (err) {
                  console.error(`[QQ Official Bot] ✗ 回复群 /start 失败: ${err.message}`);
                }
                break;
              }

              try {
                const history = memory.get(sessionKey);
                memory.append(sessionKey, "user", query);
                const result = await answer({
                  query,
                  topic: "QQ群学术研讨",
                  history,
                });

                console.log("[QQ Official Bot] 正在派发群回复");
                if (!dryRun) {
                  await replyGroupMessage({ groupOpenid, msgId, content: result });
                  console.log(`[QQ Official Bot] ✓ 群回复成功`);
                }
                memory.append(sessionKey, "assistant", result);
              } catch (err) {
                console.error(`[QQ Official Bot] ✗ 群回复失败: ${err.message}`);
              }
            }
          } else if (t === "AT_MESSAGE_CREATE") {
            const query = cleanMessageContent(d.content);
            const channelId = d.channel_id;
            const authorId = d.author?.id;
            const sessionKey = `channel_${channelId}_${authorId}`;
            const msgId = d.id;
            console.log("[QQ Official Bot] 收到频道子频道 @ 提问");

            if (query && channelId && authorId) {
              try {
                const history = memory.get(sessionKey);
                memory.append(sessionKey, "user", query);
                const result = await answer({
                  query,
                  topic: "频道学术研讨",
                  history,
                });

                if (!dryRun) {
                  await replyChannelMessage({ channelId, msgId, content: result });
                  console.log(`[QQ Official Bot] ✓ 频道回复成功`);
                }
                memory.append(sessionKey, "assistant", result);
              } catch (err) {
                console.error(`[QQ Official Bot] ✗ 频道回复失败: ${err.message}`);
              }
            }
          } else if (t === "C2C_MESSAGE_CREATE") {
            const query = cleanMessageContent(d.content);
            const userOpenid = d.author?.user_openid;
            const sessionKey = `c2c_${userOpenid}`;
            const msgId = d.id;
            console.log("[QQ Official Bot] 收到私聊提问");

            if (userOpenid) {
              try {
                users.recordUser(userOpenid, { last_query: query });
              } catch (recErr) {
                console.warn("[QQ Official Bot] 记录 userOpenid 失败:", recErr.message);
              }
            }

            if (query && userOpenid) {
              if (/^\/(start|help|id|whoami|bind)$/i.test(query)) {
                try {
                  const replyText = `👋 你好！我是 AstroLineage 高能天体物理前沿文献助手。\n\n我可以为你提供：\n• 每日 arXiv 重点论文导读与前沿雷达（快速射电暴、相对论喷流、超新星及致密天体等）\n• 论文核心突破、物理机制与阅读抓手深度解读\n• 课题组研究主线（R1~R7）与学术脉络梳理\n\n💬 直接发送论文题目、arXiv 编号或物理问题（如“总结今天的必读论文”），即可开始研讨！`;
                  if (!dryRun) {
                    await replyC2CMessage({ userOpenid, msgId, content: replyText });
                    console.log(`[QQ Official Bot] ✓ 已回复 /start 欢迎消息（已自动记录 OpenID）`);
                  }
                  memory.append(sessionKey, "user", query);
                  memory.append(sessionKey, "assistant", replyText);
                } catch (err) {
                  console.error(`[QQ Official Bot] ✗ 回复 /start 失败: ${err.message}`);
                }
                break;
              }

              if (/^\/test-c2c$/i.test(query)) {
                try {
                  const replyText = `[AstroLineage 测试] 收到私聊测试请求！双向连通状态：正常。`;
                  if (!dryRun) {
                    await replyC2CMessage({ userOpenid, msgId, content: replyText });
                    console.log(`[QQ Official Bot] ✓ 已完成 /test-c2c 私聊应答`);
                  }
                  memory.append(sessionKey, "user", query);
                  memory.append(sessionKey, "assistant", replyText);
                } catch (err) {
                  console.error(`[QQ Official Bot] ✗ 回复 /test-c2c 失败: ${err.message}`);
                }
                break;
              }

              try {
                const history = memory.get(sessionKey);
                memory.append(sessionKey, "user", query);
                const result = await answer({
                  query,
                  topic: "私聊学术研讨",
                  history,
                });

                if (!dryRun) {
                  await replyC2CMessage({ userOpenid, msgId, content: result });
                  console.log(`[QQ Official Bot] ✓ 私聊回复成功`);
                }
                memory.append(sessionKey, "assistant", result);
              } catch (err) {
                console.error(`[QQ Official Bot] ✗ 私聊回复失败: ${err.message}`);
              }
            }
          }
          break;
        }

        default:
          break;
      }
    } catch (parseErr) {
      console.warn("[QQ Official Bot] 消息解析或处理异常（不输出原始内容）");
    } finally {
      if (handlingReply) activeReplies--;
    }
  });

  ws.addEventListener("close", ({ code }) => {
    clearInterval(heartbeatTimer);
    clearInterval(memoryTimer);
    console.warn(`[QQ Official Bot] 连接断开 (code: ${code})，将在 5 秒后重试...`);
    const reconnect = () => startOfficialBot({ dryRun, WebSocketImpl, gateway, authorize, answer, memory }).catch(() => {
      console.warn("[QQ Official Bot] 重连失败，30 秒后重试");
      setTimeout(reconnect, 30_000);
    });
    setTimeout(reconnect, 5000);
  });

  ws.addEventListener("error", () => {
    console.error("[QQ Official Bot] WebSocket 连接异常");
  });
  return ws;
}

/**
 * 诊断环境连通性、凭证合法性与数据完整性 (--doctor)
 */
export async function runDoctor({ live = false } = {}) {
  console.log("=== AstroLineage 官方 QQ 机器人环境自检诊断 (Doctor) ===\n");
  let passed = true;

  // 1. 检查环境变量
  console.log("[1/5] 检查环境变量配置...");
  if (!APP_ID) {
    console.error("  ✗ 缺少 QQ_APP_ID");
    passed = false;
  } else if (!/^\d+$/.test(APP_ID)) {
    console.warn(`  ! QQ_APP_ID 应为纯数字: 当前为 "${APP_ID}"`);
  } else {
    console.log(`  ✓ QQ_APP_ID: ${APP_ID}`);
  }

  if (!APP_SECRET) {
    console.error("  ✗ 缺少 QQ_APP_SECRET");
    passed = false;
  } else if (APP_SECRET.startsWith("bot:v1_")) {
    console.error("  ✗ QQ_APP_SECRET 格式异常: 包含了 bot:v1_ 前缀，应为后台纯 32 位 Secret");
    passed = false;
  } else if (APP_SECRET.length !== 32) {
    console.warn(`  ! QQ_APP_SECRET 长度通常为 32 位，当前为 ${APP_SECRET.length} 位`);
  } else {
    console.log(`  ✓ QQ_APP_SECRET 已配置 (长度: ${APP_SECRET.length})`);
  }
  console.log(`  ✓ 运行模式: ${IS_SANDBOX ? "沙箱环境 (sandbox.api.sgroup.qq.com)" : "正式生产环境 (api.sgroup.qq.com)"}`);

  if (!live) {
    console.log("离线配置检查完成；未验证凭据、网关或模型连通性。显式 --doctor --live 才会联网并调用模型。");
    return passed;
  }

  // 2. 检查 OAuth 凭证获取 AccessToken
  console.log("\n[2/5] 检查官方 OAuth AccessToken 申请...");
  let token = null;
  try {
    token = await getAppAccessToken();
    if (token) {
      console.log("  ✓ AccessToken 申请成功（不输出凭据）");
    } else {
      console.error("  ✗ AccessToken 申请失败: 返回空凭证");
      passed = false;
    }
  } catch (err) {
    console.error(`  ✗ AccessToken 申请异常: ${err.message}`);
    passed = false;
  }

  // 3. 检查网关 URL 获取
  console.log("\n[3/5] 检查官方 Gateway WebSocket 路由接口...");
  if (token) {
    try {
      const gwUrl = await getGatewayUrl();
      console.log(`  ✓ 网关路由解析成功: ${gwUrl}`);
    } catch (err) {
      console.error(`  ✗ 查询网关路由失败: ${err.message}`);
      passed = false;
    }
  } else {
    console.log("  - 跳过网关测试 (未获得 AccessToken)");
  }

  // 4. 检查 AI 研判/学术问答模型连通性
  console.log("\n[4/5] 检查 AI 学术大脑后端接口...");
  try {
    const testAns = await generateAcademicAnswer({
      query: "测试连通性",
      topic: "健康检测",
    });
    if (testAns) {
      console.log(`  ✓ AI 模型响应正常 (${testAns.slice(0, 40)}...)`);
    } else {
      console.error("  ✗ AI 模型返回空结果");
      passed = false;
    }
  } catch (err) {
    console.error(`  ✗ AI 模型调用异常: ${err.message}`);
    passed = false;
  }

  // 5. 检查本地知识库与文献数据完整性
  console.log("\n[5/5] 检查本地文献雷达与周报数据缓存...");
  const dailyPath = resolve(fileURLToPath(new URL("../src/data/arxiv-daily.json", import.meta.url)));
  const radarPath = resolve(fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url)));
  const weeklyPath = resolve(fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url)));

  for (const [name, p] of [["每日抓取 (arxiv-daily)", dailyPath], ["每日雷达 (daily-radar)", radarPath], ["学术周报 (arxiv-weekly)", weeklyPath]]) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(await readFile(p, "utf8"));
        console.log(`  ✓ ${name}: 正常 (条目数/标识: ${raw.entries?.length || raw.analyses?.length || raw.week_id || "有效"})`);
      } catch (e) {
        console.warn(`  ! ${name}: JSON 解析异常: ${e.message}`);
      }
    } else {
      console.warn(`  ! ${name}: 尚未生成或文件不存在 (${p})`);
    }
  }

  console.log("\n========================================================");
  if (passed) {
    console.log("✓ 诊断结果: 全部核心检查项通过，官方 QQ 机器人环境健康！");
    return true;
  } else {
    console.error("✗ 诊断结果: 发现异常项，请根据上述提示排查修正配置。");
    return false;
  }
}

// CLI 直接运行入口
if (process.argv[1] && process.argv[1].endsWith("qq-official-bot.mjs")) {
  if (process.argv.includes("--doctor") || process.argv.includes("-d")) {
    runDoctor({ live: process.argv.includes("--live") }).then((ok) => {
      process.exit(ok ? 0 : 1);
    }).catch((err) => {
      console.error(`Doctor 异常: ${err.message}`);
      process.exit(1);
    });
  } else if (process.argv.includes("--list-users")) {
    const users = defaultUserManager.getUsers();
    const entries = Object.entries(users);
    console.log(`[QQ Official Bot] 当前共记录 ${entries.length} 个用户 OpenID：`);
    for (const [id, u] of entries) {
      console.log(`- OpenID: ${id}`);
      console.log(`  交互次数: ${u.interaction_count} | 首次: ${new Date(u.first_seen).toLocaleString()} | 最近: ${new Date(u.last_seen).toLocaleString()}`);
      if (u.last_query) console.log(`  最后提问: ${u.last_query}`);
    }
  } else if (process.argv.includes("--send-c2c")) {
    const idx = process.argv.indexOf("--send-c2c");
    let targetOpenid = process.argv[idx + 1];
    let content = process.argv[idx + 2];
    if (!content && targetOpenid && !targetOpenid.startsWith("-")) {
      content = targetOpenid;
      targetOpenid = defaultUserManager.getLatestUserOpenid();
    }
    if (!targetOpenid) {
      console.error("[QQ Official Bot] 错误: 未指定 targetOpenid，且本地暂无已记录的 userOpenid。");
      process.exit(1);
    }
    if (!content) {
      console.error("[QQ Official Bot] 错误: 未提供发送内容。用法: --send-c2c [openid] <内容>");
      process.exit(1);
    }
    console.log(`[QQ Official Bot] 正在向 ${targetOpenid} 发送私聊消息...`);
    sendProactiveC2CMessage({ userOpenid: targetOpenid, content })
      .then((res) => {
        console.log(`✓ 发送成功:`, res);
      })
      .catch((err) => {
        console.error(`✗ 发送失败: ${err.message}`);
        process.exit(1);
      });
  } else {
    const dryRun = process.argv.includes("--dry-run");
    startOfficialBot({ dryRun }).catch((err) => {
      console.error(`[QQ Official Bot] 启动异常: ${err.message}`);
      process.exitCode = 1;
    });
  }
}
