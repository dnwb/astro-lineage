/**
 * scripts/paper-translation.mjs
 *
 * Dedicated translation service and caching layer for academic paper titles.
 * Single source of truth for resolving, validating, and formatting Chinese paper titles.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanMathInTitle } from "./channel-title-policy.mjs";

if (typeof process.loadEnvFile === "function" && fs.existsSync(".env")) {
  process.loadEnvFile();
}

export const DEFAULT_TRANSLATION_CACHE_PATH = path.resolve(
  process.cwd(),
  ".cache",
  "paper-translations.json"
);

export const BUNDLED_TRANSLATION_PATH = path.resolve(
  process.cwd(),
  "src",
  "data",
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

  // Preserve and streamline standard astrophysics acronyms (e.g. GRB, FRB, SN)
  clean = clean
    .replace(/(?:伽马(?:射线)?暴|伽玛(?:射线)?暴)\s*(GRB(?:\s*\d{4,6}[A-Z]*)?)/giu, "$1")
    .replace(/(?:伽马(?:射线)?暴|伽玛(?:射线)?暴)(?=\s*[0-9A-Z])/giu, "GRB ")
    .replace(/快速射电暴\s*(FRB(?:\s*\d{4,6}[A-Z]*)?)/giu, "$1")
    .replace(/快速射电暴(?=\s*[0-9A-Z])/giu, "FRB ")
    .replace(/快速射电暴/gu, "FRB")
    .replace(/超新星\s*(SN(?:\s*\d{4}[A-Za-z]*)?)/giu, "$1")
    .replace(/活动星系核\s*(AGN)/giu, "$1")
    .replace(/潮汐(?:瓦解|破坏)事件\s*(TDE)/giu, "$1")
    .replace(/超亮X射线源\s*(ULX)/giu, "$1")
    .replace(/脉冲星风(?:星)?云\s*(PWN)/giu, "$1")
    .replace(/(?:环星物质|星周介质)\s*(CSM)/giu, "$1")
    .replace(/准周期振荡\s*(QPO)/giu, "$1");

  return clean.replace(/\s+/g, " ").trim();
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

export function loadTranslationsCacheSync(
  cachePath = DEFAULT_TRANSLATION_CACHE_PATH,
  { useBundled = true } = {}
) {
  if (memoryCache && lastCachePath === cachePath) return memoryCache;
  let merged = {};
  try {
    if (useBundled && fs.existsSync(BUNDLED_TRANSLATION_PATH)) {
      const rawBundled = fs.readFileSync(BUNDLED_TRANSLATION_PATH, "utf8");
      const parsedBundled = JSON.parse(rawBundled);
      if (typeof parsedBundled === "object" && parsedBundled !== null) {
        merged = { ...parsedBundled };
      }
    }
  } catch {}

  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        merged = { ...merged, ...parsed };
      }
    }
  } catch {}

  memoryCache = merged;
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
  if (options.useTranslation === false) return null;

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
    const cache = loadTranslationsCacheSync(options.cachePath, options);
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
    "你是一位精通高能天体物理与致密天体前沿的科学学者。请将给定的英文论文标题翻译为中文，要求学术术语准确规范，表达精炼流畅。请保留国际通用天文学术缩写（如 GRB, FRB, SN, AGN, TDE, GW, SGR, ULX, PWN, CSM, QPO, DM 等）与天体/事件编号（如 GRB 240825A, SN 2024ggi, Sgr A* 等），无需强制翻译为冗长全称。严格只输出翻译后的中文标题，严禁包含任何前缀、解释、说明、标点包裹或英文原文。";
  const prompt = `请将以下学术论文标题翻译为中文，保留标准天体物理英文缩写（如 GRB, FRB, SN, AGN 等），严格只返回中文标题：\n${title.trim()}`;

  const {
    executeChatCompletion,
    DEFAULT_BASE_URL,
    DEFAULT_API_KEY,
    FALLBACK_BASE_URL,
    FALLBACK_API_KEY,
    DEFAULT_MODEL,
  } = await import("./arxiv-ai-analyzer.mjs");

  const translatedRaw = await executeChatCompletion({
    prompt,
    systemPrompt,
    model: options.model || DEFAULT_MODEL,
    effort: options.effort || "low",
    baseUrl: options.baseUrl || DEFAULT_BASE_URL,
    apiKey: options.apiKey || DEFAULT_API_KEY,
    fallbackBaseUrl: options.fallbackBaseUrl || FALLBACK_BASE_URL,
    fallbackApiKey: options.fallbackApiKey || FALLBACK_API_KEY,
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

/**
 * Backfill translations for papers across daily archives and weekly top picks.
 */
