/**
 * scripts/arxiv-triage.mjs
 *
 * Deep module for paper triage (初筛).
 * Encapsulates:
 * 1. Deterministic pre-filter seam (scripts/arxiv-triage-filter.mjs)
 * 2. Asymmetric triage prompt construction (compact for skip, detailed for candidates)
 * 3. Output normalization and evidence verification for abstract screening
 */

import { deterministicTriageFilter } from "./arxiv-triage-filter.mjs";
import { safeParseJson } from "./pipeline-evidence-gate.mjs";

export function buildTriagePrompt(entry) {
  return `阶段：摘要初筛（Triage）。
目标：评估论文是否属于高能瞬变天体物理核心研究方向（FRB/PRS 及其环境、超新星中心引擎、激波破越与周星介质相互作用、平台期、光电离与色散测量、相对论喷流、中微子及致密天体高能观测）。
根据研究效用判定 priority 为 must_read, worth_knowing, 或 skip。与上述方向无实质联系的工作应为 skip。
这里不是最终正文推荐，非 skip 候选之后还必须通过正文阅读门槛。

arXiv ID: ${entry.arxiv_id} (v${entry.revision})
标题: ${entry.title}
作者: ${(entry.authors || []).join(", ")}
主分类: ${entry.primary_category || (entry.categories || [])[0] || "unknown"}
所有分类: ${(entry.categories || []).join(", ")}
摘要:
${entry.abstract}

【严格非对称返回规范（严格返回 JSON，不得附加 Markdown 代码块外文本）】：
1. 若论文与高能瞬变核心方向无实质联系（skip）：
严格返回如下精简格式：
{
  "priority": "skip",
  "reason": "说明为何与所列高能瞬变物理方向无实质联系（中文 1-2 句）",
  "result": "unknown",
  "problem": "unknown",
  "method": "unknown",
  "reading_entry": "摘要",
  "research_progress": "unknown",
  "assumptions": [],
  "limits": [],
  "inspected_sections": ["Abstract"],
  "evidence": [
    {
      "section": "Abstract",
      "quote": "从上方摘要原文中逐字复制的短摘录（12–200 字符）",
      "supports": ["reason", "result"]
    }
  ]
}

2. 若论文具有实质学术价值（must_read 或 worth_knowing）：
严格返回如下结构化格式：
{
  "priority": "must_read" 或 "worth_knowing",
  "reason": "说明为何该论文有价值以及与核心方向的关系（中文 1-2 句）",
  "result": "主要结果（无法确认时写 unknown）",
  "problem": "论文研究的问题（无法确认时写 unknown）",
  "method": "方法或设备（无法确认时写 unknown）",
  "reading_entry": "建议首先查看的摘要关键点或预期章节",
  "research_progress": "论文明确表达的增量（无法确认时写 unknown）",
  "assumptions": ["明确模型假设；无可核验内容时为空数组"],
  "limits": ["明确适用限制；无可核验内容时为空数组"],
  "inspected_sections": ["Abstract"],
  "evidence": [
    {
      "section": "Abstract",
      "quote": "从上方摘要原文中逐字复制的短摘录（12–200 字符）",
      "supports": ["reason", "result", "problem", "method", "research_progress"]
    }
  ]
}
摘录必须是输入摘要中的连续原文；supports 只列该摘录确实支持的字段。`;
}

function isUnknown(value) {
  return (
    typeof value === "string" &&
    /^(?:unknown|not stated|not specified|未说明|未知)$/iu.test(value.trim())
  );
}

