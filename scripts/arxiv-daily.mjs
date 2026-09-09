import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileDailyRadarEdition, validateDailyRadarPayload } from "./daily-radar.mjs";

export const DEFAULT_QUERY = "cat:astro-ph.HE OR cat:astro-ph.GA";
export const DEFAULT_FEED_URL = "https://export.arxiv.org/api/query";
export const DEFAULT_OUTPUT = fileURLToPath(new URL("../src/data/arxiv-daily.json", import.meta.url));
export const DEFAULT_RADAR_OUTPUT = fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url));
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const ARXIV_PARSER_VERSION = "2026-09-08.atom-v2";
export const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
export const DEFAULT_TIME_ZONE = "America/New_York";
export const ANNOUNCEMENT_CUTOFF_LOCAL_TIME = "14:00";
export const ANNOUNCEMENT_LOCAL_TIME = "20:00";
export const ANNOUNCEMENT_WEEKDAYS = Object.freeze(["Sun", "Mon", "Tue", "Wed", "Thu"]);
// arXiv's announcement schedule groups submissions by the preceding cutoff
// interval.  Sunday is the short Thursday-to-Friday batch; Monday consumes
// the Friday-to-Monday weekend interval.  These offsets are the local calendar
// dates of the 14:00 America/New_York cutoffs, not a fixed UTC duration.
export const ANNOUNCEMENT_BATCH_OFFSETS = Object.freeze({
  Sun: Object.freeze({ start: -3, end: -2 }),
  Mon: Object.freeze({ start: -3, end: 0 }),
  Tue: Object.freeze({ start: -1, end: 0 }),
  Wed: Object.freeze({ start: -1, end: 0 }),
  Thu: Object.freeze({ start: -1, end: 0 }),
});
export const DEFAULT_PAGE_SIZE = 2_000;
export const DEFAULT_MIN_REQUEST_INTERVAL_MS = 3_000;
export const DEFAULT_ARTIFACT_ROOT = fileURLToPath(new URL("../.cache/arxiv-daily", import.meta.url));
export const DEFAULT_SNAPSHOT_RETENTION = 7;
export const SNAPSHOT_SCHEMA_VERSION = "arxiv-daily-snapshot-v1";
export const RUN_STATE_SCHEMA_VERSION = "arxiv-daily-run-state-v1";
export const PUBLISHED_GENERATION_SCHEMA_VERSION = "astrolineage-published-generation-v1";
export const PUBLISHED_POINTER_SCHEMA_VERSION = "astrolineage-published-pointer-v1";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class ArxivFeedError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ArxivFeedError";
    this.code = code;
  }
}

function decodeXml(value) {
  if (/&(?!#x[0-9a-f]+;|#[0-9]+;|amp;|lt;|gt;|quot;|apos;)/iu.test(String(value))) {
    xmlFailure("XML 包含未知或未转义的 &。");
  }
  const decoded = String(value).replaceAll(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/giu, (entity, code) => {
    if (code.toLowerCase() === "amp") return "&";
    if (code.toLowerCase() === "lt") return "<";
    if (code.toLowerCase() === "gt") return ">";
    if (code.toLowerCase() === "quot") return '"';
    if (code.toLowerCase() === "apos") return "'";
    const numeric = code.startsWith("#x") || code.startsWith("#X")
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff || (numeric >= 0xd800 && numeric <= 0xdfff)) {
      xmlFailure(`XML 实体无效：${entity}`);
    }
    return String.fromCodePoint(numeric);
  });
  return decoded;
}

function localName(name) {
  return String(name).split(":").at(-1).toLowerCase();
}

function isWhitespace(value) {
  return /\s/u.test(value);
}

function xmlFailure(message) {
  throw new ArxivFeedError("ARXIV_XML_INVALID", message);
}

function readName(source, start) {
  const match = String(source).slice(start).match(/^[A-Za-z_][A-Za-z0-9_.:-]*/u);
  return match ? { name: match[0], end: start + match[0].length } : null;
}

function parseAttributes(source, start, end) {
  const attributes = {};
  let cursor = start;
  while (cursor < end) {
    while (cursor < end && isWhitespace(source[cursor])) cursor += 1;
    if (cursor >= end) break;
    const name = readName(source, cursor);
    if (!name) xmlFailure("属性名无效。");
    cursor = name.end;
    while (cursor < end && isWhitespace(source[cursor])) cursor += 1;
    if (source[cursor] !== "=") xmlFailure(`属性 ${name.name} 缺少等号。`);
    cursor += 1;
    while (cursor < end && isWhitespace(source[cursor])) cursor += 1;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") xmlFailure(`属性 ${name.name} 必须使用引号。`);
    cursor += 1;
    const valueStart = cursor;
    while (cursor < end && source[cursor] !== quote) cursor += 1;
    if (cursor >= end) xmlFailure(`属性 ${name.name} 没有闭合。`);
    attributes[name.name] = decodeXml(source.slice(valueStart, cursor));
    cursor += 1;
  }
  return attributes;
}

function findTagEnd(source, start) {
  let quote = null;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor;
    }
  }
  return -1;
}

function parseXmlDocument(xml) {
  const source = String(xml).replace(/^\uFEFF/u, "");
  const document = { name: "#document", attributes: {}, children: [], content: [] };
  const stack = [document];
  let cursor = 0;

  const appendText = (node, value) => node.content.push(value);

  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    if (open < 0) {
      appendText(stack.at(-1), decodeXml(source.slice(cursor)));
      cursor = source.length;
      break;
    }
    if (open > cursor) appendText(stack.at(-1), decodeXml(source.slice(cursor, open)));

    if (source.startsWith("<!--", open)) {
      const close = source.indexOf("-->", open + 4);
      if (close < 0) xmlFailure("XML 注释没有闭合。");
      cursor = close + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const close = source.indexOf("]]>", open + 9);
      if (close < 0) xmlFailure("CDATA 没有闭合。");
      appendText(stack.at(-1), source.slice(open + 9, close));
      cursor = close + 3;
      continue;
    }
    if (source.startsWith("<?", open)) {
      const close = source.indexOf("?>", open + 2);
      if (close < 0) xmlFailure("XML processing instruction 没有闭合。");
      cursor = close + 2;
      continue;
    }
    if (source.startsWith("<!", open)) xmlFailure("不支持的 XML declaration。");

    const close = findTagEnd(source, open + 1);
    if (close < 0) xmlFailure("XML 标签没有闭合。");
    if (source[open + 1] === "/") {
      const name = readName(source, open + 2);
      if (!name) xmlFailure("结束标签名无效。");
      let tail = name.end;
      while (tail < close && isWhitespace(source[tail])) tail += 1;
      if (tail !== close || localName(stack.at(-1).name) !== localName(name.name)) {
        xmlFailure(`结束标签 ${name.name} 与开始标签不匹配。`);
      }
      stack.pop();
      cursor = close + 1;
      continue;
    }

    let tagEnd = close;
    while (tagEnd > open + 1 && isWhitespace(source[tagEnd - 1])) tagEnd -= 1;
    const selfClosing = source[tagEnd - 1] === "/";
    if (selfClosing) tagEnd -= 1;
    const name = readName(source, open + 1);
    if (!name || name.end > tagEnd) xmlFailure("开始标签名无效。");
    const node = {
      name: name.name,
      attributes: parseAttributes(source, name.end, tagEnd),
      children: [],
      content: [],
    };
    stack.at(-1).children.push(node);
    stack.at(-1).content.push(node);
    if (!selfClosing) stack.push(node);
    cursor = close + 1;
  }

  if (stack.length !== 1) xmlFailure(`标签 ${stack.at(-1).name} 没有闭合。`);
  if (document.content.some((part) => typeof part === "string" && part.trim() !== "")) {
    xmlFailure("XML 根元素外存在非空文本。");
  }
  const roots = document.children.filter((child) => child.name !== "#text");
  if (roots.length !== 1) xmlFailure("XML 必须有且只有一个根元素。");
  return roots[0];
}

function childNodes(node, wantedName) {
  const normalizedName = localName(wantedName);
  return (node?.children ?? []).filter((child) => localName(child.name) === normalizedName);
}

function childNode(node, wantedName) {
  return childNodes(node, wantedName)[0] ?? null;
}

