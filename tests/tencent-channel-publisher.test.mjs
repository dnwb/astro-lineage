import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDailyMarkdown, generateWeeklyMarkdown, publishDailyFeed, publishWeeklyFeed, publishHistoricalFeeds, provisionTopicChannels, publishEventRanking, paperMarkdown, extractPaperTopic, deriveDailyContentTitle, deriveWeeklyContentTitle } from "../scripts/tencent-channel-publisher.mjs";
import { TOPICS, TOPIC_LABELS, routePaper, hashBody, markerFor } from "../scripts/channel-publication.mjs";
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
  assert.equal(daily.postTitle, "SN 2024ggi：ATClean在所有测试高斯核宽下均未发现显著爆前前兆｜09-28");
  assert.ok(daily.md.startsWith(`# ${daily.postTitle}\n`));
  assert.match(daily.md, /发布日期：2026-09-28/u);
  assert.ok(daily.md.includes(archive.opening_brief.intro));
  for (const sentence of archive.opening_brief.must_read) assert.ok(daily.md.includes(sentence.text));
  const summary = archive.opening_brief.worth_knowing_summary;
  assert.ok(daily.md.includes(summary.replace(/；其余见下方卡片[。.]?$/u, "。")));
  assert.doesNotMatch(daily.md, /；其余见下方卡片[。.]?$/mu);
  assert.match(daily.md, /## 本期导读/u);
  assert.match(daily.md, /## 其他值得关注/u);
  assert.doesNotMatch(daily.md, /AI 研判筛选|官方共发布|#paper-/u);
  assert.match(daily.md, /2609\.31842/u);
  assert.match(daily.md, /2609\.32726/u);
  assert.match(daily.md, /2609\.31844/u);
  // Ensure skip candidates are excluded from highlights
  assert.doesNotMatch(daily.md, /2609\.31826/u);
  // Ensure valid site URLs
  assert.match(daily.md, /\/arxiv-daily\/2026-09-28/u);
});

test("daily titles lead with one work instead of topic lists; weekly titles remain unchanged", () => {
  const highlights = [
    { title: "Supernova shock breakout", priority: "worth_knowing" },
    { title: "Plasma lensing in fast radio bursts", priority: "must_read" },
    { title: "FRB plasma lensing", priority: "must_read" },
    { title: "Pulse profiles of accretion columns", priority: "must_read" },
    { title: "Tidal disruption events", priority: "must_read" },
  ];
  assert.equal(deriveDailyContentTitle("2026-10-02", highlights), "Plasma lensing in fast radio bursts｜10-02");
  assert.equal(deriveDailyContentTitle("2026-10-02", []), "论文更新｜10-02");
  assert.equal(deriveWeeklyContentTitle("2026-W40", { thematic_highlights: [{ theme_name: "喷流传播：动力学与辐射" }, { theme_name: "喷流传播：其他结果" }, { theme_name: "中微子（候选关联）" }] }), "喷流传播、中微子｜W40");
  assert.equal(deriveWeeklyContentTitle("2026-W40", {}), "论文更新｜W40");
});

test("news-style daily titles prefer a reviewed named event and preserve its reported uncertainty", () => {
  const highlights = [
    { title: "FRB propagation", analysis: { priority: "must_read", analysis: { result: "透镜模型预言重复爆发的相关时延。" } } },
    { title: "Observations of SN 2024abc", analysis: { priority: "must_read", analysis: { result: "作者提出可能存在爆前活动，尚不能确认。后续观测仍然必要。" } } },
  ];
  const before = JSON.stringify(highlights);
  assert.equal(deriveDailyContentTitle("2026-10-02", highlights), "SN 2024abc：作者提出可能存在爆前活动，尚不能确认｜10-02");
  assert.equal(JSON.stringify(highlights), before);
  const lowerPriority = { ...highlights[1], analysis: { ...highlights[1].analysis, priority: "worth_knowing" } };
  assert.equal(deriveDailyContentTitle("2026-10-02", [highlights[0], lowerPriority]), "透镜模型预言重复爆发的相关时延｜10-02");
});

test("daily headlines use the exact version-matched opening highlight without inventing a stronger claim", () => {
  const paper = { arxiv_id: "2609.12345", revision: 2, title: "GRB 250419A", priority: "must_read", analysis: { result: "模型可合理拟合余辉。" } };
  const brief = { must_read: [
    { arxiv_id: paper.arxiv_id, revision: 1, text: "发现全新爆发机制。" },
    { arxiv_id: paper.arxiv_id, revision: 2, text: "GRB 250419A余辉可由相对论喷流拟合，尚不能区分两种几何。" },
  ] };
  const title = deriveDailyContentTitle("2026-10-02", [paper], brief);
  assert.equal(title, "GRB 250419A余辉可由相对论喷流拟合，尚不能区分两种几何｜10-02");
  assert.doesNotMatch(title, /发现全新|每日导读|所属分组/u);
});

test("long result sentences fall back to the named event without clipping conditions", () => {
  const result = "模型预言" + "限定条件下的计算结果，".repeat(24) + "尚未被观测确认。";
  const title = deriveDailyContentTitle("2026-10-02", [{ title: "GRB 250419A", priority: "must_read", analysis: { result } }]);
  assert.equal(title, "GRB 250419A的研究更新｜10-02");
  assert.ok(Array.from(title).length <= 200);
});

test("paper titles preserve content without inventing mechanisms from reading reasons or clipping terms", () => {
  assert.equal(extractPaperTopic({ title: "Dispersion Measure Variability in Fast Radio Bursts" }), "FRB色散量变化");
  assert.equal(extractPaperTopic({ title: "FRB host environments" }), "FRB环境");
  assert.equal(extractPaperTopic({ title: "A study of accretion", analysis: { reason: "与组内FRB方向相关" } }), "A study of accretion");
  const title = "A previously unclassified physical process with a complete technical name";
  assert.equal(extractPaperTopic({ title }), title);
  const item = { arxiv_id: "2609.12345", revision: 1, title: "Shock breakout in circumstellar material", analysis: { priority: "must_read", coverage: {}, analysis: { problem: "致密星周介质中的激波突破", result: "作者报告的结果", reason: "与组内研究相关" } } };
  const before = JSON.stringify(item);
  const markdown = paperMarkdown(item, "2026-10-02", { primary: "R3", related: [] });
  assert.equal(markdown.split("\n")[0], "# 致密星周介质中的激波突破");
  assert.ok(markdown.includes(`原标题：${item.title}`));
  assert.equal(JSON.stringify(item), before);
});

test("papers in the same section have work-specific titles rather than a shared category name", () => {
  const make = (problem, title) => ({ arxiv_id: "2609.12345", revision: 1, title,
    analysis: { priority: "must_read", coverage: {}, analysis: { problem, result: "作者报告的结果。" } } });
  const first = make("重复FRB的色散量变化是否来自光致电离？", "Dispersion measure changes in fast radio bursts");
  const second = make("如何利用重复FRB检验等离子体透镜模型？", "Plasma lensing in fast radio bursts");
  const titles = [first, second].map(item => paperMarkdown(item, "2026-10-02", { primary: "R5", related: [] }).split("\n")[0]);
  assert.deepEqual(titles, ["# 重复FRB的色散量变化是否来自光致电离？", "# 如何利用重复FRB检验等离子体透镜模型？"]);
  assert.notEqual(titles[0], titles[1]);
  const noProblem = make("", "A specific FRB paper title");
  assert.equal(paperMarkdown(noProblem, "2026-10-02", { primary: "R5", related: [] }).split("\n")[0], "# A specific FRB paper title");
});

test("paper cards separate contextual numerical results and collect links at the end", () => {
  const item = { arxiv_id: "2609.13540", revision: 1, title: "Shock breakout in circumstellar material", authors: ["Example Author"], analysis: { priority: "must_read", coverage: { label: "全文" }, analysis: { problem: "研究受限星周介质中的激波突破。", result: "在受限星周介质模型中，峰值光度为 1.43–3.15 × 10^44 erg/s，持续 4.1–35.4 小时。模型中的辐射前驱体预加速周围介质。", reason: "与组内 R3 的激波突破工作相关。", limits: ["这些数值限于本文采用的模型参数。"], unresolved_checks: ["未独立复算。"] } } };
  const before = JSON.stringify(item);
  const md = paperMarkdown(item, "2026-09-14", { primary: "R3", related: [] });
  assert.match(md, /## 核心结果/u);
  assert.match(md, /## 关键数据/u);
  assert.ok(md.includes("在受限星周介质模型中，峰值光度为 1.43–3.15 × 10^44 erg/s，持续 4.1–35.4 小时。"));
  assert.ok(md.indexOf("核心结果") < md.indexOf("关键数据"));
  assert.ok(md.indexOf("关键数据") < md.indexOf("阅读关联"));
  assert.ok(md.indexOf("这些数值限于本文采用的模型参数。") < md.indexOf("阅读入口"));
  assert.equal((md.match(/https?:\/\//gu) || []).length, 2);
  assert.ok(md.indexOf("https://arxiv.org") > md.indexOf("阅读入口"));
  assert.doesNotMatch(md, /<details|@img|关键图/u);
  assert.equal(JSON.stringify(item), before);
  const shorter = paperMarkdown({ ...item, analysis: { ...item.analysis, priority: "worth_knowing" } }, "2026-09-14", { primary: "R3", related: [] });
  assert.match(shorter, /\*\*关注\*\*/u);
  assert.doesNotMatch(shorter, /## 关键数据/u);
  assert.ok(shorter.length < md.length);
});

test("bibliographic years and figure numbers are not promoted to numerical measurements", () => {
  const item = { arxiv_id: "2609.12345", revision: 1, title: "FRB environments", analysis: { priority: "must_read", coverage: {}, analysis: { problem: "研究FRB环境。", result: "作者对照了 2021 年的模型和图 3。结果不支持这一解释。", reason: "相关研究。" } } };
  const md = paperMarkdown(item, "2026-09-14", { primary: "R5", related: [] });
  assert.doesNotMatch(md, /## 关键数据/u);
  assert.ok(md.includes("结果不支持这一解释。"));
});

test("single-paper cards do not display routing groups in the header or add classification lines", () => {
  const item = { arxiv_id: "2609.12345", revision: 1, title: "Shock breakout", authors: ["Example Author"],
    analysis: { priority: "must_read", coverage: {}, analysis: { problem: "研究激波突破。", result: "作者报告的结果。", reason: "与此前的激波模型相关。" } } };
  const topic = { primary: "R3", related: ["R2"] };
  const original = JSON.stringify({ item, topic });
  const text = paperMarkdown(item, "2026-10-02", topic);
  assert.equal(text.split("\n")[2], "**必读** · Example Author");
  assert.doesNotMatch(text, /所属分组|相关主题：|待分类/u);
  assert.equal(text, paperMarkdown(item, "2026-10-02", { primary: "R1", related: [] }));
  assert.equal(JSON.stringify({ item, topic }), original);
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
    if (args[1] === "get-guild-channel-list") return { retCode: 0, data: { channels: [{ channel_id: "weekly", channel_name: "Weekly" }] } };
    if (args[1] === "get-guild-feeds") return { retCode: 0, data: { feeds: [], has_more: true } };
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
    if (args[1] === "get-guild-channel-list") return { retCode: 0, data: { channels: [{ channel_id: "one", channel_name: "One" }, { channel_id: "two", channel_name: "Two" }] } };
    if (args[1] === "get-guild-feeds") return { retCode: 0, data: { feeds: [], has_more: true } };
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

test("accreting magnetar spin-down follows the accretion line with engine context", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-10.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.11479");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.11479");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R7", related: ["R1"] });
});

test("archived neutron-star spectra and observations route to R7", async () => {
  for (const [date, id] of [["2026-09-10", "2609.11787"], ["2026-09-13", "2609.12072"], ["2026-09-20", "2609.21732"], ["2026-09-22", "2609.25958"], ["2026-09-24", "2609.29316"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R7", related: [] }, id);
  }
});

test("magnetar magnetosphere and magneto-ionic papers route to R5", async () => {
  for (const [date, id] of [["2026-09-16", "2609.17661"], ["2026-09-21", "2609.23259"], ["2026-09-23", "2609.26897"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R5", related: [] }, id);
  }
});

test("magnetic Reynolds notation alone does not route to R5", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-15.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.17365");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.17365");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: null, related: [] });
});

test("a supernova gravitational-wave paper is not a magnetar-burst route", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-07.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.07774");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.07774");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R3", related: [] });
});

test("IXPE mention alone does not add an R7 route to a magnetic accretion disk", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-08.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.08895");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.08895");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R5", related: [] });
});

test("explicit gravitational-wave and merger observables route to R6", async () => {
  for (const [date, id] of [["2026-09-07", "2609.06369"], ["2026-09-07", "2609.06374"], ["2026-09-10", "2609.10736"], ["2026-09-15", "2609.16330"], ["2026-09-16", "2609.17936"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R6", related: [] }, id);
  }
});

test("method-only resistive GRMHD remains pending without a physical R6 qualifier", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-13.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.12998");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.12998");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: null, related: [] });
});

test("general GRMHD and r-process delay papers remain outside R6", async () => {
  for (const [date, id] of [["2026-09-07", "2609.06150"], ["2026-09-14", "2609.15621"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), { primary: null, related: [] }, id);
  }
});

test("collapsar and accretion gravitational-wave papers retain their existing routes", async () => {
  for (const [date, id, expected] of [["2026-09-22", "2609.25225", { primary: "R2", related: [] }], ["2026-09-29", "2609.36005", { primary: "R2", related: [] }], ["2026-09-28", "2609.32164", { primary: "R7", related: [] }]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), expected, id);
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

test("complete guild inventory does not clear an unknown write intent", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const cacheRoot = join(path, "cache"); await mkdir(cacheRoot);
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: { [`weekly:${weekly.week_id}`]: { hash: "unknown", status: "intent", channel_id: "weekly" } } }));
  let creates = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { has_more: true, feed_attch_info: "next" } };
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels: [{ channel_id: "weekly", channel_name: "Weekly" }] } };
    if (args[1] === "get-guild-feeds") return { success: true, data: { feeds: [], has_more: false } };
    if (args[1] === "publish-feed") creates += 1;
    throw new Error("unexpected CLI command");
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
      return { success: true, data: { has_more: false } };
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
    if (args[1] === "get-guild-feeds") return { retCode: 0, data: { feeds: [], has_more: true } };
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

