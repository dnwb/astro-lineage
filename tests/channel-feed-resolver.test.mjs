import test from "node:test";
import assert from "node:assert/strict";
import {
  getPublicationLedger,
  resolveFeedRecord,
  resolveFeedShareUrl,
  resolveWeeklyFeedShareUrl,
  resolveDailySummaryShareUrl,
  resolvePaperFeedShareUrl,
  clearLedgerCache,
  DEFAULT_CHANNEL_FALLBACK_URL,
} from "../scripts/channel-feed-resolver.mjs";

test("channel-feed-resolver loads ledger items and caches in memory", () => {
  clearLedgerCache();
  const items1 = getPublicationLedger();
  assert.ok(typeof items1 === "object" && items1 !== null);
  const items2 = getPublicationLedger();
  assert.equal(
    items1,
    items2,
    "Expected identical in-memory reference on subsequent call without file modification"
  );
});

test("channel-feed-resolver resolves 2026-W41 weekly feed share URL", () => {
  const url = resolveWeeklyFeedShareUrl("2026-W41");
  assert.match(url, /^https:\/\/pd\.qq\.com\/s\/[a-zA-Z0-9]+$/u);
  assert.equal(url, "https://pd.qq.com/s/b1a8tyyah");
});

test("channel-feed-resolver handles identity with weekly: prefix", () => {
  const url = resolveWeeklyFeedShareUrl("weekly:2026-W41");
  assert.equal(url, "https://pd.qq.com/s/b1a8tyyah");
});

test("channel-feed-resolver returns fallback URL for non-existent week", () => {
  const fallback = "https://pd.qq.com/s/customfallback";
  const url = resolveWeeklyFeedShareUrl("1999-W01", { fallbackUrl: fallback });
  assert.equal(url, fallback);

  const defaultUrl = resolveWeeklyFeedShareUrl("1999-W01");
  assert.equal(defaultUrl, DEFAULT_CHANNEL_FALLBACK_URL);
});

test("channel-feed-resolver returns fallback URL when input is empty or null", () => {
  assert.equal(resolveWeeklyFeedShareUrl(null), DEFAULT_CHANNEL_FALLBACK_URL);
  assert.equal(resolveDailySummaryShareUrl(""), DEFAULT_CHANNEL_FALLBACK_URL);
  assert.equal(resolvePaperFeedShareUrl(undefined), DEFAULT_CHANNEL_FALLBACK_URL);
});

test("channel-feed-resolver resolves paper feed share URL or falls back gracefully", () => {
  const fallback = "https://pd.qq.com/s/customfallback";
  const url = resolvePaperFeedShareUrl("9999.99999", { fallbackUrl: fallback });
  assert.equal(url, fallback);
});
