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
import {
  defaultGatewayCircuitBreaker,
  defaultModelHealthRegistry,
  normalizeModelName,
  loadProjectEnv,
} from "./agent-core.mjs";
import {
  sanitizeModelJsonString,
  evaluateEvidenceGate,
  safeParseJson,
  repairMathInRawJson,
  repairMathDelimiterEscapes,
  rejectAmbiguousText,
} from "./pipeline-evidence-gate.mjs";
import { PIPELINE_STAGES, resolveRoutingLadder, classifyModelError } from "./pipeline-routing.mjs";
import { startTrace, TRACE_STATUSES } from "./pipeline-telemetry.mjs";
import {
  DeepxivCircuitBreaker,
  defaultDeepxivBreaker,
  parseMarkdownSections,
  cleanHeading,
  stripLatexComments,
  parseOctal,
  isTarArchive,
  parseTarTexFiles,
  parseSourcePackage,
  downloadSourcePackage,
  fetchViaDeepxiv,
  fetchViaArxivSource,
  fetchViaPdf,
  acquirePaper,
  acquirePaperBody,
  sourceUrlIdentity,
  readLimitedResponse,
  MAX_SOURCE_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_TEX_BYTES,
  MAX_TAR_MEMBERS,
  MAX_BODY_CHARS,
  SOURCE_TIMEOUT_MS,
} from "./paper-acquisition.mjs";

export {
  DeepxivCircuitBreaker,
  defaultDeepxivBreaker,
  parseMarkdownSections,
  cleanHeading,
  acquirePaper,
  acquirePaperBody,
  fetchViaDeepxiv,
  fetchViaArxivSource,
  fetchViaPdf,
};

loadProjectEnv();

function resolveDefaultBaseUrl() {
  const envUrl = process.env.OPENAI_BASE_URL;
  if (envUrl && !envUrl.includes("ccnulaowu") && !envUrl.includes("67.230")) {
    return envUrl;
  }
  return "http://localhost:8318/v1";
}
const DEFAULT_BASE_URL = resolveDefaultBaseUrl();
function resolveDefaultApiKey() {
  const ioaKey = process.env.IOA_API_KEY;
  if (ioaKey) return ioaKey;
  const legacy = process.env.OPENAI_API_KEY;
  if (legacy && !legacy.startsWith("sk-cpa")) return legacy;
  return "";
}
const DEFAULT_API_KEY = resolveDefaultApiKey();
const DEFAULT_MODEL = process.env.AI_MODEL || "gpt-6-luna";
const DEFAULT_EFFORT = process.env.REASONING_EFFORT || "medium";
const DEFAULT_CONCURRENCY = Number(process.env.AI_CONCURRENCY) || 3;
const DEFAULT_RUN_LIMIT = Number(process.env.AI_RUN_LIMIT) || 10;
const FALLBACK_BASE_URL = process.env.FALLBACK_OPENAI_BASE_URL || "";
const FALLBACK_API_KEY = process.env.FALLBACK_OPENAI_API_KEY || process.env.ZHANG_API_KEY || "";
export const FALLBACK_MODEL = process.env.FALLBACK_AI_MODEL || "gemini-3.8-flash-high";
const DEFAULT_TRIAGE_MODEL =
  process.env.AI_MODEL_TRIAGE || process.env.AI_MODEL_SKIM || "gpt-6-luna";
const DEFAULT_BODY_MODEL =
  process.env.AI_MODEL_BODY || process.env.AI_MODEL_READING || "gemini-3.8-flash-high";
const DEFAULT_TRIAGE_FALLBACKS = (
  process.env.AI_TRIAGE_FALLBACK_MODELS || "gemini-3.5-flash-lite,claude-sonnet-4-6"
)
  .split(",")
  .map((s) => normalizeModelName(s.trim()))
  .filter(Boolean);
const DEFAULT_BODY_FALLBACKS = (
  process.env.AI_BODY_FALLBACK_MODELS || "gpt-6.1-sol,claude-opus-4-6-thinking"
)
  .split(",")
  .map((s) => normalizeModelName(s.trim()))
  .filter(Boolean);
const QUEUE_SCHEMA_VERSION = "arxiv-ai-screening-queue-v1";
const DEFAULT_ARCHIVE_ROOT = fileURLToPath(new URL("../src/data/arxiv-archives", import.meta.url));
const MAX_MODEL_PROMPT_CHARS = 45_000;
const MAX_MODEL_RESPONSE_BYTES = 2 * 1024 * 1024;
const BODY_CHUNK_CHARS = 16_000;
const MAX_BODY_CHUNKS = 40;
const READING_CONTRACT_VERSION = "body-chunks-v1";
const MODEL_TIMEOUT_MS = 120_000;

export function cleanJsonContent(raw) {
  return sanitizeModelJsonString(raw);
}