test("complete guild inventory maps names and verifies only empty sections after timeline stalls", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const channels = TOPICS.map(([key, label]) => ({ channel_id: key, channel_name: `${key} ${label}`.replace(/&/gu, "&amp;") }));
  const calls = new Map();
  let guildScans = 0;
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels } };
    if (args[1] === "get-channel-timeline-feeds") {
      const channelId = args[args.indexOf("--channel-id") + 1];
      const count = (calls.get(channelId) ?? 0) + 1;
      calls.set(channelId, count);
      return { success: true, data: { has_more: true, feed_attch_info: `page=${count + 1}` } };
    }
    if (args[1] === "get-guild-feeds") {
      guildScans += 1;
      assert.equal(args[args.indexOf("--get-type") + 1], "2");
      assert.equal(args[args.indexOf("--count") + 1], "100");
      return { success: true, data: { feeds: [{ feed_id: "existing", create_time_raw: "100", channel_name: `R1 ${TOPICS[0][1]}` }], has_more: false } };
    }
    throw new Error("unexpected CLI command");
  };
  const cacheRoot = join(path, "cache");
  await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.equal(guildScans, 1);
  assert.deepEqual([...calls.entries()], TOPICS.map(([key]) => [key, 2]));
  const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
  assert.equal(ledger.managed_sections.R1, undefined);
  assert.deepEqual(Object.keys(ledger.managed_sections).sort(), TOPICS.slice(1).map(([key]) => key).sort());
});

