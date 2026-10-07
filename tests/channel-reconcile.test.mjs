import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  extractFeedMarker,
  computeReconciliationDiff,
  formatDiffReport,
  runReconciliation,
} from "../scripts/channel-reconcile.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

test("extractFeedMarker parses identity and sha256 hash from markdown comments", () => {
  const content = "# Title\n\nBody content\n\n<!-- astrolineage-channel:daily:2609.12345v1:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890 -->";
  const marker = extractFeedMarker(content);
  assert.ok(marker);
  assert.equal(marker.identity, "daily:2609.12345v1");
  assert.equal(marker.hash, "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");

  assert.equal(extractFeedMarker("Normal text without marker"), null);
  assert.equal(extractFeedMarker(""), null);
  assert.equal(extractFeedMarker(null), null);
});

test("computeReconciliationDiff identifies matched feeds", () => {
  const hash = "1111111111111111111111111111111111111111111111111111111111111111";
  const ledgerItems = {
    "daily:2609.00001v1": {
      status: "published",
      feed_id: "feed-1",
      channel_id: "ch-1",
      hash,
    },
  };
  const remoteFeeds = [
    {
      feed_id: "feed-1",
      channel_id: "ch-1",
      title: "Sample Paper Title",
      markdown_content: `Body\n\n<!-- astrolineage-channel:daily:2609.00001v1:${hash} -->`,
    },
  ];

  const diff = computeReconciliationDiff({ ledgerItems, remoteFeeds });
  assert.equal(diff.summary.matched, 1);
  assert.equal(diff.summary.orphanRemote, 0);
  assert.equal(diff.summary.missingRemote, 0);
  assert.equal(diff.summary.drifted, 0);
  assert.equal(diff.matched[0].identity, "daily:2609.00001v1");
});

test("computeReconciliationDiff identifies orphan remote feeds", () => {
  const ledgerItems = {};
  const remoteFeeds = [
    {
      feed_id: "feed-orphan-1",
      channel_id: "ch-test",
      title: "Unrecorded manual test post",
      markdown_content: "Manual test without marker",
    },
  ];

  const diff = computeReconciliationDiff({ ledgerItems, remoteFeeds });
  assert.equal(diff.summary.matched, 0);
  assert.equal(diff.summary.orphanRemote, 1);
  assert.equal(diff.orphanRemote[0].feed_id, "feed-orphan-1");
  assert.equal(diff.orphanRemote[0].title, "Unrecorded manual test post");
});

test("computeReconciliationDiff identifies missing remote feeds in published ledger", () => {
  const ledgerItems = {
    "daily:2609.00002v1": {
      status: "published",
      feed_id: "feed-missing-1",
      channel_id: "ch-2",
      hash: "2222222222222222222222222222222222222222222222222222222222222222",
    },
  };
  const remoteFeeds = [];

  const diff = computeReconciliationDiff({ ledgerItems, remoteFeeds });
  assert.equal(diff.summary.missingRemote, 1);
  assert.equal(diff.missingRemote[0].identity, "daily:2609.00002v1");
  assert.equal(diff.missingRemote[0].feed_id, "feed-missing-1");
});

test("computeReconciliationDiff identifies drifted channel and content hash", () => {
  const hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const alteredHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const ledgerItems = {
    "daily:2609.00003v1": {
      status: "published",
      feed_id: "feed-drift-1",
      channel_id: "ch-expected",
      hash,
    },
  };
  const remoteFeeds = [
    {
      feed_id: "feed-drift-1",
      channel_id: "ch-actual-wrong",
      title: "Drifted Paper",
      markdown_content: `Modified body\n\n<!-- astrolineage-channel:daily:2609.00003v1:${alteredHash} -->`,
    },
  ];

  const diff = computeReconciliationDiff({ ledgerItems, remoteFeeds });
  assert.equal(diff.summary.matched, 0);
  assert.equal(diff.summary.drifted, 1);
  assert.equal(diff.drifted[0].identity, "daily:2609.00003v1");
  assert.ok(diff.drifted[0].reasons.some(r => r.includes("channel_drift")));
  assert.ok(diff.drifted[0].reasons.some(r => r.includes("hash_mismatch")));
});

test("formatDiffReport generates readable report string", () => {
  const diff = {
    summary: {
      totalLedger: 5,
      totalRemote: 5,
      matched: 3,
      orphanRemote: 1,
      missingRemote: 1,
      drifted: 0,
    },
    matched: [],
    orphanRemote: [{ feed_id: "orphan-1", channel_id: "ch-1", title: "Orphan Post" }],
    missingRemote: [{ identity: "daily:missing", feed_id: "missing-1", channel_id: "ch-2" }],
    drifted: [],
  };

  const report = formatDiffReport(diff);
  assert.match(report, /腾讯频道账本双向差异核对报告/u);
  assert.match(report, /总账本条目: 5/u);
  assert.match(report, /远端孤立帖 \(Orphan\):\s+1/u);
  assert.match(report, /feed_id: orphan-1/u);
  assert.match(report, /identity: daily:missing/u);
});

test("runReconciliation safety lock rejects --apply without --yes", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-reconcile-", t);
  const cacheRoot = join(path, "cache");
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: {} }));

  const fakeCli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { stdout: JSON.stringify({ channels: [] }) };
    if (args[1] === "get-channel-timeline-feeds") return { stdout: JSON.stringify({ feeds: [] }) };
    return { stdout: "{}" };
  };

  await assert.rejects(
    () => runReconciliation({
      guildId: "test",
      cacheRoot,
      apply: true,
      yes: false,
      cli: fakeCli,
    }),
    /RECONCILIATION_SAFETY_LOCK/u,
  );

  // Read-only run (default) executes successfully without error
  const report = await runReconciliation({
    guildId: "test",
    cacheRoot,
    apply: false,
    cli: fakeCli,
  });
  assert.equal(report.summary.totalRemote, 0);
  assert.equal(report.summary.matched, 0);
});
