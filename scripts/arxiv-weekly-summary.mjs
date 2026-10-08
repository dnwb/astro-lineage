import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_RADAR_OUTPUT,
  DEFAULT_OUTPUT,
  readPublishedArxivEdition,
  writeJsonAtomically,
} from "./arxiv-daily.mjs";
import { normalizeArxivId, sourceFingerprint, validateDailyRadarPayload } from "./daily-radar.mjs";
import { getDirtyWeeks, clearDirtyWeek } from "./arxiv-archive.mjs";

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

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
const FALLBACK_BASE_URL = process.env.FALLBACK_OPENAI_BASE_URL || "";
const FALLBACK_API_KEY = process.env.FALLBACK_OPENAI_API_KEY || process.env.ZHANG_API_KEY || "";
const DEFAULT_MODEL =
  process.env.AI_MODEL_WEEKLY || process.env.AI_MODEL_BODY || "gemini-3.8-flash-high";
const DEFAULT_EFFORT = process.env.REASONING_EFFORT || "medium";
const DEFAULT_TIMEOUT_MS = Number(process.env.WEEKLY_TIMEOUT_MS) || 180_000;
const DEFAULT_WEEKLY_OUTPUT = resolve(
  fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url))
);
const DEFAULT_DAILY_ARCHIVE = resolve(
  fileURLToPath(new URL("../src/data/arxiv-archives/daily", import.meta.url))
);

import { cleanJsonContent, safeParseJson } from "./arxiv-ai-analyzer.mjs";

function parseCliArgs(args) {
  const options = {
    radar: DEFAULT_RADAR_OUTPUT,
    feed: DEFAULT_OUTPUT,
    output: DEFAULT_WEEKLY_OUTPUT,
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    baseUrl: DEFAULT_BASE_URL,
    apiKey: DEFAULT_API_KEY,
    days: 7,
  };
  for (const arg of args) {
    if (arg.startsWith("--radar=")) options.radar = arg.slice("--radar=".length);
    else if (arg.startsWith("--feed=")) options.feed = arg.slice("--feed=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--model=")) options.model = arg.slice("--model=".length);
    else if (arg.startsWith("--effort=")) options.effort = arg.slice("--effort=".length);
    else if (arg.startsWith("--reasoning-effort="))
      options.effort = arg.slice("--reasoning-effort=".length);
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--api-key=")) options.apiKey = arg.slice("--api-key=".length);
    else if (arg.startsWith("--days=")) options.days = Number(arg.slice("--days=".length));
    else if (arg.startsWith("--week=")) options.weekId = arg.slice("--week=".length);
    else if (arg.startsWith("--week-id=")) options.weekId = arg.slice("--week-id=".length);
    else if (arg.startsWith("--artifact-root="))
      options.artifactRoot = arg.slice("--artifact-root=".length);
    else if (arg === "--write-archives" || arg === "--sync-archives") options.writeArchives = true;
    else if (arg === "--cascade") options.cascade = true;
  }
  return options;
}

function currentWeekId(date = new Date()) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

export function getNaturalWeekBounds(weekId) {
  const [yearStr, weekStr] = weekId.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = (jan4.getUTCDay() + 6) % 7;
  const mondayWeek1 = new Date(jan4.valueOf() - day * 86400000);
  const mondayTarget = new Date(mondayWeek1.valueOf() + (week - 1) * 7 * 86400000);

  const announcementDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayTarget.valueOf() + i * 86400000);
    announcementDates.push(d.toISOString().slice(0, 10));
  }
  const sunday = announcementDates.at(-1);
  return {
    monday: announcementDates[0],
    sunday,
    announcementDates,
    dateRange: `${announcementDates[0]} ~ ${sunday}`,
  };
}

function safeProviderError(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return new Error("Weekly summary API request timed out.");
  }
  if (/^API returned HTTP \d{3}$/u.test(error?.message ?? "")) {
    return new Error(`Weekly summary API request failed: ${error.message}.`);
  }
  if (
    error?.message === "Empty model response" ||
    error?.message === "Invalid model response JSON"
  ) {
    return error;
  }
  return new Error("Weekly summary API request failed.");
}

