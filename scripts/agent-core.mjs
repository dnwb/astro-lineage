#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

export function normalizeModelName(name) {
  if (!name) return "gpt-6-sol";
  const trimmed = String(name).trim();
  if (trimmed === "chatgpt-6-sol") return "gpt-6-sol";
  if (trimmed === "chatgpt-6-luna") return "gpt-6-luna";
  if (trimmed === "gemini-3.8-flash" || trimmed === "gemini3.8flash") return "gemini-3.8-flash-high";
  return trimmed;
}

export const SITE_BASE_URL = (process.env.SITE_BASE_URL || process.env.ASTRO_SITE_URL || "http://10.131.43.83:4321").replace(/\/+$/u, "");
export const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || process.env.CCNU_API_BASE || "https://api.ccnulaowu.online/v1";
export const DEFAULT_API_KEY = process.env.WU_API_KEY || process.env.OPENAI_API_KEY || "";
export const DEFAULT_MODEL = normalizeModelName(process.env.BOT_AI_MODEL || "gpt-6-sol");
export const DEFAULT_EFFORT = process.env.BOT_REASONING_EFFORT || "medium";

// 备用模型配置 (67 网关 / zhangioakey 供应商)
export const FALLBACK_BASE_URL = process.env.FALLBACK_OPENAI_BASE_URL || "http://67.230.191.212:8080/v1";
export const FALLBACK_API_KEY = process.env.FALLBACK_OPENAI_API_KEY || process.env.ZHANG_API_KEY || "sk-f87333ed82475d5e78f66bfcab9faaa24323b95c348a217b1316ed9cdfc4cae4";
export const FALLBACK_MODEL = normalizeModelName(process.env.FALLBACK_BOT_AI_MODEL || process.env.FALLBACK_AI_MODEL || "gemini-3.8-flash-high");

const RADAR_PATH = resolve(fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url)));
const WEEKLY_PATH = resolve(fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url)));
const FEED_PATH = resolve(fileURLToPath(new URL("../src/data/arxiv-daily.json", import.meta.url)));

export async function loadAcademicKnowledge() {
  let dailySummary = "";
  let weeklySummary = "";

  try {
    if (existsSync(FEED_PATH) && existsSync(RADAR_PATH)) {
      const feed = JSON.parse(await readFile(FEED_PATH, "utf8"));
      const radar = JSON.parse(await readFile(RADAR_PATH, "utf8"));
      const date = feed.window?.announcement_date || "最新";
      const entries = feed.entries || [];
      const mustRead = (radar.analyses || []).filter((a) => a.priority === "must_read");
      const worthKnowing = (radar.analyses || []).filter((a) => a.priority === "worth_knowing");

      let details = `【当前最新每日雷达批次 (${date})】：共收录 ${entries.length} 篇高能物理文献。必读 (${mustRead.length} 篇)，关注 (${worthKnowing.length} 篇)。`;
      if (mustRead.length > 0) {
        details += `\n- 重点必读：${mustRead.map(m => `arXiv:${m.arxiv_id} (${m.title || ""})`).join("; ")}`;
      }
      if (worthKnowing.length > 0) {
        details += `\n- 重点关注：${worthKnowing.map(m => `arXiv:${m.arxiv_id} (${m.title || ""})`).join("; ")}`;
      }
      if (mustRead.length === 0 && worthKnowing.length === 0 && entries.length > 0) {
        const samples = entries.slice(0, 5).map(e => `arXiv:${e.arxiv_id} 《${e.title}》[${e.primary_category || "astro-ph.HE"}]`);
        details += `\n- 研判情况：本批次文献经AI多信使爆发标准严格研判，未发现达到R1-R7核心主线必读门槛的爆发源专题；\n- 本期收录前沿文章样例：\n  * ${samples.join("\n  * ")}`;
      }
      dailySummary = details;
    }
  } catch {}

  try {
    if (existsSync(WEEKLY_PATH)) {
      const weekly = JSON.parse(await readFile(WEEKLY_PATH, "utf8"));
      weeklySummary = `【最新学术周报 (${weekly.week_id || "本周"})】：综述核心：${(weekly.executive_summary || "").slice(0, 200)}... 核心专题：${(weekly.thematic_highlights || []).map(t => t.theme_name).join("; ")}。`;
    }
  } catch {}

  return `
=== AstroLineage 课题组知识库与核心学术脉络 ===
课题组名称：AstroLineage（高能天体物理前沿文献与因果脉络研读平台）
校园网知识库主站：${SITE_BASE_URL}/
每日arXiv雷达：${SITE_BASE_URL}/arxiv-daily/
前沿学术周报：${SITE_BASE_URL}/arxiv-weekly/
自动化调度与运行机制：
- 抓取与研判日程：系统在【周一至周五北京时间上午 10:00】自动执行 arXiv 高能天体物理新论文抓取与 AI 深度研判（对应美东时间周日至周四晚 20:00 的 arXiv 公告批次）。
- 周报总结日程：每周五上午 10:00 抓取研判完成后，自动聚合当周所有批次产出【每周学术周报】。
- 周末规则：周六、周日美东 arXiv 官方休刊不发布新批次，系统相应保持展示最近一次工作日批次。

七大核心研究主线：
- R1: 中央引擎与能源机制（致密天体、吸积流与超长持续引擎）
- R2: 相对论喷流动力学与多信使辐射（喷流传播、激波、减速与破茧辐射）
- R3: 爆发源与致密星周介质相互作用（超新星与CSM激波破茧、光谱因果演化）
- R4: 多信使天体物理（引力波与高能中微子协同观测及物理推断）
- R5: 快速射电暴（FRB）物理与磁星动力学
- R6: 潮汐瓦解事件（TDE）动力学与暂现辐射
- R7: 千新星（Kilonova）辐射与快中子俘获核合成
重点经典文献与学习路径：
- Bromberg et al. 2011 (喷流在介质中传播与破茧机制)
- Zhang et al. 2024 (喷流在致密AGN星周介质中的减速、破裂与多信使产额)
- Zhu et al. 2021 (相对论流体力学破裂模拟)
- Long & Yu 2026 (动态多信使辐射预测)
- Arnett 1982 (Ia型与剥离包层超新星放射性衰变光变解析解)

${dailySummary}
${weeklySummary}
`;
}