function nodeText(node) {
  if (!node) return "";
  return (node.content ?? []).map((part) => typeof part === "string" ? part : nodeText(part)).join("");
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function partsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

function localDateFor(date, timeZone) {
  const parts = partsInTimeZone(date, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localWeekdayFor(dateOnly, timeZone) {
  const noon = localDateTimeToUtc(dateOnly, "12:00", timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(noon);
}

function assertDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new ArxivFeedError("ARXIV_WINDOW_INVALID", `公告日必须是 YYYY-MM-DD：${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new ArxivFeedError("ARXIV_WINDOW_INVALID", `公告日不是有效日期：${value}`);
  }
  return { year, month, day };
}

function addCalendarDays(value, amount = 1) {
  const { year, month, day } = assertDateOnly(value);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function localDateTimeToUtc(dateOnly, localTime, timeZone) {
  const { year, month, day } = assertDateOnly(dateOnly);
  const timeMatch = String(localTime).match(/^(\d{2}):(\d{2})$/u);
  if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) {
    throw new ArxivFeedError("ARXIV_WINDOW_INVALID", `本地时间无效：${localTime}`);
  }
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  let guess = Date.UTC(year, month - 1, day);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = partsInTimeZone(new Date(guess), timeZone);
    const renderedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess = Date.UTC(year, month - 1, day, hour, minute) - (renderedAsUtc - guess);
  }
  return new Date(guess);
}

function localBoundaryIso(dateOnly, localTime, utcDate, timeZone) {
  const parts = partsInTimeZone(utcDate, timeZone);
  const offsetMinutes = Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - utcDate.valueOf()) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const minutes = String(absoluteOffset % 60).padStart(2, "0");
  return `${dateOnly}T${localTime}:00${sign}${hours}:${minutes}`;
}

function apiDateTime(date) {
  const iso = date.toISOString();
  return iso.slice(0, 16).replaceAll(/[-:T]/gu, "");
}

export function buildAnnouncementWindow({ announcementDate, now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new ArxivFeedError("ARXIV_WINDOW_INVALID", "窗口参考时间必须是有效 Date。");
  }
  let date = announcementDate ?? localDateFor(now, timeZone);
  assertDateOnly(date);
  const weekday = localWeekdayFor(date, timeZone);
  if (!ANNOUNCEMENT_WEEKDAYS.includes(weekday)) {
    throw new ArxivFeedError("ARXIV_WINDOW_INVALID", `公告日 ${date} 没有 arXiv 公告批次。`);
  }
  const offsets = ANNOUNCEMENT_BATCH_OFFSETS[weekday];
  const submissionStartDate = addCalendarDays(date, offsets.start);
  const submissionEndDate = addCalendarDays(date, offsets.end);
  const utcStartDate = localDateTimeToUtc(submissionStartDate, ANNOUNCEMENT_CUTOFF_LOCAL_TIME, timeZone);
  const utcEndDate = localDateTimeToUtc(submissionEndDate, ANNOUNCEMENT_CUTOFF_LOCAL_TIME, timeZone);
  return {
    kind: "announcement_batch",
    batch_id: `announcement-${date}`,
    announcement_date: date,
    announcement_weekday: weekday,
    time_zone: timeZone,
    cutoff_local_time: ANNOUNCEMENT_CUTOFF_LOCAL_TIME,
    announcement_local_time: ANNOUNCEMENT_LOCAL_TIME,
    submission_start_date: submissionStartDate,
    submission_end_date: submissionEndDate,
    local_start: localBoundaryIso(submissionStartDate, ANNOUNCEMENT_CUTOFF_LOCAL_TIME, utcStartDate, timeZone),
    local_end: localBoundaryIso(submissionEndDate, ANNOUNCEMENT_CUTOFF_LOCAL_TIME, utcEndDate, timeZone),
    utc_start: utcStartDate.toISOString(),
    utc_end: utcEndDate.toISOString(),
    api_start: apiDateTime(utcStartDate),
    api_end: apiDateTime(utcEndDate),
  };
}

export function normalizeArxivId(value) {
  let candidate = String(value ?? "").trim();
  candidate = candidate.replace(/^arxiv:/iu, "");
  try {
    const url = new URL(candidate);
    if (["http:", "https:"].includes(url.protocol) && ["arxiv.org", "export.arxiv.org"].includes(url.hostname.toLowerCase())) {
      candidate = decodeURIComponent(url.pathname).replace(/^\/(?:abs|pdf|src)\//iu, "");
    }
  } catch {
    candidate = candidate.replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf|src)\//iu, "");
  }
  candidate = candidate.replace(/\.pdf$/iu, "").replace(/\/$/u, "");
  const revision = candidate.match(/v([1-9]\d*)$/iu);
  if (revision) candidate = candidate.slice(0, -revision[0].length);
  return {
    arxiv_id: candidate.toLowerCase(),
    revision: revision ? Number(revision[1]) : null,
  };
}

function isValidArxivId(value) {
  return /^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9-]*(?:\.[a-z]{2})?\/\d{7})$/iu.test(value);
}

function canonicalUrl(identity) {
  return `https://arxiv.org/abs/${identity.arxiv_id}v${identity.revision}`;
}

function linkIdentity(href) {
  if (!/^https?:\/\//iu.test(String(href ?? ""))) return null;
  try {
    const url = new URL(href);
    if (!["arxiv.org", "export.arxiv.org"].includes(url.hostname.toLowerCase())) return null;
    const identity = normalizeArxivId(href);
    return isValidArxivId(identity.arxiv_id) && Number.isInteger(identity.revision) && identity.revision >= 1
      ? identity
      : null;
  } catch {
    return null;
  }
}

function resolveEntryIdentity(entry) {
  const identity = normalizeArxivId(nodeText(childNode(entry, "id")));
  if (!identity.arxiv_id) throw new ArxivFeedError("ARXIV_ENTRY_INVALID", "entry 缺少 arXiv ID。");

  const linkedIdentities = childNodes(entry, "link")
    .map((link) => linkIdentity(link.attributes.href))
    .filter((linkedIdentity) => linkedIdentity?.arxiv_id === identity.arxiv_id);
  const linkedRevisions = new Set(linkedIdentities.map(({ revision }) => revision));
  if (identity.revision !== null) {
    if ([...linkedRevisions].some((revision) => revision !== identity.revision)) {
      throw new ArxivFeedError("ARXIV_ENTRY_REVISION_CONFLICT", `entry ${identity.arxiv_id} 的链接 revision 不一致。`);
    }
    return identity;
  }
  if (linkedRevisions.size === 1) {
    return { ...identity, revision: [...linkedRevisions][0] };
  }
  if (linkedRevisions.size > 1) {
    throw new ArxivFeedError("ARXIV_ENTRY_REVISION_CONFLICT", `entry ${identity.arxiv_id} 的链接包含多个 revision。`);
  }
  throw new ArxivFeedError("ARXIV_ENTRY_REVISION_MISSING", `entry ${identity.arxiv_id} 缺少明确 revision。`);
}

function integerMetadata(node, field) {
  if (!node) return undefined;
  const value = normalizeWhitespace(nodeText(node));
  const parsed = Number.parseInt(value, 10);
  if (!/^\d+$/u.test(value) || !Number.isInteger(parsed)) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", `Atom ${field} 不是整数。`);
  }
  return parsed;
}

function selectAbstractLink(entry, identity) {
  const candidates = childNodes(entry, "link")
    .map((link) => ({
      href: link.attributes.href,
      rel: String(link.attributes.rel ?? "").toLowerCase(),
      type: String(link.attributes.type ?? "").toLowerCase(),
    }))
    .filter((link) => {
      if (!/^https?:\/\//iu.test(link.href ?? "")) return false;
      try {
        const url = new URL(link.href);
        if (!["arxiv.org", "export.arxiv.org"].includes(url.hostname.toLowerCase())) return false;
        const linkIdentity = normalizeArxivId(link.href);
        return linkIdentity.arxiv_id === identity.arxiv_id && linkIdentity.revision === identity.revision;
      } catch {
        return false;
      }
    })
    .filter((link) => link.rel === "alternate" || link.type === "text/html" || /\/abs\//iu.test(link.href))
    .sort((left, right) => {
      const score = (link) =>
        (link.rel === "alternate" ? 4 : 0) +
        (link.type === "text/html" ? 2 : 0) +
        (/\/abs\//iu.test(link.href) ? 1 : 0);
      return score(right) - score(left);
    });
  return candidates[0]?.href?.replace(/^http:\/\//iu, "https://") ?? canonicalUrl(identity);
}

function parseArxivDocument(xml) {
  const root = parseXmlDocument(xml);
  if (localName(root.name) !== "feed") throw new ArxivFeedError("ARXIV_FEED_INVALID", "响应不是 Atom feed。");
  if (root.attributes.xmlns !== "http://www.w3.org/2005/Atom") {
    throw new ArxivFeedError("ARXIV_FEED_NAMESPACE_INVALID", "响应不是官方 Atom namespace。");
  }

  const entries = [];
  const seen = new Map();
  const entryNodes = childNodes(root, "entry");
  const feedTitle = normalizeWhitespace(nodeText(childNode(root, "title")));
  if (entryNodes.length === 0 && /error|failure|invalid/iu.test(feedTitle)) {
    throw new ArxivFeedError("ARXIV_FEED_ERROR", `arXiv 返回错误 feed：${feedTitle}`);
  }

  for (const entry of entryNodes) {
    const identity = resolveEntryIdentity(entry);
    if (!isValidArxivId(identity.arxiv_id)) {
      throw new ArxivFeedError("ARXIV_ENTRY_ID_INVALID", `entry ${identity.arxiv_id} 不是合法 arXiv ID。`);
    }
    if (!Number.isInteger(identity.revision) || identity.revision < 1) {
      throw new ArxivFeedError("ARXIV_ENTRY_REVISION_MISSING", `entry ${identity.arxiv_id} 缺少明确 revision。`);
    }
    const titleNode = childNode(entry, "title");
    const summaryNode = childNode(entry, "summary");
    const publishedNode = childNode(entry, "published");
    const updatedNode = childNode(entry, "updated");
    const title = normalizeWhitespace(nodeText(titleNode));
    const abstract = normalizeWhitespace(nodeText(summaryNode));
    const published = normalizeWhitespace(nodeText(publishedNode));
    const updated = normalizeWhitespace(nodeText(updatedNode));
    if (!title || !summaryNode || !published || !updated) {
      throw new ArxivFeedError("ARXIV_ENTRY_INVALID", `entry ${identity.arxiv_id} 缺少必需字段。`);
    }
    const authors = childNodes(entry, "author")
      .map((author) => normalizeWhitespace(nodeText(childNode(author, "name"))))
      .filter(Boolean);
    if (authors.length === 0) throw new ArxivFeedError("ARXIV_ENTRY_INVALID", `entry ${identity.arxiv_id} 缺少作者。`);
    const categories = childNodes(entry, "category")
      .map((category) => normalizeWhitespace(category.attributes.term ?? ""))
      .filter(Boolean);
    const primaryCategory = childNode(entry, "primary_category")?.attributes.term;
    const parsed = {
      arxiv_id: identity.arxiv_id,
      revision: identity.revision,
      title,
      abstract,
      published,
      updated,
      authors,
      url: selectAbstractLink(entry, identity),
    };
    if (categories.length > 0) parsed.categories = [...new Set(categories)];
    if (primaryCategory) parsed.primary_category = primaryCategory;

    const key = `${identity.arxiv_id}@v${identity.revision}`;
    const previous = seen.get(key);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(parsed)) {
        throw new ArxivFeedError("ARXIV_DUPLICATE_CONFLICT", `entry ${key} 重复但内容不一致。`);
      }
      continue;
    }
    seen.set(key, parsed);
    entries.push(parsed);
  }

  const metadata = {
    total_results: integerMetadata(childNode(root, "totalResults"), "totalResults"),
    start_index: integerMetadata(childNode(root, "startIndex"), "startIndex"),
    items_per_page: integerMetadata(childNode(root, "itemsPerPage"), "itemsPerPage"),
  };
  const startIndex = metadata.start_index ?? 0;
  if (metadata.total_results !== undefined && (metadata.total_results < 0 || startIndex < 0)) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "Atom 分页元数据包含负数。");
  }
  if (metadata.items_per_page !== undefined && metadata.items_per_page < entries.length) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "Atom 分页元数据小于实际条目数。");
  }
  if (metadata.total_results !== undefined && metadata.total_results > startIndex && entries.length === 0) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "Atom 声明存在结果但当前页为空。");
  }
  if (metadata.total_results !== undefined && metadata.total_results < startIndex + entries.length) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "Atom 当前页超出 totalResults。");
  }
  return {
    entries,
    metadata: Object.fromEntries(Object.entries(metadata).filter(([, value]) => Number.isInteger(value))),
  };
}

