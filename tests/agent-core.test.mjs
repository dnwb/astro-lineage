import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { readFile } from "node:fs/promises";
import {
  defaultGatewayCircuitBreaker,
  defaultModelHealthRegistry,
  loadAcademicKnowledge,
  executeChatCompletion,
  callChatCompletion,
  buildModelCandidates,
  generateAcademicAnswer,
  isMultimodalModel,
} from "../scripts/agent-core.mjs";
import { readChannelShareUrl } from "../scripts/channel-publication.mjs";

beforeEach(() => {
  defaultGatewayCircuitBreaker.reset();
  defaultModelHealthRegistry.reset();
});

test("shared channel address rejects unrelated hosts, credentials and non-HTTPS links", async () => {
  assert.equal(
    await readChannelShareUrl({ url: "https://pd.qq.com/s/test-channel" }),
    "https://pd.qq.com/s/test-channel"
  );
  for (const url of [
    "https://example.com/s/test-channel",
    "http://pd.qq.com/s/test-channel",
    "https://secret@pd.qq.com/s/test-channel",
    "https://pd.qq.com:8443/s/test-channel",
  ]) {
    assert.equal(await readChannelShareUrl({ url }), null);
  }
});

test("channel link requests return the configured address without calling a model", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "model guessed answer" } }] })
    );
  });
  for (const query of ["频道链接发我一下", "我们的 QQ 频道在哪里？", "/channel"]) {
    const answer = await generateAcademicAnswer({
      query,
      channelLink: async () => "https://pd.qq.com/s/test-channel",
    });
    assert.ok(answer.includes("https://pd.qq.com/s/test-channel"));
  }
  assert.equal(calls, 0);
});

test("site address queries return public and local links without calling a model", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "model guessed answer" } }] })
    );
  });
  for (const query of ["公网地址是什么", "网站地址是多少？", "/site", "网页在哪看", "网址"]) {
    const answer = await generateAcademicAnswer({
      query,
      channelLink: async () => "https://pd.qq.com/s/test-channel",
    });
    assert.ok(answer.includes("astro-lineage.pages.dev"), `Query failed: ${query}`);
    assert.ok(answer.includes("10.131.43.83:4321"), `Query missing local: ${query}`);
  }
  assert.equal(calls, 0);
});

test("missing channel address is reported without guessing or contacting a model", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call provider");
  });
  const answer = await generateAcademicAnswer({
    query: "给我频道链接",
    channelLink: async () => null,
  });
  assert.match(answer, /频道链接.*未配置/u);
  assert.doesNotMatch(answer, /https?:\/\//u);
});

test("academic context includes the same configured channel link", async () => {
  const knowledge = await loadAcademicKnowledge({
    feed: { entries: [] },
    radar: { analyses: [] },
    channelLink: async () => "https://pd.qq.com/s/test-channel",
  });
  assert.ok(knowledge.includes("频道讨论：https://pd.qq.com/s/test-channel"));
});

test("missing or invalid guides remain pending, not a negative scientific judgement", async () => {
  const knowledge = await loadAcademicKnowledge({
    feed: {
      entries: [{ arxiv_id: "2609.00001", revision: 1 }],
      window: { announcement_date: "2026-09-27" },
    },
    radar: { analyses: [{ arxiv_id: "2609.00001", revision: 1, priority: "must_read" }] },
  });
  assert.equal(knowledge.includes("待导读 1"), true);
  assert.equal(knowledge.includes("严格研判"), false);
  assert.equal(knowledge.includes("R7: 千新星"), false);
});

test("model secrets never go to HTTP, redirects or unbounded requests", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
  });
  const opts = { prompt: "test", systemPrompt: "test", model: "test", apiKey: "fake-test-key" };
  await assert.rejects(executeChatCompletion({ ...opts, baseUrl: "http://example.com/v1" }));
  assert.equal(calls, 0);
  assert.equal(await executeChatCompletion({ ...opts, baseUrl: "https://example.com/v1" }), "ok");
});

test("source has no embedded model credential", async () => {
  const source = await readFile(new URL("../scripts/agent-core.mjs", import.meta.url), "utf8");
  assert.equal(/sk-[a-zA-Z0-9]{20,}/u.test(source), false, "remove literal credentials");
});

test("oversized model requests and responses are rejected without exposing provider text", async (t) => {
  const options = {
    prompt: "test",
    systemPrompt: "test",
    model: "test",
    apiKey: "fake-test-key",
    baseUrl: "https://example.com/v1",
  };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("x".repeat(256 * 1024 + 1));
  });
  await assert.rejects(
    executeChatCompletion({ ...options, prompt: "x".repeat(128 * 1024) }),
    /request exceeds/
  );
  assert.equal(calls, 0);
  await assert.rejects(executeChatCompletion(options), /response exceeds/);
});

