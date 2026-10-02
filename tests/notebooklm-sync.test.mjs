import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportNotebookPages, captureBuildSources, recordWebsiteBuild, syncAnnualNotebooks, deliverPublication, runAdapter } from "../scripts/notebooklm-sync.mjs";
import { acquireRefreshLock, releaseRefreshLock } from "../scripts/arxiv-daily.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

const URL = "https://notebook.google.com/notebook/11111111-1111-4111-8111-111111111111";

async function workspace(t) {
  const { path } = await createTemporaryWorkspace("astro-lineage-notebook-test-", t);
  const dist = resolve(path, "dist"), cache = resolve(path, "cache");
  const page = async (route, body) => {
    const target = resolve(dist, route, "index.html");
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, `<html><main><nav>ignore menu</nav>${body}</main><script>private ignored</script></html>`);
  };
  await page("arxiv-daily/2026-12-31", `<h1>导读</h1><details><summary>仅摘要</summary><p>未独立验证；待分析。</p></details><span class="katex"><span class="katex-mathml"><math><mi>x</mi><annotation encoding="application/x-tex">\\frac{x}{y}</annotation></math></span><span class="katex-html">duplicate rendering</span></span>`);
  // Exceed a pipe chunk; multibyte UTF-8 must survive streaming/hash validation.
  await page("arxiv-daily/2027-01-01", `<h1>明年导读</h1><p>待审核关系${"物理图像🌌".repeat(15_000)}</p>`);
  await page("arxiv-weekly/2026-W53", "<h1>跨年周报</h1><p>阅读范围不升级</p>");
  return { cache, dist, page };
}

function transport(calls) {
  return async (_args, { input }) => {
    calls.push(input);
    return { code: null, events: [{ event: "notebook", year: input.year, url: URL },
      ...input.sources.map((source) => ({ event: "source", ...source }))] };
  };
}

test("offline export keeps original evidence and TeX; Gregorian/ISO years match built routes", async (t) => {
  const options = await workspace(t);
  const result = await exportNotebookPages(options);
  assert.equal(result.reports.length, 3);
  assert.deepEqual(result.sources.map((s) => s.key), ["daily-2026-12-p01", "weekly-2026-12-p01", "daily-2027-01-p01"]);
  const text = result.sources[0].text;
  assert.match(text, /仅摘要/u);
  assert.match(text, /未独立验证；待分析/u);
  assert.match(text, /\$\\frac\{x\}\{y\}\$/u);
  assert.doesNotMatch(text, /ignore menu|private ignored|duplicate rendering/u);
  const again = await exportNotebookPages(options);
  assert.deepEqual(again.sources, result.sources);
});

test("sync reuses annual notebook and is a no-op after unchanged successful uploads", async (t) => {
  const options = await workspace(t);
  await exportNotebookPages(options);
  const calls = [], adapter = transport(calls);
  const first = await syncAnnualNotebooks({ ...options, adapter });
  assert.equal(first.status, "success");
  assert.equal(first.uploaded, 3);
  const second = await syncAnnualNotebooks({ ...options, adapter });
  assert.equal(second.uploaded, 0);
  assert.equal(calls.length, 2);
  await options.page("arxiv-daily/2026-12-31", "<p>修订正文；部分正文，未验证</p>");
  await exportNotebookPages(options);
  await syncAnnualNotebooks({ ...options, adapter });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].notebook_url, URL);
  assert.equal(calls[2].sources.length, 1);
});

test("partial failure preserves completed sources and retries only missing hashes", async (t) => {
  const options = await workspace(t);
  await exportNotebookPages(options);
  const calls = [];
  let first = true;
  const adapter = async (args, context) => {
    const result = await transport(calls)(args, context);
    if (first) { first = false; return { events: result.events.slice(0, 2), code: "NOTEBOOKLM_TIMEOUT" }; }
    return result;
  };
  assert.equal((await syncAnnualNotebooks({ ...options, adapter })).status, "blocked");
  const retried = await syncAnnualNotebooks({ ...options, adapter });
  assert.equal(retried.status, "success");
  assert.equal(retried.uploaded, 1);
  assert.equal(calls.at(-1).sources[0].key, "weekly-2026-12-p01");
});