export function parseArxivFeedPage(xml) {
  return parseArxivDocument(xml);
}

export function parseArxivFeed(xml) {
  return parseArxivFeedPage(xml).entries;
}

export function feedUrl({ query = DEFAULT_QUERY, maxResults = DEFAULT_PAGE_SIZE, start = 0 } = {}) {
  const params = new URLSearchParams({
    search_query: query,
    sortBy: "submittedDate",
    sortOrder: "descending",
    start: String(start),
    max_results: String(maxResults),
  });
  return `${DEFAULT_FEED_URL}?${params.toString()}`;
}

function effectiveAnnouncementQuery(query, window) {
  return `(${query}) AND submittedDate:[${window.api_start} TO ${window.api_end}]`;
}

function mergePageEntries(entryMap, entries) {
  for (const entry of entries) {
    const key = `${entry.arxiv_id}@v${entry.revision}`;
    const previous = entryMap.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      throw new ArxivFeedError("ARXIV_DUPLICATE_CONFLICT", `分页中 ${key} 重复但内容不一致。`);
    }
    entryMap.set(key, entry);
  }
}

function entriesInWindow(entries, window) {
  const start = Date.parse(window.utc_start);
  const end = Date.parse(window.utc_end);
  return entries.filter((entry) => {
    const published = Date.parse(entry.published);
    if (Number.isNaN(published)) {
      throw new ArxivFeedError("ARXIV_ENTRY_DATE_INVALID", `entry ${entry.arxiv_id} 的 published 不是有效日期。`);
    }
    return published >= start && published < end;
  });
}

function pageMetadataFor(parsed, requestedStart, pageSize, { requireComplete = false } = {}) {
  const metadata = parsed.metadata;
  if (requireComplete && ["total_results", "start_index", "items_per_page"].some((field) => metadata[field] === undefined)) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "Atom 缺少完整分页元数据。需要 totalResults、startIndex 和 itemsPerPage。");
  }
  if (metadata.start_index !== undefined && metadata.start_index !== requestedStart) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", `Atom startIndex ${metadata.start_index} 与请求 ${requestedStart} 不一致。`);
  }
  if (metadata.items_per_page !== undefined && metadata.items_per_page !== parsed.entries.length) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "Atom itemsPerPage 与当前页条目数不一致。");
  }
  if (parsed.entries.length > pageSize) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "当前页条目数超过请求的 max_results。");
  }
  const start = metadata.start_index ?? requestedStart;
  const itemCount = metadata.items_per_page ?? parsed.entries.length;
  if (itemCount === 0 && parsed.entries.length > 0) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "非空页的 itemsPerPage 不能为零。");
  }
  return { ...metadata, start_index: start, items_per_page: itemCount };
}

function createRequestGate({ minRequestIntervalMs, sleepImpl, deadline }) {
  let lastRequestAt;
  return async function waitForRequest() {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new ArxivFeedError("ARXIV_REQUEST_TIMEOUT", "arXiv 刷新超过整轮时间预算。");
    }
    if (lastRequestAt !== undefined) {
      const waitMs = Math.max(0, minRequestIntervalMs - (Date.now() - lastRequestAt));
      if (waitMs >= deadline - Date.now()) {
        throw new ArxivFeedError("ARXIV_REQUEST_TIMEOUT", "请求节流等待超过整轮时间预算。");
      }
      if (waitMs > 0) await sleepImpl(waitMs);
      if (deadline - Date.now() <= 0) {
        throw new ArxivFeedError("ARXIV_REQUEST_TIMEOUT", "arXiv 刷新超过整轮时间预算。");
      }
    }
    lastRequestAt = Date.now();
  };
}

async function fetchPaginatedFeed({
  query,
  window,
  pageSize,
  start = 0,
  maxPages,
  minRequestIntervalMs,
  fetchImpl,
  timeoutMs,
  maxAttempts,
  sleepImpl,
  now,
  totalTimeoutMs,
  snapshotRun,
}) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > DEFAULT_PAGE_SIZE) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", `pageSize 必须在 1 到 ${DEFAULT_PAGE_SIZE} 之间。`);
  }
  if (!Number.isInteger(start) || start < 0) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "分页起点必须是非负整数。");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "maxPages 必须是正整数。");
  }
  if (!Number.isFinite(minRequestIntervalMs) || minRequestIntervalMs < 0) {
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "请求间隔不能为负数。");
  }

  const deadline = Date.now() + totalTimeoutMs;
  const effectiveQuery = effectiveAnnouncementQuery(query, window);
  const entryMap = new Map();
  const pages = [];
  let requestedStart = start;
  let totalResults;
  const requestGate = createRequestGate({ minRequestIntervalMs, sleepImpl, deadline });

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const sourceUrl = feedUrl({ query: effectiveQuery, maxResults: pageSize, start: requestedStart });
    const { response, rawXml } = await fetchFeed({
      sourceUrl,
      fetchImpl,
      timeoutMs,
      maxAttempts,
      sleepImpl,
      now,
      totalTimeoutMs,
      deadline,
      requestGate,
    });
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (snapshotRun) {
      await snapshotRun.capturePage({
        pageIndex,
        requestedStart,
        sourceUrl,
        rawXml,
        contentType,
      });
    }
    if (contentType && !/(?:application|text)\/(?:atom\+xml|xml)(?:;|$)/iu.test(contentType)) {
      throw new ArxivFeedError("ARXIV_RESPONSE_NOT_XML", `arXiv API 返回了非 XML 内容：${contentType}`);
    }
    const parsed = parseArxivDocument(rawXml);
    const metadata = pageMetadataFor(parsed, requestedStart, pageSize, { requireComplete: true });
    if (totalResults === undefined) totalResults = metadata.total_results;
    if (metadata.total_results !== undefined && totalResults !== metadata.total_results) {
      throw new ArxivFeedError("ARXIV_PAGINATION_DRIFT", "分页中的 totalResults 发生变化，拒绝发布不一致 edition。");
    }
    if (totalResults !== undefined && totalResults > 30_000) {
      throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "arXiv API 结果超过官方单次查询上限。");
    }
    mergePageEntries(entryMap, parsed.entries);
    const page = {
      index: pageIndex,
      start: metadata.start_index,
      requested_max_results: pageSize,
      source_url: sourceUrl,
      response_sha256: createHash("sha256").update(rawXml).digest("hex"),
      total_results: metadata.total_results,
      items_per_page: metadata.items_per_page,
      entry_count: parsed.entries.length,
      window_entry_count: entriesInWindow(parsed.entries, window).length,
    };
    if (snapshotRun) await snapshotRun.completePage(pageIndex, page);
    pages.push(page);

    const pageEnd = metadata.start_index + metadata.items_per_page;
    if (totalResults !== undefined) {
      if (totalResults === 0) break;
      if (parsed.entries.length === 0 || pageEnd <= requestedStart) {
        throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "分页未向前推进或在声明的结果结束前返回空页。");
      }
      if (pageEnd >= totalResults) break;
      requestedStart = pageEnd;
      continue;
    }
    if (parsed.entries.length < pageSize) break;
    throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "缺少 totalResults，无法证明完整分页已获取。");
  }

  if (pages.length >= maxPages && totalResults !== undefined) {
    const lastPage = pages.at(-1);
    const pageEnd = lastPage.start + lastPage.items_per_page;
    if (pageEnd < totalResults) {
      throw new ArxivFeedError("ARXIV_PAGINATION_INVALID", "分页超过 maxPages 仍未覆盖 totalResults。");
    }
  }
  const entries = entriesInWindow([...entryMap.values()], window);
  entries.sort((left, right) => left.published.localeCompare(right.published) || `${left.arxiv_id}@v${left.revision}`.localeCompare(`${right.arxiv_id}@v${right.revision}`));
  return { query: effectiveQuery, pages, totalResults: totalResults ?? entries.length, entries };
}

function retryAfterMs(response, now = Date.now()) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - (now instanceof Date ? now.valueOf() : now));
}

