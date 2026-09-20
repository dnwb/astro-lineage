import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  sourceFingerprint,
  validateDailyRadarPayload,
  normalizeArxivId,
} from "./daily-radar.mjs";
import { DEFAULT_OUTPUT, DEFAULT_RADAR_OUTPUT } from "./arxiv-daily.mjs";

const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || process.env.CCNU_API_BASE || "https://api.ccnulaowu.online/v1";
const DEFAULT_API_KEY = process.env.WU_API_KEY || process.env.OPENAI_API_KEY || "";
const DEFAULT_MODEL = process.env.AI_MODEL || "Deepseek-V4.1-Flash";
const DEFAULT_CONCURRENCY = 3;

function cleanJsonContent(raw) {
  let cleaned = String(raw ?? "").trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  return cleaned;
}

function parseCliArgs(args) {
  const options = {
    feed: DEFAULT_OUTPUT,
    radar: DEFAULT_RADAR_OUTPUT,
    model: DEFAULT_MODEL,
    baseUrl: DEFAULT_BASE_URL,
    apiKey: DEFAULT_API_KEY,
    concurrency: DEFAULT_CONCURRENCY,
    limit: null,
  };
  for (const arg of args) {
    if (arg.startsWith("--feed=")) options.feed = arg.slice("--feed=".length);
    else if (arg.startsWith("--radar=")) options.radar = arg.slice("--radar=".length);
    else if (arg.startsWith("--model=")) options.model = arg.slice("--model=".length);
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--api-key=")) options.apiKey = arg.slice("--api-key=".length);
    else if (arg.startsWith("--concurrency=")) options.concurrency = Number(arg.slice("--concurrency=".length));
    else if (arg.startsWith("--limit=")) options.limit = Number(arg.slice("--limit=".length));
  }
  return options;
}

async function callChatCompletion({ prompt, systemPrompt, model, baseUrl, apiKey, retries = 3 }) {
  const url = `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error HTTP ${response.status}: ${errorText}`);
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty model response");
      return cleanJsonContent(content);
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

const SYSTEM_PROMPT = `你是一个专注于高能天体物理与瞬变源（High-Energy Transient Astrophysics）的专业学术研读助手。
课题组重点研究各类爆发现象及其背后的物理机制，包括但不限于：
- 伽马射线暴（GRB）、超亮超新星（SLSN）、快速蓝光学瞬变源（FBOT）、快速X射线瞬变源（FXT）
- 快速射电暴（FRB）、磁星爆发（Magnetar burst）、千新星（Kilonova）/致密双星并合
- 脉冲星风云系统、吸积流与相对论性喷流机制、活动星系核（AGN）盘内爆发、高能中微子与多信使瞬变源

请仔细阅读论文标题与摘要，以严格的 JSON 格式输出科研导读与优先级评估。`;

function buildPrompt(entry) {
  return `【论文信息】
arXiv ID: ${entry.arxiv_id} (v${entry.revision})
标题: ${entry.title}
作者: ${entry.authors.join(", ")}
摘要: ${entry.abstract}

【评估标准与优先级分类】
1. "must_read"（今天先读）：
   与高能天体物理瞬变源（GRB/SLSN/FBOT/FXT/FRB/磁星/吸积流与喷流/千新星等）核心物理机制直接相关，且包含关键观测新发现、物理模型约束或能量预算分析的论文。
2. "worth_knowing"（值得知道）：
   相关天体物理背景、重要巡天观测数据（如 Chandra/Swift/Fermi/EP 等）、模型限制或近邻天体物理瞬变研究。
3. "skip"（快速浏览）：
   与高能瞬变机制距离较远（如恒星运动学、行星际环境、纯仪器校准算法、大尺度宇宙学演化等）。

【输出格式要求】
请必须返回严格合法的 JSON 对象，不包含任何 Markdown 代码块标记（不要写 \`\`\`json），包含以下字段：
{
  "priority": "must_read" 或 "worth_knowing" 或 "skip",
  "reason": "1-2句中文，说明分类理由及其与高能瞬变物理的关系",
  "result": "1-2句中文，概括核心科学发现或主要结论",
  "problem": "1-2句中文，说明该论文要解决的核心物理或观测问题",
  "method": "1-2句中文，概括使用的观测设备、数值模拟或理论解析方法",
  "reading_entry": "1句中文，建议读者从哪个核心章节、公式或关键图表切入阅读",
  "assumptions": ["关键物理或模型假设1", "关键物理或模型假设2"],
  "limits": ["参数区间或结论适用局限性1", "观测或模型限制2"],
  "research_progress": "1句中文，概括相比既有同类工作的增量价值"
}`;
}

