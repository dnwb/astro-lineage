import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_LEDGER_PATH = resolve(
  fileURLToPath(
    new URL("../.cache/channel-publication/guild-612912874093545504.json", import.meta.url)
  )
);
export const DEFAULT_CHANNEL_FALLBACK_URL = "https://pd.qq.com/s/4v70z48vi";

let cachedLedger = null;
let cachedMtime = 0;

/**
 * Returns the publication ledger items map in O(1) memory, invalidating only when file mtime changes.
 */
export function getPublicationLedger({ ledgerPath = DEFAULT_LEDGER_PATH } = {}) {
  try {
    const st = statSync(ledgerPath);
    if (!cachedLedger || cachedMtime !== st.mtimeMs) {
      const raw = readFileSync(ledgerPath, "utf8");
      cachedLedger = JSON.parse(raw);
      cachedMtime = st.mtimeMs;
    }
    return cachedLedger?.items || {};
  } catch {
    return cachedLedger?.items || {};
  }
}

/**
 * Clear the internal in-memory ledger cache (useful in tests).
 */
export function clearLedgerCache() {
  cachedLedger = null;
  cachedMtime = 0;
}

/**
 * Resolves a ledger publication record by identity key.
 */
export function resolveFeedRecord(identity, { ledgerPath = DEFAULT_LEDGER_PATH } = {}) {
  if (!identity) return null;
  const items = getPublicationLedger({ ledgerPath });
  return items[identity] || null;
}

/**
 * Resolves the precise share_url for a publication item, falling back gracefully to the provided fallbackUrl.
 */
export function resolveFeedShareUrl(
  identity,
  { ledgerPath = DEFAULT_LEDGER_PATH, fallbackUrl = DEFAULT_CHANNEL_FALLBACK_URL } = {}
) {
  const record = resolveFeedRecord(identity, { ledgerPath });
  if (
    record?.share_url &&
    typeof record.share_url === "string" &&
    record.share_url.startsWith("https://pd.qq.com/s/")
  ) {
    return record.share_url;
  }
  return fallbackUrl;
}

/**
 * Resolves the discussion thread share_url for a weekly synthesis edition (e.g. "2026-W41").
 */
export function resolveWeeklyFeedShareUrl(weekId, options = {}) {
  if (!weekId) return options.fallbackUrl || DEFAULT_CHANNEL_FALLBACK_URL;
  const cleanWeek = String(weekId).trim();
  const identity = cleanWeek.startsWith("weekly:") ? cleanWeek : `weekly:${cleanWeek}`;
  return resolveFeedShareUrl(identity, options);
}

/**
 * Resolves the discussion thread share_url for a daily radar batch (e.g. "2026-10-08").
 */
export function resolveDailySummaryShareUrl(date, options = {}) {
  if (!date) return options.fallbackUrl || DEFAULT_CHANNEL_FALLBACK_URL;
  const cleanDate = String(date).trim();
  const identity = cleanDate.startsWith("daily-summary:")
    ? cleanDate
    : `daily-summary:${cleanDate}`;
  return resolveFeedShareUrl(identity, options);
}

/**
 * Resolves the discussion thread share_url for a specific arXiv paper.
 */
export function resolvePaperFeedShareUrl(arxivId, options = {}) {
  if (!arxivId) return options.fallbackUrl || DEFAULT_CHANNEL_FALLBACK_URL;
  const cleanId = String(arxivId)
    .trim()
    .replace(/^arXiv:/i, "");
  const baseId = cleanId.replace(/v\d+$/i, "");
  const items = getPublicationLedger(options);

  // 1. Exact match with version: daily:2610.04367v1
  const direct = items[`daily:${cleanId}`];
  if (direct?.share_url && typeof direct.share_url === "string") {
    return direct.share_url;
  }

  // 2. Base ID match across revisions: daily:2610.04367*
  for (const [key, item] of Object.entries(items)) {
    if (
      key.startsWith(`daily:${baseId}`) &&
      item?.share_url &&
      typeof item.share_url === "string"
    ) {
      return item.share_url;
    }
  }

  return options.fallbackUrl || DEFAULT_CHANNEL_FALLBACK_URL;
}