export async function executeChatCompletion({ prompt, systemPrompt, history = [], model, effort, baseUrl, apiKey }) {
  const url = `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;
  const resolvedModel = normalizeModelName(model);

  const cleanHistory = Array.isArray(history)
    ? history.filter(h => h && h.role && h.content).slice(-10)
    : [];

  const payload = {
    model: resolvedModel,
    messages: [
      { role: "system", content: systemPrompt },
      ...cleanHistory,
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  };
  if (effort && resolvedModel.startsWith("gpt-6")) {
    payload.reasoning_effort = effort;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error HTTP ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty model response");
  return content.trim();
}

export async function callChatCompletion({ prompt, systemPrompt, history = [], model = DEFAULT_MODEL, effort = DEFAULT_EFFORT, baseUrl = DEFAULT_BASE_URL, apiKey = DEFAULT_API_KEY }) {
  try {
    return await executeChatCompletion({ prompt, systemPrompt, history, model, effort, baseUrl, apiKey });
  } catch (primaryErr) {
    console.warn(`[Agent Core] 主模型 ${model} 调用失败 (${primaryErr.message})，正在降级切换至备用供应商 (${FALLBACK_MODEL} @ ${FALLBACK_BASE_URL})...`);
    try {
      const fallbackResult = await executeChatCompletion({
        prompt,
        systemPrompt,
        history,
        model: FALLBACK_MODEL,
        effort: null,
        baseUrl: FALLBACK_BASE_URL,
        apiKey: FALLBACK_API_KEY,
      });
      console.log(`[Agent Core] ✓ 备用模型 (${FALLBACK_MODEL}) 成功生成解答`);
      return fallbackResult;
    } catch (fallbackErr) {
      console.error(`[Agent Core] ✗ 备用模型调用亦失败: ${fallbackErr.message}`);
      throw primaryErr;
    }
  }
}

/**
 * 统一的高能天体物理学术问答入口 (供 QQ 频道、QQ 群、CLI 等多端调用)
 */
export async function generateAcademicAnswer({
  query,
  topic = "学术研讨",
  contextSnippet = "",
  history = [],
  model = DEFAULT_MODEL,
  effort = DEFAULT_EFFORT,
}) {
  const knowledge = await loadAcademicKnowledge();

  const systemPrompt = `你是由前沿高能天体物理课题组打造的 AstroLineage 学术智能体（Research Agent）。
你正在学术讨论场景中解答读者/同行提出的文献、学术前沿与系统运行问题。
后台采用 ${model}（reasoning_effort=${effort}）思考架构，你需要给出严谨、深刻、兼具物理图像与学术前沿视角的回答。

${knowledge}

回答准则：
1. 学术严谨，直奔物理核心，符合高能天体物理科研人员学风。
2. 抓住核心动力学与多信使机制（如中心引擎注入、喷流相对论流体力学、激波破裂、辐射转移、光变曲线演化等）。
3. 当问到每日更新、系统日程、文献雷达时，根据上文知识库客观说明最新批次日期、收录篇数、分类情况及工作日自动运行日程。
4. 视情况推荐 AstroLineage 校园网平台页面（如 [AstroLineage 每日雷达](${SITE_BASE_URL}/arxiv-daily/) 或 [前沿学术周报](${SITE_BASE_URL}/arxiv-weekly/)），方便读者深入研读。
5. 控制回答长度适中（约 200~400 字以内），适合在即时通讯与论坛快速阅读。
6. 不需要精准礼貌称呼或刻意寒暄（严禁前置“@[某某]”、“尊敬的学者”、“你好”等套话），直接以科研同行讨论方式切入本质展开回答。
`;

  const userPrompt = `${topic ? `主题背景：${topic}\n` : ""}${contextSnippet ? `上下文片段：${contextSnippet}\n` : ""}讨论者提问：${query}

请作为 AstroLineage 智能体，直接给出清晰且有深度的回复，无需客套称呼。`;

  return await callChatCompletion({
    prompt: userPrompt,
    systemPrompt,
    history,
    model,
    effort,
  });
}
