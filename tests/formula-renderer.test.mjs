import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { renderMathMarkup, splitMath } from "../scripts/reader-math.mjs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("splitMath preserves intentional multi-line display equations", () => {
  assert.deepEqual(
    splitMath("前置 $$\\begin{aligned}\nE &= mc^2 \\\\\nF &= ma\n\\end{aligned}$$ 后置"),
    [
      { kind: "text", value: "前置 " },
      {
        kind: "math",
        value: "\\begin{aligned}\nE &= mc^2 \\\\\nF &= ma\n\\end{aligned}",
        display: true,
      },
      { kind: "text", value: " 后置" },
    ]
  );
  assert.deepEqual(
    splitMath(String.raw`前置 \[\begin{aligned}
E &= mc^2 \\
F &= ma
\end{aligned}\] 后置`),
    [
      { kind: "text", value: "前置 " },
      {
        kind: "math",
        value: String.raw`\begin{aligned}
E &= mc^2 \\
F &= ma
\end{aligned}`,
        display: true,
      },
      { kind: "text", value: " 后置" },
    ]
  );
});

test("renderMathMarkup emits static KaTeX visuals and semantic MathML for multi-line equations", () => {
  const markup = renderMathMarkup(
    String.raw`\begin{aligned} E_{\rm data} &= f_{\rm bol}L_{\rm X}\tau_{\rm obs} \\ \epsilon &= \frac{E_{\rm data}}{E_{\rm sh}} \end{aligned}`,
    true
  );
  assert.match(markup, /^<span class="katex-display"><span class="katex">/u);
  assert.match(markup, /<math\b[^>]*display="block"/u);
  assert.match(markup, /<semantics>[^]*<mtable\b/u);
  assert.match(markup, /<mtable\b/u);
  assert.match(markup, /<annotation encoding="application\/x-tex">/u);

  const semanticMath = markup.slice(markup.indexOf("<semantics>"), markup.indexOf("<annotation"));
  assert.doesNotMatch(semanticMath, /\\(?:begin|frac|rm|end)/u);
});

test("renderMathMarkup separates named operators from adjacent Unicode symbols", () => {
  const markup = renderMathMarkup(String.raw`-1.5 \lesssim \logξ\lesssim 1`, false);
  assert.match(markup, /<math\b/u);
  assert.match(markup, /<(?:mi|mo)(?: mathvariant="normal")?>log<\/(?:mi|mo)>/u);
  assert.match(markup, /<mi>ξ<\/mi>/u);
});

test("verified arXiv author macros render with their source definitions", () => {
  const markup = renderMathMarkup(
    String.raw`\betag_{\perp}=\hat{\mathbf{k}}\times\partial_t(p_x,p_y),\quad \Pvec=\mathbf{P}`,
    false
  );
  assert.match(markup, /<math\b/u);
  assert.doesNotMatch(markup, /reader-math-error/u);
  assert.match(markup, /mathvariant="bold-italic"/u);
  assert.match(markup, /<mi[^>]*mathvariant="bold">P<\/mi>/u);
  assert.match(markup, /<annotation encoding="application\/x-tex">\\betag/u);
});

test("renders astrophysics author macros (bb, degrees, DM, textsc, rg, Rsph)", () => {
  const cases = [
    String.raw`kT_{\rm C} \simeq \Lambda kT_{\bb} \sim 10\,\mathrm{keV}`,
    String.raw`M_{\rm ^{56}Ni} \approx 2.2~M_\odot`,
    String.raw`i=90\degrees`,
    String.raw`\DMCosmic{} + \DMHost{}`,
    String.raw`[\mathrm{O\,\textsc{iii}}]`,
    String.raw`\Rsph=(1.2--1.8)\times10^{3}\,\rg`,
    String.raw`\Ruv=(2.6--2.9)\times10^{3}\,\rg`,
    String.raw`\sim10^{3}\rg`,
    String.raw`\Delta\betaUV=+0.08`,
    String.raw`Y_\\nu=0`,
  ];
  for (const expr of cases) {
    const markup = renderMathMarkup(expr, false);
    assert.doesNotMatch(markup, /reader-math-error/u, `Expression failed to render: ${expr}`);
    assert.match(markup, /<math\b/u, `Expression missing math tag: ${expr}`);
  }
});

