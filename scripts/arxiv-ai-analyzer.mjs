import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFile, readdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
  process.loadEnvFile();
}
import {
  buildDailyRadarModel,
  buildOpeningBrief,
  editionFingerprint,
  normalizeArxivId,
  sourceFingerprint,
  validateDailyRadarPayload,
} from "./daily-radar.mjs";
import {
  discoveryIdentity,
  DEFAULT_ARTIFACT_ROOT,
  DEFAULT_MIN_REQUEST_INTERVAL_MS,
  DEFAULT_OUTPUT,
  DEFAULT_RADAR_OUTPUT,
  acquireRefreshLock,
  publishAnalyzedArxivEdition,
  releaseRefreshLock,
  readPublishedArxivEdition,
  writeJsonAtomically,
} from "./arxiv-daily.mjs";
import { triageBatch } from "./arxiv-triage.mjs";
import { extractPaperFigures } from "./arxiv-figures.mjs";
import { defaultGatewayCircuitBreaker } from "./agent-core.mjs";

const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || process.env.CCNU_API_BASE || "https://api.ccnulaowu.online/v1";
const DEFAULT_API_KEY = process.env.WU_API_KEY || process.env.OPENAI_API_KEY || "";
const DEFAULT_MODEL = process.env.AI_MODEL || "gpt-6-luna";
const DEFAULT_EFFORT = process.env.REASONING_EFFORT || "medium";
const DEFAULT_CONCURRENCY = Number(process.env.AI_CONCURRENCY) || 2;
const DEFAULT_RUN_LIMIT = Number(process.env.AI_RUN_LIMIT) || 10;
const FALLBACK_BASE_URL = process.env.FALLBACK_OPENAI_BASE_URL || "";
const FALLBACK_API_KEY = process.env.FALLBACK_OPENAI_API_KEY || process.env.ZHANG_API_KEY || "";
export const FALLBACK_MODEL = process.env.FALLBACK_AI_MODEL || "gpt-6.1-sol";
const DEFAULT_TRIAGE_MODEL = process.env.AI_MODEL_TRIAGE || process.env.AI_MODEL_SKIM || "gpt-6-luna";
const DEFAULT_BODY_MODEL = process.env.AI_MODEL_BODY || process.env.AI_MODEL_READING || "gpt-6.1-sol";
const DEFAULT_TRIAGE_FALLBACKS = (process.env.AI_TRIAGE_FALLBACK_MODELS || "gpt-6.1-sol,gpt-6-sol")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DEFAULT_BODY_FALLBACKS = (process.env.AI_BODY_FALLBACK_MODELS || "gpt-6-sol,gpt-6-luna")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const QUEUE_SCHEMA_VERSION = "arxiv-ai-screening-queue-v1";
const DEFAULT_ARCHIVE_ROOT = fileURLToPath(new URL("../src/data/arxiv-archives", import.meta.url));
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const MAX_TEX_BYTES = 16 * 1024 * 1024;
const MAX_TAR_MEMBERS = 512;
const MAX_BODY_CHARS = 600_000;
const MAX_MODEL_PROMPT_CHARS = 45_000;
const MAX_MODEL_RESPONSE_BYTES = 2 * 1024 * 1024;
const BODY_CHUNK_CHARS = 16_000;
const MAX_BODY_CHUNKS = 40;
const READING_CONTRACT_VERSION = "body-chunks-v1";
const SOURCE_TIMEOUT_MS = 30_000;
const MODEL_TIMEOUT_MS = 120_000;

export function cleanJsonContent(raw) {
  let cleaned = String(raw ?? "").trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  return cleaned;
}

function repairMathInRawJson(raw) {
  // 1. Repair $ ... $ inline math
  let text = raw.replace(/\$([^$]+)\$/gu, (_match, mathContent) => {
    const fixed = mathContent.replace(/(\\*)([a-zA-Z()])/gu, (m, slashes) => {
      if (slashes.length % 2 === 1) return `\\${m}`;
      return m;
    });
    return `$${fixed}$`;
  });

  // 2. Repair \( ... \) and \[ ... \] math
  text = text.replace(/\\([()[\]])([\s\S]*?)\\([()[\]])/gu, (_match, open, mathContent, close) => {
    const fixed = mathContent.replace(/(\\*)([a-zA-Z()])/gu, (m, slashes) => {
      if (slashes.length % 2 === 1) return `\\${m}`;
      return m;
    });
    return `\\${open}${fixed}\\${close}`;
  });

  // 3. Normalize single backslash on known astrophysics LaTeX commands that conflict with JSON escapes (n, t, r, b, f)
  // e.g. \nu, \tau, \rho, \beta, \times, \theta, \tilde, \frac, \approx, \odot
  text = text.replace(/(?<!\\)\\([ntrbf])([a-zA-Z]{1,15})(?![a-zA-Z])/gu, (match, letter, rest) => {
    const word = `${letter}${rest}`.toLowerCase();
    if (["nu", "tau", "rho", "beta", "times", "theta", "tilde", "frac", "nabla", "neq", "bar", "bf", "right", "rangle", "ref", "begin", "bibitem", "bullet", "big", "bmod", "flat", "forall"].includes(word)) {
      return `\\\\${match.slice(1)}`;
    }
    return match;
  });

  return text;
}

function repairMathDelimiterEscapes(raw) {
  let unsupported = false;
  const repaired = raw.replace(/(\\+)(.)/gsu, (matched, slashes, next, offset) => {
    if (slashes.length % 2 === 0 || /^["\\/bfnrt]$/u.test(next)) return matched;
    if (next === "u" && /^[0-9a-fA-F]{4}$/u.test(raw.slice(offset + slashes.length + 1, offset + slashes.length + 5))) return matched;
    if (next === "(" || next === ")" || /^[a-zA-Z]$/u.test(next)) return `${slashes}\\${next}`;
    unsupported = true;
    return matched;
  });
  if (unsupported) throw new Error("Model response has an unsupported JSON escape; use JSON-escaped TeX backslashes");
  return repaired;
}

function rejectAmbiguousText(value) {
  if (typeof value === "string" && /[\u0000-\u0008\u000b\u000c\u000d\u000e-\u001f]/u.test(value)) {
    throw new Error("Model response contains an ambiguous JSON escape; use JSON-escaped TeX backslashes");
  }
  if (Array.isArray(value)) value.forEach(rejectAmbiguousText);
  else if (value && typeof value === "object") Object.values(value).forEach(rejectAmbiguousText);
  return value;
}

export function safeParseJson(raw) {
  if (raw && typeof raw === "object") return rejectAmbiguousText(raw);
  const text = cleanJsonContent(raw);
  const preRepaired = repairMathInRawJson(text);
  try {
    return rejectAmbiguousText(JSON.parse(preRepaired));
  } catch (initialErr) {
    if (initialErr.message.includes("ambiguous JSON escape")) throw initialErr;
    const match = preRepaired.match(/[\[\{][\s\S]*[\]\}]/u);
    if (!match) throw initialErr;
    return rejectAmbiguousText(JSON.parse(repairMathDelimiterEscapes(match[0])));
  }
}

export function parseCliArgs(args) {
  const options = {
    feed: DEFAULT_OUTPUT,
    radar: DEFAULT_RADAR_OUTPUT,
    model: DEFAULT_MODEL,
    triageModel: DEFAULT_TRIAGE_MODEL,
    bodyModel: DEFAULT_BODY_MODEL,
    effort: DEFAULT_EFFORT,
    baseUrl: DEFAULT_BASE_URL,
    apiKey: DEFAULT_API_KEY,
    fallbackBaseUrl: FALLBACK_BASE_URL,
    fallbackApiKey: FALLBACK_API_KEY,
    concurrency: DEFAULT_CONCURRENCY,
    limit: DEFAULT_RUN_LIMIT,
    priorityIds: [],
    onlyIds: [],
    dates: [],
    backlog: false,
  };
  for (const arg of args) {
    if (arg.startsWith("--feed=")) options.feed = arg.slice("--feed=".length);
    else if (arg.startsWith("--radar=")) options.radar = arg.slice("--radar=".length);
    else if (arg.startsWith("--model=")) options.model = arg.slice("--model=".length);
    else if (arg.startsWith("--triage-model=")) options.triageModel = arg.slice("--triage-model=".length);
    else if (arg.startsWith("--body-model=")) options.bodyModel = arg.slice("--body-model=".length);
    else if (arg.startsWith("--effort=")) options.effort = arg.slice("--effort=".length);
    else if (arg.startsWith("--reasoning-effort=")) options.effort = arg.slice("--reasoning-effort=".length);
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--fallback-base-url=")) options.fallbackBaseUrl = arg.slice("--fallback-base-url=".length);
    else if (arg === "--api-key" || arg.startsWith("--api-key=")) throw new Error("API key must come from the environment, not process arguments");
    else if (arg.startsWith("--concurrency=")) options.concurrency = Number(arg.slice("--concurrency=".length));
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--priority-ids=")) options.priorityIds = arg.slice("--priority-ids=".length).split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg.startsWith("--only-ids=")) {
      options.onlyIds = arg.slice("--only-ids=".length).split(",").map((value) => value.trim()).filter(Boolean);
      if (options.onlyIds.length === 0) throw new Error("--only-ids requires at least one arXiv ID");
    }
    else if (arg.startsWith("--date=")) {
      options.dates = [arg.slice("--date=".length).trim()].filter(Boolean);
    }
    else if (arg.startsWith("--dates=")) {
      options.dates = arg.slice("--dates=".length).split(",").map((value) => value.trim()).filter(Boolean);
    }
    else if (arg === "--backlog" || arg === "--backlog=true") {
      options.backlog = true;
    }
    else if (arg.startsWith("--archive-root=")) options.archiveRoot = arg.slice("--archive-root=".length);
    else if (arg.startsWith("--artifact-root=")) options.artifactRoot = arg.slice("--artifact-root=".length);
    else if (arg.startsWith("--state=")) options.statePath = arg.slice("--state=".length);
  }
  return options;
}

let providerCycleCounter = 0;

async function executeChatCompletion({
  prompt,
  systemPrompt,
  model,
  effort,
  baseUrl,
  apiKey,
  fallbackBaseUrl,
  fallbackApiKey,
  fallbackModels,
  retries = 3,
  timeoutMs = MODEL_TIMEOUT_MS,
}) {
  const tryCall = async (targetUrl, targetKey, targetModel, targetEffort, targetTimeout = timeoutMs) => {
    const payload = {
      model: targetModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    };
    if (targetEffort && targetModel.startsWith("gpt-6")) payload.reasoning_effort = targetEffort;
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${targetKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(targetTimeout),
    });
    if (!response.ok) throw new Error(`API error HTTP ${response.status}`);
    const content = JSON.parse((await readLimitedResponse(response, MAX_MODEL_RESPONSE_BYTES, "Model response")).toString("utf8")).choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty model response");
    return cleanJsonContent(content);
  };

  const pool = [];
  if (baseUrl && apiKey) {
    pool.push({
      name: "Primary (ccnulaowu)",
      url: `${baseUrl.replace(/\/+$/u, "")}/chat/completions`,
      key: apiKey,
    });
  }
  if (fallbackBaseUrl && fallbackApiKey && (fallbackBaseUrl !== baseUrl || fallbackApiKey !== apiKey)) {
    pool.push({
      name: "Secondary (gateway-67)",
      url: `${fallbackBaseUrl.replace(/\/+$/u, "")}/chat/completions`,
      key: fallbackApiKey,
    });
  }

  if (pool.length === 0) throw new Error("Missing API key; set WU_API_KEY or OPENAI_API_KEY");

  const candidates = [model || DEFAULT_MODEL];
  if (Array.isArray(fallbackModels)) {
    for (const fb of fallbackModels) {
      if (fb && !candidates.includes(fb)) candidates.push(fb);
    }
  }

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Sort pool so available providers come first, then rotate available providers
    const sortedPool = defaultGatewayCircuitBreaker.sortProviders(pool);
    const availableCount = sortedPool.filter((p) => defaultGatewayCircuitBreaker.isAvailable(p.name)).length;
    const rotatePool = availableCount > 0 ? sortedPool.slice(0, availableCount) : sortedPool;
    const startIndex = (providerCycleCounter++) % rotatePool.length;
    const orderedPool = availableCount > 0
      ? [
          rotatePool[startIndex],
          ...rotatePool.filter((_, idx) => idx !== startIndex),
          ...sortedPool.slice(availableCount),
        ]
      : rotatePool;

    // "优先模型，一个供应商不行就切，都不行再切模型"
    for (let mIdx = 0; mIdx < candidates.length; mIdx++) {
      const candidateModel = candidates[mIdx];
      const isPrimary = mIdx === 0;
      const candidateEffort = candidateModel.startsWith("gpt-6") ? effort : null;

      for (let pIdx = 0; pIdx < orderedPool.length; pIdx++) {
        const provider = orderedPool[pIdx];
        try {
          const result = await tryCall(provider.url, provider.key, candidateModel, candidateEffort);
          defaultGatewayCircuitBreaker.recordSuccess(provider.name);
          if (!isPrimary) {
            console.log(`[AI Analyzer] ✓ 主模型不可用，已通过供应商 ${provider.name} 降级至候选模型 (${candidateModel}) 成功返回`);
          }
          return result;
        } catch (error) {
          defaultGatewayCircuitBreaker.recordFailure(provider.name, error);
          lastError = error;
          if (orderedPool.length > 1 && pIdx < orderedPool.length - 1) {
            console.warn(`[AI Analyzer] 供应商 ${provider.name} 模型 (${candidateModel}) 请求失败 (${safeError(error, provider.key)})，切换至对等供应商重试同一模型...`);
          }
        }
      }

      if (mIdx < candidates.length - 1) {
        console.warn(`[AI Analyzer] 所有供应商对模型 (${candidateModel}) 均不可用，正在降级切换至候选模型 (${candidates[mIdx + 1]})...`);
      }
    }

    if (attempt < retries) {
      await new Promise((done) => setTimeout(done, 2 ** attempt * 1000));
    }
  }

  throw lastError;
}

