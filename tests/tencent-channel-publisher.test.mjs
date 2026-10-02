import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDailyMarkdown, generateWeeklyMarkdown, publishDailyFeed, publishWeeklyFeed, publishHistoricalFeeds, provisionTopicChannels } from "../scripts/tencent-channel-publisher.mjs";
import { TOPICS, routePaper, hashBody, markerFor } from "../scripts/channel-publication.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

function fixtureBinding({ weekly = "", archives = {} } = {}) {
  const daily = { generation_id: "fixture-generation", hash: "0".repeat(64) };
  const data = { daily, weekly: { hash: hashBody(weekly) }, archives };
  return { ...data, id: hashBody(JSON.stringify(data)) };
}

test("generateDailyMarkdown generates verified daily briefing aligned with radar model and content-based title", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const daily = await generateDailyMarkdown({ feed: archive.feed, radar: archive.radar });
  assert.equal(daily.batchDate, "2026-09-28");
  assert.ok(daily.highlights.length >= 5);
  assert.match(daily.postTitle, /【AstroLineage每日精选】2026-09-28/u);
  // Enforce content-based title rather than generic filler
  assert.doesNotMatch(daily.postTitle, /高能天体物理重点文献导读/u);
  assert.match(daily.postTitle, /FRB.*等离子体透镜/u);

  assert.match(daily.md, /\*\*\d+\*\* 篇重点必读、\*\*\d+\*\* 篇值得关注/u);
  assert.match(daily.md, /2609\.31842/u);
  assert.match(daily.md, /2609\.32726/u);
  assert.match(daily.md, /2609\.31850/u);
  assert.match(daily.md, /2609\.32127/u);
  assert.match(daily.md, /2609\.32324/u);
  assert.match(daily.md, /2609\.31844/u);
  // Ensure skip candidates are excluded from highlights
  assert.doesNotMatch(daily.md, /2609\.31826/u);
  // Ensure valid site URLs
  assert.match(daily.md, /\/arxiv-daily\/2026-09-28/u);
});

function fakeCli() {
  const feeds = [];
  let calls = 0;
  let moves = 0;
  let failNextCreate = false;
  const cli = async (args) => {
    const action = args[1];
    const arg = (flag) => args[args.indexOf(flag) + 1];
    if (action === "get-channel-timeline-feeds") {
      assert.equal(args.includes("--get-type"), false);
      assert.ok(args.includes("--channel-id"));
      return { retCode: 0, data: { feeds: feeds.filter((feed) => feed.channel_id === arg("--channel-id")), has_more: false } };
    }
    if (action === "get-feed-detail") {
      assert.equal(args.includes("--create-time"), false);
      return { retCode: 0, data: feeds.find((feed) => feed.feed_id === arg("--feed-id")) };
    }
    if (action === "publish-feed") {
      calls += 1;
      const feed = { feed_id: String(calls), create_time_raw: String(calls + 100), channel_id: arg("--channel-id"), title: arg("--title"), markdown_content: arg("--markdown-content") };
      feeds.push(feed);
      if (failNextCreate) { failNextCreate = false; throw new Error("CHANNEL_TIMEOUT"); }
      return { retCode: 0, data: feed };
    }
    if (action === "alter-feed") {
      const feed = feeds.find((entry) => entry.feed_id === arg("--feed-id"));
      feed.markdown_content = arg("--markdown-content"); feed.title = arg("--title");
      return { retCode: 0, data: feed };
    }
    if (action === "move-feed") {
      const feed = feeds.find((entry) => entry.feed_id === arg("--feed-id"));
      assert.equal(feed.channel_id, arg("--original-channel-id"));
      feed.channel_id = arg("--channel-id"); moves += 1;
      return { retCode: 0, data: feed };
    }
    throw new Error(`unexpected ${action}`);
  };
  return { cli, feeds, get moves() { return moves; }, failCreate: () => { failNextCreate = true; } };
}