test("replacement failure keeps last-good manifest and records auth blocker", async (t) => {
  const options = await workspace(t);
  await exportNotebookPages(options);
  await syncAnnualNotebooks({ ...options, adapter: transport([]) });
  const before = await readFile(resolve(options.cache, "manifest.json"), "utf8");
  await options.page("arxiv-daily/2026-12-31", "<p>新正文</p>");
  await exportNotebookPages(options);
  const failed = await syncAnnualNotebooks({ ...options,
    adapter: async () => ({ events: [], code: "NOTEBOOKLM_AUTH_REQUIRED" }) });
  assert.equal(failed.errors[0].code, "NOTEBOOKLM_AUTH_REQUIRED");
  assert.equal(await readFile(resolve(options.cache, "manifest.json"), "utf8"), before);
});

test("channel and notebook failures are independent; QQ remains permission-blocked", async (t) => {
  const options = await workspace(t);
  const { build_id: buildId } = await exportNotebookPages(options);
  const status = await deliverPublication({ cache: options.cache, buildId, kinds: ["daily", "weekly"],
    channel: async (kind) => { if (kind === "daily") throw new Error("bad"); return '{"success":true}'; },
    notebookSync: async () => ({ status: "blocked", errors: [{ code: "NOTEBOOKLM_AUTH_REQUIRED" }] }) });
  assert.equal(status.website.status, "success");
  assert.equal(status.channel.daily.status, "failed");
  assert.equal(status.channel.weekly.status, "success");
  assert.equal(status.notebooklm.status, "blocked");
  assert.equal(status.qq.status, "waiting_permission");
  assert.deepEqual(JSON.parse(await readFile(resolve(options.cache, "delivery.json"))), status);
});

test("failed current export blocks stale NotebookLM upload while channel is attempted once", async (t) => {
  const options = await workspace(t);
  await exportNotebookPages(options);
  const buildId = "current-build-12345";
  const capture = async () => ({ id: "a".repeat(64) });
  await captureBuildSources({ cache: options.cache, buildId, capture });
  await recordWebsiteBuild({ cache: options.cache, buildId, capture });
  await assert.rejects(exportNotebookPages({ ...options, buildId,
    adapter: async () => ({ code: "NOTEBOOKLM_EXPORT_INVALID", events: [] }) }), /NOTEBOOKLM_EXPORT_INVALID/u);
  const manualUploads = [];
  await assert.rejects(syncAnnualNotebooks({ ...options, adapter: transport(manualUploads) }), /NOTEBOOKLM_EXPORT_STALE/u);
  assert.equal(manualUploads.length, 0);
  const calls = [], uploads = [];
  const status = await deliverPublication({ cache: options.cache, buildId, kinds: ["daily", "weekly"],
    channel: async (kind) => { calls.push(kind); return kind === "daily"
      ? { success: false, published: 1, pending: 2, remaining: 2, errors: [{ code: "CHANNEL_TIMEOUT" }] }
      : { success: true, unchanged: 1 }; },
    notebookSync: async (args) => { uploads.push(args); return { status: "success" }; } });
  assert.deepEqual(calls, ["daily", "weekly"]);
  assert.equal(uploads.length, 0);
  assert.equal(status.website.build_id, buildId);
  assert.equal(status.channel.daily.status, "failed");
  assert.equal(status.channel.daily.published, 1);
  assert.deepEqual(status.channel.daily.errors, ["CHANNEL_TIMEOUT"]);
  assert.equal(status.channel.weekly.status, "success");
  assert.equal(status.notebooklm.code, "NOTEBOOKLM_EXPORT_STALE");
});