export async function backfillPaperTranslations({
  archiveRoot = path.join(process.cwd(), "src", "data", "arxiv-archives", "daily"),
  weeklyPath = path.join(process.cwd(), "src", "data", "arxiv-weekly.json"),
  destFile = BUNDLED_TRANSLATION_PATH,
  cachePath = DEFAULT_TRANSLATION_CACHE_PATH,
  priorities = ["must_read", "worth_knowing"],
  limit = Infinity,
  concurrency = 3,
  verbose = true,
  options = {},
} = {}) {
  const existing = loadTranslationsCacheSync(cachePath);
  const pendingPapers = new Map();

  // 1. Gather from weekly Top Picks
  if (fs.existsSync(weeklyPath)) {
    try {
      const weekly = JSON.parse(fs.readFileSync(weeklyPath, "utf8"));
      for (const pick of weekly.top_picks || []) {
        const id = normalizeArxivId(pick.arxiv_id);
        if (id && pick.title && !existing[id]) {
          pendingPapers.set(id, { arxiv_id: id, title: pick.title, source: "weekly" });
        }
      }
    } catch {}
  }

  // 2. Gather from daily archives
  if (fs.existsSync(archiveRoot)) {
    const files = fs
      .readdirSync(archiveRoot)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    for (const f of files) {
      if (pendingPapers.size >= limit) break;
      try {
        const archive = JSON.parse(fs.readFileSync(path.join(archiveRoot, f), "utf8"));
        const entries = archive.radar?.analyses || [];
        const entryMap = new Map(
          (archive.feed?.entries || []).map((e) => [normalizeArxivId(e.arxiv_id), e])
        );
        for (const item of entries) {
          if (!priorities.includes(item.priority)) continue;
          const id = normalizeArxivId(item.arxiv_id);
          const raw = entryMap.get(id);
          const title = item.title || raw?.title;
          if (id && title && !existing[id]) {
            pendingPapers.set(id, { arxiv_id: id, title, source: f.replace(".json", "") });
          }
        }
      } catch {}
    }
  }

  const itemsToTranslate = Array.from(pendingPapers.values()).slice(0, limit);
  if (verbose) {
    console.log(`[Backfill] Found ${itemsToTranslate.length} papers needing title translations.`);
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < itemsToTranslate.length; i += concurrency) {
    const chunk = itemsToTranslate.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async ({ arxiv_id, title, source }) => {
        try {
          const translated = await translatePaperTitle(title, options);
          if (translated) {
            existing[arxiv_id] = {
              title_zh: translated,
              source_title: title,
              translated_at: new Date().toISOString(),
            };
            successCount++;
            if (verbose) {
              console.log(`[Backfill] [${arxiv_id}] (${source}) -> ${translated}`);
            }
          }
        } catch (err) {
          failCount++;
          if (verbose) {
            console.warn(`[Backfill] Failed ${arxiv_id}: ${err.message}`);
          }
        }
      })
    );

    // Save progressively
    saveTranslationsCacheSync(existing, cachePath);
    if (destFile) {
      try {
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.writeFileSync(destFile, JSON.stringify(existing, null, 2), "utf8");
      } catch {}
    }
  }

  if (verbose) {
    console.log(
      `[Backfill] Completed: ${successCount} translated, ${failCount} failed. Total cached: ${Object.keys(existing).length}`
    );
  }

  return { successCount, failCount, total: Object.keys(existing).length };
}

// CLI runner
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  let limit = Infinity;
  let mustReadOnly = false;
  for (const arg of args) {
    if (arg.startsWith("--limit=")) limit = Number(arg.slice("--limit=".length));
    if (arg === "--must-read-only") mustReadOnly = true;
  }

  backfillPaperTranslations({
    limit,
    priorities: mustReadOnly ? ["must_read"] : ["must_read", "worth_knowing"],
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