test("daily publishes once per version, then reconciles an unknown committed create", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const channelIds = Object.fromEntries(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((id) => [id, id]));
  remote.failCreate();
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, channelIds };
  const first = await publishDailyFeed(options);
  assert.equal(first.success, false);
  assert.ok(first.pending >= 1);
  const second = await publishDailyFeed(options);
  assert.equal(second.pending_items.some((entry) => entry.reason === "CHANNEL_UNKNOWN_OUTCOME"), false);
  assert.equal(remote.feeds.length, [...archive.radar.analyses.filter((analysis) => ["must_read", "worth_knowing"].includes(analysis.priority))].filter((analysis) => routePaper({ ...archive.feed.entries.find((entry) => entry.arxiv_id === analysis.arxiv_id), analysis }).primary).length);
  const third = await publishDailyFeed(options);
  assert.equal(third.published, 0);
  assert.equal(third.unchanged, remote.feeds.length);
  assert.match(remote.feeds[0].markdown_content, /arXiv:.*v1/u);
  assert.match(remote.feeds[0].markdown_content, /astrolineage-channel/u);
});

test("invalid source, missing built page, and unmatched topics never publish", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const remote = fakeCli();
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, channelIds: { R5: "R5" } };
  assert.equal((await publishDailyFeed(options)).success, false);
  assert.equal(remote.feeds.length, 0);
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  assert.equal((await publishDailyFeed({ ...options, source: { feed: archive.feed, radar: {} } })).success, false);
  assert.equal(routePaper({ title: "Unrelated material", analysis: { analysis: { problem: "Unknown" } } }).primary, null);
  const partial = await publishDailyFeed(options);
  assert.equal(partial.success, false);
  assert.ok(partial.pending_items.some((item) => item.reason === "CHANNEL_SECTION_MISSING"));
});

test("weekly unchanged reentry is a no-op and changed text edits same feed", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id);
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { weeklyPath, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, guildId: "test", channelId: "weekly", sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) };
  assert.equal((await publishWeeklyFeed(options)).published, 1);
  assert.equal((await publishWeeklyFeed(options)).unchanged, 1);
  assert.equal((await publishWeeklyFeed({ ...options, titleOverride: "Revised W40" })).updated, 1);
  assert.equal(remote.feeds.length, 1);
});

test("backfill is capped and dry run uses validated built archives", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archiveRoot = join(path, "archive"); await mkdir(archiveRoot);
  const source = await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url));
  await writeFile(join(archiveRoot, "2026-09-28.json"), source);
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const sourceBinding = fixtureBinding({ archives: { "2026-09-28": hashBody(source) } });
  const result = await publishHistoricalFeeds({ archiveRoot, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", dryRun: true, limit: 2, sourceBinding, channelIds: Object.fromEntries(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((id) => [id, id])) });
  assert.equal(result.remaining, 8);
  assert.equal(result.pending_items.length, 2);
  assert.equal((await publishHistoricalFeeds({ archiveRoot, distRoot: join(path, "dist"), limit: 51, sourceBinding })).success, false);
});

test("corrupt ledger and repeated remote page stop publication", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id);
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const cacheRoot = join(path, "cache"); await mkdir(cacheRoot);
  const options = { weeklyPath, distRoot: join(path, "dist"), cacheRoot, guildId: "test", channelId: "weekly", sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) };
  await writeFile(join(cacheRoot, "guild-test.json"), "not json");
  assert.match((await publishWeeklyFeed(options)).errors[0], /CHANNEL_LEDGER_CORRUPT/u);
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: {} }));
  let publishes = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [{ feed_id: "old", create_time_raw: "100", channel_id: "weekly" }], has_more: true, feed_attach_info: "same" } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { markdown_content: "unrelated" } };
    if (args[1] === "publish-feed") publishes += 1;
    throw new Error("unexpected");
  };
  const result = await publishWeeklyFeed({ ...options, cli });
  assert.equal(result.success, false);
  assert.equal(result.pending_items[0].reason, "CHANNEL_PAGINATION_INCOMPLETE");
  assert.equal(publishes, 0);
});

test("global ledger lock prevents concurrent duplicate publication", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id);
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { weeklyPath, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", channelId: "weekly", cli: remote.cli, sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) };
  const results = await Promise.all([publishWeeklyFeed(options), publishWeeklyFeed(options)]);
  assert.ok(results.some((result) => result.success));
  assert.equal(remote.feeds.length, 1);
});

