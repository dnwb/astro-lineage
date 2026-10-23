import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenizeScientificText,
  expandAstrophysicsMacros,
  extractLatexMacros,
  expandAuthorMacros,
  sanitizeLatexForKaTeX,
  renderScientificHtml,
  renderScientificPlainText,
} from "../src/domain/scientific-text/index.mjs";

test("scientific-text: tokenizeScientificText accurately isolates inline and display math", () => {
  const sample =
    "在红移 $z \\sim 6$ 处，中心引擎释放能量：$$\\frac{dE}{dt} = L_0\\left(1 + \\frac{t}{t_0}\\right)^{-2}$$ 产生了强激波。";
  const tokens = tokenizeScientificText(sample);

  assert.equal(tokens.length, 5);
  assert.equal(tokens[0].kind, "text");
  assert.equal(tokens[0].value, "在红移 ");
  assert.equal(tokens[1].kind, "inline_math");
  assert.equal(tokens[1].value, "z \\sim 6");
  assert.equal(tokens[2].kind, "text");
  assert.equal(tokens[2].value, " 处，中心引擎释放能量：");
  assert.equal(tokens[3].kind, "display_math");
  assert.match(tokens[3].value, /\\frac\{dE\}\{dt\}/);
  assert.equal(tokens[4].kind, "text");
  assert.equal(tokens[4].value, " 产生了强激波。");
});

test("scientific-text: expandAstrophysicsMacros handles complex and nested author macros", () => {
  const expr = String.raw`kT_{\rm C} \simeq \Lambda kT_{\bb} \sim 10\,\mathrm{keV} \text{ and } \Rsph=(1.2--1.8)\times10^{3}\,\rg \text{ with } \DMCosmic{} + \DMHost{}`;
  const expanded = expandAstrophysicsMacros(expr);

  assert.doesNotMatch(expanded, /\\bb(?![A-Za-z])/);
  assert.doesNotMatch(expanded, /\\Rsph(?![A-Za-z])/);
  assert.doesNotMatch(expanded, /\\rg(?![A-Za-z])/);
  assert.doesNotMatch(expanded, /\\DMCosmic/);
  assert.doesNotMatch(expanded, /\\DMHost/);
  assert.match(expanded, /\\mathrm\{bb\}/);
  assert.match(expanded, /R_\{?\\mathrm\{sph\}\}?/);
});

test("scientific-text: renderScientificHtml outputs valid KaTeX visuals and semantic MathML", () => {
  const text = "观测测得磁场强度 $B \\sim 10^{15}\\,\\mathrm{G}$。";
  const html = renderScientificHtml(text);

  assert.match(html, /class="katex"/);
  assert.match(html, /<math\b/);
  assert.match(html, /<annotation encoding="application\/x-tex">/);
  assert.doesNotMatch(html, /reader-math-error/);
});

test("scientific-text: renderScientificPlainText produces crisp Unicode text for Channel and Bot without dropping measurements", () => {
  const text =
    "在 $T \\lesssim 10^7\\,\\mathrm{K}$ 与 $M \\sim 1.4\\,M_\\odot$ 条件下，释放 $E \\approx 10^{51}\\,\\mathrm{erg}$。";
  const plain = renderScientificPlainText(text);

  assert.doesNotMatch(plain, /\$/);
  assert.match(plain, /≲/);
  assert.match(plain, /~/);
  assert.match(plain, /≈/);
  assert.match(plain, /1\.4\s*M⊙/);
  assert.match(plain, /10\^\{?51\}?\s*erg/);
});

test("scientific-text: extractLatexMacros accurately parses author macros with balanced braces", () => {
  const sampleTex = `
\\documentclass{aastex631}
\\newcommand{\\moperyear}{M_\\odot\\,\\mathrm{yr}^{-1}}
\\newcommand\\lstar{L_\\star}
\\renewcommand{\\wrap}[0]{{\\rm wrap}}
\\def\\ant{{\\rm ant}}
\\def\\rec{{\\rm rec}}
\\DeclareMathOperator{\\sinc}{sinc}
% parameterized macro that should be ignored
\\newcommand{\\myfrac}[2]{\\frac{#1}{#2}}
\\begin{document}
Body
\\end{document}
`;

  const macros = extractLatexMacros(sampleTex);
  assert.equal(macros.get("moperyear"), String.raw`M_\odot\,\mathrm{yr}^{-1}`);
  assert.equal(macros.get("lstar"), String.raw`L_\star`);
  assert.equal(macros.get("wrap"), String.raw`{\rm wrap}`);
  assert.equal(macros.get("ant"), String.raw`{\rm ant}`);
  assert.equal(macros.get("rec"), String.raw`{\rm rec}`);
  assert.equal(macros.get("sinc"), String.raw`\operatorname{sinc}`);
  assert.equal(macros.has("myfrac"), false);
});