test("pre-create guild snapshot cannot verify a section created later in provisioning", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const channels = [{ channel_id: "existing-r1", channel_name: `R1 ${TOPICS[0][1]}` }];
  let globalScans = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels } };
    if (args[1] === "create-channel") return { success: true, data: { channel_id: `new-${get("--channel-name").slice(0, 2)}` } };
    if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { has_more: true, feed_attch_info: "next" } };
    if (args[1] === "get-guild-feeds") { globalScans += 1; return { success: true, data: { feeds: [], has_more: false } }; }
    throw new Error("unexpected CLI command");
  };
  const cacheRoot = join(path, "cache");
  const ids = await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.equal(globalScans, 1);
  const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
  assert.deepEqual(Object.keys(ledger.managed_sections), [ids.R1]);
  assert.ok(TOPICS.slice(1).every(([key]) => !ledger.managed_sections[ids[key]]));
});

test("guild fallback propagates CLI failure during provisioning", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels: [{ channel_id: "R1", channel_name: `R1 ${TOPICS[0][1]}` }] } };
    if (args[1] === "create-channel") return { success: true, data: { channel_id: "created" } };
    if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { has_more: true, feed_attch_info: "next" } };
    if (args[1] === "get-guild-feeds") throw new Error("CHANNEL_CLI_EXIT_1");
    throw new Error("unexpected CLI command");
  };
  await assert.rejects(provisionTopicChannels({ guildId: "test", cacheRoot: join(path, "cache"), cli }), /CHANNEL_CLI_EXIT_1/u);
});