test("verified managed section allows a fresh key despite repeated pages, but not unknown intent", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const items = [...archive.radar.analyses.filter((a) => ["must_read", "worth_knowing"].includes(a.priority))];
  const selected = items.map((analysis) => ({ analysis, entry: archive.feed.entries.find((entry) => entry.arxiv_id === analysis.arxiv_id) })).filter(({ analysis, entry }) => routePaper({ ...entry, analysis }).primary);
  const first = selected[0]; const second = selected[1];
  const firstTopic = routePaper({ ...first.entry, analysis: first.analysis }).primary;
  const secondTopic = routePaper({ ...second.entry, analysis: second.analysis }).primary;
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const cacheRoot = join(path, "cache"); await mkdir(cacheRoot);
  const itemsLedger = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`previous-${i}`, { status: "published", hash: "x" }]));
  itemsLedger[`daily:${second.entry.arxiv_id}v${second.entry.revision}`] = { status: "intent", hash: "unknown", channel_id: "two" };
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: itemsLedger, managed_sections: { one: { verified_empty: true, topic: firstTopic }, two: { verified_empty: true, topic: secondTopic } } }));
  let creates = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [{ feed_id: "repeat", create_time_raw: "1", channel_id: "two" }], has_more: true, feed_attach_info: "repeat" } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { content: "unrelated" } };
    if (args[1] === "publish-feed") { creates += 1; return { retCode: 0, data: { feed_id: String(creates), create_time_raw: String(creates + 20) } }; }
    throw new Error("unexpected");
  };
  const result = await publishDailyFeed({ source: archive, distRoot: join(path, "dist"), cacheRoot, guildId: "test", cli, channelIds: Object.fromEntries(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((id) => [id, id === firstTopic ? "one" : "two"])) });
  assert.ok(creates >= 1);
  assert.ok(result.pending_items.some((entry) => entry.identity === `daily:${second.entry.arxiv_id}v${second.entry.revision}` && entry.reason === "CHANNEL_UNKNOWN_OUTCOME"));
});

test("explicit old-paper binding moves and edits the same remote ID", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-21.json", import.meta.url), "utf8"));
  const paper = archive.feed.entries.find((entry) => entry.arxiv_id === "2609.22426");
  const topic = routePaper({ ...paper, analysis: archive.radar.analyses.find((entry) => entry.arxiv_id === paper.arxiv_id) }).primary;
  const page = join(path, "dist", "arxiv-daily", "2026-09-21");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const binding = { guild_id: "test", feed_id: "original", create_time: "100", channel_id: "old", title: "Original paper", content: `# ${paper.title}\n\narXiv:${paper.arxiv_id}v${paper.revision}`, owner_verified: true };
  const remote = { ...binding, markdown_content: binding.content };
  let moves = 0; let edits = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [], has_more: false } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { ...remote, create_time_raw: remote.create_time } };
    if (args[1] === "move-feed") { moves += 1; remote.channel_id = get("--channel-id"); return { success: true, data: { feed_id: remote.feed_id } }; }
    if (args[1] === "alter-feed") { edits += 1; remote.markdown_content = get("--markdown-content"); remote.title = get("--title"); return { retCode: 0, data: remote }; }
    if (args[1] === "publish-feed") throw new Error("duplicate create");
    throw new Error("unexpected");
  };
  const result = await publishDailyFeed({ source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", cli, channelIds: { [topic]: "new" }, legacyBindings: { [`daily:${paper.arxiv_id}v${paper.revision}`]: binding } });
  assert.equal(moves, 1);
  assert.equal(edits, 1);
  assert.equal(remote.feed_id, "original");
  assert.equal(remote.channel_id, "new");
  assert.ok(result.updated >= 1);
});

test("legacy move intent reconciles a completed edit after ledger-save loss", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-21.json", import.meta.url), "utf8"));
  const paper = archive.feed.entries.find((entry) => entry.arxiv_id === "2609.22426");
  const topic = routePaper({ ...paper, analysis: archive.radar.analyses.find((entry) => entry.arxiv_id === paper.arxiv_id) }).primary;
  const page = join(path, "dist", "arxiv-daily", "2026-09-21");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const identity = `daily:${paper.arxiv_id}v${paper.revision}`;
  const binding = { guild_id: "test", feed_id: "original", create_time: "100", channel_id: "old", title: "Original paper", content: `# ${paper.title}\n\narXiv:${paper.arxiv_id}v${paper.revision}`, owner_verified: true };
  const remote = { ...binding, markdown_content: binding.content };
  let moves = 0; let edits = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [], has_more: false } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { ...remote, create_time_raw: remote.create_time } };
    if (args[1] === "move-feed") { moves += 1; remote.channel_id = get("--channel-id"); return { success: true }; }
    if (args[1] === "alter-feed") { edits += 1; remote.markdown_content = get("--markdown-content"); remote.title = get("--title"); return { retCode: 0 }; }
    throw new Error("unexpected");
  };
  const cacheRoot = join(path, "cache");
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot, guildId: "test", cli, channelIds: { [topic]: "new" }, legacyBindings: { [identity]: binding } };
  assert.ok((await publishDailyFeed(options)).updated >= 1);
  const ledgerPath = join(cacheRoot, "guild-test.json");
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  ledger.items[identity] = { ...ledger.items[identity], status: "intent", operation: "move", channel_id: "old" };
  await writeFile(ledgerPath, JSON.stringify(ledger));
  const retry = await publishDailyFeed(options);
  assert.equal(retry.pending_items.some((entry) => entry.identity === identity), false);
  assert.equal(moves, 1);
  assert.equal(edits, 1);
  assert.equal(JSON.parse(await readFile(ledgerPath, "utf8")).items[identity].status, "published");
});