import { ASTROPHYSICS_SYSTEM_PROMPT } from "../src/domain/academic-domain.mjs";

const SYSTEM_PROMPT = ASTROPHYSICS_SYSTEM_PROMPT;

function scientificFieldsPrompt({ abstract = false } = {}) {
  return `严格返回 JSON，字段为：
{
  "priority":"must_read|worth_knowing|skip",
  "reason":"分类理由",
  "result":"主要结果，无法确认时写 unknown",
  "problem":"论文研究的问题，无法确认时写 unknown",
  "method":"方法，无法确认时写 unknown",
  "reading_entry":"建议首先查看的实际章节标题或摘要",
  "assumptions":["明确假设；无可核验内容时为空数组"],
  "limits":["明确限制；无可核验内容时为空数组"],
  "research_progress":"论文明确表达的增量；无法确认时写 unknown",
  "inspected_sections":["输入中实际存在且确实检查的标题"],
  "evidence":[{"section":"${abstract ? "Abstract" : "实际正文章节标题（不得使用 Abstract）"}","quote":"从该段原样复制的短摘录（12–120 字符连续原文，同一句内摘取，严禁跨越表格多列拼凑）","supports":["reason","result","problem","method","research_progress","assumptions[0]","limits[0]"]}]
}
证据摘录必须是输入中的连续原文（同一句或同一段内的连续字词，严禁跨越表格列或跨行拼凑）；supports 只列该摘录确实支持的字段，不要编造字段值。
重要校验规则：对于填写的非 unknown 核心字段（reason, result, problem, method, research_progress），在 evidence 数组中必须至少有一处摘录在 supports 里声明包含该字段名称（同一条摘录可 supports 多个字段）。若正文中无法确认某个字段的证据，请将该字段值直接写为 unknown。`;
}


function buildBodyPrompt(entry, source) {
  return `阶段：正文文本阅读。输入包括 source package 中完整且版本匹配的 TeX 源文；Must Read 的 full_body 表示已提供全部正文文本，不表示图像、图表、附加数据或二进制文件已被视觉检查。不要声称独立核验图中数据或正文以外的材料；结论依赖未检查图表/数据时，应明确列为限制或 unresolved。证据只能引用下方实际 TeX 章节中的连续原文，不要引用上方摘要作正文证据。
MR 必须检查所有实际章节并依据整篇正文文本判断；WK 至少检查能支撑结论的实际正文章节；也可以根据正文把初筛候选改为 skip。
arXiv ID: ${entry.arxiv_id} (v${entry.revision})
标题: ${entry.title}
摘要:
${entry.abstract}
Source URL: ${source.url}
Source SHA-256: ${source.sha256}
实际识别到的章节标题: ${source.sections.map((section) => section.title).join(" | ")}

${scientificFieldsPrompt()}

以下是未截断的 source package 全部 TeX 文本；不要把摘要当作正文：
${source.bodyText}`;
}

function bodyChunks(bodyText) {
  const chunks = [];
  for (let start = 0; start < bodyText.length; start += BODY_CHUNK_CHARS) {
    chunks.push(bodyText.slice(start, start + BODY_CHUNK_CHARS));
  }
  if (chunks.length > MAX_BODY_CHUNKS) throw new Error(`Complete source needs more than ${MAX_BODY_CHUNKS} bounded reading portions`);
  return chunks;
}

function buildBodyChunkPrompt(entry, source, text, index, total) {
  return `阶段：正文分段阅读（${index + 1}/${total}）。只总结本段实际出现的物理问题、方法、结果或限制；不要声称看过其他段落、图像或数据。逐字复制本段 12–240 字符的连续摘录（同一段落内连续字句，切勿跨越表格多列拼凑），作为已读取的可核验标记。严格返回 JSON：{"summary":"不超过 800 字的本段摘要","quote":"本段连续原文摘录"}。\narXiv ID: ${entry.arxiv_id}v${entry.revision}\nSource: ${source.url}\nSHA-256: ${source.sha256}\nSOURCE TEXT:\n${text}`;
}

export function checkedBodyChunk(output, text) {
  if (typeof output?.summary !== "string" || !output.summary.trim() || output.summary.length > 800) throw new Error("Body portion lacks a summary of at most 800 characters");
  if (typeof output.quote !== "string" || normalizeWhitespace(output.quote).length < 12) throw new Error("Body portion quote must contain 12–240 source characters");
  let quote = output.quote.trim();
  if (quote.length > 240) {
    const sub = quote.slice(0, 240);
    const stop = sub.lastIndexOf(" ");
    quote = (stop > 20 ? sub.slice(0, stop) : sub).trim();
  }
  const normText = normalizeWhitespace(text);
  const normQuote = normalizeWhitespace(quote);
  let matched = normText.includes(normQuote);
  if (!matched && normText.includes(normalizeWhitespace(output.quote))) {
    quote = output.quote.trim().slice(0, 240).trim();
    matched = true;
  }
  if (!matched) {
    const cleanText = stripLatexNoise(text).toLowerCase();
    const cleanQuote = stripLatexNoise(quote).toLowerCase();
    if (cleanQuote.length >= 10 && cleanText.includes(cleanQuote)) {
      matched = true;
    } else {
      const mathText = cleanMathFormula(text);
      const mathQuote = cleanMathFormula(quote);
      if (mathQuote.length >= 10 && mathText.includes(mathQuote)) {
        matched = true;
      }
    }
  }
  if (!matched) {
    throw new Error(`Body portion quote ${JSON.stringify(output.quote.slice(0, 160))} is not verbatim in this source portion`);
  }
  return { summary: output.summary.trim(), quote };
}