test("incomplete or unmappable guild inventory cannot verify section absence", async (t) => {
  for (const mode of ["incomplete", "ambiguous", "unknown"]) {
    const { path, cleanup } = await createTemporaryWorkspace("astro-lineage-channel-", t);
    const channels = TOPICS.map(([key, label]) => ({ channel_id: key, channel_name: `${key} ${label}` }));
    if (mode === "ambiguous") channels.push({ channel_id: "extra-a", channel_name: "Other" }, { channel_id: "extra-b", channel_name: "Other" });
    let guildScans = 0;
    const cli = async (args) => {
      if (args[1] === "get-guild-channel-list") return { success: true, data: { channels } };
      if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { has_more: true, feed_attch_info: "next" } };
      if (args[1] === "get-guild-feeds") {
        guildScans += 1;
        if (mode === "unknown") return { success: true, data: { feeds: [{ feed_id: "unmapped", create_time_raw: "100", channel_name: "Missing" }], has_more: false } };
        return { success: true, data: { feeds: [], has_more: true, feed_attach_info: `next=${guildScans}` } };
      }
      throw new Error("unexpected CLI command");
    };
    const cacheRoot = join(path, "cache");
    await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
    assert.equal(guildScans, mode === "ambiguous" ? 0 : mode === "unknown" ? 1 : 2);
    await assert.rejects(readFile(join(cacheRoot, "guild-test.json"), "utf8"), { code: "ENOENT" });
    await cleanup();
  }
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
  assert.equal(weekly.postTitle, "磁星环境、超新星因果链｜W40");
  assert.ok(weekly.md.startsWith(`# ${weekly.postTitle}\n`));
  // Enforce content-based title rather than generic filler
  assert.doesNotMatch(weekly.postTitle, /高能天体物理学术脉络总结/u);
  assert.ok(weekly.md.includes(archive.executive_summary));
  assert.match(weekly.md, /## 本周导读/u);
  assert.match(weekly.md, /## 建议优先阅读/u);
  assert.match(weekly.md, /## 各主题进展/u);
  assert.match(weekly.md, /2609\.31842/u);
  assert.match(weekly.md, /2609\.32726/u);
  assert.match(weekly.md, /2609\.31844/u);
  assert.match(weekly.md, /\/arxiv-weekly\//u);
});

test("Chinese labels rename existing sections in place and reject duplicate aliases", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-labels-", t);
  const channels = TOPICS.map(([key, title]) => ({ channel_id: key, channel_name: `${key} ${title}` }));
  let renames = 0;
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels } };
    if (args[1] === "modify-channel") { renames++; return { success: true }; }
    if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { feeds: [], has_more: false } };
    throw new Error("unexpected write");
  };
  const options = { guildId: "test", cacheRoot: path, cli, rename: true };
  assert.deepEqual(await provisionTopicChannels(options), Object.fromEntries(TOPICS.map(([key]) => [key, key])));
  assert.equal(renames, 7);
  assert.deepEqual(channels.map(c => c.channel_name), Object.values(TOPIC_LABELS));
  await provisionTopicChannels(options);
  assert.equal(renames, 7);
  channels.push({ channel_id: "duplicate", channel_name: `R1 ${TOPICS[0][1]}` });
  await assert.rejects(provisionTopicChannels(options), /CHANNEL_SECTION_AMBIGUOUS/u);
});

