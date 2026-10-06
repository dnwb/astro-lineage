import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";
import { buildBoundTitleSources, previewTitleHistory, readOnlyTitleInventory, snapshotFeed } from "../scripts/channel-title-history-preview.mjs";
import * as titleSync from "../scripts/channel-title-only-sync.mjs";
import { refreshArxivFeed } from "../scripts/arxiv-daily.mjs";
import { capturePublishedSourceBinding, hashBody, markerFor } from "../scripts/channel-publication.mjs";
import { saveNewPreview } from "../scripts/channel-title-audit.mjs";
import { approvedDailyTitleFixture } from "./helpers/approved-daily-title-fixture.mjs";

const DAILY = "daily-summary:2026-10-04";
const WEEKLY = "weekly:2026-W40";
const DAILY_TITLE = "「10-04」GRB 220627A两段亮期之间静默约600秒";
const sourceBinding = { id: "bound-build" };

function fixture(title = DAILY_TITLE) {
  const body = "old body";
  const hash = hashBody(body);
  const marked = `${body}\n\n${markerFor(DAILY, hash)}`;
  const record = { status: "published", hash, feed_id: "feed-1", create_time: "123", channel_id: "section-1" };
  const feed = { feed_id: "feed-1", create_time_raw: "123", channel_id: "section-1", title: "old title", markdown_content: marked, image_paths: [] };
  return { ledger: { guild_id: "guild-1", items: { [DAILY]: record } }, feed, sources: { [DAILY]: { title, firstLine: "new body", evidence: "archive:2026-10-04" } } };
}

async function prepareSyncFixture(t, { identity = DAILY, alterArchive } = {}) {
  const workspace = await createTemporaryWorkspace("astro-lineage-title-sync-", t);
  const archiveRoot = join(workspace.path, "archives");
  const distRoot = join(workspace.path, "dist");
  const artifactRoot = join(workspace.path, "published");
  const feedPath = join(workspace.path, "feed.json");
  const radarPath = join(workspace.path, "radar.json");
  const weeklyPath = join(workspace.path, "weekly.json");
  const websitePath = join(workspace.path, "website.json");
  const ledgerPath = join(workspace.path, "ledger.json");
  const snapshotDir = join(workspace.path, "snapshots");
  await mkdir(archiveRoot, { recursive: true });
  const archive = await approvedDailyTitleFixture();
  alterArchive?.(archive);
  await writeFile(join(archiveRoot, "2026-10-04.json"), JSON.stringify(archive));
  const page = join(distRoot, "arxiv-daily", "2026-10-04");
  await mkdir(page, { recursive: true });
  await writeFile(join(page, "index.html"), "built");
  await writeFile(weeklyPath, await readFile(new URL("../src/data/arxiv-weekly.json", import.meta.url)));

  await refreshArxivFeed({ output: feedPath, radarOutput: radarPath, artifactRoot,
    announcementDate: "2026-09-07", minRequestIntervalMs: 0,
    manualSnapshot: { entries: [{ arxiv_id: "2609.00001", revision: 1, title: "Source binding fixture",
      abstract: "Fixture only.", authors: ["Test"], published: "2026-09-07T12:00:00Z",
      updated: "2026-09-07T12:00:00Z", url: "https://arxiv.org/abs/2609.00001v1" }] } });
  const binding = await capturePublishedSourceBinding({ feedPath, radarPath, artifactRoot, archiveRoot, weeklyPath });
  await writeFile(websitePath, JSON.stringify({ status: "success", source_binding: binding }));

  const body = "old body";
  const hash = hashBody(body);
  const feedId = identity === DAILY ? "feed-1" : "feed-2";
  const createTime = identity === DAILY ? "123" : "124";
  const channelId = identity === DAILY ? "section-1" : "section-2";
  const feed = { feed_id: feedId, create_time_raw: createTime, channel_id: channelId,
    title: "old title", markdown_content: `${body}\n\n${markerFor(identity, hash)}`, image_paths: [] };
  const approvalBaselinePath = join(workspace.path, "approved-title-baselines.json");
  const snapshot = snapshotFeed(feed);
  await writeFile(approvalBaselinePath, JSON.stringify({ version: 1, items: { [identity]: {
    status: "approved", identity, source_binding_id: binding.id,
    target_title: titleSync.APPROVED_TITLES[identity], approved_at: "2026-10-05T12:00:00.000Z",
    before: { feed_id: snapshot.feed_id, create_time: snapshot.create_time, channel_id: snapshot.channel_id,
      title: snapshot.title, body_sha256: hashBody(snapshot.markdown_content), media_sha256: hashBody(JSON.stringify(snapshot.media)) },
  } } }));
  const ledger = { guild_id: "guild-1", items: { [identity]: {
    status: "published", hash, feed_id: feedId, create_time: createTime, channel_id: channelId,
  } } };
  await writeFile(ledgerPath, JSON.stringify(ledger));
  const calls = [];
  let edits = 0;
  let editHandler = async args => {
    feed.title = args[args.indexOf("--title") + 1];
    return { stdout: JSON.stringify({ retCode: 0, data: { success: true } }) };
  };
  const cli = async args => {
    calls.push(args);
    if (args[1] === "get-feed-detail") return { stdout: JSON.stringify({ retCode: 0, data: structuredClone(feed) }) };
    if (args[1] === "alter-feed") { edits += 1; return editHandler(args); }
    throw new Error("unexpected_cli_command");
  };
  const run = options => titleSync.syncCurrentApprovedTitles({ ledgerPath, websitePath, feedPath, radarPath,
    artifactRoot, archiveRoot, distRoot, weeklyPath, cli, snapshotDir, approvalBaselinePath, dryRun: false, ...options });
  return { workspace, feed, binding, ledger, approvalBaselinePath, calls, get edits() { return edits; }, set editHandler(value) { editHandler = value; }, run };
}

