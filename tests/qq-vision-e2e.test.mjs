import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  startOfficialBot,
  DEFAULT_ACADEMIC_VISION_PROMPT,
  runDoctor,
} from "../scripts/qq-official-bot.mjs";
import { generateAcademicAnswer } from "../scripts/agent-core.mjs";
import { createSessionMemory } from "../scripts/qq-memory.mjs";
import { createUserManager } from "../scripts/qq-users.mjs";
import { VisionConcurrencySemaphore } from "../scripts/qq-media.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, "base64");

class MockWebSocket extends EventTarget {
  static OPEN = 1;
  readyState = 1;
  sent = [];
  closed = false;

  send(data) {
    this.sent.push(typeof data === "string" ? JSON.parse(data) : data);
  }

  close() {
    this.readyState = 3;
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
}

async function waitForCondition(predicate, { timeout = 5000, interval = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await predicate()) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  await predicate();
}

const fastAcademicAnswer = (args) =>
  generateAcademicAnswer({
    ...args,
    knowledgeLoader: async () => "学术知识库：前沿文献与导读正常。",
  });

const hasCredentials = Boolean(
  process.env.QQ_APP_ID &&
  process.env.QQ_APP_SECRET &&
  (process.env.OPENAI_API_KEY || process.env.IOA_API_KEY || process.env.WU_API_KEY)
);

if (!hasCredentials) {
  test("QQ vision E2E and Doctor tests (skipped: local private credentials not configured)", (t) => {
    t.skip("Skipped: QQ_APP_ID, QQ_APP_SECRET, or LLM API keys are not configured in environment");
  });
} else {
  test("E2E: C2C image question flow (ingress -> CDN fetch -> multimodal completion -> formatted channel reply -> memory marker)", async (t) => {
    const { path: memPath } = await createTemporaryWorkspace("astro-lineage-e2e-c2c-mem-", t);
    const { path: usrPath } = await createTemporaryWorkspace("astro-lineage-e2e-c2c-usr-", t);
    const memory = createSessionMemory(memPath);
    const users = createUserManager({ filePath: join(usrPath, "users.json"), root: usrPath });

    const cdnFetches = [];
    const llmCalls = [];
    const outgoingReplies = [];

    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);

      // 1. QQ CDN download
      if (urlStr.includes("c2cpicdw.qpic.cn")) {
        cdnFetches.push({ url: urlStr, options });
        return new Response(TINY_PNG_BUFFER, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }

      // 2. OpenAI-compatible completions
      if (urlStr.includes("/chat/completions")) {
        const body = JSON.parse(options.body || "{}");
        llmCalls.push({ url: urlStr, body });
        return new Response(
          JSON.stringify({
            id: "chatcmpl-e2e-c2c",
            choices: [
              {
                message: {
                  role: "assistant",
                  content:
                    "根据该能谱图分析：峰值位于软 X 射线能段，符合激波冷却辐射特征。详见 https://arxiv.org/abs/2609.12345",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 3. QQ Open Platform token & reply endpoints
      if (urlStr.includes("getAppAccessToken")) {
        return new Response(JSON.stringify({ access_token: "mock-e2e-token", expires_in: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/v2/users/")) {
        const body = JSON.parse(options.body || "{}");
        outgoingReplies.push({ url: urlStr, body });
        return new Response(JSON.stringify({ id: "qq-c2c-msg-ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected unhandled fetch URL in E2E test: ${urlStr}`);
    };

    const ws = await startOfficialBot({
      memory,
      users,
      WebSocketImpl: MockWebSocket,
      gateway: async () => "wss://e2e.gateway.qq.com",
      authorize: async () => "mock-e2e-token",
      channelLink: async () => "https://pd.qq.com/s/e2e-channel-c2c",
      answer: fastAcademicAnswer,
      visionSemaphore: new VisionConcurrencySemaphore(2),
      dryRun: false,
    });

    const c2cEvent = {
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "e2e-msg-c2c-001",
        content: "请解读这张能谱图的峰值特征",
        attachments: [{ url: "https://c2cpicdw.qpic.cn/offpic_new/0/e2e-spectrum.png" }],
        author: { user_openid: "user-e2e-c2c-1" },
      },
    };

    ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(c2cEvent) }));

    // Wait for reply and memory persistence
    await waitForCondition(() => memory.get("c2c_user-e2e-c2c-1")?.length >= 2);

    // Assertions:
    // 1. CDN was fetched
    assert.equal(cdnFetches.length, 1);
    assert.equal(cdnFetches[0].url, "https://c2cpicdw.qpic.cn/offpic_new/0/e2e-spectrum.png");

    // 2. Multimodal LLM was invoked with image payload
    assert.equal(llmCalls.length, 1);
    const userMsg = llmCalls[0].body.messages.find((m) => m.role === "user");
    assert.ok(Array.isArray(userMsg.content));
    assert.equal(userMsg.content[0].type, "text");
    assert.match(userMsg.content[0].text, /请解读这张能谱图的峰值特征/);
    assert.equal(userMsg.content[1].type, "image_url");
    assert.match(userMsg.content[1].image_url.url, /^data:image\/png;base64,/);

    // 3. Outgoing reply was sent to QQ C2C API
    assert.ok(outgoingReplies.length >= 1);
    const lastReply = outgoingReplies.at(-1);
    assert.equal(lastReply.body.msg_id, "e2e-msg-c2c-001");
    const replyContent = lastReply.body.markdown?.content || lastReply.body.content;
    assert.match(replyContent, /软 X 射线能段/);
    assert.match(
      replyContent,
      /AstroLineage QQ 频道：\s*https:\/\/pd\.qq\.com\/s\/e2e-channel-c2c/
    );

    // 4. Memory written to disk contains sanitized text marker, NOT base64
    const history = memory.get("c2c_user-e2e-c2c-1");
    assert.equal(history.length, 2);
    assert.equal(history[0].content, "[用户发送了图片进行研读: 请解读这张能谱图的峰值特征]");
    assert.doesNotMatch(history[0].content, /data:image|base64/);

    const files = await readdir(memPath);
    const rawDiskJson = await readFile(join(memPath, files[0]), "utf8");
    assert.doesNotMatch(rawDiskJson, new RegExp(TINY_PNG_BASE64));
  });

  test("E2E: Pure image message without text injects default academic prompt in QQ group", async (t) => {
    const { path: memPath } = await createTemporaryWorkspace("astro-lineage-e2e-grp-mem-", t);
    const { path: usrPath } = await createTemporaryWorkspace("astro-lineage-e2e-grp-usr-", t);
    const memory = createSessionMemory(memPath);
    const users = createUserManager({ filePath: join(usrPath, "users.json"), root: usrPath });

    const llmCalls = [];
    const outgoingReplies = [];

    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("multimedia.qpic.cn")) {
        return new Response(TINY_PNG_BUFFER, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      if (urlStr.includes("/chat/completions")) {
        const body = JSON.parse(options.body || "{}");
        llmCalls.push(body);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content:
                    "群学术解析：图示为相对论喷流激波辐射模拟演化。详见 https://arxiv.org/abs/2609.67890",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("getAppAccessToken")) {
        return new Response(JSON.stringify({ access_token: "mock-e2e-token", expires_in: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/v2/groups/")) {
        const body = JSON.parse(options.body || "{}");
        outgoingReplies.push({ url: urlStr, body });
        return new Response(JSON.stringify({ id: "qq-grp-msg-ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected unhandled fetch URL: ${urlStr}`);
    };

    const ws = await startOfficialBot({
      memory,
      users,
      WebSocketImpl: MockWebSocket,
      gateway: async () => "wss://e2e.gateway.qq.com",
      authorize: async () => "mock-e2e-token",
      channelLink: async () => "https://pd.qq.com/s/e2e-channel-grp",
      answer: fastAcademicAnswer,
      visionSemaphore: new VisionConcurrencySemaphore(2),
      dryRun: false,
    });

    const pureImageGrpEvent = {
      op: 0,
      t: "GROUP_AT_MESSAGE_CREATE",
      d: {
        id: "e2e-grp-001",
        content: "", // Pure image: no text prompt
        group_openid: "GROUP_E2E_001",
        author: { member_openid: "member-e2e-001" },
        attachments: [{ url: "https://multimedia.qpic.cn/group_pic1.png" }],
      },
    };

    ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(pureImageGrpEvent) }));

    await waitForCondition(() => memory.get("group_GROUP_E2E_001_member-e2e-001")?.length >= 2);

    assert.equal(llmCalls.length, 1);
    const userContent = llmCalls[0].messages.find((m) => m.role === "user").content;
    assert.match(userContent[0].text, new RegExp(DEFAULT_ACADEMIC_VISION_PROMPT));

    assert.ok(outgoingReplies.length >= 1);
    assert.equal(outgoingReplies.at(-1).body.msg_id, "e2e-grp-001");
    const text =
      outgoingReplies.at(-1).body.markdown?.content || outgoingReplies.at(-1).body.content;
    assert.match(text, /喷流激波辐射模拟/);

    const mem = memory.get("group_GROUP_E2E_001_member-e2e-001");
    assert.equal(mem[0].content, `[用户发送了图片进行研读: ${DEFAULT_ACADEMIC_VISION_PROMPT}]`);
  });

  test("E2E: Guild Channel AT_MESSAGE_CREATE caps image extraction at 2 attachments", async (t) => {
    const { path: memPath } = await createTemporaryWorkspace("astro-lineage-e2e-ch-mem-", t);
    const { path: usrPath } = await createTemporaryWorkspace("astro-lineage-e2e-ch-usr-", t);
    const memory = createSessionMemory(memPath);
    const users = createUserManager({ filePath: join(usrPath, "users.json"), root: usrPath });

    const cdnFetches = [];
    let llmImagesCount = 0;
    const outgoingReplies = [];

    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("multimedia.qpic.cn")) {
        cdnFetches.push(urlStr);
        return new Response(TINY_PNG_BUFFER, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      if (urlStr.includes("/chat/completions")) {
        const body = JSON.parse(options.body || "{}");
        const userContent = body.messages.find((m) => m.role === "user").content;
        llmImagesCount = userContent.filter((c) => c.type === "image_url").length;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "频道多图学术研讨回复：对比分析完毕。",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("getAppAccessToken")) {
        return new Response(JSON.stringify({ access_token: "mock-e2e-token", expires_in: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/channels/")) {
        const body = JSON.parse(options.body || "{}");
        outgoingReplies.push({ url: urlStr, body });
        return new Response(JSON.stringify({ id: "qq-ch-msg-ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected unhandled fetch URL: ${urlStr}`);
    };

    const ws = await startOfficialBot({
      memory,
      users,
      WebSocketImpl: MockWebSocket,
      gateway: async () => "wss://e2e.gateway.qq.com",
      authorize: async () => "mock-e2e-token",
      answer: fastAcademicAnswer,
      visionSemaphore: new VisionConcurrencySemaphore(2),
      dryRun: false,
    });

    const channelEvent = {
      op: 0,
      t: "AT_MESSAGE_CREATE",
      d: {
        id: "e2e-ch-001",
        content: "<@!bot> 对比这两张喷流磁流体分布图",
        channel_id: "CH_TEST_999",
        author: { id: "author-e2e-999" },
        attachments: [
          { url: "https://multimedia.qpic.cn/img_a.png" },
          { url: "https://multimedia.qpic.cn/img_b.png" },
          { url: "https://multimedia.qpic.cn/img_c.png" }, // 3rd must be ignored
        ],
      },
    };

    ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(channelEvent) }));

    await waitForCondition(() => memory.get("channel_CH_TEST_999_author-e2e-999")?.length >= 2);

    // Exactly 2 images fetched and sent to LLM
    assert.equal(cdnFetches.length, 2);
    assert.equal(llmImagesCount, 2);

    assert.ok(outgoingReplies.length >= 1);
    assert.equal(outgoingReplies.at(-1).body.msg_id, "e2e-ch-001");
    assert.match(outgoingReplies.at(-1).body.content, /对比分析完毕/);
  });

  test("Boundary: CDN download failure (HTTP 404 / 403 / abort) notifies user gracefully without crashing bot", async (t) => {
    const { path: memPath } = await createTemporaryWorkspace("astro-lineage-e2e-err-mem-", t);
    const { path: usrPath } = await createTemporaryWorkspace("astro-lineage-e2e-err-usr-", t);
    const memory = createSessionMemory(memPath);
    const users = createUserManager({ filePath: join(usrPath, "users.json"), root: usrPath });

    const outgoingReplies = [];
    let llmCalled = false;

    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("c2cpicdw.qpic.cn/fail_404.png")) {
        return new Response("Not Found", { status: 404 });
      }
      if (urlStr.includes("/chat/completions")) {
        llmCalled = true;
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      }
      if (urlStr.includes("getAppAccessToken")) {
        return new Response(JSON.stringify({ access_token: "mock-e2e-token", expires_in: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/v2/users/")) {
        const body = JSON.parse(options.body || "{}");
        outgoingReplies.push({ url: urlStr, body });
        return new Response(JSON.stringify({ id: "qq-err-reply-ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected unhandled fetch URL: ${urlStr}`);
    };

    const ws = await startOfficialBot({
      memory,
      users,
      WebSocketImpl: MockWebSocket,
      gateway: async () => "wss://e2e.gateway.qq.com",
      authorize: async () => "mock-e2e-token",
      visionSemaphore: new VisionConcurrencySemaphore(2),
      dryRun: false,
    });

    const failEvent = {
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "e2e-err-001",
        content: "分析此图",
        attachments: [{ url: "https://c2cpicdw.qpic.cn/fail_404.png" }],
        author: { user_openid: "user-err-1" },
      },
    };

    ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(failEvent) }));

    await waitForCondition(() => outgoingReplies.length >= 1);

    assert.equal(llmCalled, false, "LLM must not be called when media fetch fails");
    const replyContent =
      outgoingReplies[0].body.content || outgoingReplies[0].body.markdown?.content;
    assert.match(replyContent, /图片分析失败.*404/);

    // Bot connection remains completely alive
    assert.equal(ws.closed, false);
  });

  test("Boundary: Unsupported non-image MIME type is rejected gracefully", async (t) => {
    const { path: memPath } = await createTemporaryWorkspace("astro-lineage-e2e-mime-mem-", t);
    const { path: usrPath } = await createTemporaryWorkspace("astro-lineage-e2e-mime-usr-", t);
    const memory = createSessionMemory(memPath);
    const users = createUserManager({ filePath: join(usrPath, "users.json"), root: usrPath });

    const outgoingReplies = [];
    let llmCalled = false;

    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("c2cpicdw.qpic.cn/document.pdf")) {
        return new Response("%PDF-1.4 binary data", {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      }
      if (urlStr.includes("/chat/completions")) {
        llmCalled = true;
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      }
      if (urlStr.includes("getAppAccessToken")) {
        return new Response(JSON.stringify({ access_token: "mock-e2e-token", expires_in: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/v2/users/")) {
        const body = JSON.parse(options.body || "{}");
        outgoingReplies.push({ url: urlStr, body });
        return new Response(JSON.stringify({ id: "qq-mime-reply-ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected unhandled fetch URL: ${urlStr}`);
    };

    const ws = await startOfficialBot({
      memory,
      users,
      WebSocketImpl: MockWebSocket,
      gateway: async () => "wss://e2e.gateway.qq.com",
      authorize: async () => "mock-e2e-token",
      visionSemaphore: new VisionConcurrencySemaphore(2),
      dryRun: false,
    });

    const pdfEvent = {
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "e2e-mime-001",
        content: "请阅读此附件",
        attachments: [{ url: "https://c2cpicdw.qpic.cn/document.pdf" }],
        author: { user_openid: "user-mime-1" },
      },
    };

    ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(pdfEvent) }));

    await waitForCondition(() => outgoingReplies.length >= 1);

    assert.equal(llmCalled, false);
    const reply = outgoingReplies[0].body.content || outgoingReplies[0].body.markdown?.content;
    assert.match(reply, /图片分析失败.*application\/pdf/);
    assert.equal(ws.closed, false);
  });

  test("Boundary: Unapproved domain attachment (SSRF mitigation) is blocked before outbound HTTP request", async (t) => {
    const { path: memPath } = await createTemporaryWorkspace("astro-lineage-e2e-ssrf-mem-", t);
    const { path: usrPath } = await createTemporaryWorkspace("astro-lineage-e2e-ssrf-usr-", t);
    const memory = createSessionMemory(memPath);
    const users = createUserManager({ filePath: join(usrPath, "users.json"), root: usrPath });

    const outgoingReplies = [];
    const contactedUrls = [];

    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      contactedUrls.push(urlStr);
      if (urlStr.includes("getAppAccessToken")) {
        return new Response(JSON.stringify({ access_token: "mock-e2e-token", expires_in: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/v2/users/")) {
        const body = JSON.parse(options.body || "{}");
        outgoingReplies.push({ url: urlStr, body });
        return new Response(JSON.stringify({ id: "qq-ssrf-reply-ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const ws = await startOfficialBot({
      memory,
      users,
      WebSocketImpl: MockWebSocket,
      gateway: async () => "wss://e2e.gateway.qq.com",
      authorize: async () => "mock-e2e-token",
      visionSemaphore: new VisionConcurrencySemaphore(2),
      dryRun: false,
    });

    const ssrfEvent = {
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "e2e-ssrf-001",
        content: "帮看内部图片",
        attachments: [{ url: "https://169.254.169.254/latest/meta-data/credentials.png" }],
        author: { user_openid: "user-ssrf-1" },
      },
    };

    ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(ssrfEvent) }));

    await waitForCondition(() => outgoingReplies.length >= 1);

    // SSRF guard blocks fetch before contacting 169.254.169.254
    assert.equal(
      contactedUrls.some((u) => u.includes("169.254")),
      false
    );
    const reply = outgoingReplies[0].body.content || outgoingReplies[0].body.markdown?.content;
    assert.match(reply, /图片域名未在白名单内，无法获取分析/);
    assert.equal(ws.closed, false);
  });

  test("Concurrency regression: Exceeding vision concurrency semaphore fast-fails with congestion notice and keeps gateway alive", async (t) => {
    const { path: memPath } = await createTemporaryWorkspace("astro-lineage-e2e-cg-mem-", t);
    const { path: usrPath } = await createTemporaryWorkspace("astro-lineage-e2e-cg-usr-", t);
    const memory = createSessionMemory(memPath);
    const users = createUserManager({ filePath: join(usrPath, "users.json"), root: usrPath });

    const zeroCapacitySemaphore = new VisionConcurrencySemaphore(0);
    const outgoingReplies = [];

    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("getAppAccessToken")) {
        return new Response(JSON.stringify({ access_token: "mock-e2e-token", expires_in: 7200 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/v2/users/")) {
        const body = JSON.parse(options.body || "{}");
        outgoingReplies.push({ url: urlStr, body });
        return new Response(JSON.stringify({ id: "qq-cg-reply-ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch URL: ${urlStr}`);
    };

    const ws = await startOfficialBot({
      memory,
      users,
      WebSocketImpl: MockWebSocket,
      gateway: async () => "wss://e2e.gateway.qq.com",
      authorize: async () => "mock-e2e-token",
      visionSemaphore: zeroCapacitySemaphore,
      dryRun: false,
    });

    const congestEvent = {
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "e2e-congest-001",
        content: "分析此图",
        attachments: [{ url: "https://c2cpicdw.qpic.cn/pic.jpg" }],
        author: { user_openid: "user-cg-1" },
      },
    };

    ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(congestEvent) }));

    await waitForCondition(() => outgoingReplies.length >= 1);

    const reply = outgoingReplies[0].body.content || outgoingReplies[0].body.markdown?.content;
    assert.match(reply, /视觉分析通道繁忙，请稍后重试。/);

    // Critical: Gateway WebSocket must stay open!
    assert.equal(ws.closed, false);
    assert.equal(ws.readyState, MockWebSocket.OPEN);
  });

  test("Doctor CLI health check: runDoctor({ live: true }) verifies multimodal model inference", async (t) => {
    const originalFetch = globalThis.fetch;
    t.after(() => {
      globalThis.fetch = originalFetch;
    });

    let visionInferenceCalled = false;
    let textInferenceCalled = false;

    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("getAppAccessToken")) {
        return new Response(
          JSON.stringify({ access_token: "mock-doctor-token", expires_in: 7200 }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (urlStr.includes("/gateway")) {
        return new Response(JSON.stringify({ url: "wss://doctor.gateway.qq.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/chat/completions")) {
        const body = JSON.parse(options.body || "{}");
        const userContent = body.messages.find((m) => m.role === "user").content;
        if (Array.isArray(userContent) && userContent.some((c) => c.type === "image_url")) {
          visionInferenceCalled = true;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "多模态视觉连通健康诊断正常",
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        } else {
          textInferenceCalled = true;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "文本模型学术连通健康诊断正常",
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
      }
      throw new Error(`Unexpected doctor fetch: ${urlStr}`);
    };

    const ok = await runDoctor({
      live: true,
      knowledgeLoader: async () => "学术知识库：前沿文献与导读正常。",
    });
    assert.equal(ok, true);
    assert.equal(textInferenceCalled, true);
    assert.equal(visionInferenceCalled, true);
  });
}