test("normal daily update includes one website-aligned brief and readable paper posts", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-brief-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist/arxiv-daily/2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { source: archive, includeBrief: true, dailyChannelId: "brief", distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, channelIds: Object.fromEntries(TOPICS.map(([key]) => [key, key])) };
  const first = await publishDailyFeed(options);
  assert.ok(first.published > 1);
  const brief = remote.feeds.filter(f => f.channel_id === "brief");
  assert.equal(brief.length, 1);
  assert.ok(brief[0].markdown_content.includes(archive.opening_brief.intro));
  const paper = remote.feeds.find(f => f.channel_id !== "brief");
  assert.match(paper.title, /\p{Script=Han}/u);
  assert.doesNotMatch(paper.markdown_content, /\bR[1-7]\b/u);
  assert.ok(paper.markdown_content.indexOf("研究了什么") < paper.markdown_content.indexOf("实际阅读范围"));
  assert.match(paper.markdown_content, /原标题：/u);
  const reentry = await publishDailyFeed(options);
  assert.equal(reentry.published + reentry.updated, 0);
});

test("reader expands group direction references only in reading reason, preserving scientific model labels and source", () => {
  const item = { arxiv_id: "2609.22426", revision: 1, title: "Engine", analysis: { priority: "must_read", coverage: {}, analysis: { problem: "研究引擎", result: "高速度遭遇模型R4中的黑洞。", reason: "核心关联 R1 中的引擎和 R2 中的喷流，涉及 R1–R7 核心方向。", unresolved_checks: ["R2 marks the flare"] } } };
  const original = JSON.stringify(item);
  const text = paperMarkdown(item, "2026-09-21", { primary: "R1", related: [] });
  assert.ok(text.includes("核心关联 中央引擎与能量注入 中的引擎和 伽马射线暴与相对论喷流 中的喷流，涉及 课题组各研究方向 核心方向。"));
  assert.ok(text.includes("高速度遭遇模型R4中的黑洞。"));
  assert.ok(text.includes("R2 marks the flare"));
  assert.equal(JSON.stringify(item), original);
});