function defaultSleep(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

async function fetchFeed({ sourceUrl, fetchImpl, timeoutMs, maxAttempts, sleepImpl, totalTimeoutMs, deadline = Date.now() + totalTimeoutMs, requestGate }) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      lastError = new ArxivFeedError("ARXIV_REQUEST_TIMEOUT", "arXiv 刷新超过整轮时间预算。");
      break;
    }
    let timeout;
    let timedOut = false;
    try {
      await requestGate();
      const requestRemainingMs = deadline - Date.now();
      if (requestRemainingMs <= 0) {
        throw new ArxivFeedError("ARXIV_REQUEST_TIMEOUT", "arXiv 刷新超过整轮时间预算。");
      }
      const controller = new AbortController();
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, Math.min(timeoutMs, requestRemainingMs));
      const response = await fetchImpl(sourceUrl, {
        headers: { accept: "application/atom+xml, application/xml, text/xml" },
        signal: controller.signal,
      });
      if (RETRYABLE_STATUSES.has(response.status) && attempt < maxAttempts) {
        const retryDelay = retryAfterMs(response) ?? 500 * 2 ** (attempt - 1);
        if (retryDelay >= deadline - Date.now()) {
          lastError = new ArxivFeedError("ARXIV_REQUEST_TIMEOUT", "arXiv 重试等待超过整轮时间预算。");
          break;
        }
        await sleepImpl(retryDelay);
        continue;
      }
      if (!response.ok) throw new ArxivFeedError("ARXIV_REQUEST_FAILED", `arXiv API request failed: HTTP ${response.status}`);
      const rawXml = await response.text();
      return { response, rawXml };
    } catch (error) {
      lastError = timedOut
        ? new ArxivFeedError("ARXIV_REQUEST_TIMEOUT", `arXiv 请求超时：${sourceUrl}`, { cause: error })
        : error;
      const isRetryableError = error?.name === "AbortError" || !(error instanceof ArxivFeedError);
      if (!isRetryableError || attempt >= maxAttempts) break;
      const retryDelay = 500 * 2 ** (attempt - 1);
      if (retryDelay >= deadline - Date.now()) {
        lastError = new ArxivFeedError("ARXIV_REQUEST_TIMEOUT", "arXiv 重试等待超过整轮时间预算。", { cause: error });
        break;
      }
      await sleepImpl(retryDelay);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  if (lastError instanceof ArxivFeedError) throw lastError;
  throw new ArxivFeedError("ARXIV_REQUEST_FAILED", `arXiv API request failed: ${lastError?.message ?? "unknown error"}`, { cause: lastError });
}

const LOCK_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

async function isStaleLock(lockPath) {
  let lockStats;
  try {
    lockStats = await stat(lockPath);
  } catch (error) {
    return error?.code === "ENOENT";
  }
  try {
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    const pid = Number(lock?.pid);
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        if (error?.code === "EPERM") return false;
        if (error?.code === "ESRCH") return true;
      }
    }
    if (pid === process.pid) return false;
  } catch {
    if (Date.now() - lockStats.mtimeMs <= LOCK_STALE_AFTER_MS) return false;
  }
  return Date.now() - lockStats.mtimeMs > LOCK_STALE_AFTER_MS;
}

async function acquireRefreshLock(lockPath) {
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }), "utf8");
      await handle.close();
      return;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error?.code !== "EEXIST") throw error;
      if (!(await isStaleLock(lockPath))) {
        throw new ArxivFeedError("ARXIV_REFRESH_IN_PROGRESS", "arXiv 刷新已在运行，保留现有缓存。");
      }
      await unlink(lockPath).catch((unlinkError) => {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      });
    }
  }
  throw new ArxivFeedError("ARXIV_REFRESH_IN_PROGRESS", "arXiv 刷新锁无法取得。");
}