test("history preview conserves rows and uses read-only inventory/detail", async () => {
  const { ledger, feed, sources } = fixture();
  ledger.items[WEEKLY] = { status: "intent", feed_id: "feed-2", create_time: "124", channel_id: "section-2" };
  const calls = [];
  const preview = await previewTitleHistory({ ledger, sourceBinding, currentBinding: sourceBinding,
    sources, listInventory: async () => { calls.push("inventory"); return { complete: true, feeds: [feed] }; },
    getDetail: async () => { calls.push("detail"); return feed; } });
  assert.equal(preview.total, 2);
  assert.equal(Object.values(preview.counts).reduce((sum, count) => sum + count, 0), 2);
  assert.deepEqual(preview.classification_counts, { body_review: 1, remote_drift: 1 });
  assert.equal(Object.values(preview.classification_counts).reduce((sum, count) => sum + count, 0), preview.total);
  assert.equal(preview.rows.find(row => row.identity === WEEKLY).status, "pending");
  assert.deepEqual(calls, ["inventory", "detail", "detail"]);
  assert.equal(preview.rows[0].media_before.length, 0);
  assert.equal(preview.rows[0].body_sha256_before, hashBody(feed.markdown_content));
  assert.equal(preview.rows[0].media_sha256_before, hashBody(JSON.stringify(feed.image_paths)));
  assert.equal(preview.rows[0].classification, "body_review");
  assert.deepEqual(preview.rows[0].changes, { title: true, body_first_line: true, media: false });
  assert.ok(preview.rows[0].risk_flags.includes("body_change_outside_title_only_scope"));
});

test("history preview surfaces a paper-title human-review diagnostic", async () => {
  const identity = "daily:2609.31850v1";
  const body = "paper body";
  const hash = hashBody(body);
  const record = { status: "published", hash, feed_id: "paper-feed", create_time: "456", channel_id: "section-1" };
  const ledger = { guild_id: "guild-1", items: { [identity]: record } };
  const feed = { feed_id: "paper-feed", create_time_raw: "456", channel_id: "section-1", title: "old title",
    markdown_content: `${body}\n\n${markerFor(identity, hash)}`, image_paths: [] };
  const sources = { [identity]: { title: "长论文候选", firstLine: "paper body", evidence: "archive:test",
    diagnostics: ["CHANNEL_TITLE_HUMAN_REVIEW_RECOMMENDED"] } };
  const preview = await previewTitleHistory({ ledger, sourceBinding, currentBinding: sourceBinding,
    sources, listInventory: async () => ({ complete: true, feeds: [feed] }),
    getDetail: async () => feed });

  assert.equal(preview.rows[0].identity, identity);
  assert.ok(preview.rows[0].risk_flags.includes("title_human_review_recommended"));
});