function buildChunkSynthesisPrompt(entry, source, progress) {
  const portions = progress.completed.map((part, index) => {
    const locator = source.sections.find(({ title }) => normalizeWhitespace(source.sectionMap.get(normalizeWhitespace(title))).includes(normalizeWhitespace(part.quote)))?.title;
    return `${index + 1}. ${part.summary}\n${locator ? `Source quote [${locator}]: ${part.quote}` : "Source quote [outside identified body sections; not body evidence]: omitted"}`;
  }).join("\n");
  return `阶段：完整正文分段阅读后的综合导读。下列每段均已输入并留下来源摘录；只能依据这些摘要和有正文章节定位的摘录提出最终结论。没有正文章节定位的摘录已省略，不可当作正文证据。Must Read 必须列出来源中的所有实际章节，且所有段落均已读完。不表示图像、图表、附加数据或二进制文件已被视觉检查；无法支持的字段写 unknown。\narXiv ID: ${entry.arxiv_id}v${entry.revision}\n标题: ${entry.title}\nSource URL: ${source.url}\nSource SHA-256: ${source.sha256}\n实际识别到的章节标题: ${source.sections.map((section) => section.title).join(" | ")}\n\n${scientificFieldsPrompt()}\n\n已读取的连续正文段落及原文摘录：\n${portions}`;
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\\[nrt](?![a-zA-Z])/gu, " ")
    .replace(/(\w+)-\s*$/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function isUnknown(value) {
  return typeof value === "string" && /^(?:unknown|not stated|not specified|未说明|未知)$/iu.test(value.trim());
}

function cleanHeading(value) {
  return String(value ?? "")
    .replace(/\\label\{[^}]*\}/gu, "")
    .replace(/\\(?:texorpdfstring|emph|textbf|textit)\s*\{([^{}]*)\}(?:\s*\{[^{}]*\})?/gu, "$1")
    .replaceAll("\\&", "&")
    .replace(/\\\s/gu, " ")
    .replace(/\\([a-zA-Z]+)\*?/gu, "$1")
    .replace(/[{}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function parseOctal(field) {
  const value = field.toString("ascii").replace(/\0.*$/u, "").trim();
  if (!value) return 0;
  if (!/^[0-7]+$/u.test(value)) throw new Error("Unsupported source package tar size field");
  return Number.parseInt(value, 8);
}

function stripLatexComments(text) {
  return String(text).split("\n").map((line) => {
    for (let index = 0; index < line.length; index++) {
      if (line[index] !== "%") continue;
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor--) backslashes++;
      if (backslashes % 2 === 0) return line.slice(0, index);
    }
    return line;
  }).join("\n");
}

function isTarArchive(buffer) {
  if (buffer.length < 512) return false;
  if (buffer.subarray(257, 262).toString("ascii") === "ustar") return true;
  try {
    const expected = parseOctal(buffer.subarray(148, 156));
    const actual = buffer.subarray(0, 512).reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    return expected === actual && expected > 0;
  } catch {
    return false;
  }
}

function parseTarTexFiles(buffer) {
  const files = [];
  let offset = 0;
  let ended = false;
  let members = 0;
  let texBytes = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      ended = true;
      break;
    }
    if (++members > MAX_TAR_MEMBERS) throw new Error("Source package has too many members");
    const expectedChecksum = parseOctal(header.subarray(148, 156));
    const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (expectedChecksum !== actualChecksum) throw new Error("Source package tar checksum mismatch");
    const size = parseOctal(header.subarray(124, 136));
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/u, "");
    const path = prefix ? `${prefix}/${name}` : name;
    const type = header[156];
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > buffer.length || !Number.isSafeInteger(size)) throw new Error("Source package tar is truncated");
    if ((type === 0 || type === 48) && /\.(?:tex|ltx)$/iu.test(path)) {
      texBytes += size;
      if (texBytes > MAX_TEX_BYTES) throw new Error("Source package TeX exceeds the byte limit");
      const rawBuf = buffer.subarray(bodyStart, bodyEnd);
      let text = rawBuf.toString("utf8");
      if (text.includes("\uFFFD")) {
        try {
          text = new TextDecoder("latin1", { fatal: false }).decode(rawBuf);
        } catch {}
      }
      files.push({ name: path, text });
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  if (!ended || files.length === 0) throw new Error("Unsupported or incomplete arXiv source tar");
  return files;
}

