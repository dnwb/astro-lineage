import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
  process.loadEnvFile();
}

import { loadCausalCatalog } from "../src/domain/causal-graph-catalog.mjs";
import { callChatCompletion } from "./agent-core.mjs";

const catalog = loadCausalCatalog();

// Build a structured catalog text representing the 41 works and their stages
const worksSummary = catalog.works
  .map((w) => {
    const stages = catalog.getStagesForWork(w.slug);
    const stageLines = stages.map((s) => `    - ${s.id}: ${s.label}`).join("\n");
    return `- ${w.slug} (${w.title}):\n${stageLines}`;
  })
  .join("\n\n");

const ANCHOR_SYSTEM_PROMPT = `你是高能天体物理因果图谱对齐专家。
任务：将一篇前沿 arXiv 论文的研究成果，精准对齐并挂载到课题组 41 篇经典奠基文献的物理演化阶段（Stage）网络中。

【严格约束】：
1. stage_id 必须来自给定的 41 篇文献 Stage 列表，严禁虚构任何不存在的 stage_id！
2. work_slug 必须是该 stage_id 所属的文献 slug。
3. relation 只能从以下 5 个中选择：["supports", "constrains", "challenges", "extends", "tests"]。
4. reason 用一句话（30-80 字中文）阐述该论文的观测/理论结果如何作用于该阶段（如约束了某物理量、证实了某假设）。
5. primary_axis 填写论文涉及的主物理轴（如: dynamics, central_object, energy_transfer, emission, observable 等）。
6. 只挑选 1 到 3 个最具本质关联的 stage，宁缺毋滥，切忌泛泛关联！

必须输出纯 JSON，格式如下：
{
  "primary_axis": "dynamics",
  "anchored_stages": [
    {
      "stage_id": "stage:...",
      "work_slug": "...",
      "relation": "supports",
      "reason": "..."
    }
  ]
}`;

export async function anchorPaper(paperRecord) {
  const userPrompt = `【待对齐论文信息】：
- arXiv ID: ${paperRecord.arxiv_id}
- 标题: ${paperRecord.title || paperRecord.arxiv_id}
- 核心物理问题: ${paperRecord.problem || "unknown"}
- 关键研究结果: ${paperRecord.result || "unknown"}
- 物理方法与模型: ${paperRecord.method || "unknown"}
- 分诊理由: ${paperRecord.reason || "unknown"}

【参考：41 篇核心文献及其物理演化阶段（Stage）清单】：
${worksSummary}

请审视上述论文，将其核心成果对齐到上述演化阶段，输出严格合规的 JSON。`;

  const raw = await callChatCompletion({
    prompt: userPrompt,
    systemPrompt: ANCHOR_SYSTEM_PROMPT,
    model: process.env.AI_MODEL_BODY || process.env.AI_MODEL || "agy/gemini-3.8-flash-medium",
  });

  // Extract JSON from output
  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in model response");
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(`Failed to parse model JSON: ${err.message}\nRaw output: ${raw.slice(0, 300)}`);
  }

  const validation = catalog.validateAnchor(parsed);
  return {
    arxiv_id: paperRecord.arxiv_id,
    title: paperRecord.title,
    validation,
    raw_anchor: parsed,
  };
}

async function main() {
  console.log("=== AstroLineage 物理因果挂载试验 (Causal Anchor Pilot) ===\n");
  const radarRaw = readFileSync(resolve("src/data/daily-radar.json"), "utf8");
  const feedRaw = readFileSync(resolve("src/data/arxiv-daily.json"), "utf8");
  const radar = JSON.parse(radarRaw);
  const feed = JSON.parse(feedRaw);

  const mrAnalyses = radar.analyses.filter((a) => a.priority === "must_read").slice(0, 3);
  console.log(`正在对最近 ${mrAnalyses.length} 篇 Must Read 论文运行因果锚定试验...\n`);

  for (const a of mrAnalyses) {
    const entry = feed.entries?.find((e) => e.arxiv_id === a.arxiv_id);
    const paperRecord = {
      arxiv_id: a.arxiv_id,
      title: entry?.title || a.arxiv_id,
      problem: a.analysis?.problem,
      result: a.analysis?.result,
      method: a.analysis?.method,
      reason: a.analysis?.reason,
    };

    console.log(`>>> 正在分析: [${paperRecord.arxiv_id}] ${paperRecord.title.slice(0, 60)}...`);
    try {
      const res = await anchorPaper(paperRecord);
      if (res.validation.valid) {
        console.log(`✅ 对齐成功 (通过 276 Stages 白名单严格校验):`);
        console.log(`   主物理轴: ${res.validation.data.primary_axis}`);
        for (const st of res.validation.data.anchored_stages) {
          const catStage = catalog.getStage(st.stage_id);
          console.log(`   └─ [${st.relation.toUpperCase()}] ${st.stage_id} (${catStage.label})`);
          console.log(`      来自文献: ${st.work_slug}`);
          console.log(`      科学依据: ${st.reason}`);
        }
      } else {
        console.error(`❌ 对齐校验失败:`, res.validation.errors);
      }
    } catch (err) {
      console.error(`❌ 处理出错:`, err.message);
    }
    console.log("\n------------------------------------------------------------\n");
  }
}

if (process.argv[1]?.endsWith("causal-anchor-cli.mjs")) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