export async function executeChatCompletion({
  prompt,
  systemPrompt,
  model,
  effort = DEFAULT_EFFORT,
  baseUrl,
  apiKey,
  retries = 2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const tryCall = async (targetUrl, targetKey, targetModel, targetEffort, targetTimeout) => {
    const payload = {
      model: targetModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    };
    if (targetEffort && targetModel.startsWith("gpt-6")) {
      payload.reasoning_effort = targetEffort;
    }
    const response = await fetchImpl(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${targetKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(targetTimeout),
    });

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}`);
    }

    let json;
    try {
      json = await response.json();
    } catch {
      throw new Error("Invalid model response JSON");
    }
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty model response");
    return cleanJsonContent(content);
  };

  const pool = [];
  if (baseUrl && apiKey) {
    const isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
    pool.push({
      name: isLocal ? "Primary (local-8318)" : "Primary",
      url: `${baseUrl.replace(/\/+$/u, "")}/chat/completions`,
      key: apiKey,
    });
  }
  if (
    FALLBACK_BASE_URL &&
    FALLBACK_API_KEY &&
    (FALLBACK_BASE_URL !== baseUrl || FALLBACK_API_KEY !== apiKey)
  ) {
    pool.push({
      name: "Secondary (fallback)",
      url: `${FALLBACK_BASE_URL.replace(/\/+$/u, "")}/chat/completions`,
      key: FALLBACK_API_KEY,
    });
  }
  if (pool.length === 0)
    throw new Error("Missing API key; set IOA_API_KEY, WU_API_KEY or OPENAI_API_KEY");

  const candidateModels = [
    model,
    "gemini-3.8-flash-high",
    "gpt-6.1-sol",
    "claude-sonnet-4-6",
    "gpt-6-luna",
  ]
    .filter(Boolean)
    .filter((m, i, arr) => arr.indexOf(m) === i);
  let lastError;
  for (const currentModel of candidateModels) {
    const isPrimary = currentModel === model;
    const currentEffort = isPrimary ? effort : "medium";
    const currentRetries = isPrimary ? retries : 1;
    for (let attempt = 1; attempt <= currentRetries; attempt++) {
      for (let pIdx = 0; pIdx < pool.length; pIdx++) {
        const provider = pool[pIdx];
        try {
          if (!isPrimary)
            console.log(
              `[Weekly Summary] 正在通过供应商 ${provider.name} 降级尝试备选模型: ${currentModel}...`
            );
          return await tryCall(provider.url, provider.key, currentModel, currentEffort, timeoutMs);
        } catch (err) {
          lastError = safeProviderError(err);
          if (pool.length > 1 && pIdx < pool.length - 1) {
            console.warn(
              `[Weekly Summary] 供应商 ${provider.name} 模型 (${currentModel}) 请求失败 (${lastError.message})，切换至对等供应商重试同一模型...`
            );
          }
        }
      }
      if (attempt < currentRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(
          `[Weekly Summary] ${currentModel} 请求失败 (${lastError.message})，将在 ${delay}ms 后重试...`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

async function callChatCompletion(opts) {
  return executeChatCompletion(opts);
}

const SYSTEM_PROMPT = `你是一个专注于高能天体物理（High-Energy Astrophysics）与爆发现象的学术导师与周报主笔。
课题组重点关注各类高能爆发现象及其因果动力学链条（前身星 -> 中心引擎 -> 喷流/外流抛射物 -> 周围介质相互作用 -> 能量耗散 -> 辐射转移 -> 观测特征 -> 物理推断）。
课题组七大主线为：
- R1. 中央引擎与引擎驱动瞬变（SLSN, FBOT, 磁星能量注入, 千新星）
- R2. 相对论喷流与伽马射线暴（Jet 动力学, 激波, GRB 余辉）
- R3. 爆发瞬变与周星介质相互作用（CSM）（Chevalier 动力学, 激波破越, 辐射扩散）
- R4. 脉冲星风与高能双星（双星风碰撞激波, X/gamma 轨道调制）
- R5. 磁星爆发与快速射电暴环境（磁能释放, 磁层, FRB 色散/旋转量反演）
- R6. 致密环境与多信使瞬变（AGN 盘内爆炸/喷流, 中微子, 引力波对应体）
- R7. 致密星X射线时变、能谱与双星观测（X射线双星, 吸积脉冲星, QPO, HXMT/NuSTAR/EP 数据分析；此为观测支撑翼，不影响爆发现象核心主体）

【严禁硬凑与诚实零推荐原则】
1. 不以“突破性”或新颖度作为推荐门槛。只要论文对上述主线有明确价值，增量观测、理论约束、方法改进、重要复核、综述或有用的后续研究都可纳入；必须根据提供的分析判断实际关联与价值。
2. 不相关的泛星系巡天、普通低能段统计论文不得为了填版面而硬凑进 top_picks。若没有达到组内相关性和科学效用门槛的论文，top_picks 可以为空。
请根据本周收集的所有已分析论文，撰写一份结构化、有深度物理洞察的科研周报。`;

function buildWeeklyPrompt(papers, dateRange, weekId) {
  const mustReadPapers = papers.filter((p) => p.priority === "must_read");
  const worthKnowingPapers = papers.filter((p) => p.priority === "worth_knowing");
  // Cap at top 12 to prevent API gateway timeouts, prioritizing all must_read papers
  const importantPapers = [...mustReadPapers, ...worthKnowingPapers.slice(0, 10)];
  const totalImportant = mustReadPapers.length + worthKnowingPapers.length;
  const skipCount = papers.length - totalImportant;

  const papersText =
    importantPapers.length > 0
      ? importantPapers
          .map((p, index) => {
            const guide = p.guide || p.analysis?.analysis || p.analysis || {};
            return `[${index + 1}] arXiv:${p.arxiv_id}v${p.revision} [${p.priority.toUpperCase()}] ${p.title}
- announcement_date: ${p.announcement_date}; historical_edition: ${p.historical_edition}; source_fingerprint: ${p.source_fingerprint}
- 核心物理问题: ${guide.problem || p.problem || "探讨相关高能物理现象"}
- 主要发现与结论: ${guide.result || p.result || "观测或模型结果"}
- 采用方法: ${guide.method || p.method || "数据分析与模型模拟"}`;
          })
          .join("\n\n")
      : "（本周无符合爆发现象核心 R1~R7 方向的重点研读论文）";

  return `【周报元数据】
周期: ${weekId} (${dateRange})
本周已分析论文: 共 ${papers.length} 篇（其中已自动筛除 ${skipCount} 篇非瞬变/泛星系背景论文，保留 ${importantPapers.length} 篇重点高能瞬变工作）

【本周重点论文列表】
${papersText}

【任务要求】
请综合梳理本周高能天体物理（磁星、GRB、超新星、吸积流/喷流等）最新进展，以严谨合法的 JSON 格式返回（不得包含 \`\`\`json 等任何 markdown 标记）。
排版规范：涉及数学物理变量、天体物理参量、光度、能段、科学计数法或公式（如 $10^{-3}$、$f_{\\mathrm{agn}}$、$L_{\\mathrm{bol}}$、$M_\\odot$），请务必使用标准 LaTeX 行内公式语法（以单个 $ 包裹），确保与静态 KaTeX 排版引擎兼容。
注意：学术综述力求高度结构化、对比清晰，禁止冗长含混的段落堆叠，请务必提供细分物理领域的全景对照矩阵（overview_matrix）。
【全景对照矩阵 overview_matrix 与宏观学术综述规范】：
1. 宏观学术脉络综述（executive_summary）：每个领域方向列表（- **领域方向**：...）中的每一个具体断言必须以该篇具体论文或第一作者为语法主语（格式：\`第一作者等 (arXiv:xxxx.xxxxx)\` 或 \`arXiv:xxxx.xxxxx (第一作者等)\` 提出/论证/发现/约束...），明确具体是谁做出了何种定量结论或模型构建；严禁使用无主语的被动空洞句式。
2. 全景对照矩阵（overview_matrix）：
   - key_question：必须精准聚焦该物理方向的核心科学争论与关键未决问题。
   - representative_papers：中的每一篇论文，在 core_findings 中必须针对 key_question 给出针对性的核心物理断言/观测结论，并明确标出文献编号与作者（格式：- 【arXiv:xxxx.xxxxx】(第一作者等)：具体定量断言，物理量用 $...$）。
   - 严禁在 representative_papers 中列出正文未提及的挂名论文；严禁给出无法追溯至该行具体文献的泛泛定性断言。
   - significance：给出该物理方向的核心物理启示与机制辨析（1~2句）。
{
  "week_id": "${weekId}",
  "title": "每周学术脉络 · ${weekId}",
  "date_range": "${dateRange}",
  "executive_summary": "精炼宏观脉络结构化综述（必须包含：首句总体因果链条总揽，随后以 - **领域方向**：[第一作者等 (arXiv:xxxx.xxxxx) 提出/论证...] 列表形式列出各方向关键突破，每句话必须以具体论文或作者为主语，尾句以 > 🎯 **筛选边界**：... 收尾，禁止通篇无主语被动文字堆叠，公式请用 $...$）",
  "overview_matrix": [
    {
      "domain": "物理领域/专题方向（如：快速射电暴与磁星环境、超新星前身星与周星介质、相对论喷流与伽马射线暴）",
      "key_question": "核心物理争论或关键聚焦问题",
      "representative_papers": ["该领域下具体支撑上述断言的 arxiv_id 列表，如 2609.31842，与 core_findings 逐一对应"],
      "core_findings": "- 【arXiv:2609.31842】(第一作者等)：针对争论的具体定量断言（物理量用 $...$）\n- 【arXiv:2609.36114】(第一作者等)：针对争论的具体定量断言",
      "significance": "该物理方向的核心物理启示与机制辨析（1~2句）"
    }
  ],
  "thematic_highlights": [
    {
      "theme_name": "专题名称（如：磁星动力学与高能辐射机制）",
      "summary": "1段中文，总结该专题下的科学进展（公式请用 $...$）",
      "paper_ids": ["相关的 arxiv_id，如 2609.17661"]
    }
  ],
  "top_picks": [
    {
      "arxiv_id": "论文的 arxiv_id",
      "revision": 1,
      "historical_edition": "必须逐字复制论文列表中的 historical_edition",
      "source_fingerprint": "必须逐字复制论文列表中的 source_fingerprint",
      "title": "论文标题",
      "priority": "must_read 或 worth_knowing",
      "recommendation_reason": "推荐精读理由（中文1句）",
      "core_insight": "核心突破或结论（中文1句，关键物理量用 $...$）",
      "reading_guide": "切入阅读建议（中文1句）"
    }
  ]
}`;
}

export async function runWeeklySummary({
  radar: radarPath = DEFAULT_RADAR_OUTPUT,
  output: outputPath = DEFAULT_WEEKLY_OUTPUT,
  feed: feedPath = DEFAULT_OUTPUT,
  dailyArchiveDir = DEFAULT_DAILY_ARCHIVE,
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
  baseUrl = DEFAULT_BASE_URL,
  apiKey = DEFAULT_API_KEY,
  weekId: specifiedWeekId = null,
  artifactRoot,
  generateSummary = callChatCompletion,
  writeArchives = null,
} = {}) {
  if (!apiKey && generateSummary === callChatCompletion) {
    throw new Error("缺少 API Key。请设置环境变量 IOA_API_KEY、WU_API_KEY 或 OPENAI_API_KEY。");
  }

  const resolvedOutput = resolve(outputPath);
  const { feed: activeFeed, radar } = await readPublishedArxivEdition({
    output: feedPath,
    radarOutput: radarPath,
    artifactRoot,
  });

  const now = new Date();
  const dateFromWindow = radar.edition?.window?.announcement_date
    ? new Date(radar.edition.window.announcement_date + "T12:00:00Z")
    : now;
  const weekId = specifiedWeekId || currentWeekId(dateFromWindow);
  const bounds = getNaturalWeekBounds(weekId);
  const targetDates = bounds.announcementDates;
  const targetDateSet = new Set(targetDates);
  const dateRange = bounds.dateRange;
  const editions = new Map();
  const foundDates = new Set();

  const addEdition = (date, feed, editionRadar, preferCurrent = false) => {
    const radarWindow = editionRadar?.edition?.window;
    const feedDate = feed?.window?.announcement_date ?? radarWindow?.announcement_date ?? date;
    if (
      feed?.window?.announcement_date &&
      radarWindow?.announcement_date &&
      feed.window.announcement_date !== radarWindow.announcement_date
    )
      return;
    if (
      feed?.window?.batch_id &&
      radarWindow?.batch_id &&
      feed.window.batch_id !== radarWindow.batch_id
    )
      return;
    if (feedDate !== date || !targetDateSet.has(date) || !Array.isArray(feed?.entries)) return;
    const batchId = feed.window?.batch_id ?? radarWindow?.batch_id ?? `announcement-${date}`;
    const key = `${date}\u0000${batchId}`;
    const edition = editions.get(key) ?? { date, batchId, papers: new Map() };
    if (preferCurrent) {
      const activeEntries = new Map(
        feed.entries.map((entry) => [
          `${normalizeArxivId(entry.arxiv_id)}\u0000${entry.revision}`,
          sourceFingerprint(entry),
        ])
      );
      for (const [paperKey, paper] of edition.papers) {
        const identity = `${normalizeArxivId(paper.arxiv_id)}\u0000${paper.revision}`;
        if (activeEntries.get(identity) !== paper.source_fingerprint)
          edition.papers.delete(paperKey);
      }
    }
    const { model: dailyModel } = validateDailyRadarPayload(feed, editionRadar);
    for (const priority of ["must_read", "worth_knowing", "skip"]) {
      for (const item of dailyModel.groups[priority]) {
        const fingerprint = sourceFingerprint(item);
        const paperKey = `${normalizeArxivId(item.arxiv_id)}\u0000${item.revision}\u0000${fingerprint}`;
        const guide = item.analysis?.analysis || item.analysis || {};
        edition.papers.set(paperKey, {
          ...item,
          priority,
          announcement_date: date,
          historical_edition: batchId,
          source_fingerprint: fingerprint,
          guide,
          problem: guide.problem || "",
          result: guide.result || "",
          method: guide.method || "",
          reason: guide.reason || "",
        });
      }
    }
    editions.set(key, edition);
    foundDates.add(date);
  };

  // Load only edition-bound archives within the requested natural week.
  for (const date of targetDates) {
    const dailyPath = join(dailyArchiveDir, `${date}.json`);
    if (existsSync(dailyPath)) {
      try {
        const dailyData = JSON.parse(await readFile(dailyPath, "utf8"));
        if (dailyData.date === date) addEdition(date, dailyData.feed, dailyData.radar);
      } catch (err) {
        console.warn(`[Weekly Summary] Warning reading daily archive ${dailyPath}:`, err.message);
      }
    }
  }

  // Include the active pair only when it is an edition in the requested week.
  const activeDate =
    activeFeed?.window?.announcement_date ?? radar.edition?.window?.announcement_date;
  if (activeDate && targetDateSet.has(activeDate)) {
    addEdition(activeDate, activeFeed, radar, true);
  }

  // Keep the newest exact revision for each paper across this week's editions.
  const latestById = new Map();
  for (const edition of [...editions.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.batchId.localeCompare(b.batchId)
  )) {
    for (const paper of edition.papers.values()) {
      const id = normalizeArxivId(paper.arxiv_id);
      const previous = latestById.get(id);
      if (
        !previous ||
        paper.announcement_date > previous.announcement_date ||
        (paper.announcement_date === previous.announcement_date &&
          Number(paper.revision) > Number(previous.revision))
      ) {
        latestById.set(id, paper);
      }
    }
  }
  const papers = [...latestById.values()];

  if (papers.length === 0) {
    console.log(`[Weekly Summary] 当前自然周 (${weekId}) 没有检索到可用于总结的论文分析数据。`);
    return null;
  }

  const mustReadCount = papers.filter((p) => p.priority === "must_read").length;
  const worthKnowingCount = papers.filter((p) => p.priority === "worth_knowing").length;
  const skipCount = papers.filter((p) => p.priority === "skip").length;

  console.log(`[Weekly Summary] 目标自然周: ${weekId} (${dateRange})`);
  console.log(`[Weekly Summary] 自然周日期: [${targetDates.join(", ")}]`);
  console.log(
    `[Weekly Summary] 实际纳入归档批次: ${Array.from(foundDates).sort().join(", ") || "无"} (${foundDates.size}/7)`
  );
  if (foundDates.size === 7) {
    console.log(`[Weekly Summary] ✓ 本自然周全部 7 天的批次均已收齐！`);
  } else {
    console.log(`[Weekly Summary] 提示: 本自然周当前包含 ${foundDates.size}/7 天的批次。`);
  }
  console.log(
    `[Weekly Summary] 共聚合 ${papers.length} 篇已分析论文（Must Read: ${mustReadCount}, Worth Knowing: ${worthKnowingCount}, Skim: ${skipCount}）。`
  );

  console.log(`[Weekly Summary] 正在调用模型 ${model} 生成第 ${weekId} 期学术周报综述...`);
  const prompt = buildWeeklyPrompt(papers, dateRange, weekId);
  const rawJson = await generateSummary({
    prompt,
    systemPrompt: SYSTEM_PROMPT,
    model,
    effort,
    baseUrl,
    apiKey,
  });

  const parsed = safeParseJson(rawJson);
  const eligiblePapers = new Map(
    papers
      .filter((paper) => ["must_read", "worth_knowing"].includes(paper.priority))
      .map((paper) => [
        `${normalizeArxivId(paper.arxiv_id)}@${paper.revision}@${paper.historical_edition}@${paper.source_fingerprint}`,
        paper,
      ])
  );
  const eligibleIds = new Set(
    [...eligiblePapers.values()].map((paper) => normalizeArxivId(paper.arxiv_id))
  );
  const thematicHighlights = (
    Array.isArray(parsed.thematic_highlights) ? parsed.thematic_highlights : []
  )
    .map((theme) => ({
      ...theme,
      paper_ids: [
        ...new Set(
          (Array.isArray(theme?.paper_ids) ? theme.paper_ids : [])
            .map((id) => normalizeArxivId(id))
            .filter((id) => eligibleIds.has(id))
        ),
      ],
    }))
    .filter((theme) => theme.paper_ids.length > 0);
  const usedPicks = new Set();
  const topPicks = (Array.isArray(parsed.top_picks) ? parsed.top_picks : []).flatMap((pick) => {
    if (
      !Number.isInteger(Number(pick?.revision)) ||
      Number(pick.revision) < 1 ||
      typeof pick?.historical_edition !== "string" ||
      typeof pick?.source_fingerprint !== "string"
    )
      return [];
    const identity = `${normalizeArxivId(pick.arxiv_id)}@${Number(pick.revision)}@${pick.historical_edition}@${pick.source_fingerprint}`;
    const paper = eligiblePapers.get(identity);
    const key = `${normalizeArxivId(paper?.arxiv_id)}@${paper?.revision}@${paper?.historical_edition}@${paper?.source_fingerprint}`;
    if (!paper || paper.priority !== pick.priority || usedPicks.has(key)) return [];
    usedPicks.add(key);
    return [
      {
        ...pick,
        authors: Array.isArray(paper.authors) ? paper.authors : [],
        revision: paper.revision,
        historical_edition: paper.historical_edition,
        source_fingerprint: paper.source_fingerprint,
      },
    ];
  });

  const overviewMatrix = (Array.isArray(parsed.overview_matrix) ? parsed.overview_matrix : [])
    .map((row) => {
      const citedInText = (
        String(row?.core_findings || "").match(/\b\d{4}\.\d{4,5}[a-z]?(?:v\d+)?\b/gi) || []
      ).map((id) => normalizeArxivId(id));
      const declared = (
        Array.isArray(row?.representative_papers) ? row.representative_papers : []
      ).map((id) => normalizeArxivId(id));
      const combined = [...new Set([...declared, ...citedInText])].filter((id) =>
        eligibleIds.has(id)
      );
      if (combined.length === 0 && !row?.domain) return null;
      return {
        domain: row.domain || "前沿物理方向",
        key_question: row.key_question || "核心物理争论探讨",
        representative_papers: combined.length > 0 ? combined : declared,
        core_findings: row.core_findings || row.summary || "",
        significance: row.significance || "",
      };
    })
    .filter(Boolean);

  const weeklyPayload = {
    schema_version: "astrolineage-weekly-summary-v1",
    generated_at: now.toISOString(),
    week_id: weekId,
    title: parsed.title || `每周学术脉络 · ${weekId}`,
    date_range: dateRange,
    executive_summary: parsed.executive_summary || "暂无本周宏观脉络综述。",
    overview_matrix: overviewMatrix,
    thematic_highlights: thematicHighlights,
    top_picks: topPicks,
    statistics: {
      total_analyzed: papers.length,
      must_read_count: mustReadCount,
      worth_knowing_count: worthKnowingCount,
      skip_count: skipCount,
    },
    papers: papers.map((p) => {
      const guide = p.guide || p.analysis?.analysis || p.analysis || {};
      return {
        arxiv_id: p.arxiv_id,
        revision: p.revision || 1,
        title: p.title || `Paper ${p.arxiv_id}`,
        authors: Array.isArray(p.authors) ? p.authors : [],
        priority: p.priority,
        result: guide.result || p.result || "",
        problem: guide.problem || p.problem || "",
        method: guide.method || p.method || "",
        reason: guide.reason || p.reason || "",
        url: `https://arxiv.org/abs/${p.arxiv_id}v${p.revision || 1}`,
        announcement_date: p.announcement_date,
        historical_edition: p.historical_edition,
        source_fingerprint: p.source_fingerprint,
      };
    }),
  };

  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeJsonAtomically(resolvedOutput, weeklyPayload);

  const productionPaths =
    resolvedOutput === DEFAULT_WEEKLY_OUTPUT &&
    resolve(radarPath) === DEFAULT_RADAR_OUTPUT &&
    resolve(feedPath) === DEFAULT_OUTPUT &&
    resolve(dailyArchiveDir) === DEFAULT_DAILY_ARCHIVE;
  const shouldWriteArchives = writeArchives ?? productionPaths;
  const archivePath = shouldWriteArchives
    ? join(resolve(".cache/arxiv-weekly/archives"), `${weekId}.json`)
    : null;
  if (shouldWriteArchives) {
    await mkdir(dirname(archivePath), { recursive: true });
    await writeJsonAtomically(archivePath, weeklyPayload);
    try {
      const { syncArxivArchives } = await import("./arxiv-archive.mjs");
      await syncArxivArchives();
    } catch (archiveErr) {
      console.warn(
        "[Weekly Summary] Warning: Failed to sync archive manifest:",
        archiveErr.message
      );
    }
  }

  console.log(`[Weekly Summary] ✓ 周报生成成功并落盘：`);
  console.log(`  - 生产数据: ${resolvedOutput}`);
  if (archivePath) console.log(`  - 历史归档: ${archivePath}`);
  console.log(
    `  - 本期必读 Top Picks: ${weeklyPayload.top_picks.length} 篇，专题分类: ${weeklyPayload.thematic_highlights.length} 个。`
  );

  try {
    await clearDirtyWeek(weekId);
  } catch {}

  return weeklyPayload;
}

export async function runCascadeWeeklySummaries(options = {}) {
  const dirtyWeeks = await getDirtyWeeks();
  if (!dirtyWeeks || dirtyWeeks.length === 0) {
    console.log("[Weekly Summary:Cascade] 没有检测到积压的 dirty-weeks，无需级联生成。");
    return [];
  }

  console.log(
    `[Weekly Summary:Cascade] 检测到 ${dirtyWeeks.length} 个待更新自然周: ${dirtyWeeks.join(", ")}`
  );
  const results = [];
  for (const weekId of dirtyWeeks) {
    console.log(`[Weekly Summary:Cascade] 正在级联重新生成自然周周报: ${weekId}...`);
    try {
      const payload = await runWeeklySummary({
        ...options,
        weekId,
        writeArchives: true,
      });
      await clearDirtyWeek(weekId);
      results.push(payload);
    } catch (err) {
      console.error(`[Weekly Summary:Cascade] ✗ 生成自然周 ${weekId} 失败: ${err.message}`);
    }
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseCliArgs(process.argv.slice(2));
  const runner = options.cascade ? runCascadeWeeklySummaries(options) : runWeeklySummary(options);
  runner.catch((err) => {
    console.error("[Weekly Summary] 运行失败:", err);
    process.exit(1);
  });
}