test("current brief uses its built dated archive so backfill and normal delivery do not oscillate", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-brief-source-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const edition = structuredClone(archive);
  archive.opening_brief.intro += " 本期归档导读。";
  archive.radar.opening_brief.intro = archive.opening_brief.intro;
  const archiveRoot = join(path, "archive"); await mkdir(archiveRoot);
  const bytes = JSON.stringify(archive); await writeFile(join(archiveRoot, "2026-09-28.json"), bytes);
  const distRoot = join(path, "dist");
  const page = join(distRoot, "arxiv-daily/2026-09-28"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built dated archive");
  const sourceBinding = fixtureBinding({ archives: { "2026-09-28": hashBody(bytes) } });
  sourceBinding.daily.hash = hashBody(JSON.stringify({ feed: edition.feed, radar: edition.radar }));
  sourceBinding.id = hashBody(JSON.stringify({ daily: sourceBinding.daily, weekly: sourceBinding.weekly, archives: sourceBinding.archives }));
  const remote = fakeCli();
  const options = { archiveRoot, distRoot, cacheRoot: join(path, "cache"), guildId: "test", cli: remote.cli, sourceBinding, channelIds: Object.fromEntries(TOPICS.map(([key]) => [key, key])), channelId: "brief" };
  assert.equal((await publishHistoricalFeeds({ ...options, briefs: true })).published, 1);
  const daily = { ...options, includeBrief: true, dailyChannelId: "brief", readEdition: async () => ({ feed: edition.feed, radar: edition.radar, generation_id: sourceBinding.daily.generation_id, pointer: {} }) };
  const current = await publishDailyFeed(daily);
  assert.equal(current.updated, 0);
  assert.ok(remote.feeds.find(f => f.channel_id === "brief").markdown_content.includes(archive.opening_brief.intro));
  assert.equal((await publishHistoricalFeeds({ ...options, briefs: true })).unchanged, 1);
  await writeFile(join(archiveRoot, "2026-09-28.json"), bytes + "\n");
  const stale = await publishDailyFeed(daily);
  assert.ok(stale.errors.includes("CHANNEL_SOURCE_BUILD_MISMATCH"));
  assert.ok(stale.pending_items.some(x => x.identity === "daily-summary:2026-09-28"));
});

