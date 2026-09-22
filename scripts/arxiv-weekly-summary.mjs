import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RADAR_OUTPUT, DEFAULT_OUTPUT } from "./arxiv-daily.mjs";

const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || process.env.CCNU_API_BASE || "https://api.ccnulaowu.online/v1";
const DEFAULT_API_KEY = process.env.WU_API_KEY || process.env.OPENAI_API_KEY || "";
const DEFAULT_MODEL = process.env.AI_MODEL || "Deepseek-V4.1-Flash";
const DEFAULT_WEEKLY_OUTPUT = resolve(fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url)));

function cleanJsonContent(raw) {
  let cleaned = String(raw ?? "").trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  return cleaned;
}

function parseCliArgs(args) {
  const options = {
    radar: DEFAULT_RADAR_OUTPUT,
    feed: DEFAULT_OUTPUT,
    output: DEFAULT_WEEKLY_OUTPUT,
    model: DEFAULT_MODEL,
    baseUrl: DEFAULT_BASE_URL,
    apiKey: DEFAULT_API_KEY,
    days: 7,
  };
  for (const arg of args) {
    if (arg.startsWith("--radar=")) options.radar = arg.slice("--radar=".length);
    else if (arg.startsWith("--feed=")) options.feed = arg.slice("--feed=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--model=")) options.model = arg.slice("--model=".length);
    else if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--api-key=")) options.apiKey = arg.slice("--api-key=".length);
    else if (arg.startsWith("--days=")) options.days = Number(arg.slice("--days=".length));
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
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

async function callChatCompletion({ prompt, systemPrompt, model, baseUrl, apiKey }) {
  const url = `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
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
1. 课题组主体高度聚焦于爆发现象。如果本周没有直接推动上述核心方向的高价值突破性工作，"top_picks" 数组必须为空数组 []。
2. 绝不允许把不相关的泛星系巡天、普通低能段统计论文为了填满版面而硬凑进 top_picks！诚实空推荐在科研中是被完全肯定与鼓励的。
请根据本周收集的所有已分析论文，撰写一份结构化、有深度物理洞察的科研周报。`;

function buildWeeklyPrompt(papers, dateRange, weekId) {
  // Sort papers so must_read and worth_knowing are at the top
  const prioritized = [...papers].sort((a, b) => {
    const order = { must_read: 0, worth_knowing: 1, skip: 2 };
    return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
  });

  const papersText = prioritized.map((p, index) => {
    const isImportant = p.priority === "must_read" || p.priority === "worth_knowing";
    if (isImportant) {
      return `[${index + 1}] arXiv:${p.arxiv_id} [${p.priority.toUpperCase()}] ${p.title}
- 核心物理问题: ${p.analysis?.problem || "探讨相关高能物理现象"}
- 主要发现与结论: ${p.analysis?.result || "观测或模型结果"}
- 采用方法: ${p.analysis?.method || "数据分析与模型模拟"}`;
    } else {
      return `[${index + 1}] arXiv:${p.arxiv_id} [SKIM] ${p.title} (${p.analysis?.result?.slice(0, 50) || "背景研究"}...)`;
    }
  }).join("\n");

  return `【周报元数据】
周期: ${weekId} (${dateRange})
本周已分析论文: ${papers.length} 篇

【本周重点论文列表】
${papersText}

【任务要求】
请综合梳理本周高能天体物理（磁星、GRB、超新星、吸积流/喷流等）最新进展，以严谨合法的 JSON 格式返回（不得包含 \`\`\`json 等任何 markdown 标记）。
排版规范：涉及数学物理变量、天体物理参量、光度、能段、科学计数法或公式（如 $10^{-3}$、$f_{\\mathrm{agn}}$、$L_{\\mathrm{bol}}$、$M_\\odot$），请务必使用标准 LaTeX 行内公式语法（以单个 $ 包裹），确保与静态 KaTeX 排版引擎兼容。
{
  "week_id": "${weekId}",
  "title": "高能天体物理 arXiv 每周学术脉络与前沿精选",
  "date_range": "${dateRange}",
  "executive_summary": "1-2段精炼中文，宏观梳理本周在致密星、磁星物理、吸积喷流和瞬变观测上的核心科学脉络（公式请用 $...$）",
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
  model = DEFAULT_MODEL,
  baseUrl = DEFAULT_BASE_URL,
  apiKey = DEFAULT_API_KEY,
  days = 7,
} = {}) {
  if (!apiKey) {
    throw new Error("缺少 API Key。请设置环境变量 WU_API_KEY 或 OPENAI_API_KEY。");
  }

  const resolvedRadar = resolve(radarPath);
  const resolvedOutput = resolve(outputPath);

  let radar = {};
  try {
    radar = JSON.parse(await readFile(resolvedRadar, "utf8"));
  } catch (err) {
    throw new Error(`无法读取雷达数据文件 ${resolvedRadar}: ${err.message}`);
  }

  const allAnalyses = [
    ...(Array.isArray(radar.analyses) ? radar.analyses : []),
    ...(Array.isArray(radar.historical_analyses) ? radar.historical_analyses : []),
  ];

  if (allAnalyses.length === 0) {
    console.log("[Weekly Summary] 当前没有可用于总结的论文分析数据。");
    return null;
  }

  // Deduplicate by arxiv_id + revision
  const uniqueMap = new Map();
  for (const item of allAnalyses) {
    if (!item.arxiv_id) continue;
    const key = `${item.arxiv_id}@v${item.revision || 1}`;
    if (!uniqueMap.has(key) || item.status === "ready") {
      uniqueMap.set(key, item);
    }
  }

  let feedMap = new Map();
  try {
    const feedFile = options.feed || DEFAULT_OUTPUT;
    const feedJson = JSON.parse(await readFile(resolve(feedFile), "utf8"));
    for (const entry of feedJson.entries || []) {
      if (entry.arxiv_id) feedMap.set(entry.arxiv_id, entry);
    }
  } catch {}

  const papers = Array.from(uniqueMap.values());
  for (const p of papers) {
    const feedEntry = feedMap.get(p.arxiv_id);
    if (feedEntry?.title) {
      p.title = feedEntry.title;
    }
  }
  const mustReadCount = papers.filter((p) => p.priority === "must_read").length;
  const worthKnowingCount = papers.filter((p) => p.priority === "worth_knowing").length;
  const skipCount = papers.filter((p) => p.priority === "skip").length;

  console.log(`[Weekly Summary] 收集到本周共 ${papers.length} 篇分析论文（Must Read: ${mustReadCount}, Worth Knowing: ${worthKnowingCount}, Skim: ${skipCount}）。`);

  const now = new Date();
  const weekId = currentWeekId(now);
  const startDate = new Date(now.valueOf() - days * 86400000).toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);
  const dateRange = `${startDate} ~ ${endDate}`;

  console.log(`[Weekly Summary] 正在调用模型 ${model} 生成第 ${weekId} 期学术周报综述...`);
  const prompt = buildWeeklyPrompt(papers, dateRange, weekId);
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
    else throw new Error("无法解析模型返回的 JSON 周报内容");
  }

  const weeklyPayload = {
    schema_version: "astrolineage-weekly-summary-v1",
    generated_at: now.toISOString(),
    week_id: weekId,
    title: parsed.title || "高能天体物理 arXiv 每周学术脉络与前沿综述",
    date_range: dateRange,
    executive_summary: parsed.executive_summary || "暂无本周宏观脉络综述。",
    thematic_highlights: Array.isArray(parsed.thematic_highlights) ? parsed.thematic_highlights : [],
    top_picks: Array.isArray(parsed.top_picks) ? parsed.top_picks : [],
    statistics: {
      total_analyzed: papers.length,
      must_read_count: mustReadCount,
      worth_knowing_count: worthKnowingCount,
      skip_count: skipCount,
    },
    papers: papers.map((p) => ({
      arxiv_id: p.arxiv_id,
      revision: p.revision || 1,
      title: p.title || `Paper ${p.arxiv_id}`,
      priority: p.priority,
      result: p.analysis?.result || "",
      problem: p.analysis?.problem || "",
      method: p.analysis?.method || "",
      reason: p.analysis?.reason || "",
      url: `https://arxiv.org/abs/${p.arxiv_id}v${p.revision || 1}`,
    })),
  };

  await mkdir(dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(weeklyPayload, null, 2)}\n`, "utf8");

  // Also write an archive under .cache/arxiv-weekly/archives/
  const archiveDir = resolve(".cache/arxiv-weekly/archives");
  await mkdir(archiveDir, { recursive: true });
  const archivePath = join(archiveDir, `${weekId}.json`);
  await writeFile(archivePath, `${JSON.stringify(weeklyPayload, null, 2)}\n`, "utf8");

  try {
    const { syncArxivArchives } = await import("./arxiv-archive.mjs");
    await syncArxivArchives();
  } catch (archiveErr) {
    console.warn("[Weekly Summary] Warning: Failed to sync archive manifest:", archiveErr.message);
  }

  console.log(`[Weekly Summary] ✓ 周报生成成功并落盘：`);
  console.log(`  - 生产数据: ${resolvedOutput}`);
  console.log(`  - 历史归档: ${archivePath}`);
  console.log(`  - 本期必读 Top Picks: ${weeklyPayload.top_picks.length} 篇，专题分类: ${weeklyPayload.thematic_highlights.length} 个。`);

  return weeklyPayload;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseCliArgs(process.argv.slice(2));
  runWeeklySummary(options).catch((err) => {
    console.error("[Weekly Summary] 运行失败:", err);
    process.exit(1);
  });
}