test("a feed missing from a complete inventory stays pending even when detail lookup succeeds", async () => {
  const { ledger, feed, sources } = fixture();
  const preview = await previewTitleHistory({ ledger, sourceBinding, currentBinding: sourceBinding,
    sources, listInventory: async () => ({ complete: true, feeds: [] }),
    getDetail: async () => feed });
  assert.equal(preview.rows[0].status, "pending");
  assert.equal(preview.rows[0].reason, "remote_not_in_complete_inventory");
  assert.equal(preview.rows[0].classification, "remote_not_visible");
});

test("history preview retains a safe inventory failure code while leaving the feed pending", async () => {
  const { ledger, feed, sources } = fixture();
  const preview = await previewTitleHistory({ ledger, sourceBinding, currentBinding: sourceBinding,
    sources, listInventory: async () => { throw new Error("CHANNEL_RATE_LIMITED"); },
    getDetail: async () => feed });

  assert.equal(preview.inventory_complete, false);
  assert.equal(preview.rows[0].status, "pending");
  assert.equal(preview.rows[0].classification, "inventory_incomplete");
  assert.equal(preview.rows[0].reason, "inventory_error:CHANNEL_RATE_LIMITED");
});

test("history preview preserves a bounded detail error code without exposing the response", async () => {
  const { ledger, feed, sources } = fixture();
  const preview = await previewTitleHistory({ ledger, sourceBinding, currentBinding: sourceBinding,
    sources, listInventory: async () => ({ complete: true, feeds: [feed] }),
    getDetail: async () => { throw Object.assign(new Error("token=secret response body"), { code: "ECONNRESET" }); } });

  assert.equal(preview.rows[0].status, "pending");
  assert.equal(preview.rows[0].classification, "remote_unavailable");
  assert.equal(preview.rows[0].remote_error_code, "ECONNRESET");
  assert.doesNotMatch(JSON.stringify(preview), /secret|token=/u);
});

test("history preview reads every section through the channel timeline API and follows pagination", async () => {
  const { feed } = fixture();
  const calls = [];
  const { listInventory } = readOnlyTitleInventory(async args => {
    calls.push(args);
    if (args[0] === "manage") return { retCode: 0, data: { channels: [{ channel_id: "section-1", channel_name: "Daily" }] } };
    if (args[1] !== "get-channel-timeline-feeds") throw new Error("unexpected_command");
    if (args.includes("--feed-attach-info")) return { retCode: 0, data: { feeds: [], has_more: false } };
    return { retCode: 0, data: { feeds: [feed], has_more: true, feed_attch_info: "page=2" } };
  }, "guild-1");
  const inventory = await listInventory();
  assert.equal(inventory.complete, true);
  assert.deepEqual(inventory.feeds.map(row => row.feed_id), ["feed-1"]);
  assert.deepEqual(calls.map(args => args[1]), ["get-guild-channel-list", "get-channel-timeline-feeds", "get-channel-timeline-feeds"]);
});

test("an empty section inventory is not treated as complete proof of remote absence", async () => {
  const { listInventory } = readOnlyTitleInventory(async () => ({ retCode: 0, data: { channels: [] } }), "guild-1");
  assert.deepEqual(await listInventory(), { complete: false, feeds: [] });
});

test("read-only inventory preserves a numeric platform error code without exposing remote text", async () => {
  const { listInventory } = readOnlyTitleInventory(async () => ({
    retCode: 401011,
    error: "sensitive platform response detail",
  }), "guild-1");

  await assert.rejects(listInventory(), { message: "CHANNEL_READ_FAILED_401011" });
});

test("paper candidates remain available when a daily-brief title is not supportable", async (t) => {
  const workspace = await createTemporaryWorkspace("astro-lineage-title-sources-", t);
  const archiveRoot = join(workspace.path, "archives");
  const distRoot = join(workspace.path, "dist");
  const weeklyPath = join(workspace.path, "weekly.json");
  await mkdir(archiveRoot, { recursive: true });
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  archive.radar.opening_brief.must_read[0].text = "一项进展、另一项进展。";
  const bytes = Buffer.from(JSON.stringify(archive));
  await writeFile(join(archiveRoot, "2026-09-28.json"), bytes);
  await mkdir(join(distRoot, "arxiv-daily", "2026-09-28"), { recursive: true });
  await writeFile(join(distRoot, "arxiv-daily", "2026-09-28", "index.html"), "built");
  const weekly = { week_id: "2026-W40", executive_summary: "磁星模型显示喷流能量发生转变。", thematic_highlights: [] };
  const weeklyBytes = Buffer.from(JSON.stringify(weekly));
  await writeFile(weeklyPath, weeklyBytes);
  const sources = await buildBoundTitleSources({
    sourceBinding: { id: "bound", archives: { "2026-09-28": hashBody(bytes) }, weekly: { hash: hashBody(weeklyBytes) } },
    currentBinding: { id: "bound" }, archiveRoot, distRoot, weeklyPath,
  });
  assert.match(sources["daily-summary:2026-09-28"].error, /CHANNEL_TITLE_DAILY_SINGLE_PROGRESS_REQUIRED/u);
  assert.ok(sources["daily:2609.31842v1"].title);
  assert.deepEqual(sources["daily:2609.31850v1"].diagnostics, ["CHANNEL_TITLE_HUMAN_REVIEW_RECOMMENDED"]);
});

