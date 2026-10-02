import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadAcademicKnowledge, executeChatCompletion, callChatCompletion, buildModelCandidates } from '../scripts/agent-core.mjs';

test('missing or invalid guides remain pending, not a negative scientific judgement', async () => {
  const knowledge = await loadAcademicKnowledge({
    feed: { entries: [{ arxiv_id: '2609.00001', revision: 1 }], window: { announcement_date: '2026-09-27' } },
    radar: { analyses: [{ arxiv_id: '2609.00001', revision: 1, priority: 'must_read' }] },
  });
  assert.equal(knowledge.includes('待导读 1'), true);
  assert.equal(knowledge.includes('严格研判'), false);
  assert.equal(knowledge.includes('R7: 千新星'), false);
});

test('model secrets never go to HTTP, redirects or unbounded requests', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  const opts = { prompt: 'test', systemPrompt: 'test', model: 'test', apiKey: 'fake-test-key' };
  await assert.rejects(executeChatCompletion({ ...opts, baseUrl: 'http://example.com/v1' }));
  assert.equal(calls, 0);
  assert.equal(await executeChatCompletion({ ...opts, baseUrl: 'https://example.com/v1' }), 'ok');
});

test('source has no embedded model credential', async () => {
  const source = await readFile(new URL('../scripts/agent-core.mjs', import.meta.url), 'utf8');
  assert.equal(/sk-[a-zA-Z0-9]{20,}/u.test(source), false, 'remove literal credentials');
});

test('oversized model requests and responses are rejected without exposing provider text', async (t) => {
  const options = { prompt: 'test', systemPrompt: 'test', model: 'test', apiKey: 'fake-test-key', baseUrl: 'https://example.com/v1' };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('x'.repeat(256 * 1024 + 1));
  });
  await assert.rejects(executeChatCompletion({ ...options, prompt: 'x'.repeat(128 * 1024) }), /request exceeds/);
  assert.equal(calls, 0);
  await assert.rejects(executeChatCompletion(options), /response exceeds/);
});

test('buildModelCandidates orders primary model first and incorporates fallbacks without duplicates', () => {
  const candidates = buildModelCandidates('6.1-sol', ['6-sol', '6-luna', 'gpt-5.5', 'gpt-6.1-sol']);
  assert.deepEqual(candidates, ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.5']);
});

test('callChatCompletion falls back from failing primary model to next available candidate', async (t) => {
  const attemptedModels = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    attemptedModels.push(body.model);
    if (body.model === 'gpt-6.1-sol') {
      return new Response(JSON.stringify({ error: { message: 'model_price_not_configured' } }), { status: 503 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback success answer' } }] }), { status: 200 });
  });

  const res = await callChatCompletion({
    prompt: 'test prompt',
    systemPrompt: 'test system',
    model: 'gpt-6.1-sol',
    fallbackModels: ['gpt-6-sol', 'gpt-6-luna'],
    baseUrl: 'https://example.com/v1',
    apiKey: 'fake-test-key',
  });

  assert.equal(res, 'fallback success answer');
  assert.deepEqual(attemptedModels, ['gpt-6.1-sol', 'gpt-6-sol']);
});

test('callChatCompletion fails closed when all candidates fail', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    return new Response(JSON.stringify({ error: { message: 'service unavailable' } }), { status: 503 });
  });

  await assert.rejects(
    callChatCompletion({
      prompt: 'test prompt',
      systemPrompt: 'test system',
      model: 'gpt-6.1-sol',
      fallbackModels: ['gpt-6-sol'],
      baseUrl: 'https://example.com/v1',
      apiKey: 'fake-test-key',
    }),
    /所有模型及降级候选均不可用/
  );
});

test('callChatCompletion prioritizes model across multiple providers before falling back to next model', async (t) => {
  const attempts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    attempts.push({ host: new URL(url).host, model: body.model });
    // Provider 1 fails for gpt-6.1-sol, but Provider 2 succeeds for gpt-6.1-sol
    if (new URL(url).host === 'provider1.test') {
      return new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'provider 2 success' } }] }), { status: 200 });
  });

  const res = await callChatCompletion({
    prompt: 'test prompt',
    systemPrompt: 'test system',
    model: 'gpt-6.1-sol',
    fallbackModels: ['gpt-6-sol', 'gpt-6-luna'],
    providers: [
      { name: 'P1', baseUrl: 'https://provider1.test/v1', apiKey: 'k1' },
      { name: 'P2', baseUrl: 'https://provider2.test/v1', apiKey: 'k2' },
    ],
  });

  assert.equal(res, 'provider 2 success');
  // Must try gpt-6.1-sol on P1, then gpt-6.1-sol on P2 without falling back to gpt-6-sol
  const modelsTried = attempts.map(a => a.model);
  assert.deepEqual(modelsTried, ['gpt-6.1-sol', 'gpt-6.1-sol']);
  assert.equal(attempts[0].host, 'provider1.test');
  assert.equal(attempts[1].host, 'provider2.test');
});