function buildAnalysisRecord(entry, parsed, modelName) {
  const normId = normalizeArxivId(entry.arxiv_id);
  const rev = Number(entry.revision || 1);
  const fp = sourceFingerprint(entry);
  const priority = ["must_read", "worth_knowing", "skip"].includes(parsed.priority) ? parsed.priority : "skip";

  // Automated intake currently only ingests arXiv title and abstract.
  // Uphold scientific evidence boundary integrity: declare abstract_only coverage honestly.
  const coverage = {
    level: "abstract_only",
    label: priority === "must_read"
      ? "基于 arXiv 摘要提炼（重点研判候选；未核验正文）"
      : priority === "worth_knowing"
        ? "基于 arXiv 摘要提炼（值得关注候选；未核验正文）"
        : "基于 arXiv 摘要提炼；适合快速浏览",
    source_version: `arXiv:${normId}v${rev}`,
    inspected_sections: ["Abstract"],
    source_references: [
      {
        kind: "arxiv_abstract",
        url: entry.url,
        locator: "Abstract",
        description: "arXiv 官方元数据与英文摘要",
      },
    ],
  };

  return {
    arxiv_id: entry.arxiv_id,
    revision: rev,
    status: "ready",
    source_fingerprint: fp,
    priority,
    coverage,
    analysis: {
      origin: "ai",
      model: modelName,
      analyzed_at: new Date().toISOString(),
      reason: String(parsed.reason || "高能天体物理相关候选。").trim(),
      result: String(parsed.result || "未提供详细结果。").trim(),
      reading_entry: String(parsed.reading_entry || "建议先阅读摘要并查看关键图表。").trim(),
      problem: String(parsed.problem || "论文探讨了相关天体物理观测与模型特征。").trim(),
      method: String(parsed.method || "基于观测与理论模型分析。").trim(),
      assumptions: Array.isArray(parsed.assumptions) && parsed.assumptions.length > 0
        ? parsed.assumptions.map(String)
        : ["基于标准天体物理流体与辐射模型假设。"],
      limits: Array.isArray(parsed.limits) && parsed.limits.length > 0
        ? parsed.limits.map(String)
        : ["受观测样本和参数空间限制。"],
      citation_leads: [String(parsed.result || "摘要结论。").trim()],
      research_progress: String(parsed.research_progress || "提供了新的观测约束或模型推断。").trim(),
      unresolved_checks: ["尚未经同行专家逐项人工核算。"],
      potential_lineage: {
        status: "no_match",
        reason: "当前由 AI 完成初步科研分析，尚未人工绑定组内核心 Work 关系。",
        candidates: [],
      },
      prerequisite_works: [],
    },
  };
}