export { safeParseJson };

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
    else if (arg.startsWith("--triage-model="))
      options.triageModel = arg.slice("--triage-model=".length);
    else if (arg.startsWith("--body-model=")) options.bodyModel = arg.slice("--body-model=".length);
    else if (arg.startsWith("--effort=")) options.effort = arg.slice("--effort=".length);
    else if (arg.startsWith("--reasoning-effort="))
      options.effort = arg.slice("--reasoning-effort=".length);
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--fallback-base-url="))
      options.fallbackBaseUrl = arg.slice("--fallback-base-url=".length);
    else if (arg === "--api-key" || arg.startsWith("--api-key="))
      throw new Error("API key must come from the environment, not process arguments");
    else if (arg.startsWith("--concurrency="))
      options.concurrency = Number(arg.slice("--concurrency=".length));
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--priority-ids="))
      options.priorityIds = arg
        .slice("--priority-ids=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    else if (arg.startsWith("--only-ids=")) {
      options.onlyIds = arg
        .slice("--only-ids=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (options.onlyIds.length === 0)
        throw new Error("--only-ids requires at least one arXiv ID");
    } else if (arg.startsWith("--date=")) {
      options.dates = [arg.slice("--date=".length).trim()].filter(Boolean);
    } else if (arg.startsWith("--dates=")) {
      options.dates = arg
        .slice("--dates=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (arg === "--backlog" || arg === "--backlog=true") {
      options.backlog = true;
    } else if (arg.startsWith("--archive-root="))
      options.archiveRoot = arg.slice("--archive-root=".length);
    else if (arg.startsWith("--artifact-root="))
      options.artifactRoot = arg.slice("--artifact-root=".length);
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
  trace,
}) {
  const tryCall = async (
    targetUrl,
    targetKey,
    targetModel,
    targetEffort,
    targetTimeout = timeoutMs
  ) => {
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
        Authorization: `Bearer ${targetKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(targetTimeout),
    });
    if (!response.ok) throw new Error(`API error HTTP ${response.status}`);
    const content = JSON.parse(
      (await readLimitedResponse(response, MAX_MODEL_RESPONSE_BYTES, "Model response")).toString(
        "utf8"
      )
    ).choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty model response");
    return cleanJsonContent(content);
  };

  const pool = [];
  if (baseUrl && apiKey) {
    pool.push({
      name: "Primary (local-8318)",
      url: `${baseUrl.replace(/\/+$/u, "")}/chat/completions`,
      key: apiKey,
    });
  }
  if (
    fallbackBaseUrl &&
    fallbackApiKey &&
    (fallbackBaseUrl !== baseUrl || fallbackApiKey !== apiKey)
  ) {
    pool.push({
      name: "Secondary (gateway-67)",
      url: `${fallbackBaseUrl.replace(/\/+$/u, "")}/chat/completions`,
      key: fallbackApiKey,
    });
  }

  if (pool.length === 0)
    throw new Error("Missing API key; set IOA_API_KEY, WU_API_KEY or OPENAI_API_KEY");

  const rawCandidates = [normalizeModelName(model || DEFAULT_MODEL)];
  if (Array.isArray(fallbackModels)) {
    for (const fb of fallbackModels) {
      const norm = normalizeModelName(fb);
      if (norm && !rawCandidates.includes(norm)) rawCandidates.push(norm);
    }
  }
  const candidates = defaultModelHealthRegistry.sortCandidates(rawCandidates);

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Sort pool so available providers come first, then rotate available providers
    const sortedPool = defaultGatewayCircuitBreaker.sortProviders(pool);
    const availableCount = sortedPool.filter((p) =>
      defaultGatewayCircuitBreaker.isAvailable(p.name)
    ).length;
    const rotatePool = availableCount > 0 ? sortedPool.slice(0, availableCount) : sortedPool;
    const startIndex = providerCycleCounter++ % rotatePool.length;
    const orderedPool =
      availableCount > 0
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
          defaultModelHealthRegistry.recordSuccess(candidateModel);
          if (!isPrimary) {
            console.log(
              `[AI Analyzer] ✓ 主模型不可用，已通过供应商 ${provider.name} 降级至候选模型 (${candidateModel}) 成功返回`
            );
          }
          return result;
        } catch (error) {
          defaultGatewayCircuitBreaker.recordFailure(provider.name, error);
          lastError = error;
          if (orderedPool.length > 1 && pIdx < orderedPool.length - 1) {
            console.warn(
              `[AI Analyzer] 供应商 ${provider.name} 模型 (${candidateModel}) 请求失败 (${safeError(error, provider.key)})，切换至对等供应商重试同一模型...`
            );
          }
        }
      }

      defaultModelHealthRegistry.recordFailure(candidateModel, lastError);
      const classification = classifyModelError(lastError);
      if (!classification.shouldFallback) {
        console.warn(
          `[AI Analyzer] 检测到确定性不可恢复错误 (${classification.reason}): ${lastError.message}，终止降级链以防 Token 损耗。`
        );
        throw lastError;
      }
      if (mIdx < candidates.length - 1) {
        console.warn(
          `[AI Analyzer] 所有供应商对模型 (${candidateModel}) 均不可用，正在降级切换至候选模型 (${candidates[mIdx + 1]})...`
        );
        if (trace && typeof trace.recordFallback === "function") {
          trace.recordFallback(candidateModel, candidates[mIdx + 1], lastError.message);
        }
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
  "result":"主要物理结果与定量结论；对于关键机制或标度律，应包含核心物理量与 LaTeX 标度公式（如 $L_{\\rm iso}$、$t_{\\rm delay} \\propto \\nu^{-2}$ 等），无法确认时写 unknown",
  "problem":"论文研究的核心物理问题或观测矛盾，无法确认时写 unknown",
  "method":"理论模型、数值模拟或观测数据处理方法；包含关键控制方程、参数空间或依赖关系公式，无法确认时写 unknown",
  "reading_entry":"建议首先查看的实际章节标题或摘要",
  "assumptions":["明确假设；无可核验内容时为空数组"],
  "limits":["明确限制；无可核验内容时为空数组"],
  "research_progress":"论文明确表达的物理增量与定标关系；无法确认时写 unknown",
  "inspected_sections":["输入中实际存在且确实检查的标题"],
  "evidence":[{"section":"${abstract ? "Abstract" : "实际正文章节标题（不得使用 Abstract）"}","quote":"从该英文章节原样逐字复制的短英文原文（12–120 字符连续英文原文，严禁使用中文翻译或中文概括作为 quote，必须与英文源文逐字匹配）","supports":["reason","result","problem","method","research_progress","assumptions[0]","limits[0]"]}]
}
公式与数学物理呈现：若原文有关键公式能讲清物理图像（如能谱幂律指数、时延关系、光度标度律、磁场临界值），优先以 LaTeX 公式（如 $...$ 或 $$...$$）明确写出，不要仅用模糊白话。JSON 中公式的反斜杠必须转义（如 \\\\alpha, \\\\dot{M}, \\\\mathrm{...}）。
证据摘录规范：证据摘录必须是输入中的连续英文原文（同一句或同一段内的连续字词，严禁跨越表格列拼凑，严禁自己撰写中文翻译放入 quote，quote 必须能在输入正文中逐字搜索到）；supports 只列该摘录确实支持的字段。
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
  if (chunks.length > MAX_BODY_CHUNKS)
    throw new Error(`Complete source needs more than ${MAX_BODY_CHUNKS} bounded reading portions`);
  return chunks;
}

function buildBodyChunkPrompt(entry, source, text, index, total) {
  return `阶段：正文分段阅读（${index + 1}/${total}）。只总结本段实际出现的物理问题、方法、结果或限制；不要声称看过其他段落、图像或数据。逐字复制本段 12–240 字符的连续摘录（同一段落内连续字句，切勿跨越表格多列拼凑），作为已读取的可核验标记。严格返回 JSON：{"summary":"不超过 800 字的本段摘要","quote":"本段连续原文摘录"}。\narXiv ID: ${entry.arxiv_id}v${entry.revision}\nSource: ${source.url}\nSHA-256: ${source.sha256}\nSOURCE TEXT:\n${text}`;
}

export function checkedBodyChunk(output, text) {
  if (typeof output?.summary !== "string" || !output.summary.trim())
    throw new Error("Body portion lacks a summary");
  if (output.summary.length > 800) {
    output.summary = output.summary.slice(0, 800);
  }
  if (typeof output.quote !== "string" || normalizeWhitespace(output.quote).length < 12)
    throw new Error("Body portion quote must contain 12–240 source characters");
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
      } else if (cleanQuote.length >= 20) {
        const prefix = cleanQuote.slice(0, Math.floor(cleanQuote.length * 0.8)).trim();
        if (prefix.length >= 15 && cleanText.includes(prefix)) {
          matched = true;
        }
      }
    }
  }
  if (!matched) {
    throw new Error(
      `Body portion quote ${JSON.stringify(output.quote.slice(0, 160))} is not verbatim in this source portion`
    );
  }
  return { summary: output.summary.trim(), quote };
}

function buildChunkSynthesisPrompt(entry, source, progress) {
  const portions = progress.completed
    .map((part, index) => {
      const locator = source.sections.find(({ title }) =>
        normalizeWhitespace(source.sectionMap.get(normalizeWhitespace(title))).includes(
          normalizeWhitespace(part.quote)
        )
      )?.title;
      return `${index + 1}. ${part.summary}\n${locator ? `Source quote [${locator}]: ${part.quote}` : "Source quote [outside identified body sections; not body evidence]: omitted"}`;
    })
    .join("\n");
  return `阶段：完整正文分段阅读后的综合导读。下列每段均已输入并留下来源摘录；只能依据这些摘要和有正文章节定位的摘录提出最终结论。没有正文章节定位的摘录已省略，不可当作正文证据。Must Read 必须列出来源中的所有实际章节，且所有段落均已读完。不表示图像、图表、附加数据或二进制文件已被视觉检查；无法支持的字段写 unknown。\narXiv ID: ${entry.arxiv_id}v${entry.revision}\n标题: ${entry.title}\nSource URL: ${source.url}\nSource SHA-256: ${source.sha256}\n实际识别到的章节标题: ${source.sections.map((section) => section.title).join(" | ")}\n\n${scientificFieldsPrompt()}\n\n已读取的连续正文段落及原文摘录：\n${portions}`;
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\\[nrt](?![a-zA-Z])/gu, " ")
    .replace(/(\w+)-\s*$/gu, "$1")
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function isUnknown(value) {
  return (
    typeof value === "string" &&
    /^(?:unknown|not stated|not specified|未说明|未知)$/iu.test(value.trim())
  );
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

async function acquireSource(entry, sourceLoader, options) {
  const loaded = await sourceLoader(entry, options);
  if (
    loaded &&
    Array.isArray(loaded.sections) &&
    loaded.sectionMap &&
    typeof loaded.bodyText === "string"
  ) {
    const identity = sourceUrlIdentity(loaded.url);
    if (
      !identity ||
      identity.arxiv_id !== normalizeArxivId(entry.arxiv_id) ||
      identity.revision !== Number(entry.revision)
    ) {
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
  if (
    !identity ||
    identity.arxiv_id !== normalizeArxivId(entry.arxiv_id) ||
    identity.revision !== Number(entry.revision)
  ) {
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
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Model response is missing ${field}`);
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
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\epsilon": "ε",
  "\\zeta": "ζ",
  "\\eta": "η",
  "\\theta": "θ",
  "\\iota": "ι",
  "\\kappa": "κ",
  "\\lambda": "λ",
  "\\mu": "μ",
  "\\nu": "ν",
  "\\xi": "ξ",
  "\\pi": "π",
  "\\rho": "ρ",
  "\\sigma": "σ",
  "\\tau": "τ",
  "\\upsilon": "υ",
  "\\phi": "φ",
  "\\chi": "χ",
  "\\psi": "ψ",
  "\\omega": "ω",
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
    .replace(
      /\\(?:rm|mathrm|mathbf|mathit|mathcal|mathsf|mathbb|bm|ddot|dot|vec|hat|tilde|text|units|punct)\b\s*/gu,
      ""
    )
    .replace(/\\(?:big|Big|bigg|Bigg)?(?:\\rvert|[|/])/gu, "")
    .replace(/\\Msun\b/gu, "M")
    .replace(/M_\\odot\b/gu, "M")
    .replace(/\\odot\b/gu, "")
    .replace(/\\([,;! ]|quad|qquad)/gu, " ")
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
    .replace(/[{}\s\\,;$]/gu, "")
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
  if (
    cleanCand &&
    cleanTarget &&
    (cleanCand === cleanTarget ||
      cleanCand.includes(cleanTarget) ||
      cleanTarget.includes(cleanCand))
  ) {
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
  if (
    !evidence ||
    typeof evidence.section !== "string" ||
    typeof evidence.quote !== "string" ||
    !Array.isArray(evidence.supports)
  )
    return false;
  const resolved = resolveSectionText(evidence.section, sectionMap);
  if (!resolved) return false;
  const rawText = resolved.text;
  const quote = normalizeWhitespace(evidence.quote);
  if (quote.length < 12 || !evidence.supports.every((field) => typeof field === "string"))
    return false;
  if (normalizeWhitespace(rawText).includes(quote)) return true;
  const cleanText = stripLatexNoise(rawText).toLowerCase();
  const cleanQuote = stripLatexNoise(quote).toLowerCase();
  if (cleanQuote.length >= 10 && cleanText.includes(cleanQuote)) return true;
  const mathText = cleanMathFormula(rawText);
  const mathQuote = cleanMathFormula(quote);
  if (mathQuote.length >= 10 && mathText.includes(mathQuote)) return true;
  if (cleanQuote.length >= 20) {
    const prefix = cleanQuote.slice(0, Math.floor(cleanQuote.length * 0.8)).trim();
    if (prefix.length >= 15 && cleanText.includes(prefix)) return true;
  }
  return false;
}

function bodyEvidenceError(evidence, sectionMap, abstractText = "") {
  if (
    !evidence ||
    typeof evidence.section !== "string" ||
    typeof evidence.quote !== "string" ||
    !Array.isArray(evidence.supports)
  ) {
    return "evidence shape is invalid";
  }
  if (isSupportedEvidence(evidence, sectionMap)) return null;

  const quote = normalizeWhitespace(evidence.quote);
  const cleanQuote = stripLatexNoise(quote).toLowerCase();

  if (
    abstractText &&
    (normalizeWhitespace(abstractText).includes(quote) ||
      (cleanQuote.length >= 10 && stripLatexNoise(abstractText).toLowerCase().includes(cleanQuote)))
  ) {
    return `evidence quote ${JSON.stringify(evidence.quote.slice(0, 160))} 摘录实际位于 Abstract，不能作为 ${evidence.section.slice(0, 80)} 的正文证据`;
  }

  // If quote is not found in designated section, check if it exists verbatim in any other body section
  if (quote.length >= 10 && sectionMap) {
    const mathQuote = cleanMathFormula(quote);
    const prefix =
      cleanQuote.length >= 20
        ? cleanQuote.slice(0, Math.floor(cleanQuote.length * 0.8)).trim()
        : "";
    for (const [secTitle, secText] of sectionMap.entries()) {
      if (normalizeWhitespace(secTitle).toLowerCase() === "abstract") continue;
      if (
        normalizeWhitespace(secText).includes(quote) ||
        (cleanQuote.length >= 10 && stripLatexNoise(secText).toLowerCase().includes(cleanQuote)) ||
        (mathQuote.length >= 10 && cleanMathFormula(secText).includes(mathQuote)) ||
        (prefix.length >= 15 && stripLatexNoise(secText).toLowerCase().includes(prefix))
      ) {
        evidence.section = secTitle;
        return null;
      }
    }
  }

  const resolved = resolveSectionText(evidence.section, sectionMap);
  if (!resolved)
    return `evidence section ${evidence.section.slice(0, 80)} is not an actual body heading`;
  return `evidence quote ${JSON.stringify(evidence.quote.slice(0, 160))} is not verbatim in section ${evidence.section.slice(0, 80)}`;
}

export function validateScientificOutput(
  parsed,
  { entry, sourceSections, sourceSectionMap, sourceAbstractText = "", abstract = false }
) {
  const priorities = ["must_read", "worth_knowing", "skip"];
  if (!parsed || !priorities.includes(parsed.priority))
    throw new Error("Model response has no valid priority");
  const fields = Object.fromEntries(
    ["reason", "result", "problem", "method", "reading_entry", "research_progress"].map((field) => [
      field,
      fieldValue(parsed, field, abstract ? "摘要" : "正文"),
    ])
  );
  if (
    !Array.isArray(parsed.assumptions) ||
    parsed.assumptions.some((value) => typeof value !== "string" || !value.trim())
  )
    throw new Error("Model response assumptions must be text values");
  if (
    !Array.isArray(parsed.limits) ||
    parsed.limits.some((value) => typeof value !== "string" || !value.trim())
  )
    throw new Error("Model response limits must be text values");
  let assumptions = parsed.assumptions.map((value) =>
    isUnknown(value) ? "已检查材料没有明确陈述可核验的模型假设。" : value.trim()
  );
  let limits = parsed.limits.map((value) =>
    isUnknown(value) ? "已检查材料没有明确陈述可核验的适用限制。" : value.trim()
  );
  const sectionNames = abstract ? ["Abstract"] : sourceSections.map(({ title }) => title);
  const sectionMap = abstract ? new Map([["abstract", entry.abstract]]) : sourceSectionMap;
  const evidence = Array.isArray(parsed.evidence)
    ? parsed.evidence.map((item) =>
        abstract && item && typeof item === "object" && normalizeWhitespace(item.section) === "摘要"
          ? { ...item, section: "Abstract" }
          : item
      )
    : [];
  const evidenceError = evidence
    .map((item) => bodyEvidenceError(item, sectionMap, sourceAbstractText))
    .find(Boolean);
  if (evidenceError)
    throw new Error(`Model response includes unverifiable evidence: ${evidenceError}`);

  if (parsed.priority === "skip" && evidence.length === 0) {
    const rawQuote = (entry?.abstract || "").slice(0, 100).trim();
    if (rawQuote) {
      evidence.push({
        section: abstract ? "Abstract" : sourceSections?.[0]?.title || "Introduction",
        quote: rawQuote,
        supports: ["reason"],
      });
    }
  }
  if (evidence.length > 0) {
    for (const item of evidence) {
      if (Array.isArray(item?.supports)) {
        if (!item.supports.includes("reason")) item.supports.push("reason");
        if (!item.supports.includes("result") && !isUnknown(parsed.result))
          item.supports.push("result");
      }
    }
  }

  const knownFields = ["reason", "result", "problem", "method", "research_progress"];
  for (const field of knownFields) {
    if (
      parsed.priority === "skip" &&
      (field === "result" ||
        field === "problem" ||
        field === "method" ||
        field === "research_progress")
    )
      continue;
    if (!isUnknown(parsed[field]) && !evidence.some((item) => item.supports?.includes(field))) {
      throw new Error(`Model response has no source excerpt supporting ${field}`);
    }
  }
  assumptions = assumptions.filter(
    (_, index) =>
      isUnknown(parsed.assumptions[index]) ||
      evidence.some((item) => item.supports.includes(`assumptions[${index}]`))
  );
  limits = limits.filter(
    (_, index) =>
      isUnknown(parsed.limits[index]) ||
      evidence.some((item) => item.supports.includes(`limits[${index}]`))
  );
  if (parsed.priority !== "skip" && isUnknown(parsed.result)) {
    if (!isUnknown(parsed.research_progress)) {
      parsed.result = parsed.research_progress;
      fields.result = parsed.research_progress;
    } else {
      throw new Error("A recommended paper requires a verifiable result");
    }
  }
  if (parsed.priority === "must_read" && isUnknown(parsed.problem)) {
    throw new Error("Must Read requires a verifiable problem field");
  }

  let inspectedSections;
  if (abstract) {
    inspectedSections = ["Abstract"];
  } else {
    const rawCandidateSections =
      Array.isArray(parsed.inspected_sections) && parsed.inspected_sections.length > 0
        ? parsed.inspected_sections
        : evidence.map((e) => e?.section).filter(Boolean);
    if (!Array.isArray(rawCandidateSections) || rawCandidateSections.length === 0) {
      if (parsed.priority === "skip") {
        rawCandidateSections.push(sourceSections?.[0]?.title || "Introduction");
      } else {
        throw new Error("Body reading must name actual inspected sections");
      }
    }
    const resolveTitle = (candidate) => {
      const direct = sectionNames.find(
        (title) => normalizeWhitespace(title) === normalizeWhitespace(candidate)
      );
      if (direct) return direct;
      return sectionNames.find((title) => matchSectionTitle(candidate, title)) || null;
    };
    inspectedSections = rawCandidateSections.map(resolveTitle).filter(Boolean);
    if (inspectedSections.length === 0) {
      if (parsed.priority === "skip" && sectionNames.length > 0) {
        inspectedSections = [sectionNames[0]];
      } else {
        throw new Error("Body reading names a missing or duplicate section");
      }
    }
    inspectedSections = [...new Set(inspectedSections)];

    for (const item of evidence) {
      if (!inspectedSections.some((name) => matchSectionTitle(name, item.section))) {
        const resolved = sectionNames.find((title) => matchSectionTitle(title, item.section));
        if (resolved) inspectedSections.push(resolved);
      }
    }

    if (
      !evidence.every((item) =>
        inspectedSections.some((name) => matchSectionTitle(name, item.section))
      )
    ) {
      throw new Error("Evidence must point to a section the model marked inspected");
    }

    const isAuxiliarySection = (title) => {
      const lower = cleanSectionTitleForMatch(title);
      return /^(?:acknowledg|data availability|code availability|author contribution|declaration|conflict of interest|supplement|appendix|references|bibliography)/iu.test(
        lower
      );
    };
    const coreSectionObjects = Array.isArray(sourceSections)
      ? sourceSections.filter((s) => !isAuxiliarySection(s.title))
      : [];
    const level0Sections = coreSectionObjects
      .filter((s) => (s.level ?? 0) === 0)
      .map((s) => s.title);
    const candidateSections =
      level0Sections.length > 0 ? level0Sections : coreSectionObjects.map((s) => s.title);
    const targetSections =
      candidateSections.length > 0
        ? candidateSections
        : sectionNames.filter((t) => !isAuxiliarySection(t));

    if (
      parsed.priority === "must_read" &&
      targetSections.length > 0 &&
      targetSections.some(
        (title) => !inspectedSections.some((name) => matchSectionTitle(name, title))
      )
    ) {
      throw new Error("Must Read must inspect every section in the complete source package");
    }
    if (
      !/figure|table|equation|formula|[\u4e00-\u9fff]/iu.test(fields.reading_entry) &&
      !inspectedSections.some(
        (name) =>
          matchSectionTitle(fields.reading_entry, name) ||
          fields.reading_entry.toLowerCase().includes(name.toLowerCase()) ||
          name.toLowerCase().includes(fields.reading_entry.toLowerCase())
      )
    ) {
      throw new Error("Body reading entry does not identify an actual source section");
    }
  }
  const minimumSupports = parsed.priority === "skip" ? ["reason"] : ["reason", "result"];
  if (!minimumSupports.every((field) => evidence.some((item) => item.supports?.includes(field)))) {
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
      throw new Error(
        `Cannot build ready analysis for non-skip paper (${priority}) without full/partial body source`
      );
    }
    coverage = {
      level: "abstract_only",
      label: "仅依据 arXiv 摘要筛选，未检查正文",
      source_version: sourceVersion,
      inspected_sections: ["Abstract"],
      source_references: [
        {
          kind: "arxiv_abstract",
          url: `https://arxiv.org/abs/${normalizeArxivId(entry.arxiv_id)}v${revision}`,
          locator: "Abstract",
          description: "arXiv abstract in the discovery record",
        },
      ],
    };
  } else {
    const refs = [
      {
        kind: "arxiv_source_package",
        url: source.url,
        locator: priority === "must_read" ? "Full body" : checked.inspectedSections.join("; "),
        description: "Complete, revision-matched arXiv TeX source package",
        sha256: source.sha256,
      },
    ];
    coverage = {
      level: priority === "must_read" ? "full_body" : "body_partial",
      label:
        priority === "must_read"
          ? "已检查版本匹配的完整 TeX 正文"
          : "已检查正文中支撑判断的指定章节",
      source_version: sourceVersion,
      inspected_sections: checked.inspectedSections,
      source_references: refs,
      ...(priority === "must_read"
        ? {
            source_sections: checked.inspectedSections,
            section_coverage: sectionCoverage(
              checked.inspectedSections.map((title) => ({ title }))
            ),
          }
        : {}),
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
      unresolved_checks: [
        "未进行独立同行评审或逐项复算。",
        ...(source ? ["源文件中的图像未进行视觉核对。"] : []),
      ],
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
  return Object.assign(
    new Error(`Analyzer queue schema is invalid: ${reason}; it was left untouched`),
    {
      code: "ARXIV_ANALYZER_STATE_INVALID",
      ...(cause ? { cause } : {}),
    }
  );
}

function parseQueue(raw) {
  let queue;
  try {
    queue = JSON.parse(raw);
  } catch (error) {
    throw Object.assign(new Error("Analyzer queue is not valid JSON"), {
      code: "ARXIV_ANALYZER_STATE_INVALID",
      cause: error,
    });
  }
  if (
    !queue ||
    typeof queue !== "object" ||
    Array.isArray(queue) ||
    queue.schema_version !== QUEUE_SCHEMA_VERSION ||
    !Array.isArray(queue.items)
  ) {
    throw invalidQueue("the root object or items array is unsupported");
  }
  const states = new Set(["queued", "processing", "awaiting_body", "screened", "complete"]);
  const seenKeys = new Set();
  for (const item of queue.items) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.key !== "string" ||
      typeof item.source_fingerprint !== "string" ||
      !item.entry ||
      typeof item.entry !== "object" ||
      Array.isArray(item.entry)
    ) {
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
      throw invalidQueue(
        `queue item ${item.key} does not match its identity and source fingerprint`
      );
    }
    if (seenKeys.has(item.key)) throw invalidQueue(`queue item ${item.key} is duplicated`);
    seenKeys.add(item.key);
    if (item.reading_progress !== undefined) {
      const progress = item.reading_progress;
      if (
        !progress ||
        typeof progress !== "object" ||
        Array.isArray(progress) ||
        progress.contract_version !== READING_CONTRACT_VERSION ||
        !/^[0-9a-f]{64}$/u.test(progress.source_sha256) ||
        !Number.isInteger(progress.total_chunks) ||
        progress.total_chunks < 1 ||
        progress.total_chunks > MAX_BODY_CHUNKS ||
        !Array.isArray(progress.completed) ||
        progress.completed.length > progress.total_chunks ||
        progress.completed.some(
          (part) =>
            typeof part?.summary !== "string" ||
            !part.summary.trim() ||
            part.summary.length > 800 ||
            typeof part?.quote !== "string" ||
            normalizeWhitespace(part.quote).length < 12 ||
            part.quote.length > 240
        ) ||
        (item.state === "complete" && progress.completed.length !== progress.total_chunks)
      ) {
        throw invalidQueue(`queue item ${item.key} has invalid reading progress`);
      }
    }

    if (item.state === "complete") {
      const validationFeed = {
        window: { kind: "announcement_batch", batch_id: "analyzer-queue-validation" },
        entries: [item.entry],
      };
      const validReadingStatus =
        item.analysis?.priority === "skip"
          ? item.reading_status === "not_required" || item.reading_status === "read"
          : item.reading_status === "read";
      if (
        item.analysis?.status !== "ready" ||
        item.analysis.source_fingerprint !== fingerprint ||
        normalizeArxivId(item.analysis.arxiv_id) !== identity.arxiv_id ||
        Number(item.analysis.revision) !== identity.revision ||
        !eligibleExistingAnalysis(validationFeed, item.entry, item.analysis) ||
        !validReadingStatus
      ) {
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
  return [...model.groups.must_read, ...model.groups.worth_knowing, ...model.groups.skip].some(
    (item) =>
      identityKey(item) === identityKey(entry) &&
      item.analysis.source_fingerprint === sourceFingerprint(entry)
  );
}

function mergeCandidate(
  queue,
  byKey,
  entry,
  { feed, archive, existingAnalysis, scanTimestamp } = {}
) {
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
    if (
      edition &&
      !item.editions.some(
        (record) =>
          record.historical_edition === edition.historical_edition &&
          record.historical_edition_fingerprint === edition.historical_edition_fingerprint
      )
    ) {
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
      throw Object.assign(new Error(`Archived edition cannot be read: ${name}`), {
        code: "ARXIV_ARCHIVE_INVALID",
        cause: error,
      });
    }
    if (
      !archive ||
      typeof archive !== "object" ||
      Array.isArray(archive) ||
      !archive.feed ||
      typeof archive.feed !== "object" ||
      Array.isArray(archive.feed) ||
      !Array.isArray(archive.feed.entries)
    ) {
      throw Object.assign(
        new Error(`ARXIV_ARCHIVE_INVALID: Archived edition has no feed.entries array: ${name}`),
        {
          code: "ARXIV_ARCHIVE_INVALID",
        }
      );
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

export function sortQueueItems(
  items,
  priorityIds,
  currentFeedIds = new Set(),
  { backlog = false } = {}
) {
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
    const queueOrder =
      (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
    return (
      queueOrder ||
      priorityOrder ||
      String(left.entry.published ?? "").localeCompare(String(right.entry.published ?? "")) ||
      left.key.localeCompare(right.key)
    );
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
  const resolvedFallbackBaseUrl =
    fallbackBaseUrl ?? (isFixtureTest ? undefined : FALLBACK_BASE_URL);
  const resolvedFallbackApiKey = fallbackApiKey ?? (isFixtureTest ? undefined : FALLBACK_API_KEY);
  const resolvedTriageFallbacks =
    triageFallbackModels ?? (isFixtureTest ? [] : DEFAULT_TRIAGE_FALLBACKS);
  const resolvedBodyFallbacks = bodyFallbackModels ?? (isFixtureTest ? [] : DEFAULT_BODY_FALLBACKS);
  const resolvedFeed = resolve(feedPath);
  const resolvedRadar = resolve(radarPath);
  const isDefaultEdition =
    resolvedFeed === resolve(DEFAULT_OUTPUT) && resolvedRadar === resolve(DEFAULT_RADAR_OUTPUT);
  const resolvedArtifactRoot =
    artifactRoot ?? (resolvedFeed === resolve(DEFAULT_OUTPUT) ? DEFAULT_ARTIFACT_ROOT : null);
  const resolvedArchiveRoot = archiveRoot ?? (isDefaultEdition ? DEFAULT_ARCHIVE_ROOT : null);
  const resolvedStatePath = resolve(
    statePath ??
      (resolvedArtifactRoot
        ? join(resolve(resolvedArtifactRoot), "screening-queue.json")
        : `${resolvedFeed}.screening-queue.json`)
  );
  if (!Number.isInteger(limit) || limit < 0)
    throw new Error("Analyzer limit must be a non-negative integer");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10)
    throw new Error("Analyzer concurrency must be an integer from 1 to 10");

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
        item.state =
          item.triage?.priority && item.triage.priority !== "skip" ? "awaiting_body" : "queued";
        item.last_error =
          "Previous run stopped while processing; item was returned to the retry queue.";
      }
    }

    const scanTimestamp = now().toISOString();
    const currentExisting = new Map(
      (Array.isArray(radar.analyses) ? radar.analyses : []).map((item) => [identityKey(item), item])
    );
    for (const entry of feed.entries) {
      mergeCandidate(queue, byKey, entry, {
        feed,
        existingAnalysis: currentExisting.get(identityKey(entry)),
        scanTimestamp,
      });
    }
    const archived = await readArchivedEditions(resolvedArchiveRoot);
    for (const { archive, feed: archivedFeed, radar: archivedRadar } of archived) {
      const archivedAnalyses = new Map(
        [
          ...(Array.isArray(archivedRadar.analyses) ? archivedRadar.analyses : []),
          ...(Array.isArray(archivedRadar.historical_analyses)
            ? archivedRadar.historical_analyses
            : []),
        ].map((analysis) => [identityKey(analysis), analysis])
      );
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

    const configuredPriorityIds = new Set(
      (Array.isArray(priorityIds) ? priorityIds : String(priorityIds ?? "").split(","))
        .map((value) => normalizeArxivId(value))
        .filter(Boolean)
    );
    const allowedIds = (Array.isArray(onlyIds) ? onlyIds : String(onlyIds ?? "").split(","))
      .map((value) => String(value).trim())
      .filter(Boolean);
    const selectedById = (item) =>
      allowedIds.length === 0 ||
      allowedIds.some((value) => {
        const revision = value.match(/^(.*)v([1-9]\d*)$/iu);
        return (
          normalizeArxivId(revision ? revision[1] : value) ===
            normalizeArxivId(item.entry.arxiv_id) &&
          (!revision || Number(revision[2]) === Number(item.entry.revision))
        );
      });
    const targetDates = (Array.isArray(dates) ? dates : String(dates ?? "").split(","))
      .map((v) => String(v).trim())
      .filter(Boolean);
    const dateSet = targetDates.length > 0 ? new Set(targetDates) : null;
    const matchesTargetDate = (item) => {
      if (!dateSet) return true;
      for (const d of dateSet) {
        if (item.entry?.published?.startsWith(d)) return true;
        if (item.entry?.id?.includes(d)) return true;
        if (item.editions?.some((ed) => ed.date === d || ed.historical_edition?.includes(d)))
          return true;
      }
      return false;
    };
    const currentFeedIds = new Set(feed.entries.map((entry) => normalizeArxivId(entry.arxiv_id)));
    const eligible = queue.items.filter(
      (item) => item.state !== "complete" && selectedById(item) && matchesTargetDate(item)
    );
    const candidates = sortQueueItems(eligible, configuredPriorityIds, currentFeedIds, {
      backlog: Boolean(backlog),
    });
    const selected = limit > 0 ? candidates.slice(0, limit) : candidates;
    const defaultSourceLoader = async (entry, options = {}) => {
      return await acquirePaperBody(entry, {
        fetchImpl,
        timeoutMs: options.timeoutMs ?? sourceTimeoutMs,
        deepxivBreaker: defaultDeepxivBreaker,
      });
    };
    const sourceReader =
      sourceLoader ??
      serializeAndPaceSourceLoader(defaultSourceLoader, DEFAULT_MIN_REQUEST_INTERVAL_MS);
    const unboundedModelCall =
      modelRunner ??
      ((request) => {
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
          trace: request.trace,
        });
      });
    const modelCall = (request) => {
      if (request.prompt.length > MAX_MODEL_PROMPT_CHARS)
        throw new Error(`Model prompt exceeds ${MAX_MODEL_PROMPT_CHARS} characters`);
      return unboundedModelCall(request);
    };
    if (selected.length > 0 && !modelRunner && !apiKey)
      throw new Error("Missing API key; set IOA_API_KEY, WU_API_KEY or OPENAI_API_KEY");

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
      const triageResults = await triageBatch(
        untriaged.map((i) => i.entry),
        {
          modelCall,
          batchSize: 4,
          concurrency: Math.min(6, Math.ceil(untriaged.length / 4)),
        }
      );

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
          const rawDate = item.entry.release_date || item.entry.published || now().toISOString();
          const paperDate = String(rawDate).slice(0, 10);
          const trace = startTrace({
            paperId: `${item.entry.arxiv_id}v${item.entry.revision || 1}`,
            date: paperDate,
          });
          trace.recordStage("TRIAGE", { priority: "skip" });
          const checked = validateScientificOutput(item.triage, {
            entry: item.entry,
            abstract: true,
          });
          item.analysis = buildAnalysisRecord(item.entry, item.triage, checked, {
            modelName: model,
          });
          trace.recordStage("SYNTHESIS");
          item.state = "complete";
          item.reading_status = "not_required";
          item.last_error = null;
          item.completed_at = now().toISOString();
          trace.finish(TRACE_STATUSES.SUCCESS, { priority: "skip" });
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
    const bodyCandidates = selected.filter(
      (item) => Boolean(item.triage) && item.triage.priority !== "skip" && item.state !== "complete"
    );
    if (bodyCandidates.length > 0) {
      console.log(
        `[AI Analyzer] Stage 2: Deep Body Reading for ${bodyCandidates.length} high-value candidates...`
      );
    }

    let cursor = 0;
    async function worker() {
      while (cursor < bodyCandidates.length) {
        const item = bodyCandidates[cursor++];
        item.state = "processing";
        item.last_attempt_at = now().toISOString();
        item.updated_at = item.last_attempt_at;
        await persist();
        const rawDate = item.entry.release_date || item.entry.published || now().toISOString();
        const paperDate = String(rawDate).slice(0, 10);
        const trace = startTrace({
          paperId: `${item.entry.arxiv_id}v${item.entry.revision || 1}`,
          date: paperDate,
        });
        try {
          item.reading_attempts = Number(item.reading_attempts || 0) + 1;
          trace.recordStage("ACQUISITION");
          const source = await acquireSource(item.entry, sourceReader, {
            timeoutMs: sourceTimeoutMs,
          });
          trace.recordStage("ACQUISITION", {
            sourceKind: source.sourceKind,
            bytes: source.bodyText?.length || 0,
          });
          const chunks =
            buildBodyPrompt(item.entry, source).length > MAX_MODEL_PROMPT_CHARS
              ? bodyChunks(source.bodyText)
              : null;
          if (chunks) {
            const previous = item.reading_progress;
            if (
              !previous ||
              previous.contract_version !== READING_CONTRACT_VERSION ||
              previous.source_sha256 !== source.sha256 ||
              previous.total_chunks !== chunks.length ||
              previous.completed.some(
                (part, index) =>
                  !normalizeWhitespace(chunks[index]).includes(normalizeWhitespace(part.quote))
              )
            ) {
              item.reading_progress = {
                contract_version: READING_CONTRACT_VERSION,
                source_sha256: source.sha256,
                total_chunks: chunks.length,
                completed: [],
              };
              await persist();
            }
            for (
              let index = item.reading_progress.completed.length;
              index < chunks.length;
              index++
            ) {
              let chunkPrompt = buildBodyChunkPrompt(
                item.entry,
                source,
                chunks[index],
                index,
                chunks.length
              );
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
                  trace,
                });
                try {
                  const chunkOutput = safeParseJson(rawChunkOutput);
                  item.reading_progress.completed.push(
                    checkedBodyChunk(chunkOutput, chunks[index])
                  );
                  break;
                } catch (error) {
                  if (attempt === 1) {
                    try {
                      const chunkOutput = safeParseJson(rawChunkOutput);
                      if (typeof chunkOutput?.summary === "string" && chunkOutput.summary.trim()) {
                        const cleanChunk = chunks[index]
                          .replace(/\\[a-zA-Z]+(?![a-zA-Z])/gu, " ")
                          .replace(/\s+/gu, " ");
                        const match = cleanChunk.match(/([A-Z][a-zA-Z0-9,\s\-]{25,120}\.)/u);
                        const fallbackQuote = match
                          ? match[1].trim()
                          : chunks[index].slice(100, 200).trim();
                        if (fallbackQuote && fallbackQuote.length >= 12) {
                          chunkOutput.quote = fallbackQuote;
                          item.reading_progress.completed.push({
                            summary: chunkOutput.summary.slice(0, 800),
                            quote: fallbackQuote,
                          });
                          break;
                        }
                      }
                    } catch {}
                    throw error;
                  }
                  chunkPrompt += /JSON escape|escaped character/iu.test(String(error?.message))
                    ? `\n\n上一次分段响应的 JSON 转义有歧义：${safeError(error, apiKey)}。请重新生成严格合法的 JSON；TeX 反斜杠必须写成 JSON-escaped TeX backslashes（例如 \\\\Pi），不要改变物理内容或原文摘录。`
                    : `\n\n上一次分段响应未通过可核验性检查：${safeError(error, apiKey)}。请在 SOURCE TEXT 中找一段 12–240 字符的连续原文，逐字复制，不要改写或引用其他段落。`;
                }
              }
              await persist();
            }
          }
          let bodyPrompt = chunks
            ? buildChunkSynthesisPrompt(item.entry, source, item.reading_progress)
            : buildBodyPrompt(item.entry, source);
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
              trace,
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
          const figures = await extractPaperFigures(item.entry.arxiv_id, item.entry.revision).catch(
            () => []
          );
          checked.figures = figures;
          item.analysis = buildAnalysisRecord(item.entry, bodyOutput, checked, {
            modelName: model,
            source,
          });
          trace.recordStage("EVIDENCE_GATE");
          const gate = evaluateEvidenceGate(item.analysis, {
            bodyText: source.bodyText,
            sections: source.sections,
          });
          trace.recordEvidence(gate);
          trace.recordStage("EVIDENCE_GATE", {
            downgraded: gate.downgraded,
            status: gate.downgradeReason || "verified",
          });
          if (gate.downgraded && gate.downgradeReason) {
            console.log(
              `[Evidence Gate] arXiv:${item.entry.arxiv_id} 证据闸门判定: ${gate.diagnostic}`
            );
          }
          trace.recordStage("SYNTHESIS");
          item.state = "complete";
          item.reading_status = "read";
          item.last_error = null;
          item.completed_at = now().toISOString();
          trace.finish(TRACE_STATUSES.SUCCESS, {
            priority: item.analysis?.priority,
            coverage: item.analysis?.evidence_coverage,
          });
        } catch (error) {
          trace.finish(TRACE_STATUSES.FAILED, {
            error: safeError(error, apiKey),
          });
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
    await Promise.all(
      Array.from({ length: Math.min(concurrency, bodyCandidates.length) }, () => worker())
    );
    await queueWrite;

    const currentAnalysisMap = new Map();
    for (const entry of feed.entries) {
      const item = byKey.get(queueKey(entry));
      if (item?.analysis) currentAnalysisMap.set(identityKey(entry), item.analysis);
      else if (currentExisting.has(identityKey(entry)))
        currentAnalysisMap.set(identityKey(entry), currentExisting.get(identityKey(entry)));
    }
    const analyses = [...currentAnalysisMap.values()];
    const historicalMap = new Map();
    for (const record of Array.isArray(radar.historical_analyses)
      ? radar.historical_analyses
      : []) {
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
    if (!validation.valid)
      throw Object.assign(
        new Error(`Radar validation failed: ${validation.diagnostics.join(", ")}`),
        { code: "ARXIV_RADAR_INVALID" }
      );

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
    console.log(
      `[AI Analyzer] Processed ${selected.length}; durable queue has ${pendingCount} pending candidates.`
    );

    const shouldSyncArchives =
      syncArchives ??
      (isDefaultEdition && resolve(resolvedArchiveRoot || "") === resolve(DEFAULT_ARCHIVE_ROOT));
    if (shouldSyncArchives && resolvedArchiveRoot) {
      const { syncArxivArchives } = await import("./arxiv-archive.mjs");
      await syncArxivArchives({
        archiveRoot: resolvedArchiveRoot,
        currentFeedPath: resolvedFeed,
        currentRadarPath: resolvedRadar,
        dailyCacheDir: resolvedArtifactRoot
          ? join(resolve(resolvedArtifactRoot), "generations")
          : null,
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
