import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { cleanMessageContent, claimMessage, startOfficialBot, appendChannelShareLinkToReply } from "../scripts/qq-official-bot.mjs";
import { createSessionMemory, SESSION_TTL_MS } from "../scripts/qq-memory.mjs";
import { createUserManager } from "../scripts/qq-users.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAcademicKnowledge } from "../scripts/agent-core.mjs";

test("cleanMessageContent strips QQ bot mentions and whitespace", () => {
  assert.equal(cleanMessageContent("<@!12345678> 你好，喷流机制是什么？"), "你好，喷流机制是什么？");
  assert.equal(cleanMessageContent("@astrolineage 喷流破茧模型"), "喷流破茧模型");
  assert.equal(cleanMessageContent(""), "");
  assert.equal(cleanMessageContent(null), "");
});

test("outgoing bot replies that contain external links also include the configured QQ channel link", async () => {
  let lookups = 0;
  const response = await appendChannelShareLinkToReply(
    "这篇论文见 https://arxiv.org/abs/2609.00001",
    async () => { lookups++; return "https://pd.qq.com/s/astrolineage"; },
  );
  assert.equal(response, "这篇论文见 https://arxiv.org/abs/2609.00001\n\nAstroLineage QQ 频道：\nhttps://pd.qq.com/s/astrolineage");
  assert.equal(lookups, 1);
});

test("outgoing replies do not add duplicate or guessed channel links", async () => {
  let lookups = 0;
  const getChannelUrl = async () => { lookups++; return "https://pd.qq.com/s/astrolineage"; };
  const plain = "结论是该机制仍未被观测确认。";
  assert.equal(await appendChannelShareLinkToReply(plain, getChannelUrl), plain);
  assert.equal(lookups, 0);

  const alreadyLinked = "论文 https://arxiv.org/abs/2609.00001\nhttps://pd.qq.com/s/astrolineage";
  assert.equal(await appendChannelShareLinkToReply(alreadyLinked, getChannelUrl), alreadyLinked);
  assert.equal(lookups, 1);

  const unavailable = "论文 https://arxiv.org/abs/2609.00001";
  assert.equal(await appendChannelShareLinkToReply(unavailable, async () => null), unavailable);
});

test("loadAcademicKnowledge uses project directions and does not invent runtime state", async () => {
  const knowledge = await loadAcademicKnowledge();
  assert(knowledge.includes("须查询运行状态"));
  assert(knowledge.includes("R7. High-Energy X-ray"));
  assert(!knowledge.includes("R7: 千新星"));
  assert(knowledge.includes("AstroLineage"));
});

test("disk memory bounds history, survives restart and expires from last user message", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-memory-", t);
  let now = 1000;
  const memory = createSessionMemory(path, () => now);
  const key = `test_session_${Date.now()}`;
  for (let i = 1; i <= 12; i++) {
    memory.append(key, i % 2 === 1 ? "user" : "assistant", `msg_${i}`);
  }
  const restored = createSessionMemory(path, () => now);
  const history = restored.get(key);
  assert.equal(history.length, 10);
  assert.equal(history[0].content, "msg_3");
  assert.equal(history[history.length - 1].content, "msg_12");
  assert.deepEqual(restored.get("another-user"), []);
  const files = await readdir(path);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  assert.equal((await stat(join(path, files[0]))).mode & 0o777, 0o600);
  assert.equal((await stat(path)).mode & 0o777, 0o700);
  now += SESSION_TTL_MS - 1;
  restored.append(key, "assistant", "late reply does not renew TTL");
  assert.equal(restored.get(key).length, 10);
  now++;
  assert.deepEqual(restored.get(key), []);
  assert.deepEqual(await readdir(path), []);
  restored.append(key, "assistant", "cannot resurrect expired memory");
  assert.deepEqual(await readdir(path), []);
});

test("new user activity renews TTL; sweep removes idle files and corrupt records fail closed", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-memory-", t);
  let now = 0;
  const memory = createSessionMemory(path, () => now);
  memory.append("private:a", "user", "old");
  memory.append("group:a", "user", "other context");
  now = SESSION_TTL_MS - 1;
  memory.append("private:a", "user", "new");
  now = SESSION_TTL_MS;
  memory.sweep();
  assert.equal(memory.get("private:a").length, 2);
  assert.deepEqual(memory.get("group:a"), []);
  const [file] = await readdir(path);
  await writeFile(join(path, file), "invalid private content");
  assert.throws(() => memory.get("private:a"), /Invalid memory JSON/);
  assert.throws(() => memory.append("private:a", "user", "do not overwrite corruption"), /Invalid memory JSON/);
  assert.throws(() => memory.append("other", "user", "x".repeat(8193)), /Invalid memory message/);
});

test("bot --doctor CLI flag runs diagnostic checks cleanly", () => {
  const env = { ...process.env, QQ_APP_ID: "1234", QQ_APP_SECRET: "a".repeat(32) };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["scripts/qq-official-bot.mjs", "--doctor"], {
    encoding: "utf8",
    timeout: 30000,
    env,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /官方 QQ 机器人环境自检诊断 \(Doctor\)/u);
  assert.match(result.stdout, /未验证凭据、网关或模型连通性/u);
  assert.doesNotMatch(result.stdout, /AccessToken 申请成功|AI 模型响应正常/u);
});

