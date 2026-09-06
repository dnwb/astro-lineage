import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_QUERY = "cat:astro-ph.HE OR cat:astro-ph.GA";
export const DEFAULT_FEED_URL = "https://export.arxiv.org/api/query";
export const DEFAULT_OUTPUT = fileURLToPath(new URL("../src/data/arxiv-daily.json", import.meta.url));

function decodeXml(value) {
  return String(value)
    .replaceAll(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll(/&#([0-9]+);/gu, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function textTag(source, tag) {
  const match = String(source).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "u"));
  return match ? decodeXml(match[1].trim().replaceAll(/<[^>]+>/gu, "")) : "";
}

function attrTag(source, tag, attribute) {
  const match = String(source).match(new RegExp(`<${tag}\\b[^>]*\\b${attribute}="([^"]+)"`, "u"));
  return match ? decodeXml(match[1]) : "";
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/gu, " ").trim();
}

function normalizeArxivId(value) {
  const match = String(value).match(/\/abs\/([^/]+?)(?:v(\d+))?$/u);
  if (!match) return { arxiv_id: String(value), revision: null };
  return { arxiv_id: match[1], revision: match[2] ? Number(match[2]) : null };
}

export function parseArxivFeed(xml) {
  const entries = [];
  for (const match of String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gu)) {
    const body = match[1];
    const identity = normalizeArxivId(textTag(body, "id"));
    const revision = identity.revision ?? 1;
    const rawUrl = attrTag(body, "link", "href") || `https://arxiv.org/abs/${identity.arxiv_id}v${revision}`;
    entries.push({
      arxiv_id: identity.arxiv_id,
      revision,
      title: normalizeWhitespace(textTag(body, "title")),
      abstract: normalizeWhitespace(textTag(body, "summary")),
      published: textTag(body, "published"),
      updated: textTag(body, "updated"),
      authors: [...body.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gu)]
        .map((author) => textTag(author[1], "name"))
        .filter(Boolean),
      url: rawUrl.replace(/^http:\/\//u, "https://"),
    });
  }
  return entries;
}

export function feedUrl({ query = DEFAULT_QUERY, maxResults = 20 } = {}) {
  const params = new URLSearchParams({
    search_query: query,
    sortBy: "submittedDate",
    sortOrder: "descending",
    start: "0",
    max_results: String(maxResults),
  });
  return `${DEFAULT_FEED_URL}?${params.toString()}`;
}

export async function refreshArxivFeed({
  output = DEFAULT_OUTPUT,
  query = DEFAULT_QUERY,
  maxResults = 20,
  now = new Date(),
} = {}) {
  const sourceUrl = feedUrl({ query, maxResults });
  const response = await fetch(sourceUrl, {
    headers: { accept: "application/atom+xml, application/xml" },
  });
  if (!response.ok) throw new Error(`arXiv API request failed: HTTP ${response.status}`);
  const entries = parseArxivFeed(await response.text());
  const payload = {
    generated_at: now.toISOString(),
    query,
    source_url: sourceUrl,
    entries,
  };
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const output = process.argv[2] ?? DEFAULT_OUTPUT;
  const payload = await refreshArxivFeed({ output });
  console.log(`wrote ${payload.entries.length} arXiv entries to ${output}`);
}