test("bound daily and weekly title diagnostics reach history preview risk flags", async (t) => {
  const workspace = await createTemporaryWorkspace("astro-lineage-title-sources-", t);
  const archiveRoot = join(workspace.path, "archives");
  const distRoot = join(workspace.path, "dist");
  const weeklyPath = join(workspace.path, "weekly.json");
  await mkdir(archiveRoot, { recursive: true });
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const condition = `仅在${"极端条件".repeat(9)}下`;
  archive.radar.opening_brief.must_read[0].text = `GRB 220627A${condition}，辐射强度提高。`;
  const archiveBytes = Buffer.from(JSON.stringify(archive));
  await writeFile(join(archiveRoot, "2026-09-28.json"), archiveBytes);
  await mkdir(join(distRoot, "arxiv-daily", "2026-09-28"), { recursive: true });
  await writeFile(join(distRoot, "arxiv-daily", "2026-09-28", "index.html"), "built");
  const weekly = { week_id: "2026-W40", executive_summary: `本周结果：${condition}，超新星光度提高。`, thematic_highlights: [] };
  const weeklyBytes = Buffer.from(JSON.stringify(weekly));
  await writeFile(weeklyPath, weeklyBytes);
  const sources = await buildBoundTitleSources({
    sourceBinding: { id: "bound", archives: { "2026-09-28": hashBody(archiveBytes) }, weekly: { hash: hashBody(weeklyBytes) } },
    currentBinding: { id: "bound" }, archiveRoot, distRoot, weeklyPath,
  });
  const identities = ["daily-summary:2026-09-28", "weekly:2026-W40"];
  const feeds = identities.map((identity, index) => {
    const source = sources[identity];
    assert.deepEqual(source.diagnostics, ["CHANNEL_TITLE_HUMAN_REVIEW_RECOMMENDED"]);
    const feedId = `feed-${index}`;
    const hash = hashBody(source.firstLine);
    return { feed_id: feedId, create_time_raw: String(index + 1), channel_id: "section-1", title: source.title,
      markdown_content: `${source.firstLine}\n\n${markerFor(identity, hash)}`, image_paths: [] };
  });
  const ledger = { guild_id: "guild-1", items: Object.fromEntries(identities.map((identity, index) => [identity, {
    status: "published", hash: hashBody(sources[identity].firstLine), feed_id: `feed-${index}`, create_time: String(index + 1), channel_id: "section-1",
  }])) };
  const preview = await previewTitleHistory({ ledger, sourceBinding, currentBinding: sourceBinding, sources,
    listInventory: async () => ({ complete: true, feeds }),
    getDetail: async record => feeds.find(feed => feed.feed_id === record.feed_id) });

  assert.deepEqual(preview.rows.map(row => row.status), ["unchanged", "unchanged"]);
  for (const row of preview.rows) assert.ok(row.risk_flags.includes("title_human_review_recommended"));
});

test("weekly source failures are not assigned to an unrelated fixed week", async (t) => {
  const workspace = await createTemporaryWorkspace("astro-lineage-title-sources-", t);
  const sources = await buildBoundTitleSources({
    sourceBinding: { id: "bound", archives: {}, weekly: { hash: "0".repeat(64) } },
    currentBinding: { id: "bound" }, archiveRoot: join(workspace.path, "archives"),
    distRoot: join(workspace.path, "dist"), weeklyPath: join(workspace.path, "missing-weekly.json"),
  });
  assert.match(sources["weekly:source"].error, /source_unavailable/u);
  assert.equal(sources[WEEKLY], undefined);
});