test("buildModelCandidates orders primary model first and incorporates fallbacks without duplicates", () => {
  const candidates = buildModelCandidates("6.1-sol", ["6-sol", "6-luna", "gpt-5.5", "gpt-6.1-sol"]);
  assert.deepEqual(candidates, ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.5"]);
});

test("callChatCompletion falls back from failing primary model to next available candidate", async (t) => {
  const attemptedModels = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    attemptedModels.push(body.model);
    if (body.model === "gpt-6.1-sol") {
      return new Response(JSON.stringify({ error: { message: "model_price_not_configured" } }), {
        status: 503,
      });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "fallback success answer" } }] }),
      { status: 200 }
    );
  });

  const res = await callChatCompletion({
    prompt: "test prompt",
    systemPrompt: "test system",
    model: "gpt-6.1-sol",
    fallbackModels: ["gpt-6-sol", "gpt-6-luna"],
    baseUrl: "https://example.com/v1",
    apiKey: "fake-test-key",
  });

  assert.equal(res, "fallback success answer");
  assert.deepEqual(attemptedModels, ["gpt-6.1-sol", "gpt-6-sol"]);
});

test("callChatCompletion fails closed when all candidates fail", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    return new Response(JSON.stringify({ error: { message: "service unavailable" } }), {
      status: 503,
    });
  });

  await assert.rejects(
    callChatCompletion({
      prompt: "test prompt",
      systemPrompt: "test system",
      model: "gpt-6.1-sol",
      fallbackModels: ["gpt-6-sol"],
      baseUrl: "https://example.com/v1",
      apiKey: "fake-test-key",
    }),
    /所有模型及降级候选均不可用/
  );
});

test("callChatCompletion prioritizes model across multiple providers before falling back to next model", async (t) => {
  const attempts = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    attempts.push({ host: new URL(url).host, model: body.model });
    // Provider 1 fails for gpt-6.1-sol, but Provider 2 succeeds for gpt-6.1-sol
    if (new URL(url).host === "provider1.test") {
      return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "provider 2 success" } }] }),
      { status: 200 }
    );
  });

  const res = await callChatCompletion({
    prompt: "test prompt",
    systemPrompt: "test system",
    model: "gpt-6.1-sol",
    fallbackModels: ["gpt-6-sol", "gpt-6-luna"],
    providers: [
      { name: "P1", baseUrl: "https://provider1.test/v1", apiKey: "k1" },
      { name: "P2", baseUrl: "https://provider2.test/v1", apiKey: "k2" },
    ],
  });

  assert.equal(res, "provider 2 success");
  // Must try gpt-6.1-sol on P1, then gpt-6.1-sol on P2 without falling back to gpt-6-sol
  const modelsTried = attempts.map((a) => a.model);
  assert.deepEqual(modelsTried, ["gpt-6.1-sol", "gpt-6.1-sol"]);
  assert.equal(attempts[0].host, "provider1.test");
  assert.equal(attempts[1].host, "provider2.test");
});

test("isMultimodalModel accurately identifies multimodal vs pure-text models", () => {
  assert.equal(isMultimodalModel("gpt-6.1-sol"), true);
  assert.equal(isMultimodalModel("6-sol"), true);
  assert.equal(isMultimodalModel("gpt-6-astra"), true);
  assert.equal(isMultimodalModel("gemini-3.8-flash-high"), true);
  assert.equal(isMultimodalModel("gemini-3.5-flash"), true);
  assert.equal(isMultimodalModel("claude-opus-4-6-thinking"), true);
  assert.equal(isMultimodalModel("claude-sonnet-4-6"), true);
  assert.equal(isMultimodalModel("openai/gpt-6-sol"), true);
  assert.equal(isMultimodalModel("gpt-5.5"), false);
  assert.equal(isMultimodalModel("deepseek-r1"), false);
  assert.equal(isMultimodalModel("qwen-max"), false);
  assert.equal(isMultimodalModel("llama-3"), false);
  assert.equal(isMultimodalModel(""), false);
  assert.equal(isMultimodalModel(null), false);
});