async function releaseRefreshLock(lockPath) {
  await unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

async function writeTemporary(target, contents) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = resolve(dirname(target), `.${basename(target)}.tmp-${process.pid}-${randomUUID()}`);
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    return temporary;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function writeAtomically(target, contents, renameImpl = rename) {
  const temporary = await writeTemporary(target, contents);
  try {
    await renameImpl(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function jsonContents(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function publicationPaths({ target, artifactRoot }) {
  const outputDirectory = dirname(resolve(target));
  if (artifactRoot !== null && artifactRoot !== undefined) {
    const root = resolve(artifactRoot);
    return {
      root,
      pointerPath: join(root, "current-generation.json"),
      generationRoot: join(root, "generations"),
    };
  }
  return {
    root: outputDirectory,
    pointerPath: join(outputDirectory, ".arxiv-daily-current.json"),
    generationRoot: join(outputDirectory, ".arxiv-daily-generations"),
  };
}

function relativeTargetPath(root, target) {
  const path = relative(root, resolve(target)).split(sep).join("/");
  if (!path || path === ".") throw new ArxivFeedError("ARXIV_PUBLISH_INVALID", `发布目标不能是 pointer 根目录：${target}`);
  return path;
}

function resolvePathInside(root, path, code = "ARXIV_PUBLISH_INVALID") {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
    throw new ArxivFeedError(code, "发布路径无效。");
  }
  const rootPath = resolve(root);
  const target = resolve(rootPath, path);
  if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`)) {
    throw new ArxivFeedError(code, "发布路径不能离开根目录。");
  }
  return target;
}

function validateGenerationId(value) {
  if (typeof value !== "string" || !/^generation-[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/u.test(value)) {
    throw new ArxivFeedError("ARXIV_PUBLISH_INVALID", "generation_id 无效。");
  }
  return value;
}

function contentRecord({ target, path, contents }) {
  return {
    target,
    path,
    sha256: createHash("sha256").update(contents).digest("hex"),
    byte_length: Buffer.byteLength(contents, "utf8"),
  };
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Directory fsync is available on the production Linux filesystem. Some
    // test filesystems reject opening directories; the atomic rename protocol
    // still provides the visibility guarantee there.
    if (!new Set(["EINVAL", "ENOTSUP", "EBADF"]).has(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function validateGenerationMarker(marker, generationId) {
  if (!marker || marker.schema_version !== PUBLISHED_GENERATION_SCHEMA_VERSION || marker.status !== "complete" || marker.generation_id !== generationId) {
    throw new ArxivFeedError("ARXIV_PUBLISH_GENERATION_INVALID", `generation marker 无效：${generationId}`);
  }
  if (!Array.isArray(marker.files) || marker.files.length === 0) {
    throw new ArxivFeedError("ARXIV_PUBLISH_GENERATION_INVALID", `generation 没有完整文件清单：${generationId}`);
  }
  const targets = new Set();
  for (const record of marker.files) {
    if (!record || typeof record.target !== "string" || !record.target || targets.has(record.target) ||
      typeof record.path !== "string" || !/^[^/].*$/u.test(record.path) ||
      !/^[a-f0-9]{64}$/u.test(record.sha256) || !Number.isInteger(record.byte_length) || record.byte_length < 0) {
      throw new ArxivFeedError("ARXIV_PUBLISH_GENERATION_INVALID", `generation 文件清单无效：${generationId}`);
    }
    targets.add(record.target);
  }
}

function pointerForGeneration({ pointerRoot, generationPath, marker }) {
  return {
    schema_version: PUBLISHED_POINTER_SCHEMA_VERSION,
    generation_id: marker.generation_id,
    generation_path: relativeArtifactPath(pointerRoot, generationPath),
    published_at: marker.completed_at,
    files: marker.files.map((record) => ({ ...record })),
  };
}

function validatePointer(pointer) {
  if (!pointer || pointer.schema_version !== PUBLISHED_POINTER_SCHEMA_VERSION ||
    typeof pointer.generation_id !== "string" || typeof pointer.generation_path !== "string" ||
    !Array.isArray(pointer.files) || pointer.files.length === 0) {
    throw new ArxivFeedError("ARXIV_PUBLISH_POINTER_INVALID", "current-generation pointer 无效。");
  }
  validateGenerationId(pointer.generation_id);
  const targets = new Set();
  for (const record of pointer.files) {
    if (!record || typeof record.target !== "string" || targets.has(record.target) ||
      typeof record.path !== "string" || !/^[^/].*$/u.test(record.path) ||
      !/^[a-f0-9]{64}$/u.test(record.sha256) || !Number.isInteger(record.byte_length) || record.byte_length < 0) {
      throw new ArxivFeedError("ARXIV_PUBLISH_POINTER_INVALID", "current-generation 文件清单无效。");
    }
    targets.add(record.target);
  }
}

function recordsMatch(left, right) {
  return left?.target === right?.target && left?.path === right?.path &&
    left?.sha256 === right?.sha256 && left?.byte_length === right?.byte_length;
}

async function readCompleteGeneration({ generationRoot, generationId, pointerFiles }) {
  const safeGenerationId = validateGenerationId(generationId);
  const generationPath = resolvePathInside(generationRoot, safeGenerationId, "ARXIV_PUBLISH_GENERATION_INVALID");
  let marker;
  try {
    marker = JSON.parse(await readFile(join(generationPath, "generation.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ArxivFeedError("ARXIV_PUBLISH_GENERATION_NOT_FOUND", `generation 不存在：${safeGenerationId}`, { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new ArxivFeedError("ARXIV_PUBLISH_GENERATION_INVALID", `generation marker 不是有效 JSON：${safeGenerationId}`, { cause: error });
    }
    throw error;
  }
  validateGenerationMarker(marker, safeGenerationId);
  if (pointerFiles) {
    if (pointerFiles.length !== marker.files.length || pointerFiles.some((record, index) => !recordsMatch(record, marker.files[index]))) {
      throw new ArxivFeedError("ARXIV_PUBLISH_INCONSISTENT", `pointer 与 generation 不一致：${safeGenerationId}`);
    }
  }
  const contents = new Map();
  for (const record of marker.files) {
    const filePath = resolvePathInside(generationPath, record.path, "ARXIV_PUBLISH_GENERATION_INVALID");
    let value;
    try {
      value = await readFile(filePath, "utf8");
    } catch (error) {
      throw new ArxivFeedError("ARXIV_PUBLISH_GENERATION_INVALID", `generation 文件不存在：${record.path}`, { cause: error });
    }
    const actual = contentRecord({ target: record.target, path: record.path, contents: value });
    if (!recordsMatch(record, actual)) {
      throw new ArxivFeedError("ARXIV_PUBLISH_GENERATION_INTEGRITY", `generation 文件校验失败：${record.target}`);
    }
    contents.set(record.target, value);
  }
  return { generationId: safeGenerationId, generationPath, marker, contents };
}

async function readPublishedPointer(pointerPath) {
  try {
    const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
    validatePointer(pointer);
    return pointer;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new ArxivFeedError("ARXIV_PUBLISH_POINTER_INVALID", `pointer 不是有效 JSON：${pointerPath}`, { cause: error });
    }
    throw error;
  }
}

async function findLatestCompleteGeneration(generationRoot) {
  let directories;
  try {
    directories = await readdir(generationRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const candidates = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    try {
      const generation = await readCompleteGeneration({ generationRoot, generationId: directory.name });
      candidates.push(generation);
    } catch {
      // Incomplete generations are retained for diagnosis and ignored by the
      // reader until their durable marker exists.
    }
  }
  candidates.sort((left, right) =>
    String(right.marker.completed_at ?? right.marker.created_at ?? "").localeCompare(String(left.marker.completed_at ?? left.marker.created_at ?? "")) ||
    right.generationId.localeCompare(left.generationId),
  );
  return candidates[0] ?? null;
}

async function recoverLatestCompleteGeneration({ pointerPath, generationRoot, renameImpl = rename }) {
  const recovered = await findLatestCompleteGeneration(generationRoot);
  if (!recovered) return null;
  const recoveredPointer = pointerForGeneration({
    pointerRoot: dirname(resolve(pointerPath)),
    generationPath: recovered.generationPath,
    marker: recovered.marker,
  });
  try {
    await writeJsonAtomically(pointerPath, recoveredPointer, renameImpl);
    await syncDirectory(dirname(resolve(pointerPath)));
  } catch {
    // The complete immutable generation is still safe to serve for this read;
    // the next writer/reader can retry pointer recovery without deleting it.
  }
  return { pointer: recoveredPointer, ...recovered };
}

async function resolvePublishedGeneration({ pointerPath, generationRoot, renameImpl = rename, allowRecovery = true }) {
  let pointer;
  try {
    pointer = await readPublishedPointer(pointerPath);
  } catch (error) {
    if (!allowRecovery) throw error;
    const recovered = await recoverLatestCompleteGeneration({ pointerPath, generationRoot, renameImpl });
    if (recovered) return recovered;
    throw error;
  }
  if (pointer) {
    try {
      const pointerRoot = dirname(resolve(pointerPath));
      const generationPath = resolvePathInside(pointerRoot, pointer.generation_path, "ARXIV_PUBLISH_POINTER_INVALID");
      const expectedGenerationPath = resolvePathInside(generationRoot, pointer.generation_id, "ARXIV_PUBLISH_POINTER_INVALID");
      if (generationPath !== expectedGenerationPath) {
        throw new ArxivFeedError("ARXIV_PUBLISH_INCONSISTENT", "pointer generation_path 与 generationRoot 不一致。");
      }
      return { pointer, ...(await readCompleteGeneration({ generationRoot, generationId: pointer.generation_id, pointerFiles: pointer.files })) };
    } catch (error) {
      if (!allowRecovery) throw error;
      const recovered = await recoverLatestCompleteGeneration({ pointerPath, generationRoot, renameImpl });
      if (recovered) return recovered;
      throw error;
    }
  }

  if (!allowRecovery) return null;
  return recoverLatestCompleteGeneration({ pointerPath, generationRoot, renameImpl });
}

export async function readPublishedFileSet({ pointerPath, generationRoot, targets, allowRecovery = true } = {}) {
  if (typeof pointerPath !== "string" || typeof generationRoot !== "string" || !Array.isArray(targets) || targets.length === 0) {
    throw new ArxivFeedError("ARXIV_PUBLISH_INVALID", "读取 published generation 需要 pointer、generationRoot 和 targets。");
  }
  const resolvedTargets = targets.map((target) => resolve(target));
  let recoveryAllowed = allowRecovery;
  if (recoveryAllowed) {
    for (const target of resolvedTargets) {
      if (!(await isStaleLock(`${target}.lock`))) {
        recoveryAllowed = false;
        break;
      }
    }
  }
  const generation = await resolvePublishedGeneration({ pointerPath, generationRoot, allowRecovery: recoveryAllowed });
  if (!generation) return null;
  const pointerRoot = dirname(resolve(pointerPath));
  const files = new Map();
  for (const target of resolvedTargets) {
    const targetKey = relativeTargetPath(pointerRoot, target);
    if (!generation.contents.has(targetKey)) {
      throw new ArxivFeedError("ARXIV_PUBLISH_INCOMPLETE", `published generation 缺少目标：${targetKey}`);
    }
    files.set(target, generation.contents.get(targetKey));
  }
  return {
    generation_id: generation.generationId,
    pointer: generation.pointer,
    files,
  };
}

async function mirrorPublishedFiles(files, renameImpl) {
  const warnings = [];
  for (const file of files) {
    try {
      await writeAtomically(file.target, file.contents, renameImpl);
    } catch (error) {
      warnings.push({ target: resolve(file.target), error: serializedError(error) });
    }
  }
  return warnings;
}

async function publishFileSet(files, renameImpl = rename, { pointerPath, generationRoot } = {}) {
  const uniqueTargets = new Set(files.map(({ target }) => resolve(target)));
  if (uniqueTargets.size !== files.length) {
    throw new ArxivFeedError("ARXIV_PUBLISH_INVALID", "一次发布不能包含重复目标文件。");
  }
  if (files.length === 0) throw new ArxivFeedError("ARXIV_PUBLISH_INVALID", "一次发布至少需要一个目标文件。");
  const firstTarget = resolve(files[0].target);
  const defaultPaths = publicationPaths({ target: firstTarget, artifactRoot: null });
  const resolvedPointerPath = resolve(pointerPath ?? defaultPaths.pointerPath);
  const resolvedGenerationRoot = resolve(generationRoot ?? defaultPaths.generationRoot);
  const generationId = `generation-${Date.now()}-${randomUUID()}`;
  const generationPath = join(resolvedGenerationRoot, generationId);
  const filesDirectory = join(generationPath, "files");
  await mkdir(filesDirectory, { recursive: true });

  const records = [];
  try {
    for (const [index, file] of files.entries()) {
      const target = resolve(file.target);
      if (target === resolvedPointerPath || target === generationPath || target.startsWith(`${generationPath}${sep}`)) {
        throw new ArxivFeedError("ARXIV_PUBLISH_INVALID", `发布目标与 generation/pointer 冲突：${target}`);
      }
      const path = `files/${String(index).padStart(4, "0")}.json`;
      const storedPath = join(generationPath, path);
      await writeAtomically(storedPath, file.contents, renameImpl);
      records.push(contentRecord({ target: relativeTargetPath(dirname(resolvedPointerPath), target), path, contents: file.contents }));
    }
    const completedAt = new Date().toISOString();
    const marker = {
      schema_version: PUBLISHED_GENERATION_SCHEMA_VERSION,
      status: "complete",
      generation_id: generationId,
      created_at: completedAt,
      completed_at: completedAt,
      files: records,
    };
    await writeJsonAtomically(join(generationPath, "generation.json"), marker, renameImpl);
    await syncDirectory(filesDirectory);
    await syncDirectory(generationPath);
    await syncDirectory(resolvedGenerationRoot);

    const pointer = pointerForGeneration({
      pointerRoot: dirname(resolvedPointerPath),
      generationPath,
      marker,
    });
    await writeJsonAtomically(resolvedPointerPath, pointer, renameImpl);
    await syncDirectory(dirname(resolvedPointerPath));

    // Legacy paths remain as compatibility projections for existing callers
    // and source checkouts. They are written only after the pointer commit;
    // readers that understand the protocol never combine these projections.
    const warnings = await mirrorPublishedFiles(files, renameImpl);
    return {
      generation_id: generationId,
      pointer_path: resolvedPointerPath,
      generation_path: generationPath,
      warnings,
    };
  } catch (error) {
    // Never remove the generation here. It is either an incomplete diagnostic
    // record or a complete generation recoverable after a process abort.
    throw error;
  }
}

function validateRunId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", "snapshot run_id 必须是安全的文件名片段。");
  }
  return value;
}

function generatedRunId(now) {
  return `${now.toISOString().replace(/[-:.]/gu, "")}-${randomUUID()}`;
}

function relativeArtifactPath(root, target) {
  return relative(root, target).split(sep).join("/");
}

function resolveArtifactPath(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", "snapshot 路径不能为空。");
  }
  const rootPath = resolve(root);
  const target = resolve(rootPath, relativePath);
  if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`)) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", "snapshot 路径不能离开 artifact 根目录。");
  }
  return target;
}

function serializedError(error) {
  return {
    code: error?.code ?? "ARXIV_REFRESH_FAILED",
    message: error?.message ?? String(error),
  };
}

async function writeJsonAtomically(target, value, renameImpl = rename) {
  await writeAtomically(target, jsonContents(value), renameImpl);
}

async function writeDiagnosticJsonAtomically(target, value, renameImpl = rename) {
  try {
    await writeJsonAtomically(target, value, renameImpl);
  } catch (primaryError) {
    if (renameImpl === rename) throw primaryError;
    try {
      await writeJsonAtomically(target, value, rename);
    } catch (fallbackError) {
      fallbackError.cause = primaryError;
      throw fallbackError;
    }
  }
}

function configuredArtifactRoot({ target, artifactRoot }) {
  if (artifactRoot !== undefined) return artifactRoot;
  return resolve(target) === resolve(DEFAULT_OUTPUT) ? DEFAULT_ARTIFACT_ROOT : null;
}

function parsePublishedJson(contents, target) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new ArxivFeedError("ARXIV_PUBLISH_INVALID", `published generation 中的 JSON 无效：${target}`, { cause: error });
  }
}

