/**
 * scripts/paper-translation.mjs
 *
 * Dedicated translation service and caching layer for academic paper titles.
 * Single source of truth for resolving, validating, and formatting Chinese paper titles.
 */

import fs from "node:fs";
import path from "node:path";
import { cleanMathInTitle } from "./channel-title-policy.mjs";
import { executeChatCompletion } from "./arxiv-ai-analyzer.mjs";

export const DEFAULT_TRANSLATION_CACHE_PATH = path.resolve(
  process.cwd(),
  ".cache",
  "paper-translations.json"
);

let memoryCache = null;
let lastCachePath = null;

export function normalizeArxivId(id) {
  if (!id) return "";
  return String(id)
    .replace(/^arxiv:\s*/iu, "")
    .replace(/v\d+$/iu, "")
    .trim();
}

export function cleanTitleZh(text) {
  if (!text) return "";
  let clean = cleanMathInTitle(text)
    .replace(/^《|》$/g, "")
    .replace(/^["'“”‘’]|["'“”‘’]$/g, "")
    .replace(/[。！？?]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

  // Strip leading redundant translation prefixes if model outputs them
  clean = clean.replace(/^(?:中文标题|论文标题|翻译|标题)[:：]\s*/u, "").trim();
  return clean;
}

export function formatTranslatedPaperTitle(arxivId, titleZh, maxLength = 200) {
  const cleanId = normalizeArxivId(arxivId);
  if (!cleanId) throw new Error("CHANNEL_TITLE_ARXIV_ID_REQUIRED");
  const cleanedZh = cleanTitleZh(titleZh);
  if (!cleanedZh) throw new Error("CHANNEL_TITLE_PAPER_PROGRESS_REQUIRED");

  const title = `[${cleanId}] ${cleanedZh}`;
  if (Array.from(title).length > maxLength) {
    const allowedZhLen = maxLength - cleanId.length - 3;
    const truncatedZh = Array.from(cleanedZh).slice(0, allowedZhLen).join("").trim();
    return `[${cleanId}] ${truncatedZh}`;
  }
  return title;
}

export function loadTranslationsCacheSync(cachePath = DEFAULT_TRANSLATION_CACHE_PATH) {
  if (memoryCache && lastCachePath === cachePath) return memoryCache;
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, "utf8");
      const parsed = JSON.parse(raw);
      memoryCache = typeof parsed === "object" && parsed !== null ? parsed : {};
    } else {
      memoryCache = {};
    }
  } catch {
    memoryCache = {};
  }
  lastCachePath = cachePath;
  return memoryCache;
}

export function saveTranslationsCacheSync(cache, cachePath = DEFAULT_TRANSLATION_CACHE_PATH) {
  memoryCache = cache;
  lastCachePath = cachePath;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
  } catch (err) {
    console.warn(`[PaperTranslation] Failed to persist translations cache: ${err.message}`);
  }
}

export async function loadTranslationsCache(cachePath = DEFAULT_TRANSLATION_CACHE_PATH) {
  return loadTranslationsCacheSync(cachePath);
}

export async function saveTranslationsCache(cache, cachePath = DEFAULT_TRANSLATION_CACHE_PATH) {
  saveTranslationsCacheSync(cache, cachePath);
}

export function resolvePaperTitleZhSync(item, options = {}) {
  if (!item || typeof item !== "object") return null;

  // 1. Direct explicit title_zh property
  if (typeof item.title_zh === "string" && item.title_zh.trim()) {
    return cleanTitleZh(item.title_zh);
  }

  // 2. Nested analysis body property
  const analysisTitleZh =
    item.analysis?.title_zh || item.analysis?.analysis?.title_zh || item.triage?.title_zh;
  if (typeof analysisTitleZh === "string" && analysisTitleZh.trim()) {
    return cleanTitleZh(analysisTitleZh);
  }

  // 3. Cache lookup
  const arxivId = normalizeArxivId(item.arxiv_id || item.id);
  if (arxivId) {
    const cache = loadTranslationsCacheSync(options.cachePath);
    const cached = cache[arxivId];
    if (typeof cached === "string" && cached.trim()) {
      return cleanTitleZh(cached);
    }
    if (cached && typeof cached === "object" && typeof cached.title_zh === "string") {
      return cleanTitleZh(cached.title_zh);
    }
  }

  return null;
}

export async function translatePaperTitle(title, options = {}) {
  if (!title || typeof title !== "string" || !title.trim()) {
    throw new Error("Missing title to translate");
  }

  const systemPrompt =
    "你是一位精通高能天体物理与致密天体前沿的科学学者。请将给定的英文论文标题翻译为中文，要求学术术语准确规范（如快速射电暴、磁星、伽马射线暴、吸积盘等），表达精炼流畅。严格只输出翻译后的中文标题，严禁包含任何前缀、解释、说明、标点包裹或英文原文。";
  const prompt = `请将以下学术论文标题翻译为中文，严格只返回中文标题：\n${title.trim()}`;

  const translatedRaw = await executeChatCompletion({
    prompt,
    systemPrompt,
    model: options.model,
    effort: options.effort,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    fallbackBaseUrl: options.fallbackBaseUrl,
    fallbackApiKey: options.fallbackApiKey,
    fallbackModels: options.fallbackModels,
    retries: options.retries ?? 2,
    timeoutMs: options.timeoutMs ?? 15000,
  });

  return cleanTitleZh(translatedRaw);
}

export async function resolvePaperTitleZhAsync(item, options = {}) {
  const syncResult = resolvePaperTitleZhSync(item, options);
  if (syncResult) return syncResult;

  if (options.translate === false) return null;

  const rawTitle = item?.title || item?.entry?.title;
  const arxivId = normalizeArxivId(item?.arxiv_id || item?.id || item?.entry?.arxiv_id);
  if (!rawTitle) return null;

  try {
    const translated = await translatePaperTitle(rawTitle, options);
    if (translated) {
      if (arxivId) {
        const cache = loadTranslationsCacheSync(options.cachePath);
        cache[arxivId] = {
          title_zh: translated,
          source_title: rawTitle,
          translated_at: new Date().toISOString(),
        };
        saveTranslationsCacheSync(cache, options.cachePath);
      }
      return translated;
    }
  } catch (error) {
    if (options.verbose) {
      console.warn(
        `[PaperTranslation] Translation failed for ${arxivId || rawTitle}: ${error.message}`
      );
    }
  }

  return null;
}

/**
 * Clear or reset memory cache for testing.
 */
export function resetTranslationMemoryCache() {
  memoryCache = null;
  lastCachePath = null;
}
