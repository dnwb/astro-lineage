/**
 * Domain service for polling and ingesting multi-source academic journal feeds.
 */

import { JOURNAL_SOURCES, shouldPollSource, parseJournalFeedXml } from "./journal-adapter.mjs";

/**
 * Polls active journal feeds for a given target date, applies high-energy astrophysics filtering,
 * and returns standardized paper candidates.
 *
 * @param {object} options
 * @param {Date|string} [options.date] - Current execution or target date
 * @param {Array<string>} [options.sources] - List of journal source IDs to poll
 * @param {Function} [options.fetchFn] - Injected fetch function
 * @returns {Promise<Array<object>>}
 */
export async function pollActiveJournalCandidates({
  date = new Date(),
  sources = Object.keys(JOURNAL_SOURCES),
  fetchFn = fetch,
} = {}) {
  const candidates = [];

  for (const sourceId of sources) {
    if (!JOURNAL_SOURCES[sourceId]) {
      continue;
    }

    if (!shouldPollSource(sourceId, date)) {
      continue;
    }

    const sourceConfig = JOURNAL_SOURCES[sourceId];
    try {
      const response = await fetchFn(sourceConfig.rssUrl);
      if (!response || !response.ok) {
        continue;
      }

      const xmlText = await response.text();
      const extracted = parseJournalFeedXml(xmlText, sourceId);
      candidates.push(...extracted);
    } catch {
      // Gracefully swallow network/parsing errors to avoid blocking the broader pipeline
    }
  }

  return candidates;
}