export async function readPublishedArxivEdition({
  output = DEFAULT_OUTPUT,
  radarOutput = DEFAULT_RADAR_OUTPUT,
  artifactRoot,
  fallbackFeed,
  fallbackRadar,
} = {}) {
  const target = resolve(output);
  const radarTarget = resolve(radarOutput);
  const paths = publicationPaths({
    target,
    artifactRoot: configuredArtifactRoot({ target, artifactRoot }),
  });
  const published = await readPublishedFileSet({
    pointerPath: paths.pointerPath,
    generationRoot: paths.generationRoot,
    targets: [target, radarTarget],
  });
  if (published) {
    return {
      feed: parsePublishedJson(published.files.get(target), target),
      radar: parsePublishedJson(published.files.get(radarTarget), radarTarget),
      generation_id: published.generation_id,
      pointer: published.pointer,
    };
  }
  return {
    feed: fallbackFeed ?? JSON.parse(await readFile(target, "utf8")),
    radar: fallbackRadar ?? JSON.parse(await readFile(radarTarget, "utf8")),
    generation_id: null,
    pointer: null,
  };
}

function emptyRunState() {
  return {
    schema_version: RUN_STATE_SCHEMA_VERSION,
    status: "idle",
    current_run_id: null,
    last_attempt: null,
    last_success: null,
    last_failure: null,
  };
}

function parseRunState(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new ArxivFeedError("ARXIV_RUN_STATE_INVALID", "run-state.json 不是有效 JSON。", { cause: error });
  }
  if (!parsed || parsed.schema_version !== RUN_STATE_SCHEMA_VERSION || !["idle", "running", "success", "failed"].includes(parsed.status)) {
    throw new ArxivFeedError("ARXIV_RUN_STATE_INVALID", "run-state.json 的 schema_version 或 status 无效。");
  }
  return parsed;
}

async function readRunState(artifactRoot) {
  const statePath = join(artifactRoot, "run-state.json");
  try {
    return parseRunState(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyRunState();
    if (error instanceof ArxivFeedError) throw error;
    throw new ArxivFeedError("ARXIV_RUN_STATE_INVALID", `无法读取 run-state.json：${error.message}`, { cause: error });
  }
}

async function readAuthoritativeRunState(artifactRoot) {
  const root = resolve(artifactRoot);
  const statePath = join(root, "run-state.json");
  const published = await readPublishedFileSet({
    pointerPath: join(root, "current-generation.json"),
    generationRoot: join(root, "generations"),
    targets: [statePath],
    allowRecovery: false,
  });
  if (published) return parseRunState(published.files.get(statePath));
  return readRunState(root);
}

export async function readArxivRunState({ artifactRoot = DEFAULT_ARTIFACT_ROOT } = {}) {
  const root = resolve(artifactRoot);
  try {
    return await readAuthoritativeRunState(root);
  } catch (error) {
    return {
      ...emptyRunState(),
      read_error: serializedError(error),
    };
  }
}

async function createSnapshotRun({
  artifactRoot,
  runId,
  target,
  query,
  baseQuery,
  window,
  pageSize,
  now,
  renameImpl,
}) {
  const root = resolve(artifactRoot);
  const safeRunId = validateRunId(runId);
  const runsRoot = join(root, "runs");
  const runDirectory = join(runsRoot, safeRunId);
  await mkdir(runsRoot, { recursive: true });
  try {
    await mkdir(runDirectory);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_RUN_EXISTS", `snapshot run 已存在：${safeRunId}`);
    }
    throw error;
  }
  const pagesDirectory = join(runDirectory, "pages");
  await mkdir(pagesDirectory);
  const manifestPath = join(runDirectory, "manifest.json");
  const startedAt = now.toISOString();
  const manifest = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    run_id: safeRunId,
    status: "running",
    started_at: startedAt,
    finished_at: null,
    output_path: target,
    query,
    base_query: baseQuery,
    window,
    parser_version: ARXIV_PARSER_VERSION,
    page_size: pageSize,
    page_count: 0,
    total_results: null,
    entry_count: null,
    response_sha256: null,
    pages: [],
    failure: null,
  };

  const persist = () => writeJsonAtomically(manifestPath, manifest, renameImpl);
  await persist();

  return {
    artifactRoot: root,
    runId: safeRunId,
    startedAt,
    manifestPath,
    manifestRelativePath: relativeArtifactPath(root, manifestPath),
    async capturePage({ pageIndex, requestedStart, sourceUrl, rawXml, contentType }) {
      const snapshotPath = join(pagesDirectory, `page-${String(pageIndex).padStart(4, "0")}.xml`);
      await writeAtomically(snapshotPath, rawXml, renameImpl);
      const record = {
        index: pageIndex,
        start: requestedStart,
        source_url: sourceUrl,
        content_type: contentType || null,
        snapshot_path: relativeArtifactPath(root, snapshotPath),
        response_sha256: createHash("sha256").update(rawXml).digest("hex"),
        byte_length: Buffer.byteLength(rawXml, "utf8"),
        status: "captured",
      };
      manifest.pages.push(record);
      manifest.pages.sort((left, right) => left.index - right.index);
      await persist();
      return record;
    },
    async completePage(pageIndex, page) {
      const record = manifest.pages.find(({ index }) => index === pageIndex);
      if (!record) throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", `snapshot page 不存在：${pageIndex}`);
      Object.assign(record, page, { status: "parsed" });
      await persist();
    },
    async ready({ totalResults, entryCount, responseSha256, pageCount }) {
      Object.assign(manifest, {
        status: "ready",
        page_count: pageCount,
        total_results: totalResults,
        entry_count: entryCount,
        response_sha256: responseSha256,
      });
      await persist();
    },
    publishedContents({ outputSha256, finishedAt = new Date().toISOString() }) {
      return jsonContents({
        ...manifest,
        status: "published",
        finished_at: finishedAt,
        published_at: finishedAt,
        output_sha256: outputSha256,
        failure: null,
      });
    },
    markPublished({ outputSha256, finishedAt }) {
      Object.assign(manifest, {
        status: "published",
        finished_at: finishedAt,
        published_at: finishedAt,
        output_sha256: outputSha256,
        failure: null,
      });
    },
    async failed(error) {
      if (manifest.status === "published") return;
      Object.assign(manifest, {
        status: "failed",
        finished_at: new Date().toISOString(),
        failure: serializedError(error),
      });
      await writeDiagnosticJsonAtomically(manifestPath, manifest, renameImpl);
    },
  };
}

function runStateAttempt(run, status, extra = {}) {
  return {
    run_id: run.runId,
    status,
    started_at: run.startedAt,
    ...extra,
  };
}

async function recordRunStarted(artifactRoot, run, window, query, renameImpl) {
  const state = await readAuthoritativeRunState(artifactRoot);
  state.status = "running";
  state.current_run_id = run.runId;
  state.last_attempt = runStateAttempt(run, "running", {
    window,
    query,
  });
  await writeDiagnosticJsonAtomically(join(artifactRoot, "run-state.json"), state, renameImpl);
}

function buildRunSuccessState(state, run, payload, outputSha256, finishedAt) {
  const lastAttempt = runStateAttempt(run, "published", {
    finished_at: finishedAt,
    window: payload.window,
    query: payload.query,
    page_count: payload.page_count,
    entry_count: payload.entries.length,
    snapshot_manifest: payload.snapshot_manifest,
    output_sha256: outputSha256,
  });
  return {
    ...state,
    status: "success",
    current_run_id: null,
    last_attempt: lastAttempt,
    last_success: {
      run_id: run.runId,
      finished_at: finishedAt,
      generated_at: payload.generated_at,
      window: payload.window,
      query: payload.query,
      page_count: payload.page_count,
      entry_count: payload.entries.length,
      snapshot_manifest: payload.snapshot_manifest,
      output_sha256: outputSha256,
    },
  };
}

async function prepareRunSuccess(artifactRoot, run, payload, outputSha256, finishedAt) {
  return buildRunSuccessState(await readAuthoritativeRunState(artifactRoot), run, payload, outputSha256, finishedAt);
}

async function recordRunFailure(artifactRoot, run, error, renameImpl, extra = {}) {
  const state = await readAuthoritativeRunState(artifactRoot);
  state.status = "failed";
  state.current_run_id = null;
  state.last_attempt = {
    ...(state.last_attempt?.run_id === run.runId ? state.last_attempt : runStateAttempt(run, "running")),
    status: "failed",
    finished_at: new Date().toISOString(),
    error: serializedError(error),
    ...extra,
  };
  state.last_failure = {
    run_id: run.runId,
    finished_at: state.last_attempt.finished_at,
    error: serializedError(error),
    ...extra,
  };
  await writeDiagnosticJsonAtomically(join(artifactRoot, "run-state.json"), state, renameImpl);
}

