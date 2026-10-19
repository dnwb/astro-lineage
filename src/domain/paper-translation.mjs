/**
 * src/domain/paper-translation.mjs
 *
 * Domain layer single-source-of-truth (SSOT) for academic paper title normalization,
 * translation cleaning, acronym preservation, and synchronous translation cache resolution.
 * Decoupled from runtime pipeline engines and external LLM analyzers.
 */

import fs from "node:fs";
import path from "node:path";

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

export function cleanMathInTitle(text) {
  if (!text) return "";
  return String(text)
    .replace(/\$[^$]*\\int[^$]*\$\s*(?:的)?/gu, "")
    .replace(/\\,/gu, " ")
    .replace(/\\;/gu, " ")
    .replace(/\\:/gu, " ")
    .replace(/\\!/gu, "")
    .replace(/\\quad/gu, " ")
    .replace(/\\qquad/gu, " ")
    .replace(/_\{?\\rm\s*([a-zA-Z0-9]+)\}?/gu, ",$1")
    .replace(/\\rm\b/gu, "")
    .replace(/\\(?:mathrm|text|mathbf|mathit|mathsf|boldsymbol)\{([^}]*)\}/gu, "$1")
    .replace(/\\gtrsim/gu, "≳")
    .replace(/\\lesssim/gu, "≲")
    .replace(/\\propto/gu, "∝")
    .replace(/\\Delta/gu, "Δ")
    .replace(/\\lambda/gu, "λ")
    .replace(/\\Lambda/gu, "Λ")
    .replace(/\\%/gu, "%")
    .replace(/\$([^\$]+)\$/g, (m, p1) => {
      return p1
        .replace(/\\omega/g, "ω")
        .replace(/\\pi/g, "π")
        .replace(/\\nu/g, "ν")
        .replace(/\\gamma/g, "γ")
        .replace(/\\tau/g, "τ")
        .replace(/\\alpha/g, "α")
        .replace(/\\beta/g, "β")
        .replace(/\\sigma/g, "σ")
        .replace(/\\mu/g, "μ")
        .replace(/\\times/g, "×")
        .replace(/\\sim/g, "~")
        .replace(/\\pm/g, "±")
        .replace(/\\approx/g, "≈")
        .replace(/\\le|\\leq/g, "≤")
        .replace(/\\ge|\\geq/g, "≥")
        .replace(/\\odot/g, "☉")
        .replace(/\\([a-zA-Z]+)/g, "$1")
        .replace(/[\{\}]/g, "")
        .replace(/\^([0-9a-zA-Z+-]+)/g, "^$1")
        .replace(/_([0-9a-zA-Z+-]+)/g, "_$1");
    })
    .replace(/[\$]/g, "")
    .replace(/\s+/gu, " ")
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

  // Preserve and streamline standard astrophysics acronyms (e.g. GRB, FRB, SN, GW)
  clean = clean
    .replace(/(?:伽马(?:射线)?暴|伽玛(?:射线)?暴)\s*(GRB(?:\s*\d{4,6}[A-Z]*)?)/giu, "$1")
    .replace(/(?:伽马(?:射线)?暴|伽玛(?:射线)?暴)(?=\s*[0-9A-Z])/giu, "GRB ")
    .replace(/快速射电暴\s*(FRB(?:\s*\d{4,6}[A-Z]*)?)/giu, "$1")
    .replace(/快速射电暴(?=\s*[0-9A-Z])/giu, "FRB ")
    .replace(/快速射电暴/gu, "FRB")
    .replace(/引力波\s*(GW(?:\s*\d{6}[A-Z]*)?)/giu, "$1")
    .replace(/引力波(?=\s*[0-9A-Z])/giu, "GW ")
    .replace(/超新星\s*(\d{4}[A-Za-z]+)/giu, "SN $1")
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

export function loadTranslationsCacheSync(cachePath = null, { useBundled = true } = {}) {
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
    if (typeof cachePath === "string" && cachePath.trim() && fs.existsSync(cachePath)) {
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

export function resetTranslationMemoryCache() {
  memoryCache = null;
  lastCachePath = null;
}