test("published item moves same ID when its target section changes", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", cli: remote.cli };
  const topics = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"];
  assert.ok((await publishDailyFeed({ ...options, channelIds: Object.fromEntries(topics.map((id) => [id, "old"])) })).published > 0);
  const before = remote.feeds.map((feed) => feed.feed_id);
  const changed = await publishDailyFeed({ ...options, channelIds: Object.fromEntries(topics.map((id) => [id, "new"])) });
  assert.equal(changed.pending_items.some((entry) => entry.reason === "CHANNEL_UNKNOWN_OUTCOME"), false);
  assert.equal(remote.moves, before.length);
  assert.deepEqual(remote.feeds.map((feed) => feed.feed_id), before);
  assert.ok(remote.feeds.every((feed) => feed.channel_id === "new"));
});

test("default daily source refuses valid mutable files without a published generation", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const feedPath = join(path, "feed.json"); const radarPath = join(path, "radar.json");
  await writeFile(feedPath, JSON.stringify(archive.feed)); await writeFile(radarPath, JSON.stringify(archive.radar));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const result = await publishDailyFeed({ feedPath, radarPath, artifactRoot: null, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, channelIds: { R5: "R5" }, sourceBinding: fixtureBinding() });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /CHANNEL_SOURCE_UNPUBLISHED/u);
  assert.equal(remote.feeds.length, 0);
});

test("move timeout retries only after target absence and unchanged old body are proven", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-21.json", import.meta.url), "utf8"));
  const paper = archive.feed.entries.find((entry) => entry.arxiv_id === "2609.22426");
  const topic = routePaper({ ...paper, analysis: archive.radar.analyses.find((entry) => entry.arxiv_id === paper.arxiv_id) }).primary;
  const page = join(path, "dist", "arxiv-daily", "2026-09-21"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const identity = `daily:${paper.arxiv_id}v${paper.revision}`;
  const binding = { guild_id: "test", feed_id: "original", create_time: "100", channel_id: "old", title: "Original paper", content: `# ${paper.title}\n\narXiv:${paper.arxiv_id}v${paper.revision}`, owner_verified: true };
  const remote = { ...binding, markdown_content: binding.content };
  let moves = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [], has_more: false } };
    if (args[1] === "get-feed-detail") { if (remote.channel_id !== get("--channel-id")) throw new Error("absent"); return { retCode: 0, data: { ...remote, create_time_raw: remote.create_time } }; }
    if (args[1] === "move-feed") { moves += 1; if (moves === 1) throw new Error("CHANNEL_TIMEOUT"); remote.channel_id = get("--channel-id"); return { retCode: 0 }; }
    if (args[1] === "alter-feed") { remote.markdown_content = get("--markdown-content"); remote.title = get("--title"); return { retCode: 0 }; }
    throw new Error("unexpected");
  };
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", cli, channelIds: { [topic]: "new" }, legacyBindings: { [identity]: binding } };
  assert.ok((await publishDailyFeed(options)).pending_items.some((entry) => entry.identity === identity));
  const retry = await publishDailyFeed(options);
  assert.equal(retry.pending_items.some((entry) => entry.identity === identity), false);
  assert.equal(moves, 2);
  assert.equal(remote.channel_id, "new");
});