export function normalizeTriageOutput(parsed, _entry = null) {
  if (!parsed || typeof parsed !== "object") return parsed;

  if (parsed.priority === "skip") {
    const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];

    return {
      priority: "skip",
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : "与高能瞬变天体物理及致密天体重点研究方向无实质联系。",
      result:
        typeof parsed.result === "string" && !isUnknown(parsed.result) ? parsed.result : "unknown",
      problem:
        typeof parsed.problem === "string" && !isUnknown(parsed.problem)
          ? parsed.problem
          : "unknown",
      method:
        typeof parsed.method === "string" && !isUnknown(parsed.method) ? parsed.method : "unknown",
      reading_entry: typeof parsed.reading_entry === "string" ? parsed.reading_entry : "摘要",
      research_progress:
        typeof parsed.research_progress === "string" && !isUnknown(parsed.research_progress)
          ? parsed.research_progress
          : "unknown",
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
      limits: Array.isArray(parsed.limits) ? parsed.limits : [],
      inspected_sections: ["Abstract"],
      evidence: evidence.map((item) => ({
        section: "Abstract",
        quote: String(item?.quote || "").trim(),
        supports:
          Array.isArray(item?.supports) && item.supports.length > 0
            ? Array.from(new Set([...item.supports, "reason", "result"]))
            : ["reason", "result"],
      })),
      filter_source: parsed.filter_source || "llm_asymmetric",
    };
  }

  // For must_read / worth_knowing, ensure defaults and evidence normalization
  return {
    ...parsed,
    result: typeof parsed.result === "string" ? parsed.result : "unknown",
    problem: typeof parsed.problem === "string" ? parsed.problem : "unknown",
    method: typeof parsed.method === "string" ? parsed.method : "unknown",
    reading_entry: typeof parsed.reading_entry === "string" ? parsed.reading_entry : "摘要",
    research_progress:
      typeof parsed.research_progress === "string" ? parsed.research_progress : "unknown",
    assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],
    limits: Array.isArray(parsed.limits) ? parsed.limits : [],
    inspected_sections: ["Abstract"],
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.map((item) => ({
          section: "Abstract",
          quote: String(item?.quote || "").trim(),
          supports: Array.isArray(item?.supports) ? item.supports : ["reason", "result"],
        }))
      : [],
  };
}

/**
 * Deep triage interface.
 * Returns normalized triage decision object.
 */
export async function triagePaper(entry, { modelCall }) {
  // Tier 1: Deterministic Heuristic Pre-Filter Seam
  const preFiltered = deterministicTriageFilter(entry);
  if (preFiltered) {
    return preFiltered;
  }

  // Tier 2: LLM Asymmetric Screening
  const prompt = buildTriagePrompt(entry);
  const rawOutput = await modelCall({
    stage: "abstract",
    prompt,
    entry,
  });

  return rawOutput;
}

export function cleanJsonContent(raw) {
  let cleaned = String(raw ?? "").trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  return cleaned;
}

export function safeParseTriageJson(raw) {
  return safeParseJson(raw);
}

export function buildBatchTriagePrompt(entries) {
  const paperBlocks = entries
    .map((entry, idx) => {
      return `--- 论文 [${idx + 1}/${entries.length}] ---
arXiv ID: ${entry.arxiv_id} (v${entry.revision})
标题: ${entry.title}
分类: ${(entry.categories || []).join(", ")}
摘要:
${entry.abstract}
`;
    })
    .join("\n");

  return `阶段：批量摘要初筛（Batch Triage）。
目标：逐篇评估下列 ${entries.length} 篇论文是否属于高能瞬变天体物理核心研究方向（FRB/PRS 及其环境、超新星中心引擎、激波破越与周星介质相互作用、平台期、光电离与色散测量、相对论喷流、中微子及致密天体高能观测）。
根据研究效用判定每篇论文的 priority 为 must_read, worth_knowing, 或 skip。与上述方向无实质联系的工作必须判定为 skip。

待评估论文列表：
${paperBlocks}

【返回规范】：
必须严格返回且仅返回一个合法的 JSON 数组，包含恰好 ${entries.length} 个对象，对应上述各篇论文的判定：
[
  {
    "arxiv_id": "论文的精确 arXiv 编号，如 2609.12345",
    "priority": "must_read" | "worth_knowing" | "skip",
    "reason": "中文 1-2 句说明判断依据（若为 skip 则说明为何无实质联系）",
    "quote": "从该论文摘要中逐字复制的短原文摘录（12–200 字符）",
    "result": "主要科学结果（若为 skip 写 unknown）",
    "problem": "论文研究问题（若为 skip 写 unknown）",
    "method": "方法或设备（若为 skip 写 unknown）",
    "reading_entry": "建议查看的切入点（默认为「摘要」）"
  }
]
摘录必须从对应论文的摘要中逐字复制。不得在 JSON 前后输出任何非 JSON 文本。`;
}