test("unsupported TeX is escaped and visibly marked as not rendered", () => {
  const markup = renderMathMarkup(
    String.raw`\unknownReaderMacro{<script>alert(1)</script>}`,
    false
  );
  assert.match(markup, /class="reader-math-error"/u);
  assert.match(markup, /公式暂未渲染/u);
  assert.match(markup, /\\unknownReaderMacro/u);
  assert.doesNotMatch(markup, /<script>/iu);
});

test("renderer emits static KaTeX visuals with one semantic MathML tree", () => {
  const markup = renderMathMarkup(String.raw`\frac{a}{b} + \alpha`, false);
  assert.match(markup, /class="katex"/u);
  assert.match(markup, /class="katex-mathml"/u);
  assert.match(markup, /<math[^>]*xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/u);
  assert.match(markup, /class="katex-html"[^>]*aria-hidden="true"/u);
  assert.ok(
    markup.includes(
      `<annotation encoding="application/x-tex">${String.raw`\frac{a}{b} + \alpha`}</annotation>`
    )
  );
});

test("real-world failure sample formulas render cleanly without reader-math-error", () => {
  const samples = [
    String.raw`0\fdg78`,
    String.raw`\left{|211\rangle,|322\rangle\right}`,
    String.raw`\Lbol`,
    String.raw`\REdd`,
    String.raw`\log(\Mbh/\Msun)=6.2\pm0.3`,
    String.raw`\Mdot_{\rm out}=3.1`,
    String.raw`\texttt{source_id}`,
    String.raw`L=50\mev`,
    String.raw`\log|{\rm EW}(\niv~\lambda4058)/{\rm EW}(\niii~\lambda4640)|`,
    String.raw`\simeq 0.005-\n0.043 M_{\odot}`,
    String.raw`36\penalty\ \mu`,
    String.raw`\farcs`,
    String.raw`\Rs`,
    String.raw`\avg{|B|}\,R^2`,
    String.raw`ε= B_{\perp,{\rm rms}}/\avg{B_\parallel}`,
    String.raw`T_{\rm sys}(\nu)=T_{\ant}(\nu)+T_{\rec}(\nu)`,
    String.raw`N_{\mathrm{H}}=2.64\times 10^{21}\penalty\ \mathrm{cm}^{-2}`,
    String.raw`\mbf{Y}\equiv(H_1, K, W, X)^T`,
    String.raw`\mdot`,
    String.raw`2\times10^{-9}~\moperyear`,
    String.raw`\log\left(\lstar/L_\odot\right)\approx4.5`,
    String.raw`\Lambda_{\rm LIV} = M_P/\eta = \qty{5.8e17}{\GeV}`,
    String.raw`\Delta \DM(t)`,
    String.raw`t_{\wrap} \sim 2.5\text{ 天}`,
    String.raw`\dd M/\dd\epsilon`,
    String.raw`8\penalty\ \micro`,
    String.raw`\Le\gtrsim1`,
    String.raw`E_\mathrm{GW} = \qty{e-2}{\solarmass}c^2`,
    String.raw`K_\rm{ep}`,
  ];
  for (const s of samples) {
    const markup = renderMathMarkup(s, false);
    assert.doesNotMatch(markup, /reader-math-error/u, `Failed to render: ${s}`);
  }
});

test("formula CSS uses local KaTeX assets and a bounded wide-equation viewport", async () => {
  const css = await readFile(join(projectRoot, "src/styles/global.css"), "utf8");
  const workflow = await readFile(join(projectRoot, ".github/workflows/verify.yml"), "utf8");
  assert.match(css, /@import\s+["']katex\/dist\/katex\.min\.css["']/u);
  assert.match(css, /\.reader-math\s*>\s*\.katex\s*\{/u);
  assert.match(
    css,
    /\.reader-math:not\(\.reader-math-display\)\s*\{[\s\S]*display:\s*inline/u
  );
  assert.match(
    css,
    /\.reader-math:not\(\.reader-math-display\)\s*>\s*\.katex\s*\{[\s\S]*line-height:\s*1/u
  );
  assert.match(css, /\.reader-math\s+\.katex-mathml\s*\{/u);
  assert.match(css, /\.reader-math-display\s*\{[\s\S]*overflow-x:\s*auto/u);
  assert.match(
    css,
    /\.reader-math-display\s*>\s*\.katex-display\s*\{[\s\S]*min-inline-size:\s*100%/u
  );
  assert.match(css, /\.reader-math-display:focus-visible\s*\{/u);
  assert.match(css, /@media print[\s\S]*\.reader-math-display\s*\{[\s\S]*overflow: visible/u);

  assert.doesNotMatch(workflow, /pandoc\/actions\/setup/u);
});