test("changed source between capture and build completion cannot become current", async (t) => {
  const options = await workspace(t);
  const buildId = "source-build-12345";
  const first = { daily: { generation_id: "G1", hash: "a".repeat(64) }, weekly: { hash: "b".repeat(64) }, archives: {}, id: "c".repeat(64) };
  const second = { ...first, daily: { generation_id: "G2", hash: "d".repeat(64) }, id: "e".repeat(64) };
  await captureBuildSources({ cache: options.cache, buildId, capture: async () => first });
  await assert.rejects(recordWebsiteBuild({ cache: options.cache, buildId, capture: async () => second }), /NOTEBOOKLM_SOURCE_CHANGED/u);
  let calls = 0;
  await assert.rejects(deliverPublication({ cache: options.cache, buildId, kinds: ["daily", "weekly"],
    channel: async () => { calls++; return { success: true }; } }), /NOTEBOOKLM_BUILD_REQUIRED/u);
  assert.equal(calls, 0);
});

test("daily and weekly delivery receive the verified build source binding", async (t) => {
  const options = await workspace(t);
  const buildId = "verified-build-12345";
  const binding = { daily: { generation_id: "G1", hash: "a".repeat(64) }, weekly: { hash: "b".repeat(64) }, archives: {}, id: "c".repeat(64) };
  const capture = async () => binding;
  await captureBuildSources({ cache: options.cache, buildId, capture });
  await recordWebsiteBuild({ cache: options.cache, buildId, capture });
  await exportNotebookPages({ ...options, buildId });
  const seen = [];
  const status = await deliverPublication({ cache: options.cache, buildId, kinds: ["daily", "weekly"],
    channel: async (kind, { sourceBinding }) => { seen.push([kind, sourceBinding]); return { success: true }; },
    notebookSync: async () => ({ status: "success" }) });
  assert.deepEqual(seen, [["daily", binding], ["weekly", binding]]);
  assert.equal(status.channel.daily.status, "success");
  assert.equal(status.channel.weekly.status, "success");
});

test("an unfinished later build cannot reuse the prior website or export", async (t) => {
  const options = await workspace(t);
  const capture = async () => ({ id: "a".repeat(64) });
  const oldId = "previous-build-12345";
  await captureBuildSources({ cache: options.cache, buildId: oldId, capture });
  await recordWebsiteBuild({ cache: options.cache, buildId: oldId, capture });
  await exportNotebookPages({ ...options, buildId: oldId });
  await captureBuildSources({ cache: options.cache, buildId: "later-build-12345", capture });
  let channelCalls = 0, uploads = 0;
  await assert.rejects(deliverPublication({ cache: options.cache, buildId: oldId,
    channel: async () => { channelCalls++; return { success: true }; } }), /NOTEBOOKLM_BUILD_REQUIRED/u);
  await assert.rejects(syncAnnualNotebooks({ ...options, adapter: async () => { uploads++; return { code: null, events: [] }; } }), /NOTEBOOKLM_EXPORT_STALE/u);
  assert.equal(channelCalls, 0);
  assert.equal(uploads, 0);
});

test("success envelopes with pending or remaining items are reported incomplete", async (t) => {
  const options = await workspace(t);
  const { build_id: buildId } = await exportNotebookPages(options);
  const status = await deliverPublication({ cache: options.cache, buildId, kinds: ["daily", "weekly"],
    channel: async (kind) => kind === "daily"
      ? { success: true, published: 1, pending: 2, errors: ["CHANNEL_TOPIC_UNRESOLVED"] }
      : { success: true, updated: 1, remaining: 2 },
    notebookSync: async () => ({ status: "success" }) });
  assert.equal(status.channel.daily.status, "failed");
  assert.equal(status.channel.daily.pending, 2);
  assert.deepEqual(status.channel.daily.errors, ["CHANNEL_TOPIC_UNRESOLVED"]);
  assert.equal(status.channel.weekly.status, "failed");
  assert.equal(status.channel.weekly.remaining, 2);
  assert.equal(status.channel.weekly.code, "CHANNEL_DELIVERY_INCOMPLETE");
  assert.equal(status.notebooklm.status, "success");
});

