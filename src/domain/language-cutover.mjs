/**
 * Language Cutover & Legacy Archive SSOT
 *
 * Defines the contract and boundaries for the English-only transition:
 * - Archives dated prior to LANGUAGE_CUTOVER_DATE / LANGUAGE_CUTOVER_WEEK are classified as legacy Chinese archives.
 * - Readers, UI components, and publishers use this SSOT to apply legacy notices and resolve display titles without breaking historical records.
 */

export const LANGUAGE_CUTOVER_DATE = "2026-10-27";
export const LANGUAGE_CUTOVER_WEEK = "2026-W44";

/**
 * Checks if a given daily date (YYYY-MM-DD) or weekly id (YYYY-Www) is a legacy archive.
 * @param {string} dateOrWeek
 * @returns {boolean}
 */
export function isLegacyChineseDate(dateOrWeek) {
  if (!dateOrWeek || typeof dateOrWeek !== "string") return false;
  const trimmed = dateOrWeek.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed < LANGUAGE_CUTOVER_DATE;
  }
  if (/^\d{4}-W\d{2}$/i.test(trimmed)) {
    return trimmed.toUpperCase() <= LANGUAGE_CUTOVER_WEEK;
  }
  return false;
}

/**
 * Resolves the primary display title of a paper, prioritizing English titles.
 * @param {object} paper
 * @returns {string}
 */
export function resolveDisplayTitle(paper) {
  if (!paper || typeof paper !== "object") return "";
  return paper.title_en || paper.title || paper.claim_title || paper.title_zh || "";
}

/**
 * Resolves a declarative scientific claim title if available, otherwise paper title.
 * @param {object} paper
 * @returns {string}
 */
export function resolveClaimTitle(paper) {
  if (!paper || typeof paper !== "object") return "";
  return paper.claim_title || paper.title_en || paper.title || paper.title_zh || "";
}