test("validated PWN and magnetothermal papers follow physical Research Lines", async () => {
  for (const [date, id, expected] of [["2026-09-09", "2609.10041", "R1"], ["2026-09-21", "2609.24918", "R5"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis);
    assert.equal(routePaper({ ...entry, analysis }).primary, expected);
  }
});

test("confirmed CLI rate limit stops the bounded batch before later writes", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  let writes = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [], has_more: false } };
    if (args[1] === "publish-feed") { writes += 1; return { retCode: 153 }; }
    throw new Error("unexpected");
  };
  const cacheRoot = join(path, "cache");
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot, guildId: "test", cli, channelIds: Object.fromEntries(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((id) => [id, id])) };
  const result = await publishDailyFeed(options);
  assert.equal(writes, 1);
  assert.equal(result.pending_items[0].reason, "CHANNEL_RATE_LIMIT");
  assert.ok(result.remaining > 0);
  assert.equal(Object.keys(JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8")).items).length, 0);
});

test("unknown intent does not accept a copied marker on altered remote text", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const rendered = await generateWeeklyMarkdown({ weekly });
  const identity = `weekly:${weekly.week_id}`; const hash = hashBody(rendered.md);
  const cacheRoot = join(path, "cache"); await mkdir(cacheRoot);
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: { [identity]: { hash, status: "intent", channel_id: "weekly" } } }));
  let creates = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [{ feed_id: "rogue", create_time_raw: "100", channel_id: "weekly" }], has_more: false } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { markdown_content: `changed\n\n${markerFor(identity, hash)}`, title: rendered.postTitle } };
    if (args[1] === "publish-feed") creates += 1;
    throw new Error("unexpected");
  };
  const result = await publishWeeklyFeed({ weeklyPath, distRoot: join(path, "dist"), cacheRoot, guildId: "test", channelId: "weekly", cli, sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) });
  assert.equal(result.pending_items[0].reason, "CHANNEL_UNKNOWN_OUTCOME");
  assert.equal(creates, 0);
});

test("weekly changed body edits a positively bound original with same remote ID", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const binding = { guild_id: "test", feed_id: "original", create_time: "100", channel_id: "weekly", title: "Old 2026-W40", content: "# Original 2026-W40 summary", week_id: "2026-W40", owner_verified: true };
  const feed = { ...binding, markdown_content: binding.content };
  let edits = 0; let creates = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-feed-detail") return { retCode: 0, data: feed };
    if (args[1] === "alter-feed") { edits += 1; feed.markdown_content = get("--markdown-content"); feed.title = get("--title"); return { retCode: 0 }; }
    if (args[1] === "publish-feed") creates += 1;
    throw new Error("unexpected");
  };
  const result = await publishWeeklyFeed({ weeklyPath, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", channelId: "weekly", cli, sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }), legacyBindings: { "weekly:2026-W40": binding } });
  assert.equal(result.updated, 1);
  assert.equal(edits, 1);
  assert.equal(creates, 0);
  assert.equal(feed.feed_id, "original");
});

test("unbound same-week post stays pending even with complete inventory", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  let creates = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [{ feed_id: "old", create_time_raw: "100", channel_id: "weekly" }], has_more: false } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { title: "Old 2026-W40", markdown_content: "# Previous 2026-W40 content" } };
    if (args[1] === "publish-feed") creates += 1;
    throw new Error("unexpected");
  };
  const result = await publishWeeklyFeed({ weeklyPath, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", channelId: "weekly", cli, sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) });
  assert.equal(result.pending_items[0].reason, "CHANNEL_WEEKLY_AMBIGUOUS");
  assert.equal(creates, 0);
});

test("provision reuses escaped R1 and verifies an initially empty timeline before trusting it", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const channels = [{ channel_id: "existing-r1", channel_name: `R1 ${TOPICS[0][1]}`.replace(/&/gu, "&amp;") }];
  let creates = 0; let r1Pages = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[0] === "manage" && args[1] === "get-guild-channel-list") return { retCode: 0, data: { channels } };
    if (args[0] === "manage" && args[1] === "create-channel") {
      creates += 1;
      const channel = { channel_id: `created-${creates}`, channel_name: get("--channel-name") };
      channels.push(channel);
      return { retCode: 0, data: channel };
    }
    if (args[1] === "get-channel-timeline-feeds") {
      assert.equal(args.includes("--get-type"), false);
      assert.ok(args.includes("--guild-id") && args.includes("--channel-id"));
      if (get("--channel-id") === "existing-r1") {
        r1Pages += 1;
        if (r1Pages === 1) return { success: true, data: { feed_attch_info: "pageNum=2&top=", has_more: true } };
        assert.equal(get("--feed-attach-info"), "pageNum=2&top=");
      }
      return { success: true, data: { feeds: [], has_more: false } };
    }
    throw new Error("unexpected CLI command");
  };
  const cacheRoot = join(path, "cache");
  const ids = await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.equal(ids.R1, "existing-r1");
  assert.equal(creates, 6);
  assert.equal(r1Pages, 2);
  const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
  assert.equal(ledger.managed_sections["existing-r1"].verified_empty, true);
  await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.equal(creates, 6);
});