test("event chart is source-bound, capped at five and updates one persistent identity", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-events-", t);
  const eventsPath = join(path, "events.json");
  const data = { generated_at: "2026-10-03T00:00:00Z", events: Array.from({ length: 6 }, (_, i) => ({ event_id: `SN 2026${i}`, heat_score: 60 - i, paper_count: 1, last_updated: "2026-10-01", papers: [] })) };
  const save = async () => { const bytes = JSON.stringify(data); await writeFile(eventsPath, bytes); return { hash: hashBody(bytes), generated_at: data.generated_at }; };
  const remote = fakeCli();
  const options = { sourceBinding: fixtureBinding(), eventSnapshot: await save(), eventsPath, channelId: "brief", cacheRoot: join(path, "cache"), guildId: "test", cli: remote.cli };
  assert.equal((await publishEventRanking(options)).published, 1);
  assert.equal(remote.feeds[0].title, "瞬变源 Top 5");
  assert.equal((remote.feeds[0].markdown_content.match(/^## /gmu) || []).length, 5);
  assert.doesNotMatch(remote.feeds[0].markdown_content, /SN 20265/u);
  assert.equal((await publishEventRanking(options)).unchanged, 1);
  data.events[0].heat_score = 70;
  await save();
  assert.deepEqual((await publishEventRanking(options)).errors, ["CHANNEL_EVENTS_BUILD_MISMATCH"]);
  options.eventSnapshot = await save();
  assert.equal((await publishEventRanking(options)).updated, 1);
  assert.equal(remote.feeds.length, 1);
  assert.match(remote.feeds[0].markdown_content, /不等于物理重要性/u);
});

test("persistent chart recovers lost ledger without cloning and refuses duplicate identities", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-events-recovery-", t);
  const eventsPath = join(path, "events.json");
  const cacheRoot = join(path, "cache");
  const data = { generated_at: "2026-10-03T00:00:00Z", events: [] };
  const save = async () => { const bytes = JSON.stringify(data); await writeFile(eventsPath, bytes); return { hash: hashBody(bytes), generated_at: data.generated_at }; };
  const remote = fakeCli();
  const options = { sourceBinding: fixtureBinding(), eventSnapshot: await save(), eventsPath, channelId: "brief", cacheRoot, guildId: "test", cli: remote.cli };
  assert.equal((await publishEventRanking(options)).published, 1);
  const originalId = remote.feeds[0].feed_id;
  const reset = async () => writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: {} }));
  await reset();
  data.generated_at = "2026-10-03T01:00:00Z";
  options.eventSnapshot = await save();
  assert.equal((await publishEventRanking(options)).updated, 1);
  assert.equal(remote.feeds.length, 1);
  assert.equal(remote.feeds[0].feed_id, originalId);
  assert.equal((await publishEventRanking(options)).unchanged, 1);
  remote.feeds.push({ ...remote.feeds[0], feed_id: "duplicate" });
  await reset();
  const result = await publishEventRanking(options);
  assert.equal(result.published + result.updated, 0);
  assert.equal(result.pending_items[0].reason, "CHANNEL_UNKNOWN_OUTCOME");
  remote.feeds.pop();
  remote.feeds[0].markdown_content += "\nExternal correction";
  const externalBody = remote.feeds[0].markdown_content;
  const corrupted = await publishEventRanking(options);
  assert.equal(corrupted.pending_items[0].reason, "CHANNEL_REMOTE_MISMATCH");
  assert.equal(corrupted.published + corrupted.updated, 0);
  assert.equal(remote.feeds.length, 1);
  assert.equal(remote.feeds[0].markdown_content, externalBody);
});