test("history title sources include the current bound Top 5 post template", async (t) => {
  const workspace = await createTemporaryWorkspace("astro-lineage-title-sources-", t);
  const eventsPath = join(workspace.path, "events.json");
  const events = { generated_at: "2026-10-05T12:00:00.000Z", events: [{
    event_id: "GRB 2609.12345", heat_score: 25, paper_count: 1, last_updated: "2026-10-04",
    papers: [{ priority: "must_read", arxiv_id: "2609.12345", bluf_problem: "该事件是否来自坍缩星爆发？" }],
  }] };
  const eventBytes = Buffer.from(JSON.stringify(events));
  await writeFile(eventsPath, eventBytes);
  const eventSnapshot = { hash: hashBody(eventBytes), generated_at: events.generated_at };

  const sources = await buildBoundTitleSources({ sourceBinding: { id: "bound", archives: {} },
    currentBinding: { id: "bound" }, eventSnapshot, eventsPath });

  assert.deepEqual(sources["events:top5"], {
    title: "瞬变源 Top 5",
    firstLine: "数据更新：2026-10-05T12:00:00.000Z",
    evidence: `events:${eventSnapshot.hash}`,
  });
});

test("the module exposes no title writer that accepts caller-supplied candidate strings", () => {
  assert.equal("syncApprovedTitles" in titleSync, false);
});

test("an approved W40 title mismatch remains pending and issues no edit", async (t) => {
  const target = await prepareSyncFixture(t, { identity: WEEKLY });
  const result = await target.run({ candidates: { [WEEKLY]: "W40周报：前兆非探测收紧超新星失质量约束" } });
  assert.equal(result.items[WEEKLY].status, "pending");
  assert.equal(result.items[WEEKLY].reason, "candidate_not_exactly_approved");
  assert.equal(target.edits, 0);
});

test("caller-supplied title cannot bypass the current bound daily archive", async (t) => {
  const target = await prepareSyncFixture(t, { alterArchive: archive => {
    archive.radar.opening_brief.must_read[0].text = "GRB 220627A两段亮期之间静默约610秒。";
  } });
  const result = await target.run({ candidates: { [DAILY]: DAILY_TITLE } });
  assert.equal(result.items[DAILY].status, "pending");
  assert.equal(result.items[DAILY].reason, "candidate_not_exactly_approved");
  assert.equal(target.edits, 0);
});

test("a human-edited title after approval remains untouched", async (t) => {
  const target = await prepareSyncFixture(t);
  target.feed.title = "human-edited title";
  const result = await target.run();
  assert.equal(result.items[DAILY].status, "pending");
  assert.equal(result.items[DAILY].reason, "approved_baseline_title_mismatch");
  assert.equal(target.edits, 0);
  assert.equal(target.feed.title, "human-edited title");
});

test("an exact approved baseline edits the title only and verifies read-back", async (t) => {
  const target = await prepareSyncFixture(t);
  target.editHandler = async args => {
    assert.deepEqual(args.slice(0, 2), ["feed", "alter-feed"]);
    assert.equal(args.includes("--markdown-content"), false);
    assert.equal(args.includes("--image"), false);
    assert.equal(args.includes("--title"), true);
    const snapshots = await readFile(join(target.workspace.path, "snapshots", "daily-summary_2026-10-04.json"), "utf8");
    assert.equal(JSON.parse(snapshots).before.markdown_content, target.feed.markdown_content);
    target.feed.title = args[args.indexOf("--title") + 1];
    return { stdout: JSON.stringify({ retCode: 0, data: { success: true } }) };
  };
  const result = await target.run();
  assert.equal(result.items[DAILY].status, "verified");
  assert.equal(target.edits, 1);
  const again = await target.run();
  assert.equal(again.items[DAILY].status, "unchanged");
  assert.equal(target.edits, 1);
});

test("a missing approval baseline blocks the write", async (t) => {
  const target = await prepareSyncFixture(t);
  const result = await target.run({ approvalBaselinePath: join(target.workspace.path, "missing.json") });
  assert.equal(result.items[DAILY].status, "pending");
  assert.equal(result.items[DAILY].reason, "approved_baseline_missing");
  assert.equal(target.edits, 0);
});