test("executeChatCompletion constructs OpenAI-compatible multimodal content array when images are present", async (t) => {
  let capturedBody = null;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "vision response" } }] }));
  });

  const testImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const res = await executeChatCompletion({
    prompt: "Describe the transient light curve",
    systemPrompt: "You are an astrophysics research assistant",
    images: [testImage],
    model: "gpt-6.1-sol",
    baseUrl: "https://example.com/v1",
    apiKey: "fake-test-key",
  });

  assert.equal(res, "vision response");
  assert.ok(capturedBody);
  const userMsg = capturedBody.messages.find((m) => m.role === "user");
  assert.ok(
    Array.isArray(userMsg.content),
    "User message content must be an array when images are present"
  );
  assert.deepEqual(userMsg.content, [
    { type: "text", text: "Describe the transient light curve" },
    { type: "image_url", image_url: { url: testImage } },
  ]);
});

test("executeChatCompletion preserves string content format when no image inputs are provided", async (t) => {
  let capturedBodies = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    capturedBodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "text response" } }] }));
  });

  // Test 1: images parameter omitted
  await executeChatCompletion({
    prompt: "Plain text query without images",
    systemPrompt: "System",
    model: "gpt-6.1-sol",
    baseUrl: "https://example.com/v1",
    apiKey: "fake-test-key",
  });

  // Test 2: images is empty array
  await executeChatCompletion({
    prompt: "Plain text query with empty images array",
    systemPrompt: "System",
    images: [],
    model: "gpt-6.1-sol",
    baseUrl: "https://example.com/v1",
    apiKey: "fake-test-key",
  });

  assert.equal(capturedBodies.length, 2);
  const userMsg1 = capturedBodies[0].messages.find((m) => m.role === "user");
  assert.equal(typeof userMsg1.content, "string");
  assert.equal(userMsg1.content, "Plain text query without images");

  const userMsg2 = capturedBodies[1].messages.find((m) => m.role === "user");
  assert.equal(typeof userMsg2.content, "string");
  assert.equal(userMsg2.content, "Plain text query with empty images array");
});

test("callChatCompletion filters candidate models to only multimodal-capable models when images are present", async (t) => {
  const attemptedModels = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    attemptedModels.push(body.model);
    if (body.model === "gpt-6.1-sol") {
      return new Response(JSON.stringify({ error: { message: "capacity limit" } }), {
        status: 503,
      });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "multimodal answer" } }] }),
      { status: 200 }
    );
  });

  const testImage = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/";
  const res = await callChatCompletion({
    prompt: "Interpret this spectral line",
    systemPrompt: "System",
    images: [testImage],
    // primary model is pure-text, fallbacks contain both pure-text and multimodal models
    model: "gpt-5.5",
    fallbackModels: ["deepseek-r1", "gpt-6.1-sol", "llama-3", "gemini-3.8-flash-high"],
    baseUrl: "https://example.com/v1",
    apiKey: "fake-test-key",
  });

  assert.equal(res, "multimodal answer");
  // Pure text models (gpt-5.5, deepseek-r1, llama-3) must be filtered out!
  // Only multimodal models (gpt-6.1-sol, then gemini-3.8-flash-high) should have been attempted
  assert.deepEqual(attemptedModels, ["gpt-6.1-sol", "gemini-3.8-flash-high"]);
});

test("callChatCompletion preserves multimodal payload across circuit breaker and provider failover", async (t) => {
  const payloadsReceived = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    payloadsReceived.push({
      host: new URL(url).host,
      model: body.model,
      userContent: body.messages.find((m) => m.role === "user").content,
    });
    // Provider 1 fails with 503
    if (new URL(url).host === "provider1.test") {
      return new Response(JSON.stringify({ error: { message: "gateway timeout" } }), {
        status: 503,
      });
    }
    // Provider 2 succeeds
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "failover success" } }] }),
      { status: 200 }
    );
  });

  const testImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...";
  const res = await callChatCompletion({
    prompt: "Explain the light curve slope",
    systemPrompt: "System",
    images: [testImage],
    model: "gpt-6.1-sol",
    fallbackModels: ["gemini-3.8-flash-high"],
    providers: [
      { name: "P1", baseUrl: "https://provider1.test/v1", apiKey: "k1" },
      { name: "P2", baseUrl: "https://provider2.test/v1", apiKey: "k2" },
    ],
  });

  assert.equal(res, "failover success");
  assert.equal(payloadsReceived.length, 2);

  // Both attempts must retain the exact multimodal content array without mangling or dropping images
  for (const attempt of payloadsReceived) {
    assert.deepEqual(attempt.userContent, [
      { type: "text", text: "Explain the light curve slope" },
      { type: "image_url", image_url: { url: testImage } },
    ]);
  }
});