test("endless empty timeline pages stop after two calls per section without trusting absence", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const channels = TOPICS.map(([key, label]) => ({ channel_id: key, channel_name: `${key} ${label}` }));
  const calls = new Map();
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { retCode: 0, data: { channels } };
    if (args[1] === "get-channel-timeline-feeds") {
      const channelId = args[args.indexOf("--channel-id") + 1];
      const page = (calls.get(channelId) ?? 0) + 1;
      calls.set(channelId, page);
      return { retCode: 0, data: { feeds: [], has_more: true, feed_attch_info: `page=${page + 1}` } };
    }
    throw new Error("unexpected CLI command");
  };
  const cacheRoot = join(path, "cache");
  const ids = await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.deepEqual(Object.keys(ids), TOPICS.map(([key]) => key));
  assert.deepEqual([...calls.entries()], TOPICS.map(([key]) => [key, 2]));
  await assert.rejects(readFile(join(cacheRoot, "guild-test.json"), "utf8"), { code: "ENOENT" });
  await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.deepEqual([...calls.entries()], TOPICS.map(([key]) => [key, 4]));
});

test("daily rejects G2 after a G1 page build before any remote call", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "G1 page");
  const sourceBinding = fixtureBinding();
  let calls = 0;
  const result = await publishDailyFeed({ readEdition: async () => ({ feed: archive.feed, radar: archive.radar, generation_id: "G2", pointer: {} }), sourceBinding, distRoot: join(path, "dist"), cli: async () => { calls += 1; throw new Error("remote"); } });
  assert.equal(result.errors[0], "CHANNEL_SOURCE_BUILD_MISMATCH");
  assert.equal(calls, 0);
});

test("weekly refuses changed source after its built binding", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json");
  const sourceBinding = fixtureBinding({ weekly: JSON.stringify(weekly) });
  await writeFile(weeklyPath, JSON.stringify({ ...weekly, executive_summary: "changed after build" }));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "G1 page");
  let calls = 0;
  const result = await publishWeeklyFeed({ weeklyPath, sourceBinding, distRoot: join(path, "dist"), cli: async () => { calls += 1; throw new Error("remote"); } });
  assert.equal(result.errors[0], "CHANNEL_SOURCE_BUILD_MISMATCH");
  assert.equal(calls, 0);
});

test("historical archive changed after build stays pending", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const archiveRoot = join(path, "archive"); await mkdir(archiveRoot);
  const sourceBinding = fixtureBinding({ archives: { "2026-09-28": hashBody(JSON.stringify(archive)) } });
  archive.counts.total += 1;
  await writeFile(join(archiveRoot, "2026-09-28.json"), JSON.stringify(archive));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "G1 page");
  let calls = 0;
  const result = await publishHistoricalFeeds({ archiveRoot, sourceBinding, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), channelIds: {}, cli: async () => { calls += 1; throw new Error("remote"); } });
  assert.equal(result.pending_items[0].reason, "CHANNEL_SOURCE_BUILD_MISMATCH");
  assert.equal(calls, 0);
});

test("generateWeeklyMarkdown generates verified weekly summary aligned with weekly synthesis and content-based title", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weekly = await generateWeeklyMarkdown({ weekly: archive });
  assert.equal(weekly.weekId, "2026-W40");
  assert.match(weekly.postTitle, /【AstroLineage周报】2026-W40/u);
  // Enforce content-based title rather than generic filler
  assert.doesNotMatch(weekly.postTitle, /高能天体物理学术脉络总结/u);
  assert.match(weekly.postTitle, /FRB|磁星|超新星/u);

  assert.match(weekly.md, /宏观学术态势综述/u);
  assert.match(weekly.md, /本周重点精选论文 \(Top Picks\)/u);
  assert.match(weekly.md, /本周核心专题突破与因果链演进/u);
  assert.match(weekly.md, /2609\.31842/u);
  assert.match(weekly.md, /2609\.32726/u);
  assert.match(weekly.md, /2609\.31844/u);
  assert.match(weekly.md, /\/arxiv-weekly\//u);
});