export async function runAiAnalyzer({
  feed: feedPath = DEFAULT_OUTPUT,
  radar: radarPath = DEFAULT_RADAR_OUTPUT,
  model = DEFAULT_MODEL,
  baseUrl = DEFAULT_BASE_URL,
  apiKey = DEFAULT_API_KEY,
  concurrency = DEFAULT_CONCURRENCY,
  limit = null,
} = {}) {
  if (!apiKey) {
    throw new Error("缺少 API Key。请设置环境变量 WU_API_KEY 或 OPENAI_API_KEY。");
  }

  const resolvedFeed = resolve(feedPath);
  const resolvedRadar = resolve(radarPath);

  const feedContent = await readFile(resolvedFeed, "utf8");
  const feed = JSON.parse(feedContent);
  const entries = Array.isArray(feed.entries) ? feed.entries : [];

  let radar = { edition: {}, analyses: [], opening_brief: { status: "unavailable", reason: "待生成" } };
  try {
    radar = JSON.parse(await readFile(resolvedRadar, "utf8"));
  } catch {
    // start with default
  }

  const existingAnalyses = Array.isArray(radar.analyses) ? radar.analyses : [];
  const existingMap = new Map();
  for (const a of existingAnalyses) {
    existingMap.set(`${normalizeArxivId(a.arxiv_id)}@v${Number(a.revision)}`, a);
  }

  const candidatesToAnalyze = [];
  const preservedAnalyses = [];

  for (const entry of entries) {
    const key = `${normalizeArxivId(entry.arxiv_id)}@v${Number(entry.revision)}`;
    const fp = sourceFingerprint(entry);
    const existing = existingMap.get(key);

    if (existing && existing.source_fingerprint === fp && existing.status === "ready") {
      preservedAnalyses.push(existing);
    } else {
      candidatesToAnalyze.push(entry);
    }
  }

  const effectiveCandidates = limit ? candidatesToAnalyze.slice(0, limit) : candidatesToAnalyze;
  console.log(`[AI Analyzer] 当前批次共 ${entries.length} 篇论文，已分析 ${preservedAnalyses.length} 篇，待分析 ${effectiveCandidates.length} 篇。`);

  const newAnalyses = [];
  let index = 0;

  async function worker() {
    while (index < effectiveCandidates.length) {
      const currentIndex = index++;
      const entry = effectiveCandidates[currentIndex];
      console.log(`[AI Analyzer] [${currentIndex + 1}/${effectiveCandidates.length}] 正在分析 arXiv:${entry.arxiv_id} - ${entry.title.slice(0, 40)}...`);

      try {
        const prompt = buildPrompt(entry);
        const rawJson = await callChatCompletion({
          prompt,
          systemPrompt: SYSTEM_PROMPT,
          model,
          baseUrl,
          apiKey,
        });

        let parsed;
        try {
          parsed = JSON.parse(rawJson);
        } catch {
          const match = rawJson.match(/\{[\s\S]*\}/u);
          if (match) parsed = JSON.parse(match[0]);
          else throw new Error("无法解析模型返回的 JSON 内容");
        }

        const record = buildAnalysisRecord(entry, parsed, model);
        newAnalyses.push(record);
        console.log(`[AI Analyzer] ✓ 完成 arXiv:${entry.arxiv_id} (优先级: ${record.priority})`);
      } catch (err) {
        console.error(`[AI Analyzer] ✗ 分析 arXiv:${entry.arxiv_id} 失败: ${err.message}`);
      }
    }
  }

  const workerPromises = Array.from({ length: Math.min(concurrency, effectiveCandidates.length || 1) }, () => worker());
  await Promise.all(workerPromises);

  const combinedAnalyses = [...preservedAnalyses, ...newAnalyses];

  const nextRadar = {
    ...radar,
    edition: {
      ...(radar.edition || {}),
      generated_at: feed.generated_at || new Date().toISOString(),
      query: feed.query || null,
      coverage_kind: feed.window?.kind || "announcement_batch",
      window: feed.window || radar.edition?.window || null,
    },
    analyses: combinedAnalyses,
    opening_brief: {
      status: "unavailable",
      reason: "本期导读由 AI 针对各篇论文完成单篇结构化分析；请直接浏览下方阅读分组。",
    },
  };

  const validation = validateDailyRadarPayload(feed, nextRadar);
  if (validation.fatalDiagnostics && validation.fatalDiagnostics.length > 0) {
    console.warn(`[AI Analyzer] 警告: 雷达数据校验发现诊断问题:`, validation.fatalDiagnostics);
  }

  const radarJsonContent = `${JSON.stringify(nextRadar, null, 2)}\n`;
  await writeFile(resolvedRadar, radarJsonContent, "utf8");
  await syncGenerationRadar(resolvedRadar, radarJsonContent);
  console.log(`[AI Analyzer] 成功写入雷达数据到 ${resolvedRadar}，共计 ${combinedAnalyses.length} 篇有效导读记录。`);
  return nextRadar;
}

async function syncGenerationRadar(_radarJsonPath, radarContent) {
  try {
    const pointerPath = resolve(".cache/arxiv-daily/current-generation.json");
    let pointerText;
    try {
      pointerText = await readFile(pointerPath, "utf8");
    } catch {
      return;
    }
    const pointer = JSON.parse(pointerText);
    const radarRecord = pointer.files?.find((f) => f.target?.endsWith("daily-radar.json"));
    if (!radarRecord) return;

    const newSha = createHash("sha256").update(radarContent).digest("hex");
    const newLen = Buffer.byteLength(radarContent, "utf8");

    const genRadarPath = join(resolve(".cache/arxiv-daily"), pointer.generation_path, radarRecord.path);
    await writeFile(genRadarPath, radarContent, "utf8");

    radarRecord.sha256 = newSha;
    radarRecord.byte_length = newLen;

    const genMarkerPath = join(resolve(".cache/arxiv-daily"), pointer.generation_path, "generation.json");
    try {
      const marker = JSON.parse(await readFile(genMarkerPath, "utf8"));
      const markerRadarRecord = marker.files?.find((f) => f.target?.endsWith("daily-radar.json"));
      if (markerRadarRecord) {
        markerRadarRecord.sha256 = newSha;
        markerRadarRecord.byte_length = newLen;
        await writeFile(genMarkerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
      }
    } catch (e) {
      console.warn("[AI Analyzer] 更新 generation.json 警告:", e.message);
    }

    await writeFile(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
    console.log("[AI Analyzer] 已同步更新 generation 缓存指针与哈希校验。");
  } catch (err) {
    console.warn("[AI Analyzer] 同步 generation 缓存出现异常:", err.message);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseCliArgs(process.argv.slice(2));
  runAiAnalyzer(options).catch((err) => {
    console.error("[AI Analyzer] 运行失败:", err);
    process.exit(1);
  });
}
