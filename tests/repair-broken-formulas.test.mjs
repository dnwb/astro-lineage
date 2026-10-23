import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFormulaWithKatex,
  findInvalidFormulas,
} from "../src/domain/scientific-text/index.mjs";
import {
  repairTextFormulasWithModel,
  repairScientificObjectFormulasWithModel,
} from "../scripts/repair-broken-formulas.mjs";

test("validateFormulaWithKatex correctly validates formulas and catches errors", () => {
  const ok = validateFormulaWithKatex("E = mc^2");
  assert.equal(ok.valid, true);
  assert.equal(ok.error, null);

  const fail = validateFormulaWithKatex(String.raw`\unknownMacroThatFails{123}`);
  assert.equal(fail.valid, false);
  assert.match(fail.error, /KaTeX parse error/);
});

test("findInvalidFormulas isolates only failing math tokens in mixed text", () => {
  const text =
    "这是有效公式 $L=4\\pi R^2\\sigma T^4$，而这是损坏公式 $\\badCommand{xyz}$ 和正常的 $$\\nu = c/\\lambda$$。";
  const invalid = findInvalidFormulas(text);

  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].rawToken, String.raw`\badCommand{xyz}`);
  assert.equal(invalid[0].display, false);
  assert.match(invalid[0].error, /Undefined control sequence/);
});

test("repairTextFormulasWithModel does not call model when all formulas are valid", async () => {
  let modelCalled = false;
  const text = "恒星引力势能释放 $E_{\\rm pot} \\approx GM^2/R$ 驱动激波。";
  const result = await repairTextFormulasWithModel(text, {
    chatCompletionFn: async () => {
      modelCalled = true;
      return "repaired";
    },
  });

  assert.equal(modelCalled, false);
  assert.equal(result, text);
});

test("repairTextFormulasWithModel calls model on invalid formula and replaces it after validation", async () => {
  let capturedPrompt = "";
  const text = "测得临界吸积半径 $\\badAccretionRadius{42}$。";
  const result = await repairTextFormulasWithModel(text, {
    chatCompletionFn: async ({ prompt }) => {
      capturedPrompt = prompt;
      return String.raw`R_{\rm acc} \approx 42\,\mathrm{km}`;
    },
  });

  assert.match(capturedPrompt, /\\badAccretionRadius\{42\}/);
  assert.equal(result, String.raw`测得临界吸积半径 $R_{\rm acc} \approx 42\,\mathrm{km}$。`);

  // Verify remaining text has no invalid formulas
  const remaining = findInvalidFormulas(result);
  assert.equal(remaining.length, 0);
});

test("repairTextFormulasWithModel safely rejects model response if repaired output is still invalid", async () => {
  const text = "受损公式 $\\badFormula{x}$。";
  const result = await repairTextFormulasWithModel(text, {
    chatCompletionFn: async () => {
      // Model returns another broken syntax
      return String.raw`\stillBrokenMacro{x}`;
    },
  });

  // Since repaired version is invalid, original text is safely preserved rather than corrupted
  assert.equal(result, text);
});

test("repairTextFormulasWithModel preserves display math $$ delimiters without JavaScript replace escape degradation", async () => {
  const text = "核心爆发机制满足如下连续方程：\n$$\\brokenEquation{rho,v}$$\n由此推导光变曲线。";
  const result = await repairTextFormulasWithModel(text, {
    chatCompletionFn: async () => {
      return String.raw`\frac{\partial \rho}{\partial t} + \nabla \cdot (\rho \mathbf{v}) = 0`;
    },
  });

  assert.match(
    result,
    /\$\$\s*\\frac\{\\partial \\rho\}\{\\partial t\} \+ \\nabla \\cdot \(\\rho \\mathbf\{v\}\) = 0\s*\$\$/,
    "Display math delimiters ($$) must not be collapsed to single dollar signs"
  );
  assert.doesNotMatch(result, /[^\$]\$\\frac/);
});

test("repairTextFormulasWithModel preserves bracket delimiters \\[...\\]", async () => {
  const text = "能量守恒：\\[\\brokenBracketEnergy{E}\\]。";
  const result = await repairTextFormulasWithModel(text, {
    chatCompletionFn: async () => {
      return String.raw`E_{\rm tot} = \gamma M c^2`;
    },
  });

  assert.equal(result, String.raw`能量守恒：\[E_{\rm tot} = \gamma M c^2\]。`);
});

test("repairScientificObjectFormulasWithModel repairs all target fields in an AI output object", async () => {
  const paperOutput = {
    title_zh: "具有 $\\brokenTitle{SN}$ 的超新星爆发",
    priority: "must_read",
    reason: "分类理由",
    result: "观测到能谱截止 $\\brokenCutoff{E}$。",
    problem: "待解决物理矛盾 $\\brokenConflict{\\nu}$。",
    method: "标准数值方法",
    research_progress: "unknown",
    assumptions: ["模型假设 $\\brokenAssumption{A}$。"],
    limits: ["适用限制 $\\brokenLimit{B}$。"],
  };

  const repaired = await repairScientificObjectFormulasWithModel(paperOutput, {
    chatCompletionFn: async ({ prompt }) => {
      if (prompt.includes("brokenTitle")) return String.raw`\mathrm{SN}`;
      if (prompt.includes("brokenCutoff")) return String.raw`E_{\rm cut} = 100\,\mathrm{MeV}`;
      if (prompt.includes("brokenConflict")) return String.raw`\nu_{\rm c} \propto B^{-1}`;
      if (prompt.includes("brokenAssumption")) return String.raw`A \ge 0`;
      if (prompt.includes("brokenLimit")) return String.raw`B \le 1`;
      return "1";
    },
  });

  assert.equal(repaired.title_zh, String.raw`具有 $\mathrm{SN}$ 的超新星爆发`);
  assert.equal(repaired.result, String.raw`观测到能谱截止 $E_{\rm cut} = 100\,\mathrm{MeV}$。`);
  assert.equal(repaired.problem, String.raw`待解决物理矛盾 $\nu_{\rm c} \propto B^{-1}$。`);
  assert.equal(repaired.assumptions[0], String.raw`模型假设 $A \ge 0$。`);
  assert.equal(repaired.limits[0], String.raw`适用限制 $B \le 1$。`);
});
