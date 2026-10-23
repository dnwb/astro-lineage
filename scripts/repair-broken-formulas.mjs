/**
 * scripts/repair-broken-formulas.mjs
 *
 * Automated Model-Assisted Formula Repair System
 *
 * Detects any formulas in scientific text that fail KaTeX rendering and calls
 * the agent model to repair them into 100% compliant, standard KaTeX LaTeX,
 * strictly preserving physical and mathematical meaning.
 */

import {
  findInvalidFormulas,
  validateFormulaWithKatex,
} from "../src/domain/scientific-text/index.mjs";
import { callChatCompletion } from "./agent-core.mjs";

/**
 * Repairs broken LaTeX formulas in a given string using the model.
 * If all formulas are valid, returns text immediately without model calls.
 *
 * @param {string} text
 * @param {object} options
 * @param {Function} [options.chatCompletionFn]
 * @param {string} [options.model]
 * @returns {Promise<string>}
 */
export async function repairTextFormulasWithModel(
  text,
  { chatCompletionFn = callChatCompletion, model = "gemini-3.8-flash-high" } = {}
) {
  if (!text || typeof text !== "string") return text;
  const invalid = findInvalidFormulas(text);
  if (invalid.length === 0) return text;

  let currentText = text;
  for (const item of invalid) {
    const prompt = `你是一个 LaTeX 与 KaTeX 公式修复专家。以下公式在网页 KaTeX 渲染中报错：
原公式内容：${item.rawToken}
KaTeX 错误信息：${item.error}
上下文环境：${text.slice(0, 300)}

任务：请将原公式修复为 100% 兼容 KaTeX 的合法标准 LaTeX 数学公式。
要求：
1. 保持原公式的物理、数学与天文学含义完全一致。
2. 展开任何未知的非标准宏为标准符号（如 \\mathrm{...}、\\dot{...}、M_\\odot 等）。
3. 剥离任何 \\penalty、\\n 等非公式字符或非法转义。
4. 只输出修复后的纯公式内容本身（严禁包含外层 $、$$、\\[、\\] 定界符，不要有任何解释、前后缀或 Markdown 标记）。`;

    try {
      const response = await chatCompletionFn({
        prompt,
        systemPrompt:
          "你是一个严格的 LaTeX 公式修复程序。只输出修复后的纯公式内容，严禁输出任何多余字符。",
        model,
      });

      let repaired = String(response || "").trim();
      repaired = repaired.replace(/^```(?:latex|tex)?\s*/iu, "").replace(/\s*```$/u, "");
      repaired = repaired
        .replace(/^(\$\$|\$|\\\[|\\\()/, "")
        .replace(/(\$\$|\$|\\\]|\\\))$/, "")
        .trim();

      const verify = validateFormulaWithKatex(repaired, { display: item.display });
      if (verify.valid) {
        const delimiter = item.delimiter || (item.display ? "$$" : "$");
        const closing = item.closing || (item.display ? "$$" : "$");
        const oldTarget = item.fullMatch || `${delimiter}${item.rawToken}${closing}`;
        const newReplacement = `${delimiter}${repaired}${closing}`;
        // Use replacer function to avoid JavaScript `$$` replacement pattern evaluation
        currentText = currentText.replace(oldTarget, () => newReplacement);
      }
    } catch {
      // Keep original text on model failure
    }
  }

  return currentText;
}

/**
 * Repairs all formula-bearing fields in an AI analysis output object.
 *
 * @param {object} obj
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function repairScientificObjectFormulasWithModel(obj, options = {}) {
  if (!obj || typeof obj !== "object") return obj;

  const targetFields = ["title_zh", "result", "problem", "method", "reason", "research_progress"];
  for (const field of targetFields) {
    if (typeof obj[field] === "string" && obj[field].includes("$")) {
      obj[field] = await repairTextFormulasWithModel(obj[field], options);
    }
  }

  for (const arrayField of ["assumptions", "limits"]) {
    if (Array.isArray(obj[arrayField])) {
      for (let i = 0; i < obj[arrayField].length; i++) {
        if (typeof obj[arrayField][i] === "string" && obj[arrayField][i].includes("$")) {
          obj[arrayField][i] = await repairTextFormulasWithModel(obj[arrayField][i], options);
        }
      }
    }
  }

  return obj;
}