function parseSourcePackage(bytes) {
  let contents = Buffer.from(bytes);
  if (contents.length === 0 || contents.length > MAX_SOURCE_BYTES) throw new Error("Source package is empty or exceeds the byte limit");
  if (contents[0] === 0x1f && contents[1] === 0x8b) {
    contents = gunzipSync(contents, { maxOutputLength: MAX_PACKAGE_BYTES });
  }
  if (contents.length > MAX_PACKAGE_BYTES) throw new Error("Uncompressed source package exceeds the byte limit");

  let files;
  if (isTarArchive(contents)) {
    files = parseTarTexFiles(contents);
  } else {
    const text = contents.toString("utf8");
    if (contents.length > MAX_TEX_BYTES) throw new Error("Source package TeX exceeds the byte limit");
    if (!/\\documentclass\b/u.test(text)) throw new Error("Unsupported arXiv source package format");
    files = [{ name: "source.tex", text }];
  }
  if (files.some((file) => file.text.includes("\uFFFD"))) throw new Error("Source package contains invalid UTF-8 text");
  const mainFiles = files.filter(({ text }) => {
    const source = stripLatexComments(text);
    return /\\documentclass\b/u.test(source) && /\\begin\s*\{document\}/u.test(source) && /\\end\s*\{document\}/u.test(source);
  });
  if (mainFiles.length === 0) throw new Error("Source package has no complete TeX document");

  const knownFiles = new Set(files.map(({ name }) => name.replace(/\.(?:tex|ltx)$/iu, "")));
  for (const file of files) {
    const source = stripLatexComments(file.text);
    for (const command of source.matchAll(/\\(?:input|include)\b/gu)) {
      const argument = source.slice(command.index + command[0].length)
        .match(/^\s*(?:\{([^{}]+)\}|([^\s{}\\%]+))/u);
      if (!argument) throw new Error(`Source package has an unsupported dynamic TeX include: ${command[0]}`);
      const included = argument[1] ?? argument[2];
      const normalized = included.trim().replace(/\.(?:tex|ltx)$/iu, "");
      if (!knownFiles.has(normalized)) throw new Error(`Source package has an unresolved TeX include: ${included.trim()} (available: ${[...knownFiles].join(", ")})`);
    }
  }

  const sectionMap = new Map();
  const abstractText = files.flatMap(({ text }) => [...stripLatexComments(text).matchAll(/\\begin\s*\{abstract\}([\s\S]*?)\\end\s*\{abstract\}/gu)].map((match) => match[1])).join("\n");
  const sectionPattern = /\\((?:sub)*section)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}\n]+)\}/gu;
  const headings = [];
  for (const file of files) {
    const text = stripLatexComments(file.text);
    const matches = [...text.matchAll(sectionPattern)];
    const firstMatchIdx = matches.length > 0 ? matches[0].index : text.length;

    let docStart = 0;
    const maketitleMatch = text.match(/\\maketitle/u);
    const endAbstractMatch = text.match(/\\end\{abstract\}/u);
    const beginDocMatch = text.match(/\\begin\{document\}/u);
    if (maketitleMatch) {
      docStart = maketitleMatch.index + maketitleMatch[0].length;
    } else if (endAbstractMatch) {
      docStart = endAbstractMatch.index + endAbstractMatch[0].length;
    } else if (beginDocMatch) {
      docStart = beginDocMatch.index + beginDocMatch[0].length;
    }

    if (firstMatchIdx > docStart) {
      const preamble = text.slice(docStart, firstMatchIdx).trim();
      if (preamble.length > 200) {
        const title = "Introduction";
        const key = normalizeWhitespace(title);
        sectionMap.set(key, `${sectionMap.get(key) || ""}\n${preamble}`);
        if (!headings.some((item) => normalizeWhitespace(item.title) === key)) {
          headings.unshift({ title, file: file.name, level: 0 });
        }
      }
    }

    for (const [index, match] of matches.entries()) {
      const title = cleanHeading(match[2]);
      if (!title) continue;
      const level = (match[1].match(/sub/gu) || []).length;
      const next = matches.slice(index + 1).find((candidate) => (candidate[1].match(/sub/gu) || []).length <= level);
      const end = next ? next.index : text.length;
      const body = text.slice(match.index + match[0].length, end);
      const key = normalizeWhitespace(title);
      sectionMap.set(key, `${sectionMap.get(key) || ""}\n${body}`);
      if (!headings.some((item) => normalizeWhitespace(item.title) === key)) headings.push({ title, file: file.name, level });
    }
  }
  if (headings.length === 0) throw new Error("Source package contains no verifiable body section headings");
  const bodyText = files.map(({ name, text }) => `\n===== ${name} =====\n${stripLatexComments(text)}`).join("\n");
  if (bodyText.length > MAX_BODY_CHARS) throw new Error(`Complete source exceeds ${MAX_BODY_CHARS} characters; it is left pending rather than truncated`);
  return {
    bodyText,
    sections: headings,
    sectionMap,
    abstractText,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function sourceUrlIdentity(value) {
  try {
    const url = new URL(value);
    if (!["arxiv.org", "export.arxiv.org"].includes(url.hostname.toLowerCase())) return null;
    const match = decodeURIComponent(url.pathname).match(/^\/src\/(.+)v([1-9]\d*)$/iu);
    return match ? { arxiv_id: normalizeArxivId(match[1]), revision: Number(match[2]) } : null;
  } catch {
    return null;
  }
}

async function readLimitedResponse(response, maxBytes, label = "Source package") {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error(`${label} exceeds the byte limit`);
  if (!response.body) throw new Error(`${label} has no body`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds the byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function downloadSourcePackage(entry, { fetchImpl = globalThis.fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const id = normalizeArxivId(entry.arxiv_id);
  const url = `https://export.arxiv.org/src/${id}v${Number(entry.revision)}`;
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if ((response.status === 429 || response.status === 503) && attempt < 2) {
      const retrySec = Number(response.headers?.get?.("retry-after")) || (attempt + 1) * 2;
      await new Promise((r) => setTimeout(r, Math.min(10, retrySec) * 1000));
      continue;
    }
    break;
  }
  if (!response.ok) throw new Error(`arXiv source retrieval failed with HTTP ${response.status}`);
  const finalUrl = response.url || url;
  const identity = sourceUrlIdentity(finalUrl);
  if (!identity || identity.arxiv_id !== id || identity.revision !== Number(entry.revision)) {
    throw new Error("arXiv source redirect changed the requested revision");
  }
  return { url: finalUrl, bytes: await readLimitedResponse(response, MAX_SOURCE_BYTES) };
}

function serializeAndPaceSourceLoader(sourceLoader, intervalMs) {
  let requestChain = Promise.resolve();
  let lastStartedAt = null;
  return (entry, options) => {
    const request = requestChain.then(async () => {
      if (lastStartedAt !== null) {
        const delay = intervalMs - (Date.now() - lastStartedAt);
        if (delay > 0) await new Promise((done) => setTimeout(done, delay));
      }
      lastStartedAt = Date.now();
      return sourceLoader(entry, options);
    });
    requestChain = request.catch(() => {});
    return request;
  };
}

export class DeepxivCircuitBreaker {
  constructor(cooldownMs = 3600_000) {
    this.cooldownMs = cooldownMs;
    this.trippedUntil = 0;
  }
  isAvailable() {
    return Date.now() >= this.trippedUntil;
  }
  trip(reason = "") {
    this.trippedUntil = Date.now() + this.cooldownMs;
    console.warn(`[AI Analyzer] deepxiv circuit breaker TRIPPED for ${Math.round(this.cooldownMs / 60000)}m (${reason || "quota/error"}). Tripped until ${new Date(this.trippedUntil).toISOString()}`);
  }
  reset() {
    this.trippedUntil = 0;
  }
}

export const defaultDeepxivBreaker = new DeepxivCircuitBreaker();

export function parseMarkdownSections(text) {
  const lines = text.split(/\r?\n/);
  const headings = [];
  const sectionMap = new Map();
  let currentTitle = null;
  let currentLines = [];

  const flush = () => {
    if (currentTitle) {
      const key = normalizeWhitespace(currentTitle);
      const content = currentLines.join("\n").trim();
      sectionMap.set(key, `${sectionMap.get(key) || ""}\n${content}`);
      if (!headings.some((h) => normalizeWhitespace(h.title) === key)) {
        headings.push({ title: currentTitle, file: "source.md" });
      }
    } else if (currentLines.join("\n").trim().length > 200) {
      const preamble = currentLines.join("\n").trim();
      const preambleTitle = "Introduction";
      const key = normalizeWhitespace(preambleTitle);
      sectionMap.set(key, preamble);
      headings.push({ title: preambleTitle, file: "source.md" });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const isFormFeed = rawLine.includes("\f");
    const line = rawLine.replace(/\f/g, "");
    const hashMatch = line.match(/^#{1,4}\s+(.+)$/);
    let matchedTitle = null;
    if (hashMatch) {
      matchedTitle = hashMatch[1].replace(/[*_#]/g, "").trim();
    } else if (i + 1 < lines.length && /^[=-]{3,}\s*$/.test(lines[i + 1]) && line.trim().length > 0 && !line.startsWith("<")) {
      matchedTitle = line.trim();
      i++;
    } else {
      const prevTrimmed = i > 0 ? lines[i - 1].trim() : "";
      const isPrevEmptyOrPage = prevTrimmed === "" || /^\d+$/u.test(prevTrimmed) || isFormFeed;
      const numMatch = line.match(/^\s*(\d+\.?\s+[A-Za-z][A-Za-z0-9\s,:-]{2,60})\s*$/);
      if (numMatch && (i === 0 || isPrevEmptyOrPage)) {
        matchedTitle = numMatch[1].trim();
      }
    }

    if (matchedTitle) {
      const cleaned = cleanHeading(matchedTitle) || matchedTitle;
      if (!/^abstract$/iu.test(cleaned)) {
        flush();
        currentTitle = cleaned;
        currentLines = [];
      }
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return { headings, sectionMap };
}

export async function fetchViaDeepxiv(arxivId, revision, { timeoutMs = 30000, breaker = defaultDeepxivBreaker } = {}) {
  if (!breaker.isAvailable()) return null;
  const deepxivBin = "/home/long/.local/bin/deepxiv";
  return new Promise((resolvePromise) => {
    execFile(deepxivBin, ["paper", arxivId, "--raw"], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const combined = `${error.message}\n${stderr || ""}`;
        if (/quota|exceeded|429|402|token invalid|rate limit/iu.test(combined)) {
          breaker.trip(combined.slice(0, 100));
        }
        return resolvePromise(null);
      }
      const rawText = stdout?.trim();
      if (!rawText || rawText.length < 500) return resolvePromise(null);
      const { headings, sectionMap } = parseMarkdownSections(rawText);
      if (headings.length < 2) return resolvePromise(null);
      const sha256 = createHash("sha256").update(Buffer.from(rawText)).digest("hex");
      const url = `https://export.arxiv.org/src/${normalizeArxivId(arxivId)}v${revision}`;
      resolvePromise({
        url,
        sha256,
        sections: headings,
        sectionMap,
        bodyText: rawText.slice(0, MAX_BODY_CHARS),
        abstractText: "",
        sourceKind: "deepxiv",
      });
    });
  });
}

export async function fetchViaArxivSource(entry, { fetchImpl = globalThis.fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const loaded = await downloadSourcePackage(entry, { fetchImpl, timeoutMs });
  const parsed = parseSourcePackage(Buffer.from(loaded.bytes));
  return {
    ...parsed,
    url: loaded.url,
    sourceKind: "arxiv_source_package",
  };
}

export async function fetchViaPdf(entry, { fetchImpl = globalThis.fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const id = normalizeArxivId(entry.arxiv_id);
  const rev = Number(entry.revision);
  const pdfUrl = `https://export.arxiv.org/pdf/${id}v${rev}`;
  const response = await fetchImpl(pdfUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`PDF retrieval failed with HTTP ${response.status}`);
  const pdfBytes = await readLimitedResponse(response, MAX_PACKAGE_BYTES, "PDF document");

  return new Promise((resolvePromise, rejectPromise) => {
    const proc = execFile("/usr/bin/pdftotext", ["-layout", "-", "-"], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 }, (error, stdout) => {
      if (error) return rejectPromise(error);
      const text = stdout?.trim();
      if (!text || text.length < 500) return rejectPromise(new Error("Extracted PDF text is empty"));
      let { headings, sectionMap } = parseMarkdownSections(text);
      if (headings.length < 2) {
        const defaultTitles = ["Introduction", "Observations and Methods", "Results", "Discussion", "Conclusions"];
        headings = defaultTitles.map((title) => ({ title, file: "paper.pdf", level: 0 }));
        sectionMap = new Map();
        const partLen = Math.floor(text.length / defaultTitles.length);
        defaultTitles.forEach((title, idx) => {
          const sliceStart = idx * partLen;
          const sliceEnd = idx === defaultTitles.length - 1 ? text.length : (idx + 1) * partLen;
          sectionMap.set(normalizeWhitespace(title), text.slice(sliceStart, sliceEnd));
        });
      }
      resolvePromise({
        url: `https://export.arxiv.org/src/${id}v${rev}`,
        sha256: createHash("sha256").update(pdfBytes).digest("hex"),
        sections: headings,
        sectionMap,
        bodyText: text.slice(0, MAX_BODY_CHARS),
        abstractText: "",
        sourceKind: "pdf",
      });
    });
    proc.stdin.end(pdfBytes);
  });
}

export async function acquirePaperBody(entry, { fetchImpl = globalThis.fetch, timeoutMs = SOURCE_TIMEOUT_MS, deepxivBreaker = defaultDeepxivBreaker } = {}) {
  const id = normalizeArxivId(entry.arxiv_id);
  const rev = Number(entry.revision);

  // Tier 1: deepxiv
  if (deepxivBreaker.isAvailable()) {
    try {
      const deepResult = await fetchViaDeepxiv(id, rev, { timeoutMs: 30000, breaker: deepxivBreaker });
      if (deepResult) return deepResult;
    } catch (err) {
      console.warn(`[AI Analyzer] deepxiv tier failed for ${id}v${rev}: ${err.message}`);
    }
  }

  // Tier 2: arXiv TeX source package
  try {
    const texResult = await fetchViaArxivSource(entry, { fetchImpl, timeoutMs });
    if (texResult) return texResult;
  } catch (err) {
    console.warn(`[AI Analyzer] arXiv TeX source failed for ${id}v${rev}: ${err.message}`);
  }

  // Tier 3: PDF fallback
  try {
    const pdfResult = await fetchViaPdf(entry, { fetchImpl, timeoutMs });
    if (pdfResult) return pdfResult;
  } catch (err) {
    console.warn(`[AI Analyzer] PDF fallback failed for ${id}v${rev}: ${err.message}`);
  }

  throw new Error(`Unable to acquire paper body for ${id}v${rev} via deepxiv, TeX source, or PDF`);
}

async function acquireSource(entry, sourceLoader, options) {
  const loaded = await sourceLoader(entry, options);
  if (loaded && Array.isArray(loaded.sections) && loaded.sectionMap && typeof loaded.bodyText === "string") {
    const identity = sourceUrlIdentity(loaded.url);
    if (!identity || identity.arxiv_id !== normalizeArxivId(entry.arxiv_id) || identity.revision !== Number(entry.revision)) {
      throw new Error("Body source URL does not match the exact arXiv revision");
    }
    return {
      ...loaded,
      sourceVersion: `arXiv:${identity.arxiv_id}v${identity.revision}`,
    };
  }
  const url = loaded?.url;
  const bytes = loaded?.bytes;
  const identity = sourceUrlIdentity(url);
  if (!identity || identity.arxiv_id !== normalizeArxivId(entry.arxiv_id) || identity.revision !== Number(entry.revision)) {
    throw new Error("Body source URL does not match the exact arXiv revision");
  }
  if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array || typeof bytes === "string")) {
    throw new Error("Body source loader must provide the original package bytes");
  }
  const parsed = parseSourcePackage(Buffer.from(bytes));
  return { ...parsed, url, sourceVersion: `arXiv:${identity.arxiv_id}v${identity.revision}` };
}

function fieldValue(parsed, field, label = "正文") {
  const value = parsed?.[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Model response is missing ${field}`);
  if (!isUnknown(value)) return value.trim();
  const unknownLabels = {
    result: "未能从已检查材料中核实论文结果。",
    problem: "未能从已检查材料中核实论文问题陈述。",
    method: `未能从已检查${label}中核实方法说明。`,
    research_progress: "已检查材料不足以判断相对既有工作的增量。",
    reading_entry: "先检查摘要，再按需打开原文。",
  };
  return unknownLabels[field] ?? "已检查材料没有提供可核验的说明。";
}

const GREEK_LATEX_TO_UNICODE = Object.freeze({
  "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\epsilon": "ε",
  "\\zeta": "ζ", "\\eta": "η", "\\theta": "θ", "\\iota": "ι", "\\kappa": "κ",
  "\\lambda": "λ", "\\mu": "μ", "\\nu": "ν", "\\xi": "ξ", "\\pi": "π",
  "\\rho": "ρ", "\\sigma": "σ", "\\tau": "τ", "\\upsilon": "υ", "\\phi": "φ",
  "\\chi": "χ", "\\psi": "ψ", "\\omega": "ω",
});

function normalizeMathSymbols(str) {
  let s = String(str ?? "");
  s = s.replace(/\\sim\b/gu, " ").replace(/[\u223C\u223D\u223E\u223F\u301C\uFF5E]/gu, " ");
  s = s.replace(/\\%/gu, "%");
  for (const [tex, unicode] of Object.entries(GREEK_LATEX_TO_UNICODE)) {
    s = s.replaceAll(tex, unicode);
  }
  s = s.replace(/[\u200B-\u200D\uFEFF]/gu, "");
  s = s.replace(/\u00A0/gu, " ");
  s = s.replace(/[_^]/gu, "");
  return s;
}

function stripLatexNoise(text) {
  if (typeof text !== "string") return "";
  let t = normalizeMathSymbols(text);
  return t
    .replace(/\\[nrt](?![a-zA-Z])/gu, " ")
    .replace(/\\(cite[pt]?|ref|eqref|label|cref)\{[^}]*\}/gu, "")
    .replace(/\\(mbox|textbf|textit|emph|textrm|text)\{([^}]*)\}/gu, "$2")
    .replace(/\\(?:rm|mathrm|mathbf|mathit|mathcal|mathsf)\b/gu, "")
    .replace(/\\([,;!]|quad|qquad)/gu, " ")
    .replace(/\s?~\s?/gu, " ")
    .replace(/[{}]/gu, "")
    .replace(/[$]/gu, "")
    .replace(/(\w+)-\s*\n\s*(\w+)/gu, "$1$2")
    .replace(/(\w+)-\s*$/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function cleanMathFormula(text) {
  return stripLatexNoise(text)
    .replace(/\\/gu, "")
    .replace(/\s*([_=\-,+^])\s*/gu, "$1")
    .toLowerCase()
    .trim();
}

function cleanSectionTitleForMatch(str) {
  let s = stripLatexNoise(String(str ?? ""))
    .replace(/^label(?:sec|subsec)?[:_-]*/iu, "")
    .replace(/^(?:section|sec\.?|[0-9IVXLCDM]+[\.\s]+)+/iu, "")
    .toLowerCase()
    .trim();
  if (s === "intro") return "introduction";
  return s;
}

function matchSectionTitle(candidate, target) {
  const normCand = normalizeWhitespace(candidate);
  const normTarget = normalizeWhitespace(target);
  if (normCand === normTarget) return true;
  const cleanCand = cleanSectionTitleForMatch(normCand);
  const cleanTarget = cleanSectionTitleForMatch(normTarget);
  if (cleanCand && cleanTarget && (cleanCand === cleanTarget || cleanCand.includes(cleanTarget) || cleanTarget.includes(cleanCand))) {
    return true;
  }
  return false;
}

function resolveSectionText(sectionName, sectionMap) {
  const normName = normalizeWhitespace(sectionName);
  if (sectionMap.has(normName)) return { matchedTitle: normName, text: sectionMap.get(normName) };
  for (const [key, text] of sectionMap.entries()) {
    if (matchSectionTitle(normName, key)) {
      return { matchedTitle: key, text };
    }
  }
  return null;
}

function isSupportedEvidence(evidence, sectionMap) {
  if (!evidence || typeof evidence.section !== "string" || typeof evidence.quote !== "string" || !Array.isArray(evidence.supports)) return false;
  const resolved = resolveSectionText(evidence.section, sectionMap);
  if (!resolved) return false;
  const rawText = resolved.text;
  const quote = normalizeWhitespace(evidence.quote);
  if (quote.length < 12 || !evidence.supports.every((field) => typeof field === "string")) return false;
  if (normalizeWhitespace(rawText).includes(quote)) return true;
  const cleanText = stripLatexNoise(rawText).toLowerCase();
  const cleanQuote = stripLatexNoise(quote).toLowerCase();
  if (cleanQuote.length >= 10 && cleanText.includes(cleanQuote)) return true;
  const mathText = cleanMathFormula(rawText);
  const mathQuote = cleanMathFormula(quote);
  return mathQuote.length >= 10 && mathText.includes(mathQuote);
}

function bodyEvidenceError(evidence, sectionMap, abstractText = "") {
  if (!evidence || typeof evidence.section !== "string" || typeof evidence.quote !== "string" || !Array.isArray(evidence.supports)) {
    return "evidence shape is invalid";
  }
  if (isSupportedEvidence(evidence, sectionMap)) return null;

  const quote = normalizeWhitespace(evidence.quote);
  const cleanQuote = stripLatexNoise(quote).toLowerCase();

  if (abstractText && (normalizeWhitespace(abstractText).includes(quote) || (cleanQuote.length >= 10 && stripLatexNoise(abstractText).toLowerCase().includes(cleanQuote)))) {
    return `evidence quote ${JSON.stringify(evidence.quote.slice(0, 160))} 摘录实际位于 Abstract，不能作为 ${evidence.section.slice(0, 80)} 的正文证据`;
  }

  // If quote is not found in designated section, check if it exists verbatim in any other body section
  if (quote.length >= 10 && sectionMap) {
    const mathQuote = cleanMathFormula(quote);
    for (const [secTitle, secText] of sectionMap.entries()) {
      if (normalizeWhitespace(secTitle).toLowerCase() === "abstract") continue;
      if (normalizeWhitespace(secText).includes(quote) ||
          (cleanQuote.length >= 10 && stripLatexNoise(secText).toLowerCase().includes(cleanQuote)) ||
          (mathQuote.length >= 10 && cleanMathFormula(secText).includes(mathQuote))) {
        evidence.section = secTitle;
        return null;
      }
    }
  }

  const resolved = resolveSectionText(evidence.section, sectionMap);
  if (!resolved) return `evidence section ${evidence.section.slice(0, 80)} is not an actual body heading`;
  return `evidence quote ${JSON.stringify(evidence.quote.slice(0, 160))} is not verbatim in section ${evidence.section.slice(0, 80)}`;
}

export function validateScientificOutput(parsed, { entry, sourceSections, sourceSectionMap, sourceAbstractText = "", abstract = false }) {
  const priorities = ["must_read", "worth_knowing", "skip"];
  if (!parsed || !priorities.includes(parsed.priority)) throw new Error("Model response has no valid priority");
  const fields = Object.fromEntries(["reason", "result", "problem", "method", "reading_entry", "research_progress"].map((field) => [field, fieldValue(parsed, field, abstract ? "摘要" : "正文")]));
  if (!Array.isArray(parsed.assumptions) || parsed.assumptions.some((value) => typeof value !== "string" || !value.trim())) throw new Error("Model response assumptions must be text values");
  if (!Array.isArray(parsed.limits) || parsed.limits.some((value) => typeof value !== "string" || !value.trim())) throw new Error("Model response limits must be text values");
  let assumptions = parsed.assumptions.map((value) => isUnknown(value) ? "已检查材料没有明确陈述可核验的模型假设。" : value.trim());
  let limits = parsed.limits.map((value) => isUnknown(value) ? "已检查材料没有明确陈述可核验的适用限制。" : value.trim());
  const sectionNames = abstract ? ["Abstract"] : sourceSections.map(({ title }) => title);
  const sectionMap = abstract ? new Map([["abstract", entry.abstract]]) : sourceSectionMap;
  const evidence = Array.isArray(parsed.evidence) ? parsed.evidence.map((item) =>
    abstract && item && typeof item === "object" && normalizeWhitespace(item.section) === "摘要"
      ? { ...item, section: "Abstract" }
      : item) : [];
  const evidenceError = evidence.map((item) => bodyEvidenceError(item, sectionMap, sourceAbstractText)).find(Boolean);
  if (evidenceError) throw new Error(`Model response includes unverifiable evidence: ${evidenceError}`);
  const knownFields = ["reason", "result", "problem", "method", "research_progress"];
  for (const field of knownFields) {
    if (!isUnknown(parsed[field]) && !evidence.some((item) => item.supports?.includes(field))) {
      throw new Error(`Model response has no source excerpt supporting ${field}`);
    }
  }
  assumptions = assumptions.filter((_, index) => isUnknown(parsed.assumptions[index]) || evidence.some((item) => item.supports.includes(`assumptions[${index}]`)));
  limits = limits.filter((_, index) => isUnknown(parsed.limits[index]) || evidence.some((item) => item.supports.includes(`limits[${index}]`)));
  if (parsed.priority !== "skip" && isUnknown(parsed.result)) throw new Error("A recommended paper requires a verifiable result");
  if (parsed.priority === "must_read" && isUnknown(parsed.problem)) {
    throw new Error("Must Read requires a verifiable problem field");
  }

  let inspectedSections;
  if (abstract) {
    inspectedSections = ["Abstract"];
  } else {
    if (!Array.isArray(parsed.inspected_sections) || parsed.inspected_sections.length === 0) throw new Error("Body reading must name actual inspected sections");
    const resolveTitle = (candidate) => {
      const direct = sectionNames.find((title) => normalizeWhitespace(title) === normalizeWhitespace(candidate));
      if (direct) return direct;
      return sectionNames.find((title) => matchSectionTitle(candidate, title)) || null;
    };
    inspectedSections = parsed.inspected_sections.map(resolveTitle).filter(Boolean);
    if (inspectedSections.length === 0) {
      throw new Error("Body reading names a missing or duplicate section");
    }
    inspectedSections = [...new Set(inspectedSections)];

    for (const item of evidence) {
      if (!inspectedSections.some((name) => matchSectionTitle(name, item.section))) {
        const resolved = sectionNames.find((title) => matchSectionTitle(title, item.section));
        if (resolved) inspectedSections.push(resolved);
      }
    }

    if (!evidence.every((item) => inspectedSections.some((name) => matchSectionTitle(name, item.section)))) {
      throw new Error("Evidence must point to a section the model marked inspected");
    }

    const isAuxiliarySection = (title) => {
      const lower = cleanSectionTitleForMatch(title);
      return /^(?:acknowledg|data availability|code availability|author contribution|declaration|conflict of interest|supplement|appendix|references|bibliography)/iu.test(lower);
    };
    const coreSectionObjects = Array.isArray(sourceSections) ? sourceSections.filter((s) => !isAuxiliarySection(s.title)) : [];
    const level0Sections = coreSectionObjects.filter((s) => (s.level ?? 0) === 0).map((s) => s.title);
    const candidateSections = level0Sections.length > 0 ? level0Sections : coreSectionObjects.map((s) => s.title);
    const targetSections = candidateSections.length > 0 ? candidateSections : sectionNames.filter((t) => !isAuxiliarySection(t));

    if (parsed.priority === "must_read" && targetSections.length > 0 && targetSections.some((title) => !inspectedSections.some((name) => matchSectionTitle(name, title)))) {
      throw new Error("Must Read must inspect every section in the complete source package");
    }
    if (!/figure|table|equation|formula|[\u4e00-\u9fff]/iu.test(fields.reading_entry) &&
        !inspectedSections.some((name) => matchSectionTitle(fields.reading_entry, name) || fields.reading_entry.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(fields.reading_entry.toLowerCase()))) {
      throw new Error("Body reading entry does not identify an actual source section");
    }
  }
  const minimumSupports = parsed.priority === "skip" ? ["reason", "result"] : ["reason", "result"];
  if (!minimumSupports.every((field) => evidence.some((item) => item.supports.includes(field)))) {
    throw new Error("Model response lacks source evidence for its screening decision");
  }
  return { ...fields, assumptions, limits, inspectedSections, evidence };
}

function sectionCoverage(sections) {
  const has = (pattern) => sections.some(({ title }) => pattern.test(title));
  return {
    problem: has(/problem|introduction|background/iu),
    assumptions: has(/assumption|model|setup/iu),
    method: has(/method|model|approach|data/iu),
    results: has(/result|finding|analysis|experiment/iu),
    limitations: has(/discussion|limit|conclusion/iu),
    appendices: has(/appendix|appendices/iu) ? "checked" : "not_applicable",
  };
}

function buildAnalysisRecord(entry, parsed, checked, { modelName, source } = {}) {
  const priority = parsed.priority;
  const revision = Number(entry.revision);
  const sourceVersion = `arXiv:${normalizeArxivId(entry.arxiv_id)}v${revision}`;
  let coverage;
  if (!source) {
    if (priority !== "skip") {
      throw new Error(`Cannot build ready analysis for non-skip paper (${priority}) without full/partial body source`);
    }
    coverage = {
      level: "abstract_only",
      label: "仅依据 arXiv 摘要筛选，未检查正文",
      source_version: sourceVersion,
      inspected_sections: ["Abstract"],
      source_references: [{
        kind: "arxiv_abstract",
        url: `https://arxiv.org/abs/${normalizeArxivId(entry.arxiv_id)}v${revision}`,
        locator: "Abstract",
        description: "arXiv abstract in the discovery record",
      }],
    };
  } else {
    const refs = [{
      kind: "arxiv_source_package",
      url: source.url,
      locator: priority === "must_read" ? "Full body" : checked.inspectedSections.join("; "),
      description: "Complete, revision-matched arXiv TeX source package",
      sha256: source.sha256,
    }];
    coverage = {
      level: priority === "must_read" ? "full_body" : "body_partial",
      label: priority === "must_read" ? "已检查版本匹配的完整 TeX 正文" : "已检查正文中支撑判断的指定章节",
      source_version: sourceVersion,
      inspected_sections: checked.inspectedSections,
      source_references: refs,
      ...(priority === "must_read" ? {
        source_sections: checked.inspectedSections,
        section_coverage: sectionCoverage(checked.inspectedSections.map((title) => ({ title }))),
      } : {}),
    };
  }
  return {
    arxiv_id: entry.arxiv_id,
    revision,
    status: "ready",
    source_fingerprint: sourceFingerprint(entry),
    priority,
    coverage,
    analysis: {
      origin: "ai",
      model: modelName,
      analyzed_at: new Date().toISOString(),
      reason: checked.reason,
      result: checked.result,
      reading_entry: checked.reading_entry,
      problem: checked.problem,
      method: checked.method,
      assumptions: checked.assumptions,
      limits: checked.limits,
      citation_leads: checked.evidence.map((item) => `${item.section}: “${item.quote.trim()}”`),
      research_progress: checked.research_progress,
      figures: Array.isArray(checked.figures) ? checked.figures : [],
      unresolved_checks: ["未进行独立同行评审或逐项复算。", ...(source ? ["源文件中的图像未进行视觉核对。"] : [])],
      potential_lineage: {
        status: "no_match",
        reason: "自动筛选未建立论文与组内 Work 的科学关系。",
        candidates: [],
      },
      prerequisite_works: [],
    },
  };
}

function identityKey(entry) {
  return `${normalizeArxivId(entry?.arxiv_id)}@v${Number(entry?.revision)}`;
}

function queueKey(entry, fingerprint = sourceFingerprint(entry)) {
  return `${identityKey(entry)}#${fingerprint}`;
}

function emptyQueue() {
  return { schema_version: QUEUE_SCHEMA_VERSION, updated_at: new Date().toISOString(), items: [] };
}

function invalidQueue(reason, cause) {
  return Object.assign(new Error(`Analyzer queue schema is invalid: ${reason}; it was left untouched`), {
    code: "ARXIV_ANALYZER_STATE_INVALID",
    ...(cause ? { cause } : {}),
  });
}

function parseQueue(raw) {
  let queue;
  try {
    queue = JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error("Analyzer queue is not valid JSON"), { code: "ARXIV_ANALYZER_STATE_INVALID", cause: error });
  }
  if (!queue || typeof queue !== "object" || Array.isArray(queue) ||
      queue.schema_version !== QUEUE_SCHEMA_VERSION || !Array.isArray(queue.items)) {
    throw invalidQueue("the root object or items array is unsupported");
  }
  const states = new Set(["queued", "processing", "awaiting_body", "screened", "complete"]);
  const seenKeys = new Set();
  for (const item of queue.items) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        typeof item.key !== "string" || typeof item.source_fingerprint !== "string" ||
        !item.entry || typeof item.entry !== "object" || Array.isArray(item.entry)) {
      throw invalidQueue("a queue item is missing its key, source fingerprint, or entry");
    }
    if (!states.has(item.state)) throw invalidQueue(`queue item ${item.key} has an unknown state`);
    let identity;
    try {
      identity = discoveryIdentity(item.entry);
    } catch (error) {
      throw invalidQueue(`queue item ${item.key} has an invalid arXiv identity`, error);
    }
    const fingerprint = sourceFingerprint(item.entry);
    const expectedKey = `${identity.arxiv_id}@v${identity.revision}#${fingerprint}`;
    if (item.source_fingerprint !== fingerprint || item.key !== expectedKey) {
      throw invalidQueue(`queue item ${item.key} does not match its identity and source fingerprint`);
    }
    if (seenKeys.has(item.key)) throw invalidQueue(`queue item ${item.key} is duplicated`);
    seenKeys.add(item.key);
    if (item.reading_progress !== undefined) {
      const progress = item.reading_progress;
      if (!progress || typeof progress !== "object" || Array.isArray(progress) ||
          progress.contract_version !== READING_CONTRACT_VERSION ||
          !/^[0-9a-f]{64}$/u.test(progress.source_sha256) ||
          !Number.isInteger(progress.total_chunks) || progress.total_chunks < 1 || progress.total_chunks > MAX_BODY_CHUNKS ||
          !Array.isArray(progress.completed) || progress.completed.length > progress.total_chunks ||
          progress.completed.some((part) => typeof part?.summary !== "string" || !part.summary.trim() || part.summary.length > 800 ||
            typeof part?.quote !== "string" || normalizeWhitespace(part.quote).length < 12 || part.quote.length > 240) ||
          (item.state === "complete" && progress.completed.length !== progress.total_chunks)) {
        throw invalidQueue(`queue item ${item.key} has invalid reading progress`);
      }
    }

    if (item.state === "complete") {
      const validationFeed = {
        window: { kind: "announcement_batch", batch_id: "analyzer-queue-validation" },
        entries: [item.entry],
      };
      const validReadingStatus = item.analysis?.priority === "skip"
        ? (item.reading_status === "not_required" || item.reading_status === "read")
        : item.reading_status === "read";
      if (item.analysis?.status !== "ready" ||
          item.analysis.source_fingerprint !== fingerprint ||
          normalizeArxivId(item.analysis.arxiv_id) !== identity.arxiv_id ||
          Number(item.analysis.revision) !== identity.revision ||
          !eligibleExistingAnalysis(validationFeed, item.entry, item.analysis) ||
          !validReadingStatus) {
        throw invalidQueue(`completed queue item ${item.key} lacks an eligible matching analysis`);
      }
    } else if (item.analysis?.status === "ready") {
      throw invalidQueue(`non-complete queue item ${item.key} contains a ready analysis`);
    }
  }
  return queue;
}