test("replayed message IDs are suppressed within the bounded TTL", () => {
  assert.equal(claimMessage('test:duplicate', 1000), true);
  assert.equal(claimMessage('test:duplicate', 1001), false);
  assert.equal(claimMessage('test:duplicate', 1000 + 30 * 60_000), true);
  assert.equal(claimMessage(''), false);
});

test("native WebSocket adapter identifies and closes after a missed heartbeat ACK", async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    closed = false;
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.closed = true; this.readyState = 3; }
  }
  let answers = 0;
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-adapter-", t);
  const memory = createSessionMemory(path);
  const users = createUserManager({ filePath: join(path, "users.json"), root: path });
  const ws = await startOfficialBot({ memory, users, WebSocketImpl: Socket, gateway: async () => 'wss://example.com', authorize: async () => 'fake-test-token', answer: async () => { answers++; return 'fixture answer'; }, dryRun: true });
  const message = { op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'fixture-duplicate', content: 'test', author: { user_openid: 'fixture-user' } } };
  ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  await Promise.resolve();
  assert.equal(answers, 1);
  assert.equal(memory.get('c2c_fixture-user').at(-1).content, 'fixture answer');
  ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }) }));
  await Promise.resolve();
  assert.equal(ws.sent[0].op, 2);
  t.mock.timers.tick(1000);
  assert.equal(ws.sent[1].op, 1);
  ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ op: 11 }) }));
  t.mock.timers.tick(1000);
  assert.equal(ws.closed, false);
  t.mock.timers.tick(1000);
  assert.equal(ws.closed, true);
});

test("C2C message records userOpenid and responds to /whoami and /test-c2c", async (t) => {
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    closed = false;
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.closed = true; this.readyState = 3; }
  }
  const { path: memPath } = await createTemporaryWorkspace("astro-lineage-qq-mem-", t);
  const { path: usersPath } = await createTemporaryWorkspace("astro-lineage-qq-usr-", t);
  const memory = createSessionMemory(memPath);
  const users = createUserManager({ filePath: join(usersPath, "users.json"), root: usersPath });

  const ws = await startOfficialBot({
    memory,
    users,
    WebSocketImpl: Socket,
    gateway: async () => "wss://example.com",
    authorize: async () => "fake-test-token",
    answer: async () => "model reply",
    dryRun: true,
  });

  // 1. Regular message
  const msg1 = { op: 0, t: "C2C_MESSAGE_CREATE", d: { id: "msg-1", content: "普通学术提问", author: { user_openid: "user-alpha" } } };
  ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg1) }));
  await Promise.resolve();

  assert.equal(users.getLatestUserOpenid(), "user-alpha");
  const recorded = users.getUsers()["user-alpha"];
  assert.equal(recorded.interaction_count, 1);
  assert.equal(recorded.last_query, "普通学术提问");

  // 2. /start command
  const msg2 = { op: 0, t: "C2C_MESSAGE_CREATE", d: { id: "msg-2", content: "/start", author: { user_openid: "user-alpha" } } };
  ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg2) }));
  await Promise.resolve();

  assert.equal(users.getUsers()["user-alpha"].interaction_count, 2);
  const mem = memory.get("c2c_user-alpha");
  assert.match(mem.at(-1).content, /AstroLineage/);
  assert.doesNotMatch(mem.at(-1).content, /user-alpha/);

  // 3. /test-c2c command
  const msg3 = { op: 0, t: "C2C_MESSAGE_CREATE", d: { id: "msg-3", content: "/test-c2c", author: { user_openid: "user-beta" } } };
  ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg3) }));
  await Promise.resolve();

  assert.equal(users.getLatestUserOpenid(), "user-beta");
  assert.match(memory.get("c2c_user-beta").at(-1).content, /双向连通状态：正常/);
});

test("C2C academic replies append the channel link when the answer contains a paper link", async (t) => {
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    send() {}
    close() { this.readyState = 3; }
  }
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-link-reply-", t);
  const memory = createSessionMemory(path);
  const users = createUserManager({ filePath: join(path, "users.json"), root: path });
  const channelUrl = "https://pd.qq.com/s/astrolineage";
  const ws = await startOfficialBot({
    memory, users, WebSocketImpl: Socket, gateway: async () => "wss://example.com",
    authorize: async () => "fake-test-token", answer: async () => "论文：https://arxiv.org/abs/2609.00001",
    channelLink: async () => channelUrl, dryRun: true,
  });
  const message = { op: 0, t: "C2C_MESSAGE_CREATE", d: { id: "link-reply-1", content: "给我论文链接", author: { user_openid: "user-link" } } };
  ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
  await new Promise(resolve => setImmediate(resolve));
  const sentText = memory.get("c2c_user-link").at(-1).content;
  assert.match(sentText, /https:\/\/arxiv\.org\/abs\/2609\.00001/u);
  assert.match(sentText, /AstroLineage QQ 频道：\nhttps:\/\/pd\.qq\.com\/s\/astrolineage/u);
});

test("alertAdmin targets admin openid with structured alert content", async () => {
  const { alertAdmin } = await import("../scripts/qq-send.mjs");
  const origEnv = process.env.QQ_ADMIN_OPENID;
  process.env.QQ_ADMIN_OPENID = "TEST_ADMIN_ID";
  try {
    await assert.rejects(
      async () => await alertAdmin("测试告警主题", "测试告警详情内容"),
      (err) => err instanceof Error
    );
  } finally {
    if (origEnv !== undefined) process.env.QQ_ADMIN_OPENID = origEnv;
    else delete process.env.QQ_ADMIN_OPENID;
  }
});
