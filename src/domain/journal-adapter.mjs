/**
 * Domain adapter and classifier for peer-reviewed academic journals (Nature, Science, etc.)
 */

export const JOURNAL_SOURCES = Object.freeze({
  nature: {
    id: "nature",
    name: "Nature",
    cadence: "weekly",
    rssUrl: "https://www.nature.com/nature.rss",
    badge: "Nature",
  },
  "nature-astronomy": {
    id: "nature-astronomy",
    name: "Nature Astronomy",
    cadence: "weekly",
    rssUrl: "https://www.nature.com/natastron.rss",
    badge: "Nat Astron",
  },
  science: {
    id: "science",
    name: "Science",
    cadence: "weekly",
    rssUrl: "https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science",
    badge: "Science",
  },
});

/**
 * Returns a standardized badge label for a given academic source.
 *
 * @param {string} [source]
 * @returns {string}
 */
export function formatSourceBadge(source) {
  if (!source || source === "arxiv") {
    return "arXiv";
  }
  if (JOURNAL_SOURCES[source]) {
    return JOURNAL_SOURCES[source].badge;
  }
  return source;
}

/**
 * Formats a concise citation badge text (e.g., Vol./Issue or arXiv ID).
 * If volume and/or issue is provided: "Vol. 630, No. 8015" or "Vol. 630".
 * If only DOI is available: extract a concise article ref (e.g. "s41586-026-00001-2" instead of full URL/doi).
 * For arXiv papers: returns "arXiv:<id>".
 *
 * @param {object} item
 * @returns {string}
 */
export function formatPaperCitation(item) {
  if (!item) return "";
  if (!item.source || item.source === "arxiv") {
    return item.arxiv_id ? `arXiv:${item.arxiv_id}` : item.id || "";
  }

  const vol = item.volume ? `Vol. ${item.volume}` : "";
  const iss = item.issue ? `No. ${item.issue}` : "";
  if (vol && iss) return `${vol}, ${iss}`;
  if (vol) return vol;
  if (iss) return iss;

  // Concise short DOI fallback
  if (item.doi) {
    const shortDoi = item.doi.replace(/^10\.\d{4,9}\//u, "");
    return shortDoi || item.doi;
  }

  return item.id || "";
}

/**
 * Checks whether a given academic source should be polled on a specific date (evaluated in UTC+8 Beijing Time).
 *
 * @param {string} source - 'arxiv' | 'nature' | 'science' | etc.
 * @param {Date|string} dateOrTimestamp
 * @returns {boolean}
 */
export function shouldPollSource(source, dateOrTimestamp = new Date()) {
  const date = typeof dateOrTimestamp === "string" ? new Date(dateOrTimestamp) : dateOrTimestamp;
  const beijingDayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  });
  const weekday = beijingDayFormatter.format(date); // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'

  if (source === "arxiv") {
    // arXiv announces Monday through Friday
    return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  }

  if (source === "science") {
    // Science publishes new issues on Thursdays and Fridays
    return weekday === "Thu" || weekday === "Fri";
  }

  if (source === "nature" || source === "nature-astronomy") {
    // Nature Portfolio publishes new weekly issues primarily on Thursdays
    return weekday === "Thu";
  }

  return false;
}

/**
 * Standardizes a paper identifier into either an arXiv ID or a normalized doi: prefix.
 *
 * @param {string} rawId
 * @returns {string}
 */