test("chart edit timeout recovers same ID and external edits are preserved", async (t) => {
  for (const committed of [false, true]) {
    const { path } = await createTemporaryWorkspace("astro-lineage-channel-events-edit-", t);
    const eventsPath = join(path, "events.json");
    const cacheRoot = join(path, "cache");
    const data = { generated_at: "2026-10-03T00:00:00Z", events: [] };
    const save = async () => { const bytes = JSON.stringify(data); await writeFile(eventsPath, bytes); return { hash: hashBody(bytes), generated_at: data.generated_at }; };
    const remote = fakeCli();
    let failEdit = false;
    const cli = async (args) => {
      if (args[1] === "alter-feed" && failEdit) {
        failEdit = false;
        if (committed) await remote.cli(args);
        throw new Error("CHANNEL_TIMEOUT");
      }
      return remote.cli(args);
    };
    const options = { sourceBinding: fixtureBinding(), eventSnapshot: await save(), eventsPath, channelId: "brief", cacheRoot, guildId: "test", cli };
    assert.equal((await publishEventRanking(options)).published, 1);
    const priorBody = remote.feeds[0].markdown_content;
    const originalId = remote.feeds[0].feed_id;
    data.generated_at = "2026-10-03T01:00:00Z";
    options.eventSnapshot = await save();
    failEdit = true;
    assert.equal((await publishEventRanking(options)).errors[0], "CHANNEL_TIMEOUT");
    const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
    assert.equal(ledger.items["events:top5"].status, "intent");
    assert.equal(ledger.items["events:top5"].from_hash, priorBody.match(/([a-f0-9]{64}) -->$/u)[1]);
    const recovery = await publishEventRanking(options);
    assert.equal(recovery.pending, 0);
    assert.equal(recovery.updated, committed ? 0 : 1);
    assert.equal(remote.feeds.length, 1);
    assert.equal(remote.feeds[0].feed_id, originalId);
    assert.equal((await publishEventRanking(options)).unchanged, 1);
    remote.feeds[0].markdown_content += "\nExternal correction";
    const externalBody = remote.feeds[0].markdown_content;
    data.generated_at = "2026-10-03T02:00:00Z";
    options.eventSnapshot = await save();
    const result = await publishEventRanking(options);
    assert.equal(result.pending_items[0].reason, "CHANNEL_REMOTE_MISMATCH");
    assert.equal(result.published + result.updated, 0);
    assert.equal(remote.feeds[0].markdown_content, externalBody);
  }
});

test("historical daily briefs use their own cursor and do not republish papers", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-history-brief-", t);
  const archiveRoot = join(path, "archive");
  const cacheRoot = join(path, "cache");
  await mkdir(archiveRoot); await mkdir(cacheRoot);
  const bytes = await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url));
  await writeFile(join(archiveRoot, "2026-09-28.json"), bytes);
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: {}, backfill_cursor: 7 }));
  const page = join(path, "dist/arxiv-daily/2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { briefs: true, archiveRoot, distRoot: join(path, "dist"), cacheRoot, guildId: "test", channelId: "brief", cli: remote.cli, sourceBinding: fixtureBinding({ archives: { "2026-09-28": hashBody(bytes) } }) };
  assert.equal((await publishHistoricalFeeds(options)).published, 1);
  assert.equal((await publishHistoricalFeeds(options)).unchanged, 1);
  const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
  assert.equal(ledger.backfill_cursor, 7);
  assert.deepEqual(Object.keys(ledger.items), ["daily-summary:2026-09-28"]);
  assert.equal(remote.feeds.length, 1);
});