async function recordRunPublicationWarnings(artifactRoot, run, warnings, renameImpl, { payload, outputSha256, finishedAt } = {}) {
  try {
    const state = await readAuthoritativeRunState(artifactRoot);
    const completedState = payload && outputSha256
      ? buildRunSuccessState(state, run, payload, outputSha256, finishedAt ?? new Date().toISOString())
      : state;
    const attempt = completedState.last_attempt?.run_id === run.runId
      ? completedState.last_attempt
      : runStateAttempt(run, "published");
    completedState.status = "success";
    completedState.current_run_id = null;
    completedState.last_attempt = {
      ...attempt,
      status: "published",
      publication_warnings: warnings,
    };
    if (completedState.last_success?.run_id === run.runId) {
      completedState.last_success = {
        ...completedState.last_success,
        publication_warnings: warnings,
      };
    }
    await writeDiagnosticJsonAtomically(join(artifactRoot, "run-state.json"), completedState, renameImpl);
  } catch {
    // Publication is already committed through the immutable generation. A
    // warning-state write must never turn that durable success into a false
    // refresh failure.
  }
}

function runIdFromManifestPath(value) {
  const match = typeof value === "string" ? value.match(/^runs\/([^/]+)\/manifest\.json$/u) : null;
  return match ? match[1] : null;
}

async function referencedSnapshotRunIds(artifactRoot, outputPath) {
  const protectedRunIds = new Set();
  try {
    const state = await readAuthoritativeRunState(artifactRoot);
    for (const value of [state.last_success?.run_id, runIdFromManifestPath(state.last_success?.snapshot_manifest)]) {
      if (value) protectedRunIds.add(value);
    }
  } catch {
    // The cache itself remains the stronger reference when state is unreadable.
  }
  if (outputPath) {
    try {
      const payload = JSON.parse(await readFile(outputPath, "utf8"));
      if (payload?.snapshot_run_id) protectedRunIds.add(payload.snapshot_run_id);
      const manifestRunId = runIdFromManifestPath(payload?.snapshot_manifest);
      if (manifestRunId) protectedRunIds.add(manifestRunId);
    } catch {
      // Keep the retention pass conservative when the current cache is unreadable.
    }
  }
  return protectedRunIds;
}

async function pruneSnapshotRuns(artifactRoot, snapshotRetention, currentRunId, outputPath) {
  const runsRoot = join(artifactRoot, "runs");
  let directories;
  try {
    directories = await readdir(runsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const terminalRuns = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const manifestPath = join(runsRoot, directory.name, "manifest.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (!["published", "failed"].includes(manifest.status)) continue;
      terminalRuns.push({
        runId: directory.name,
        path: join(runsRoot, directory.name),
        order: manifest.finished_at ?? manifest.started_at ?? "",
      });
    } catch {
      // Keep malformed or in-progress records for diagnosis rather than
      // deleting evidence that the retention pass cannot understand.
    }
  }
  terminalRuns.sort((left, right) => right.order.localeCompare(left.order) || right.runId.localeCompare(left.runId));
  const keep = new Set(terminalRuns.slice(0, snapshotRetention).map(({ runId }) => runId));
  if (currentRunId) keep.add(currentRunId);
  for (const runId of await referencedSnapshotRunIds(artifactRoot, outputPath)) keep.add(runId);
  for (const run of terminalRuns) {
    if (!keep.has(run.runId)) await rm(run.path, { recursive: true, force: true });
  }
}

async function readSnapshotManifest(artifactRoot, runId) {
  const root = resolve(artifactRoot);
  const safeRunId = validateRunId(runId);
  const manifestPath = resolveArtifactPath(root, `runs/${safeRunId}/manifest.json`);
  let manifest;
  try {
    const paths = publicationPaths({ target: manifestPath, artifactRoot: root });
    let contents;
    try {
      const published = await readPublishedFileSet({
        pointerPath: paths.pointerPath,
        generationRoot: paths.generationRoot,
        targets: [manifestPath],
        allowRecovery: false,
      });
      contents = published?.files.get(manifestPath);
    } catch (error) {
      // A retained historical run is intentionally absent from the current
      // generation. Its immutable manifest remains the replay entry point;
      // only fall back for that expected omission, never for pointer or
      // generation integrity failures.
      if (error?.code !== "ARXIV_PUBLISH_INCOMPLETE") throw error;
    }
    contents ??= await readFile(manifestPath, "utf8");
    manifest = JSON.parse(contents);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_NOT_FOUND", `snapshot manifest 不存在：${safeRunId}`, { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", `snapshot manifest 不是有效 JSON：${safeRunId}`, { cause: error });
    }
    throw error;
  }
  if (!manifest || manifest.schema_version !== SNAPSHOT_SCHEMA_VERSION || manifest.run_id !== safeRunId) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", `snapshot manifest schema 或 run_id 无效：${safeRunId}`);
  }
  return { root, manifest };
}

export async function replayArxivSnapshot({ artifactRoot = DEFAULT_ARTIFACT_ROOT, runId } = {}) {
  const { root, manifest } = await readSnapshotManifest(artifactRoot, runId);
  if (!["ready", "published"].includes(manifest.status)) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_NOT_READY", `snapshot run 尚未完成发布：${manifest.run_id}`);
  }
  if (manifest.parser_version !== ARXIV_PARSER_VERSION) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_PARSER_UNSUPPORTED", `snapshot 使用了不兼容的 parser：${manifest.parser_version}`);
  }
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0 || manifest.page_count !== manifest.pages.length) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", `snapshot manifest 的 pages 不完整：${manifest.run_id}`);
  }
  if (!manifest.window?.announcement_date || !manifest.window?.time_zone) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", `snapshot manifest 缺少窗口：${manifest.run_id}`);
  }
  const expectedWindow = buildAnnouncementWindow({
    announcementDate: manifest.window.announcement_date,
    timeZone: manifest.window.time_zone,
  });
  for (const field of Object.keys(expectedWindow)) {
    if (manifest.window[field] !== expectedWindow[field]) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", `snapshot 窗口字段不一致：${field}`);
    }
  }
  if (typeof manifest.base_query !== "string" || manifest.base_query.trim() === "") {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", "snapshot 缺少 base_query。");
  }
  const expectedQuery = effectiveAnnouncementQuery(manifest.base_query, expectedWindow);
  if (manifest.query !== expectedQuery) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INTEGRITY", "snapshot query 与窗口或 base_query 不一致。");
  }
  if (!Number.isInteger(manifest.page_size) || manifest.page_size < 1 || manifest.page_size > DEFAULT_PAGE_SIZE) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", "snapshot page_size 无效。");
  }

  const entryMap = new Map();
  const pages = [];
  let totalResults;
  const orderedManifestPages = [...manifest.pages].sort((left, right) => left.index - right.index);
  let expectedStart;
  for (let pagePosition = 0; pagePosition < orderedManifestPages.length; pagePosition += 1) {
    const storedPage = orderedManifestPages[pagePosition];
    if (storedPage.index !== pagePosition || storedPage.status !== "parsed") {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", `snapshot page 顺序或状态无效：${storedPage.index}`);
    }
    if (!Number.isInteger(storedPage.start) || storedPage.start < 0 || storedPage.requested_max_results !== manifest.page_size) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", `snapshot page 请求参数无效：${storedPage.index}`);
    }
    if (expectedStart !== undefined && storedPage.start !== expectedStart) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INTEGRITY", `snapshot page 起点没有连续推进：${storedPage.index}`);
    }
    const expectedSourceUrl = feedUrl({ query: expectedQuery, maxResults: manifest.page_size, start: storedPage.start });
    if (storedPage.source_url !== expectedSourceUrl) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INTEGRITY", `snapshot page source URL 与请求参数不一致：${storedPage.index}`);
    }
    const snapshotPath = resolveArtifactPath(root, storedPage.snapshot_path);
    let rawXml;
    try {
      rawXml = await readFile(snapshotPath, "utf8");
    } catch (error) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_NOT_FOUND", `snapshot page 不存在：${storedPage.snapshot_path}`, { cause: error });
    }
    const responseSha256 = createHash("sha256").update(rawXml).digest("hex");
    if (responseSha256 !== storedPage.response_sha256 || Buffer.byteLength(rawXml, "utf8") !== storedPage.byte_length) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INTEGRITY", `snapshot page hash 或长度不匹配：${storedPage.snapshot_path}`);
    }
    const parsed = parseArxivDocument(rawXml);
    const metadata = pageMetadataFor(parsed, storedPage.start, manifest.page_size, { requireComplete: true });
    if (storedPage.total_results !== metadata.total_results || storedPage.items_per_page !== metadata.items_per_page || storedPage.entry_count !== parsed.entries.length) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INTEGRITY", `snapshot page manifest 与解析结果不一致：${storedPage.snapshot_path}`);
    }
    if (totalResults === undefined) totalResults = metadata.total_results;
    if (metadata.total_results !== undefined && totalResults !== metadata.total_results) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INTEGRITY", "snapshot pages 的 totalResults 不一致。");
    }
    mergePageEntries(entryMap, parsed.entries);
    const page = {
      index: storedPage.index,
      start: metadata.start_index,
      requested_max_results: manifest.page_size,
      source_url: storedPage.source_url,
      response_sha256: responseSha256,
      total_results: metadata.total_results,
      items_per_page: metadata.items_per_page,
      entry_count: parsed.entries.length,
      window_entry_count: entriesInWindow(parsed.entries, manifest.window).length,
    };
    if (JSON.stringify(page) !== JSON.stringify({
      index: storedPage.index,
      start: storedPage.start,
      requested_max_results: storedPage.requested_max_results,
      source_url: storedPage.source_url,
      response_sha256: storedPage.response_sha256,
      total_results: storedPage.total_results,
      items_per_page: storedPage.items_per_page,
      entry_count: storedPage.entry_count,
      window_entry_count: storedPage.window_entry_count,
    })) {
      throw new ArxivFeedError("ARXIV_SNAPSHOT_INTEGRITY", `snapshot page provenance 不一致：${storedPage.snapshot_path}`);
    }
    pages.push(page);
    expectedStart = storedPage.start + storedPage.items_per_page;
  }
  const pageEnd = pages.at(-1).start + pages.at(-1).items_per_page;
  if (totalResults !== undefined && pageEnd < totalResults) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INTEGRITY", "snapshot pages 没有覆盖 totalResults。");
  }
  const entries = entriesInWindow([...entryMap.values()], manifest.window);
  entries.sort((left, right) => left.published.localeCompare(right.published) || `${left.arxiv_id}@v${left.revision}`.localeCompare(`${right.arxiv_id}@v${right.revision}`));
  const normalizedTotalResults = totalResults ?? entries.length;
  const responseSha256 = createHash("sha256").update(pages.map(({ response_sha256: hash }) => hash).join("\n")).digest("hex");
  if (manifest.total_results !== normalizedTotalResults || manifest.entry_count !== entries.length || manifest.response_sha256 !== responseSha256) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INTEGRITY", `snapshot manifest 汇总不一致：${manifest.run_id}`);
  }
  return {
    run_id: manifest.run_id,
    query: manifest.query,
    base_query: manifest.base_query,
    window: manifest.window,
    page_size: manifest.page_size,
    page_count: pages.length,
    total_results: normalizedTotalResults,
    response_sha256: responseSha256,
    pages,
    entries,
  };
}