test("channel failure retains publisher code without exposing diagnostic text", async (t) => {
  const options = await workspace(t);
  const { build_id: buildId } = await exportNotebookPages(options);
  const status = await deliverPublication({ cache: options.cache, buildId, kinds: ["daily", "weekly"],
    channel: async (kind) => kind === "daily"
      ? { success: false, pending: 1, errors: ["CHANNEL_LEDGER_CORRUPT", "CHANNEL_SOURCE_INVALID:private details", "private token"] }
      : Promise.reject(new Error("CHANNEL_MOVE_UNVERIFIED")),
    notebookSync: async () => ({ status: "success" }) });
  assert.deepEqual(status.channel.daily.errors, ["CHANNEL_LEDGER_CORRUPT", "CHANNEL_SOURCE_INVALID", "CHANNEL_DELIVERY_FAILED"]);
  assert.equal(status.channel.weekly.code, "CHANNEL_MOVE_UNVERIFIED");
  assert.doesNotMatch(JSON.stringify(status), /private/u);
});

test("publisher and helper error literals remain in the delivery allowlist", async (t) => {
  const options = await workspace(t);
  const { build_id: buildId } = await exportNotebookPages(options);
  const source = (await Promise.all(["tencent-channel-publisher.mjs", "channel-publication.mjs"]
    .map((name) => readFile(resolve(import.meta.dirname, "../scripts", name), "utf8")))).join("\n");
  const codes = [...new Set(source.match(/\bCHANNEL_[A-Z_]+\b/gu))]
    .filter((code) => !["CHANNEL_ID", "CHANNEL_CLI_EXIT_"].includes(code));
  for (let i = 0; i < codes.length; i += 20) {
    const batch = codes.slice(i, i + 20);
    const status = await deliverPublication({ cache: options.cache, buildId,
      channel: async () => ({ success: false, pending: 1, errors: batch }),
      notebookSync: async () => ({ status: "success" }) });
    assert.deepEqual(status.channel.daily.errors, batch);
  }
});

test("delivery refuses unbound or repeated kinds before contacting any target", async (t) => {
  const options = await workspace(t);
  const { build_id: buildId } = await exportNotebookPages(options);
  let calls = 0;
  const channel = async () => { calls++; return { success: true }; };
  await assert.rejects(deliverPublication({ cache: options.cache, kinds: ["daily"], channel }), /INVALID_DELIVERY_MODE/u);
  await assert.rejects(deliverPublication({ cache: options.cache, buildId, kinds: ["daily", "daily"], channel }), /INVALID_DELIVERY_MODE/u);
  await assert.rejects(deliverPublication({ cache: options.cache, buildId: "another-build-12345", kinds: ["daily"], channel }), /BUILD_REQUIRED/u);
  assert.equal(calls, 0);
});

test("missing build, malformed export and live sync lock stop uploads", async (t) => {
  const options = await workspace(t);
  let calls = 0;
  const adapter = async () => { calls++; return { events: [], code: null }; };
  await assert.rejects(syncAnnualNotebooks({ ...options, adapter }), /BUILD_REQUIRED/u);
  const { build_id: buildId } = await exportNotebookPages(options);
  const lock = resolve(options.cache, "sync.lock");
  await acquireRefreshLock(lock);
  try { await assert.rejects(syncAnnualNotebooks({ ...options, adapter }), /刷新已在运行/u); }
  finally { await releaseRefreshLock(lock); }
  await writeFile(resolve(options.cache, "export.json"), JSON.stringify({ schema_version: 1, build_id: buildId, sources: [{}] }));
  await assert.rejects(syncAnnualNotebooks({ ...options, adapter }), /EXPORT_INVALID/u);
  assert.equal(calls, 0);
});

test("subprocess timeout is bounded and non-JSON diagnostics are not exposed", async () => {
  const timed = await runAdapter(["-c", "import time; time.sleep(10)"], { timeoutMs: 50 });
  assert.equal(timed.code, "NOTEBOOKLM_TIMEOUT");
  const safe = await runAdapter(["-c", 'print("private debug"); print(\'{"event":"error","code":"NOTEBOOKLM_AUTH_REQUIRED"}\'); exit(1)']);
  assert.equal(safe.events.length, 1);
  assert.equal(safe.code, "NOTEBOOKLM_AUTH_REQUIRED");
});