test("scientific-text: expandAuthorMacros pre-expands author private macros in paper text", () => {
  const macros = new Map([
    ["moperyear", String.raw`M_\odot\,\mathrm{yr}^{-1}`],
    ["lstar", String.raw`L_\star`],
    ["wrap", String.raw`{\rm wrap}`],
  ]);

  const raw =
    "The mass loss is $2\\times 10^{-9}~\\moperyear$ with luminosity $\\lstar$ and timescale $t_\\wrap$.";
  const expanded = expandAuthorMacros(raw, macros);

  assert.equal(
    expanded,
    String.raw`The mass loss is $2\times 10^{-9}~M_\odot\,\mathrm{yr}^{-1}$ with luminosity $L_\star$ and timescale $t_{\rm wrap}$.`
  );
});

test("scientific-text: sanitizeLatexForKaTeX protects valid TeX commands while sanitizing artifacts", () => {
  // 1. Standard commands starting with \n must NOT be mangled
  const commands = [
    String.raw`\nu`,
    String.raw`\nabla`,
    String.raw`\neq`,
    String.raw`\notin`,
    String.raw`\natural`,
    String.raw`\nearrow`,
    String.raw`\neg`,
    String.raw`\niv`,
    String.raw`\niii`,
    String.raw`F_\nu \propto \nu^{-\alpha}`,
    String.raw`\nabla \times \mathbf{B}`,
    String.raw`A \neq B`,
    String.raw`x \notin S`,
  ];
  for (const cmd of commands) {
    assert.equal(sanitizeLatexForKaTeX(cmd), cmd, `Failed to protect command: ${cmd}`);
  }

  // 2. Stray JSON newline escapes (\n followed by non-letters) must be cleaned
  assert.equal(sanitizeLatexForKaTeX(String.raw`0.005-\n0.043`), String.raw`0.005- 0.043`);
  assert.equal(sanitizeLatexForKaTeX(String.raw`\n\frac{1}{2}`), String.raw` \frac{1}{2}`);
  assert.equal(sanitizeLatexForKaTeX(String.raw`E=mc^2\n+ 1`), String.raw`E=mc^2 + 1`);
  assert.equal(sanitizeLatexForKaTeX(String.raw`\n(a+b)`), String.raw` (a+b)`);
  assert.equal(sanitizeLatexForKaTeX(String.raw`\n{a+b}`), String.raw` {a+b}`);

  // 3. \penalty artifacts must be removed
  assert.equal(sanitizeLatexForKaTeX(String.raw`36\penalty\ \mu`), String.raw`36 \mu`);
  assert.equal(
    sanitizeLatexForKaTeX(String.raw`2.64\times 10^{21}\penalty 10000\ \mathrm{cm}^{-2}`),
    String.raw`2.64\times 10^{21} \mathrm{cm}^{-2}`
  );

  // 4. \left{ and \right} without backslash must be fixed
  assert.equal(sanitizeLatexForKaTeX(String.raw`\left{a,b\right}`), String.raw`\left\{a,b\right\}`);

  // 5. \rm{...} must be normalized to \mathrm{...}
  assert.equal(sanitizeLatexForKaTeX(String.raw`E_\rm{data}`), String.raw`E_{\mathrm{data}}`);
  assert.equal(sanitizeLatexForKaTeX(String.raw`\rm{max}`), String.raw`{\mathrm{max}}`);

  // 6. Bare underscores inside \texttt{...} must be escaped
  assert.equal(
    sanitizeLatexForKaTeX(String.raw`\texttt{source_id_test}`),
    String.raw`\texttt{source\_id\_test}`
  );
});