export async function refreshArxivFeed({
  output = DEFAULT_OUTPUT,
  query = DEFAULT_QUERY,
  maxResults,
  pageSize = maxResults ?? DEFAULT_PAGE_SIZE,
  start = 0,
  announcementDate,
  timeZone = DEFAULT_TIME_ZONE,
  now = new Date(),
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  sleepImpl = defaultSleep,
  renameImpl = rename,
  totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
  maxPages = Math.ceil(30_000 / pageSize) + 1,
  minRequestIntervalMs = DEFAULT_MIN_REQUEST_INTERVAL_MS,
  lockPath,
  artifactRoot,
  snapshotRetention = DEFAULT_SNAPSHOT_RETENTION,
  runId,
  radarOutput,
  publishStageHook = async () => {},
} = {}) {
  if (typeof fetchImpl !== "function") throw new ArxivFeedError("ARXIV_REQUEST_FAILED", "当前运行环境没有 fetch 实现。");
  if (!Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0) throw new ArxivFeedError("ARXIV_REQUEST_TIMEOUT", "整轮时间预算必须为正数。");
  if (!Number.isInteger(snapshotRetention) || snapshotRetention < 1) {
    throw new ArxivFeedError("ARXIV_SNAPSHOT_INVALID", "snapshotRetention 必须是正整数。");
  }
  const window = buildAnnouncementWindow({ announcementDate, now, timeZone });
  const target = resolve(output);
  const configuredRoot = configuredArtifactRoot({ target, artifactRoot });
  const artifactDirectory = configuredRoot === null ? null : resolve(configuredRoot);
  const configuredRadarOutput = radarOutput === undefined
    ? (target === resolve(DEFAULT_OUTPUT) ? DEFAULT_RADAR_OUTPUT : null)
    : radarOutput;
  const radarTarget = configuredRadarOutput === null ? null : resolve(configuredRadarOutput);
  const publication = publicationPaths({ target, artifactRoot: artifactDirectory });
  const refreshLockPath = resolve(lockPath ?? `${target}.lock`);
  await acquireRefreshLock(refreshLockPath);
  let snapshotRun = null;
  let outputPublished = false;
  let publishPhase = "pre_publish";
  try {
    let previousFeed = null;
    let previousRadar = null;
    if (radarTarget) {
      const previousEdition = await readPublishedArxivEdition({
        output: target,
        radarOutput: radarTarget,
        artifactRoot: artifactDirectory,
      });
      previousFeed = previousEdition.feed;
      previousRadar = previousEdition.radar;
    }
    if (artifactDirectory) {
      snapshotRun = await createSnapshotRun({
        artifactRoot: artifactDirectory,
        runId: runId ?? generatedRunId(now),
        target,
        query: effectiveAnnouncementQuery(query, window),
        baseQuery: query,
        window,
        pageSize,
        now,
        renameImpl,
      });
      await recordRunStarted(artifactDirectory, snapshotRun, window, effectiveAnnouncementQuery(query, window), renameImpl);
    }
    const result = await fetchPaginatedFeed({
      query,
      window,
      pageSize,
      start,
      maxPages,
      minRequestIntervalMs,
      fetchImpl,
      timeoutMs,
      maxAttempts,
      sleepImpl,
      now,
      totalTimeoutMs,
      snapshotRun,
    });
    const responseSha = createHash("sha256")
      .update(result.pages.map(({ response_sha256 }) => response_sha256).join("\n"))
      .digest("hex");
    const outputContents = `${JSON.stringify({
      generated_at: now.toISOString(),
      query: result.query,
      base_query: query,
      source_url: result.pages[0]?.source_url ?? feedUrl({ query: result.query, maxResults: pageSize, start }),
      source_urls: result.pages.map(({ source_url }) => source_url),
      parser_version: ARXIV_PARSER_VERSION,
      response_sha256: responseSha,
      window,
      page_size: pageSize,
      page_count: result.pages.length,
      total_results: result.totalResults,
      pages: result.pages,
      entries: result.entries,
      ...(snapshotRun ? {
        snapshot_run_id: snapshotRun.runId,
        snapshot_manifest: snapshotRun.manifestRelativePath,
      } : {}),
    }, null, 2)}\n`;
    const payload = JSON.parse(outputContents);
    const filesToPublish = [{ target, contents: outputContents }];
    if (radarTarget) {
      const radarPayload = reconcileDailyRadarEdition(previousFeed, previousRadar, payload);
      const radarValidation = validateDailyRadarPayload(payload, radarPayload);
      if (!radarValidation.valid) {
        throw new ArxivFeedError(
          "ARXIV_RADAR_INVALID",
          `Daily Radar 与新 arXiv edition 不一致：${radarValidation.diagnostics.join(", ")}`,
        );
      }
      filesToPublish.push({ target: radarTarget, contents: `${JSON.stringify(radarPayload, null, 2)}\n` });
    }
    const outputSha256 = createHash("sha256").update(outputContents).digest("hex");
    const finishedAt = new Date().toISOString();
    if (snapshotRun) {
      await snapshotRun.ready({
        totalResults: result.totalResults,
        entryCount: result.entries.length,
        responseSha256: responseSha,
        pageCount: result.pages.length,
      });
      const successState = await prepareRunSuccess(artifactDirectory, snapshotRun, payload, outputSha256, finishedAt);
      filesToPublish.push(
        { target: snapshotRun.manifestPath, contents: snapshotRun.publishedContents({ outputSha256, finishedAt }) },
        { target: join(artifactDirectory, "run-state.json"), contents: jsonContents(successState) },
      );
    }
    publishPhase = "publish_commit";
    const publicationResult = await publishFileSet(filesToPublish, renameImpl, {
      pointerPath: publication.pointerPath,
      generationRoot: publication.generationRoot,
    });
    outputPublished = true;
    if (snapshotRun) snapshotRun.markPublished({ outputSha256, finishedAt });
    publishPhase = "generation_published";
    const postPublishWarnings = [...publicationResult.warnings];
    try {
      await publishStageHook("cache_published", { payload, radar_output: radarTarget, generation_id: publicationResult.generation_id });
    } catch (hookError) {
      postPublishWarnings.push({ stage: "cache_published", error: serializedError(hookError) });
    }
    if (snapshotRun) {
      try {
        await pruneSnapshotRuns(artifactDirectory, snapshotRetention, snapshotRun.runId, target);
        publishPhase = "retention_done";
      } catch (retentionError) {
        publishPhase = "retention_failed";
        postPublishWarnings.push({ stage: publishPhase, error: serializedError(retentionError) });
        await publishStageHook(publishPhase, { payload, error: serializedError(retentionError) }).catch(() => {});
      }
    }
    if (snapshotRun && postPublishWarnings.length > 0) {
      await recordRunPublicationWarnings(artifactDirectory, snapshotRun, postPublishWarnings, renameImpl, {
        payload,
        outputSha256,
        finishedAt,
      });
    }
    return payload;
  } catch (error) {
    if (snapshotRun) {
      if (!outputPublished) {
        await snapshotRun.failed(error).catch(() => {});
        await recordRunFailure(artifactDirectory, snapshotRun, error, renameImpl, {
          publish_phase: publishPhase,
          output_published: false,
        }).catch(() => {});
        await pruneSnapshotRuns(artifactDirectory, snapshotRetention, snapshotRun.runId, target).catch(() => {});
      } else {
        await recordRunPublicationWarnings(artifactDirectory, snapshotRun, [{ stage: publishPhase, error: serializedError(error) }], renameImpl);
      }
    }
    throw error;
  } finally {
    await releaseRefreshLock(refreshLockPath);
  }
}

function cliValue(args, name) {
  const prefix = `${name}=`;
  const argument = args.find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.includes("--replay")) {
    const replay = await replayArxivSnapshot({
      artifactRoot: cliValue(args, "--artifact-root") ?? DEFAULT_ARTIFACT_ROOT,
      runId: cliValue(args, "--run-id"),
    });
    console.log(JSON.stringify(replay, null, 2));
  } else {
    const output = args.find((argument) => !argument.startsWith("--")) ?? DEFAULT_OUTPUT;
    const payload = await refreshArxivFeed({ output });
    console.log(`wrote ${payload.entries.length} arXiv entries to ${output}`);
  }
}