export function normalizePaperIdentifier(rawId) {
  if (!rawId || typeof rawId !== "string") {
    return "";
  }
  const trimmed = rawId.trim();

  // arXiv ID patterns
  const arxivMatch = trimmed.match(/(?:arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  if (arxivMatch) {
    return arxivMatch[1];
  }

  // DOI patterns
  if (trimmed.startsWith("doi:")) {
    return trimmed;
  }
  if (trimmed.startsWith("10.")) {
    return `doi:${trimmed}`;
  }

  return trimmed;
}

/**
 * Keywords and concepts identifying high-energy astrophysics phenomena.
 */
const HE_KEYWORDS = [
  "gamma-ray burst",
  "gamma ray burst",
  "grb",
  "fast radio burst",
  "frb",
  "supernova",
  "supernovae",
  "kilonova",
  "kilonovae",
  "magnetar",
  "neutron star",
  "pulsar",
  "black hole",
  "microquasar",
  "active galactic nucleus",
  "active galactic nuclei",
  "agn",
  "blazar",
  "quasar",
  "gravitational wave",
  "compact binary",
  "tidal disruption event",
  "tde",
  "cosmic ray",
  "x-ray binary",
  "ultra-luminous x-ray",
  "neutrino",
];

const HE_REGEX = new RegExp(`\\b(${HE_KEYWORDS.join("|")})\\b`, "i");

/**
 * Checks whether an article candidate belongs to high-energy transient astrophysics.
 *
 * @param {{ title?: string, abstract?: string, categories?: string[] }} paper
 * @returns {boolean}
 */
export function isHighEnergyAstrophysicsPaper(paper) {
  if (!paper) return false;

  const content = `${paper.title || ""} ${paper.abstract || ""}`;
  return HE_REGEX.test(content);
}

/**
 * Decodes basic HTML entities and strips tags.
 *
 * @param {string} str
 * @returns {string}
 */
function stripHtml(str) {
  if (!str) return "";
  return str
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lightweight XML/RSS parser for journal feeds.
 *
 * @param {string} xmlText
 * @param {string} sourceId
 * @returns {Array<object>}
 */
export function parseJournalFeedXml(xmlText, sourceId = "nature") {
  if (!xmlText || typeof xmlText !== "string") {
    return [];
  }

  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemBlock = match[1];

    const titleMatch = itemBlock.match(/<title[\s>]([\s\S]*?)<\/title>/i);
    const linkMatch = itemBlock.match(/<link[\s>]([\s\S]*?)<\/link>/i);
    const descMatch = itemBlock.match(/<description[\s>]([\s\S]*?)<\/description>/i);
    const doiMatch = itemBlock.match(/<(?:prism:)?doi[\s>]([\s\S]*?)<\/(?:prism:)?doi>/i);
    const volMatch = itemBlock.match(/<(?:prism:)?volume[\s>]([\s\S]*?)<\/(?:prism:)?volume>/i);
    const issueMatch =
      itemBlock.match(/<(?:prism:)?number[\s>]([\s\S]*?)<\/(?:prism:)?number>/i) ||
      itemBlock.match(/<(?:prism:)?issue[\s>]([\s\S]*?)<\/(?:prism:)?issue>/i);
    const creatorMatch = itemBlock.match(/<dc:creator[\s>]([\s\S]*?)<\/dc:creator>/i);
    const dateMatch = itemBlock.match(/<(?:dc:)?date[\s>]([\s\S]*?)<\/(?:dc:)?date>/i);

    const title = stripHtml(titleMatch ? titleMatch[1] : "");
    const link = stripHtml(linkMatch ? linkMatch[1] : "");
    const summary = stripHtml(descMatch ? descMatch[1] : "");
    let rawDoi = stripHtml(doiMatch ? doiMatch[1] : "");
    if (!rawDoi && link) {
      const doiInLink = link.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
      if (doiInLink) {
        rawDoi = doiInLink[0];
      }
    }
    const volume = stripHtml(volMatch ? volMatch[1] : "");
    const issue = stripHtml(issueMatch ? issueMatch[1] : "");
    const rawCreator = stripHtml(creatorMatch ? creatorMatch[1] : "");
    const published = stripHtml(dateMatch ? dateMatch[1] : "");

    const authors = rawCreator
      ? rawCreator
          .split(/,\s*|\s+and\s+/i)
          .map((a) => a.trim())
          .filter(Boolean)
      : [];

    const candidate = {
      title,
      abstract: summary,
      link,
      doi: rawDoi,
      volume,
      issue,
      authors,
      published,
    };

    if (isHighEnergyAstrophysicsPaper(candidate)) {
      const id = normalizePaperIdentifier(rawDoi || link);
      items.push({
        id,
        source: sourceId,
        title,
        doi: rawDoi,
        volume,
        issue,
        url: link,
        authors,
        summary,
        published,
      });
    }
  }

  return items;
}