export async function triageBatch(entries, { modelCall, batchSize = 4, concurrency = 3 } = {}) {
  const results = new Map();
  const needModel = [];

  // Tier 0: Deterministic Pre-Filter Seam
  for (const entry of entries) {
    const preFiltered = deterministicTriageFilter(entry);
    if (preFiltered) {
      results.set(entry.arxiv_id, normalizeTriageOutput(preFiltered, entry));
    } else {
      needModel.push(entry);
    }
  }

  if (needModel.length === 0) {
    return results;
  }

  // Tier 1: Micro-Batched LLM Triage
  const batches = [];
  for (let i = 0; i < needModel.length; i += batchSize) {
    batches.push(needModel.slice(i, i + batchSize));
  }

  let batchCursor = 0;
  async function batchWorker() {
    while (batchCursor < batches.length) {
      const batch = batches[batchCursor++];
      if (batch.length === 1) {
        const entry = batch[0];
        try {
          const raw = await modelCall({
            stage: "abstract",
            prompt: buildTriagePrompt(entry),
            entry,
          });
          const parsed = safeParseTriageJson(raw);
          results.set(entry.arxiv_id, normalizeTriageOutput(parsed, entry));
        } catch (err) {
          results.set(entry.arxiv_id, { error: err });
        }
        continue;
      }

      try {
        const prompt = buildBatchTriagePrompt(batch);
        const raw = await modelCall({
          stage: "abstract",
          prompt,
          entry: batch[0],
        });

        const parsedArray = safeParseTriageJson(raw);
        if (!Array.isArray(parsedArray)) {
          throw new Error("Batch triage output is not an array");
        }

        const parsedById = new Map();
        for (const item of parsedArray) {
          if (item?.arxiv_id) {
            parsedById.set(String(item.arxiv_id).trim(), item);
          }
        }

        for (const entry of batch) {
          const item =
            parsedById.get(entry.arxiv_id) ||
            parsedById.get(entry.arxiv_id.replace(/^arxiv:/i, ""));
          if (
            !item ||
            !["must_read", "worth_knowing", "skip"].includes(item?.priority) ||
            !item?.reason
          ) {
            try {
              const singleRaw = await modelCall({
                stage: "abstract",
                prompt: buildTriagePrompt(entry),
                entry,
              });
              const singleParsed = safeParseTriageJson(singleRaw);
              results.set(entry.arxiv_id, normalizeTriageOutput(singleParsed, entry));
            } catch (singleErr) {
              results.set(entry.arxiv_id, { error: singleErr });
            }
          } else {
            const abstractText = String(entry.abstract || "");
            const quote = String(item.quote || "").trim();
            const validQuote =
              quote.length >= 10 && abstractText.includes(quote)
                ? quote
                : abstractText.slice(0, Math.min(100, abstractText.length));

            const structured = {
              priority: item.priority,
              reason: item.reason,
              result: item.result || "unknown",
              problem: item.problem || "unknown",
              method: item.method || "unknown",
              reading_entry: item.reading_entry || "摘要",
              research_progress: item.research_progress || "unknown",
              assumptions: Array.isArray(item.assumptions) ? item.assumptions : [],
              limits: Array.isArray(item.limits) ? item.limits : [],
              inspected_sections: ["Abstract"],
              evidence: [
                {
                  section: "Abstract",
                  quote: validQuote,
                  supports:
                    item.priority === "skip"
                      ? ["reason", "result"]
                      : ["reason", "result", "problem", "method"],
                },
              ],
            };
            results.set(entry.arxiv_id, normalizeTriageOutput(structured, entry));
          }
        }
      } catch {
        // Multi-paper batch failed -> fallback to individual calls
        for (const entry of batch) {
          try {
            const singleRaw = await modelCall({
              stage: "abstract",
              prompt: buildTriagePrompt(entry),
              entry,
            });
            const singleParsed = safeParseTriageJson(singleRaw);
            results.set(entry.arxiv_id, normalizeTriageOutput(singleParsed, entry));
          } catch (singleErr) {
            results.set(entry.arxiv_id, { error: singleErr });
          }
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, batches.length);
  await Promise.all(Array.from({ length: workerCount }, () => batchWorker()));

  return results;
}