test("an approved media snapshot must still match before title-only edit", async (t) => {
  const target = await prepareSyncFixture(t);
  const baseline = JSON.parse(await readFile(target.approvalBaselinePath, "utf8"));
  baseline.items[DAILY].before.media_sha256 = hashBody(JSON.stringify(["previous.png"]));
  await writeFile(target.approvalBaselinePath, JSON.stringify(baseline));
  const result = await target.run();
  assert.equal(result.items[DAILY].status, "pending");
  assert.equal(result.items[DAILY].reason, "approved_baseline_content_mismatch");
  assert.equal(target.edits, 0);
});

test("unverifiable media and body drift stay pending before any write", async (t) => {
  const missing = await prepareSyncFixture(t);
  delete missing.feed.image_paths;
  const unverifiable = await missing.run();
  assert.equal(unverifiable.items[DAILY].status, "pending");
  assert.equal(missing.edits, 0);

  const drift = await prepareSyncFixture(t);
  drift.feed.markdown_content = "changed";
  const result = await drift.run();
  assert.equal(result.items[DAILY].status, "pending");
  assert.equal(result.items[DAILY].reason, "body_marker_or_hash_drift");
  assert.equal(drift.edits, 0);
});

test("a title already equal to the approved candidate is unchanged without a write", async (t) => {
  const target = await prepareSyncFixture(t);
  target.feed.title = DAILY_TITLE;
  const result = await target.run();
  assert.equal(result.items[DAILY].status, "unchanged");
  assert.equal(target.edits, 0);
});

test("rejected JSON write responses stay pending and do not replay", async (t) => {
  const target = await prepareSyncFixture(t);
  target.editHandler = async () => ({ stdout: JSON.stringify({ success: false, error: "permission denied" }) });
  const first = await target.run();
  assert.equal(first.items[DAILY].status, "pending");
  assert.match(first.items[DAILY].reason, /unknown_outcome:remote_rejected/u);
  const second = await target.run();
  assert.equal(second.items[DAILY].reason, "previous_write_outcome_unresolved");
  assert.equal(target.edits, 1);
});

test("an unknown write is recorded and never replayed automatically", async (t) => {
  const target = await prepareSyncFixture(t);
  target.editHandler = async () => { throw new Error("timeout"); };
  const first = await target.run();
  assert.equal(first.items[DAILY].status, "pending");
  const intent = JSON.parse(await readFile(join(target.workspace.path, "snapshots", "daily-summary_2026-10-04.intent.json"), "utf8"));
  assert.equal(intent.status, "pending");
  assert.equal(intent.target_title, DAILY_TITLE);
  const second = await target.run();
  assert.equal(second.items[DAILY].reason, "previous_write_outcome_unresolved");
  assert.equal(target.edits, 1);
});

test("an unknown write that changed the title is reconciled without another edit", async (t) => {
  const target = await prepareSyncFixture(t);
  target.editHandler = async args => {
    target.feed.title = args[args.indexOf("--title") + 1];
    throw new Error("timeout");
  };
  const first = await target.run();
  assert.equal(first.items[DAILY].status, "pending");
  const second = await target.run();
  assert.equal(second.items[DAILY].status, "verified");
  assert.equal(target.edits, 1);
  const intent = JSON.parse(await readFile(join(target.workspace.path, "snapshots", "daily-summary_2026-10-04.intent.json"), "utf8"));
  assert.equal(intent.status, "verified");
});

test("an orphaned before-snapshot blocks a fresh write until intent state is reconciled", async (t) => {
  const target = await prepareSyncFixture(t);
  await mkdir(join(target.workspace.path, "snapshots"), { recursive: true });
  await writeFile(join(target.workspace.path, "snapshots", "daily-summary_2026-10-04.json"), JSON.stringify({
    identity: DAILY, source_binding_id: target.binding.id, before: snapshotFeed(target.feed),
  }));
  const result = await target.run();
  assert.equal(result.items[DAILY].status, "pending");
  assert.equal(result.items[DAILY].reason, "snapshot_without_intent");
  assert.equal(target.edits, 0);
});

test("preview report creates a new file and preserves a previous report", async (t) => {
  const workspace = await createTemporaryWorkspace("astro-lineage-title-report-", t);
  const path = join(workspace.path, "preview.json");
  await saveNewPreview(path, { total: 1, counts: { pending: 1 } });
  await assert.rejects(saveNewPreview(path, { total: 2 }), { code: "EEXIST" });
  assert.equal(JSON.parse(await readFile(path, "utf8")).total, 1);
});