async function loadQueue(path) {
  try {
    return parseQueue(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyQueue();
    throw error;
  }
}

function editionRecord(feed, archive) {
  const historicalEdition = feed?.window?.batch_id ?? archive?.batch_id;
  if (typeof historicalEdition !== "string" || !historicalEdition.trim()) return null;
  return {
    historical_edition: historicalEdition,
    historical_edition_fingerprint: editionFingerprint(feed),
    date: archive?.date ?? feed?.window?.announcement_date ?? null,
  };
}

function eligibleExistingAnalysis(feed, entry, analysis) {
  if (!analysis || analysis.source_fingerprint !== sourceFingerprint(entry)) return false;
  const model = buildDailyRadarModel(feed, {
    analyses: [analysis],
    opening_brief: { status: "unavailable", reason: "Existing edition analysis reuse" },
  });
  return [...model.groups.must_read, ...model.groups.worth_knowing, ...model.groups.skip].some((item) =>
    identityKey(item) === identityKey(entry) && item.analysis.source_fingerprint === sourceFingerprint(entry));
}

function mergeCandidate(queue, byKey, entry, { feed, archive, existingAnalysis, scanTimestamp } = {}) {
  const fingerprint = sourceFingerprint(entry);
  const key = queueKey(entry, fingerprint);
  let item = byKey.get(key);
  if (!item) {
    item = {
      key,
      entry,
      source_fingerprint: fingerprint,
      state: "queued",
      reading_status: "not_started",
      attempts: 0,
      screening_attempts: 0,
      reading_attempts: 0,
      editions: [],
      created_at: scanTimestamp ?? new Date().toISOString(),
      updated_at: scanTimestamp ?? new Date().toISOString(),
    };
    queue.items.push(item);
    byKey.set(key, item);
  }
  if (archive) {
    const edition = editionRecord(feed, archive);
    if (edition && !item.editions.some((record) => record.historical_edition === edition.historical_edition && record.historical_edition_fingerprint === edition.historical_edition_fingerprint)) {
      item.editions.push(edition);
    }
  }
  if (eligibleExistingAnalysis(feed, entry, existingAnalysis) && !item.analysis) {
    item.analysis = existingAnalysis;
    item.state = "complete";
    item.reading_status = existingAnalysis.priority === "skip" ? "not_required" : "read";
  }
  item.updated_at = scanTimestamp ?? new Date().toISOString();
  return item;
}

async function readArchivedEditions(archiveRoot) {
  if (!archiveRoot) return [];
  const directory = join(resolve(archiveRoot), "daily");
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const editions = [];
  for (const name of names.filter((value) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(value)).sort()) {
    let archive;
    try {
      archive = JSON.parse(await readFile(join(directory, name), "utf8"));
    } catch (error) {
      throw Object.assign(new Error(`Archived edition cannot be read: ${name}`), { code: "ARXIV_ARCHIVE_INVALID", cause: error });
    }
    if (!archive || typeof archive !== "object" || Array.isArray(archive) ||
        !archive.feed || typeof archive.feed !== "object" || Array.isArray(archive.feed) ||
        !Array.isArray(archive.feed.entries)) {
      throw Object.assign(new Error(`ARXIV_ARCHIVE_INVALID: Archived edition has no feed.entries array: ${name}`), {
        code: "ARXIV_ARCHIVE_INVALID",
      });
    }
    editions.push({ archive, feed: archive.feed, radar: archive.radar || { analyses: [] } });
  }
  return editions;
}

function safeError(error, apiKey) {
  let message = String(error?.message ?? error ?? "Unknown analyzer failure");
  if (apiKey) message = message.replaceAll(apiKey, "[redacted]");
  return message.slice(0, 400);
}

function pendingAnalysis(entry, reason, priority) {
  return {
    arxiv_id: entry.arxiv_id,
    revision: Number(entry.revision),
    source_fingerprint: sourceFingerprint(entry),
    status: "failed",
    failure_reason: reason,
    ...(priority ? { priority } : {}),
  };
}

export function sortQueueItems(items, priorityIds, currentFeedIds = new Set(), { backlog = false } = {}) {
  return [...items].sort((left, right) => {
    const leftPriority = priorityIds.has(normalizeArxivId(left.entry.arxiv_id)) ? 0 : 1;
    const rightPriority = priorityIds.has(normalizeArxivId(right.entry.arxiv_id)) ? 0 : 1;
    const priorityOrder = leftPriority - rightPriority;

    let leftInFeed = currentFeedIds.has(normalizeArxivId(left.entry.arxiv_id)) ? 1 : 0;
    let rightInFeed = currentFeedIds.has(normalizeArxivId(right.entry.arxiv_id)) ? 1 : 0;
    if (backlog) {
      leftInFeed = 1 - leftInFeed;
      rightInFeed = 1 - rightInFeed;
    }

    const leftUnattempted = (left.attempts ?? 0) === 0 ? 1 : 0;
    const rightUnattempted = (right.attempts ?? 0) === 0 ? 1 : 0;

    if (priorityOrder !== 0 && (leftPriority === 0 || rightPriority === 0)) {
      if (leftInFeed !== rightInFeed) {
        return priorityOrder;
      }
    }

    if (leftUnattempted && rightUnattempted && leftInFeed !== rightInFeed) {
      return rightInFeed - leftInFeed;
    }

    const leftTime = Date.parse(left.last_attempt_at ?? left.created_at ?? "");
    const rightTime = Date.parse(right.last_attempt_at ?? right.created_at ?? "");
    const queueOrder = (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
    return queueOrder || priorityOrder || String(left.entry.published ?? "").localeCompare(String(right.entry.published ?? "")) || left.key.localeCompare(right.key);
  });
}

export async function runAiAnalyzer({
  feed: feedPath = DEFAULT_OUTPUT,
  radar: radarPath = DEFAULT_RADAR_OUTPUT,
  model = DEFAULT_MODEL,
  triageModel = DEFAULT_TRIAGE_MODEL,
  bodyModel = DEFAULT_BODY_MODEL,
  triageFallbackModels,
  bodyFallbackModels,
  effort = DEFAULT_EFFORT,
  baseUrl = DEFAULT_BASE_URL,
  apiKey = DEFAULT_API_KEY,
  fallbackBaseUrl,
  fallbackApiKey,
  concurrency = DEFAULT_CONCURRENCY,
  limit = DEFAULT_RUN_LIMIT,
  priorityIds = [],
  onlyIds = [],
  dates = [],
  backlog = false,
  archiveRoot,
  artifactRoot,
  statePath,
  modelRunner,
  sourceLoader,
  fetchImpl = globalThis.fetch,
  sourceTimeoutMs = SOURCE_TIMEOUT_MS,
  modelTimeoutMs = MODEL_TIMEOUT_MS,
  renameImpl = rename,
  syncArchives,
  now = () => new Date(),
} = {}) {
  const isFixtureTest = Boolean(apiKey && apiKey !== DEFAULT_API_KEY);
  const resolvedFallbackBaseUrl = fallbackBaseUrl ?? (isFixtureTest ? undefined : FALLBACK_BASE_URL);
  const resolvedFallbackApiKey = fallbackApiKey ?? (isFixtureTest ? undefined : FALLBACK_API_KEY);
  const resolvedTriageFallbacks = triageFallbackModels ?? (isFixtureTest ? [] : DEFAULT_TRIAGE_FALLBACKS);
  const resolvedBodyFallbacks = bodyFallbackModels ?? (isFixtureTest ? [] : DEFAULT_BODY_FALLBACKS);
  const resolvedFeed = resolve(feedPath);
  const resolvedRadar = resolve(radarPath);
  const isDefaultEdition = resolvedFeed === resolve(DEFAULT_OUTPUT) && resolvedRadar === resolve(DEFAULT_RADAR_OUTPUT);
  const resolvedArtifactRoot = artifactRoot ?? (resolvedFeed === resolve(DEFAULT_OUTPUT) ? DEFAULT_ARTIFACT_ROOT : null);
  const resolvedArchiveRoot = archiveRoot ?? (isDefaultEdition ? DEFAULT_ARCHIVE_ROOT : null);
  const resolvedStatePath = resolve(statePath ?? (resolvedArtifactRoot
    ? join(resolve(resolvedArtifactRoot), "screening-queue.json")
    : `${resolvedFeed}.screening-queue.json`));
  if (!Number.isInteger(limit) || limit < 0) throw new Error("Analyzer limit must be a non-negative integer");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error("Analyzer concurrency must be an integer from 1 to 10");

  const feedFallback = JSON.parse(await readFile(resolvedFeed, "utf8"));
  let radarFallback = { analyses: [], knowledge_points: [] };
  try {
    radarFallback = JSON.parse(await readFile(resolvedRadar, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const published = await readPublishedArxivEdition({
    output: resolvedFeed,
    radarOutput: resolvedRadar,
    artifactRoot: resolvedArtifactRoot,
    fallbackFeed: feedFallback,
    fallbackRadar: radarFallback,
    allowMissing: true,
  });
  const feed = published.feed;
  const radar = published.radar;
  if (!Array.isArray(feed?.entries)) throw new Error("Published feed has no entries array");

  const queueLockPath = `${resolvedStatePath}.lock`;
  await acquireRefreshLock(queueLockPath);
  let queue;
  let queueWrite = Promise.resolve();
  const persist = () => {
    queue.updated_at = now().toISOString();
    queueWrite = queueWrite.then(() => writeJsonAtomically(resolvedStatePath, queue, renameImpl));
    return queueWrite;
  };
  try {
    queue = await loadQueue(resolvedStatePath);
    const byKey = new Map(queue.items.map((item) => [item.key, item]));
    for (const item of queue.items) {
      if (item.state === "processing") {
        item.state = item.triage?.priority && item.triage.priority !== "skip" ? "awaiting_body" : "queued";
        item.last_error = "Previous run stopped while processing; item was returned to the retry queue.";
      }
    }

    const scanTimestamp = now().toISOString();
    const currentExisting = new Map((Array.isArray(radar.analyses) ? radar.analyses : []).map((item) => [identityKey(item), item]));
    for (const entry of feed.entries) {
      mergeCandidate(queue, byKey, entry, { feed, existingAnalysis: currentExisting.get(identityKey(entry)), scanTimestamp });
    }
    const archived = await readArchivedEditions(resolvedArchiveRoot);
    for (const { archive, feed: archivedFeed, radar: archivedRadar } of archived) {
      const archivedAnalyses = new Map([
        ...(Array.isArray(archivedRadar.analyses) ? archivedRadar.analyses : []),
        ...(Array.isArray(archivedRadar.historical_analyses) ? archivedRadar.historical_analyses : []),
      ].map((analysis) => [identityKey(analysis), analysis]));
      for (const entry of archivedFeed.entries) {
        mergeCandidate(queue, byKey, entry, {
          feed: archivedFeed,
          archive,
          existingAnalysis: archivedAnalyses.get(identityKey(entry)),
          scanTimestamp,
        });
      }
    }
    await persist();

    const configuredPriorityIds = new Set((Array.isArray(priorityIds) ? priorityIds : String(priorityIds ?? "").split(","))
      .map((value) => normalizeArxivId(value)).filter(Boolean));
    const allowedIds = (Array.isArray(onlyIds) ? onlyIds : String(onlyIds ?? "").split(","))
      .map((value) => String(value).trim()).filter(Boolean);
    const selectedById = (item) => allowedIds.length === 0 || allowedIds.some((value) => {
      const revision = value.match(/^(.*)v([1-9]\d*)$/iu);
      return normalizeArxivId(revision ? revision[1] : value) === normalizeArxivId(item.entry.arxiv_id) &&
        (!revision || Number(revision[2]) === Number(item.entry.revision));
    });
    const targetDates = (Array.isArray(dates) ? dates : String(dates ?? "").split(","))
      .map((v) => String(v).trim()).filter(Boolean);
    const dateSet = targetDates.length > 0 ? new Set(targetDates) : null;
    const matchesTargetDate = (item) => {
      if (!dateSet) return true;
      for (const d of dateSet) {
        if (item.entry?.published?.startsWith(d)) return true;
        if (item.entry?.id?.includes(d)) return true;
        if (item.editions?.some((ed) => ed.date === d || ed.historical_edition?.includes(d))) return true;
      }
      return false;
    };
    const currentFeedIds = new Set(feed.entries.map((entry) => normalizeArxivId(entry.arxiv_id)));
    const eligible = queue.items.filter((item) => item.state !== "complete" && selectedById(item) && matchesTargetDate(item));
    const candidates = sortQueueItems(eligible, configuredPriorityIds, currentFeedIds, { backlog: Boolean(backlog) });
    const selected = limit > 0 ? candidates.slice(0, limit) : candidates;
    const defaultSourceLoader = async (entry, options = {}) => {
      return await acquirePaperBody(entry, {
        fetchImpl,
        timeoutMs: options.timeoutMs ?? sourceTimeoutMs,
        deepxivBreaker: defaultDeepxivBreaker,
      });
    };
    const sourceReader = sourceLoader ?? serializeAndPaceSourceLoader(
      defaultSourceLoader,
      DEFAULT_MIN_REQUEST_INTERVAL_MS,
    );
    const unboundedModelCall = modelRunner ?? ((request) => {
      let stageModel = model;
      let stageFallbacks = [];
      if (request.stage === "abstract") {
        stageModel = triageModel;
        stageFallbacks = resolvedTriageFallbacks;
      } else if (request.stage === "body" || request.stage === "body_chunk") {
        stageModel = bodyModel;
        stageFallbacks = resolvedBodyFallbacks;
      }
      return executeChatCompletion({
        stage: request.stage,
        prompt: request.prompt,
        systemPrompt: SYSTEM_PROMPT,
        model: stageModel,
        fallbackModels: stageFallbacks,
        effort: request.effort ?? effort,
        baseUrl: request.baseUrl ?? baseUrl,
        apiKey: request.apiKey ?? apiKey,
        fallbackBaseUrl: resolvedFallbackBaseUrl,
        fallbackApiKey: resolvedFallbackApiKey,
        timeoutMs: modelTimeoutMs,
      });
    });
    const modelCall = (request) => {
      if (request.prompt.length > MAX_MODEL_PROMPT_CHARS) throw new Error(`Model prompt exceeds ${MAX_MODEL_PROMPT_CHARS} characters`);
      return unboundedModelCall(request);
    };
    if (selected.length > 0 && !modelRunner && !apiKey) throw new Error("Missing API key; set WU_API_KEY or OPENAI_API_KEY");

    for (const item of selected) {
      item.attempts = Number(item.attempts || 0) + 1;
      item.last_attempt_at = now().toISOString();
      item.updated_at = item.last_attempt_at;
    }

    // ====================================================
    // Stage 1: Fast Batch Triage Pass (Two-Stage Pipeline Seam)
    // ====================================================
    const untriaged = selected.filter((item) => !item.triage);
    if (untriaged.length > 0) {
      console.log(`[AI Analyzer] Stage 1: Fast Batch Triage for ${untriaged.length} candidates...`);
      const triageResults = await triageBatch(untriaged.map((i) => i.entry), {
        modelCall,
        batchSize: 4,
        concurrency: Math.min(6, Math.ceil(untriaged.length / 4)),
      });

      for (const item of untriaged) {
        const result = triageResults.get(item.entry.arxiv_id);
        item.screening_attempts = Number(item.screening_attempts || 0) + 1;
        item.last_attempt_at = now().toISOString();
        item.updated_at = item.last_attempt_at;

        if (result?.error) {
          item.state = "queued";
          item.reading_status = "not_started";
          item.last_error = safeError(result.error, apiKey);
          item.analysis = pendingAnalysis(item.entry, item.last_error, null);
          console.warn(`[AI Analyzer] ${item.entry.arxiv_id} remains pending: ${item.last_error}`);
        } else if (result) {
          item.triage = result;
          item.state = result.priority === "skip" ? "screened" : "awaiting_body";
          item.reading_status = result.priority === "skip" ? "not_required" : "pending";
          item.last_error = null;
        }
      }
      await persist();
    }

    // Immediately finalize and complete all skip papers
    for (const item of selected) {
      if (item.triage?.priority === "skip" && item.state !== "complete") {
        try {
          const checked = validateScientificOutput(item.triage, { entry: item.entry, abstract: true });
          item.analysis = buildAnalysisRecord(item.entry, item.triage, checked, { modelName: model });
          item.state = "complete";
          item.reading_status = "not_required";
          item.last_error = null;
          item.completed_at = now().toISOString();
        } catch (error) {
          item.triage = null;
          item.state = "queued";
          item.reading_status = "not_started";
          item.last_error = safeError(error, apiKey);
          item.analysis = pendingAnalysis(item.entry, item.last_error, null);
          console.warn(`[AI Analyzer] ${item.entry.arxiv_id} remains pending: ${item.last_error}`);
        }
      }
    }
    await persist();

    // ====================================================
    // Stage 2: Deep Body Reading Pool
    // ====================================================
    const bodyCandidates = selected.filter((item) => Boolean(item.triage) && item.triage.priority !== "skip" && item.state !== "complete");
    if (bodyCandidates.length > 0) {
      console.log(`[AI Analyzer] Stage 2: Deep Body Reading for ${bodyCandidates.length} high-value candidates...`);
    }

    let cursor = 0;
    async function worker() {
      while (cursor < bodyCandidates.length) {
        const item = bodyCandidates[cursor++];
        item.state = "processing";
        item.last_attempt_at = now().toISOString();
        item.updated_at = item.last_attempt_at;
        await persist();
        try {
          item.reading_attempts = Number(item.reading_attempts || 0) + 1;
          const source = await acquireSource(item.entry, sourceReader, { timeoutMs: sourceTimeoutMs });
          const chunks = buildBodyPrompt(item.entry, source).length > MAX_MODEL_PROMPT_CHARS ? bodyChunks(source.bodyText) : null;
          if (chunks) {
            const previous = item.reading_progress;
            if (!previous || previous.contract_version !== READING_CONTRACT_VERSION ||
                previous.source_sha256 !== source.sha256 || previous.total_chunks !== chunks.length ||
                previous.completed.some((part, index) => !normalizeWhitespace(chunks[index]).includes(normalizeWhitespace(part.quote)))) {
              item.reading_progress = {
                contract_version: READING_CONTRACT_VERSION,
                source_sha256: source.sha256,
                total_chunks: chunks.length,
                completed: [],
              };
              await persist();
            }
            for (let index = item.reading_progress.completed.length; index < chunks.length; index++) {
              let chunkPrompt = buildBodyChunkPrompt(item.entry, source, chunks[index], index, chunks.length);
              for (let attempt = 0; attempt < 2; attempt++) {
                const rawChunkOutput = await modelCall({
                  stage: "body_chunk",
                  prompt: chunkPrompt,
                  entry: item.entry,
                  source,
                  model,
                  effort,
                  baseUrl,
                  apiKey,
                });
                try {
                  const chunkOutput = safeParseJson(rawChunkOutput);
                  item.reading_progress.completed.push(checkedBodyChunk(chunkOutput, chunks[index]));
                  break;
                } catch (error) {
                  if (attempt === 1) throw error;
                  chunkPrompt += /JSON escape|escaped character/iu.test(String(error?.message))
                    ? `\n\n上一次分段响应的 JSON 转义有歧义：${safeError(error, apiKey)}。请重新生成严格合法的 JSON；TeX 反斜杠必须写成 JSON-escaped TeX backslashes（例如 \\\\Pi），不要改变物理内容或原文摘录。`
                    : `\n\n上一次分段响应未通过可核验性检查：${safeError(error, apiKey)}。请在 SOURCE TEXT 中找一段 12–240 字符的连续原文，逐字复制，不要改写或引用其他段落。`;
                }
              }
              await persist();
            }
          }
          let bodyPrompt = chunks ? buildChunkSynthesisPrompt(item.entry, source, item.reading_progress) : buildBodyPrompt(item.entry, source);
          let bodyOutput;
          let checked;
          for (let attempt = 0; attempt < 2; attempt++) {
            const rawBodyOutput = await modelCall({
              stage: "body",
              prompt: bodyPrompt,
              entry: item.entry,
              source,
              model,
              effort,
              baseUrl,
              apiKey,
            });
            try {
              bodyOutput = safeParseJson(rawBodyOutput);
              checked = validateScientificOutput(bodyOutput, {
                entry: item.entry,
                sourceSections: source.sections,
                sourceSectionMap: source.sectionMap,
                sourceAbstractText: source.abstractText,
              });
              break;
            } catch (error) {
              if (attempt === 1) throw error;
              bodyPrompt += /JSON escape|escaped character/iu.test(String(error?.message))
                ? `\n\n上一次输出的 JSON 转义有歧义：${safeError(error, apiKey)}。请重新生成严格合法的 JSON；TeX 反斜杠必须写成 JSON-escaped TeX backslashes（例如 \\\\Pi），不要改变物理内容或原文摘录。`
                : `\n\n上一次输出未通过可核验性检查：${safeError(error, apiKey)}。请重新核对实际章节标题，并从相应章节逐字复制连续 TeX 原文作为 quote；不要引用摘要或自行改写摘录。`;
            }
          }
          const figures = await extractPaperFigures(item.entry.arxiv_id, item.entry.revision).catch(() => []);
          checked.figures = figures;
          item.analysis = buildAnalysisRecord(item.entry, bodyOutput, checked, { modelName: model, source });
          item.state = "complete";
          item.reading_status = "read";
          item.last_error = null;
          item.completed_at = now().toISOString();
        } catch (error) {
          if (item.triage?.priority === "skip") item.triage = null;
          item.state = item.triage ? "awaiting_body" : "queued";
          item.reading_status = item.triage ? "pending" : "not_started";
          item.last_error = safeError(error, apiKey);
          item.analysis = pendingAnalysis(item.entry, item.last_error, item.triage?.priority);
          console.warn(`[AI Analyzer] ${item.entry.arxiv_id} remains pending: ${item.last_error}`);
        }
        item.updated_at = now().toISOString();
        await persist();
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, bodyCandidates.length) }, () => worker()));
    await queueWrite;

    const currentAnalysisMap = new Map();
    for (const entry of feed.entries) {
      const item = byKey.get(queueKey(entry));
      if (item?.analysis) currentAnalysisMap.set(identityKey(entry), item.analysis);
      else if (currentExisting.has(identityKey(entry))) currentAnalysisMap.set(identityKey(entry), currentExisting.get(identityKey(entry)));
    }
    const analyses = [...currentAnalysisMap.values()];
    const historicalMap = new Map();
    for (const record of Array.isArray(radar.historical_analyses) ? radar.historical_analyses : []) {
      if (typeof record?.historical_edition === "string" && record.historical_edition.trim()) {
        const key = `${record.historical_edition}|${identityKey(record)}|${record.source_fingerprint}|${record.historical_edition_fingerprint ?? ""}`;
        historicalMap.set(key, record);
      }
    }
    for (const item of queue.items) {
      if (item.state !== "complete" || !item.analysis) continue;
      for (const edition of item.editions || []) {
        const record = {
          ...item.analysis,
          historical_edition: edition.historical_edition,
          historical_edition_fingerprint: edition.historical_edition_fingerprint,
        };
        const key = `${edition.historical_edition}|${identityKey(record)}|${record.source_fingerprint}|${edition.historical_edition_fingerprint}`;
        historicalMap.set(key, record);
      }
    }
    const nextRadar = {
      ...radar,
      edition: {
        ...(radar.edition || {}),
        generated_at: feed.generated_at || now().toISOString(),
        query: feed.query || null,
        coverage_kind: feed.window?.kind || "announcement_batch",
        window: feed.window || radar.edition?.window || null,
      },
      analyses,
      historical_analyses: [...historicalMap.values()],
      opening_brief: { status: "unavailable", reason: "正在汇总已核验导读。" },
    };
    nextRadar.opening_brief = buildOpeningBrief(feed, nextRadar);
    const validation = validateDailyRadarPayload(feed, nextRadar);
    if (!validation.valid) throw Object.assign(new Error(`Radar validation failed: ${validation.diagnostics.join(", ")}`), { code: "ARXIV_RADAR_INVALID" });

    if (JSON.stringify(nextRadar) !== JSON.stringify(radar)) {
      await publishAnalyzedArxivEdition({
        output: resolvedFeed,
        radarOutput: resolvedRadar,
        artifactRoot: resolvedArtifactRoot,
        expectedFeed: feed,
        expectedRadar: radar,
        radar: nextRadar,
        renameImpl,
      });
    }
    const pendingCount = queue.items.filter((item) => item.state !== "complete").length;
    console.log(`[AI Analyzer] Processed ${selected.length}; durable queue has ${pendingCount} pending candidates.`);

    const shouldSyncArchives = syncArchives ?? (isDefaultEdition && resolve(resolvedArchiveRoot || "") === resolve(DEFAULT_ARCHIVE_ROOT));
    if (shouldSyncArchives && resolvedArchiveRoot) {
      const { syncArxivArchives } = await import("./arxiv-archive.mjs");
      await syncArxivArchives({
        archiveRoot: resolvedArchiveRoot,
        currentFeedPath: resolvedFeed,
        currentRadarPath: resolvedRadar,
        dailyCacheDir: resolvedArtifactRoot ? join(resolve(resolvedArtifactRoot), "generations") : null,
      });
    }
    return nextRadar;
  } finally {
    try {
      await queueWrite;
    } finally {
      await releaseRefreshLock(queueLockPath);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[AI Analyzer] Run failed: ${safeError(error)}`);
    process.exit(1);
  }
  runAiAnalyzer(options).catch((error) => {
    const message = safeError(error, options.apiKey);
    console.error(`[AI Analyzer] Run failed: ${message}`);
    process.exit(1);
  });
}
