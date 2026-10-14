/**
 * src/domain/scientific-text/index.mjs
 *
 * Deep Domain Module: Unified Scientific Math & Text AST Pipeline
 *
 * Provides:
 * 1. tokenizeScientificText: Robust state-machine isolating text, inline math ($...$), and display math ($$...$$ / \[...\]).
 * 2. expandAstrophysicsMacros: Declarative astrophysicist TeX macro expansion dictionary.
 * 3. renderScientificHtml: Static KaTeX HTML + accessible MathML output for Astro UI.
 * 4. renderScientificPlainText: Unicode-faithful degradation for QQ Channel titles, Bot cards, and plain-text feeds.
 */

import katex from "katex";

export const ASTRO_LATEX_MACROS = [
  [/\\betag(?![A-Za-z])/gu, "\\boldsymbol{\\beta}"],
  [/\\Pvec(?![A-Za-z])/gu, "\\mathbf{P}"],
  [/\\rm(?![A-Za-z])/gu, "\\mathrm"],
  [/\\bf(?![A-Za-z])/gu, "\\mathbf"],
  [/\\it(?![A-Za-z])/gu, "\\mathit"],
  [/\\cal(?![A-Za-z])/gu, "\\mathcal"],
  [/\\Msun(?![A-Za-z])/gu, "M_\\odot"],
  [/\\msun(?![A-Za-z])/gu, "M_\\odot"],
  [/\\Msol(?![A-Za-z])/gu, "M_\\odot"],
  [/\\Rsun(?![A-Za-z])/gu, "R_\\odot"],
  [/\\MBH(?![A-Za-z])/gu, "M_{\\mathrm{BH}}"],
  [/\\teff(?![A-Za-z])/gu, "T_{\\mathrm{eff}}"],
  [/\\thd(?![A-Za-z])/gu, "\\theta_{\\mathrm{d}}"],
  [/\\thr(?![A-Za-z])/gu, "\\theta_{\\mathrm{r}}"],
  [/\\lpisl(?![A-Za-z])/gu, "\\ell_{\\mathrm{pisl}}"],
  [/\\Rmw(?![A-Za-z])/gu, "R_{\\mathrm{mw}}"],
  [/\\ffrbmw(?![A-Za-z])/gu, "f_{\\mathrm{frb,mw}}"],
  [/\\Rgap(?![A-Za-z])/gu, "R_{\\mathrm{gap}}"],
  [/\\bk(?![A-Za-z])/gu, "\\mathbf{k}"],
  [/\\xx(?![A-Za-z])/gu, "\\mathbf{x}"],
  [/\\PP(?![A-Za-z])/gu, "\\mathbf{P}"],
  [/\\unit\{([^}]+)\}/gu, "\\mathrm{$1}"],
  [/\\e\{([^}]+)\}/gu, "\\times 10^{$1}"],
  [/\\Gyr(?![A-Za-z])/gu, "\\mathrm{Gyr}"],
  [/\\kpc(?![A-Za-z])/gu, "\\mathrm{kpc}"],
  [/\\kms(?![A-Za-z])/gu, "\\mathrm{km}\\,\\mathrm{s}^{-1}"],
  [/\\sigmam(?![A-Za-z])/gu, "\\sigma_{\\mathrm{m}}"],
  [/\\TeV(?![A-Za-z])/gu, "\\mathrm{TeV}"],
  [/\\GeV(?![A-Za-z])/gu, "\\mathrm{GeV}"],
  [/\\MeV(?![A-Za-z])/gu, "\\mathrm{MeV}"],
  [/\\keV(?![A-Za-z])/gu, "\\mathrm{keV}"],
  [/\\eV(?![A-Za-z])/gu, "\\mathrm{eV}"],
  [/\\Spix(?![A-Za-z])/gu, "S_{\\mathrm{pix}}"],
  [/\\Sscale(?![A-Za-z])/gu, "S_{\\mathrm{scale}}"],
  [/\\bb(?![A-Za-z])/gu, "{\\mathrm{bb}}"],
  [/\\degrees(?![A-Za-z])/gu, "^{\\circ}"],
  [/\\degree(?![A-Za-z])/gu, "^{\\circ}"],
  [/\\DMCosmic(?:\{\})?/gu, "{\\mathrm{DM}_{\\mathrm{cosmic}}}"],
  [/\\DMHost(?:\{\})?/gu, "{\\mathrm{DM}_{\\mathrm{host}}}"],
  [/\\DMSI\{([^}]+)\}/gu, "$1\\,\\mathrm{pc}\\,\\mathrm{cm}^{-3}"],
  [/\\galfit(?:\{\})?/gu, "\\mathrm{GALFIT}"],
  [/\\ba(?![A-Za-z])/gu, "(b/a)"],
  [/\\Rsph(?![A-Za-z])/gu, "R_{\\mathrm{sph}}"],
  [/\\Ruv(?![A-Za-z])/gu, "R_{\\mathrm{uv}}"],
  [/\\rg(?![A-Za-z])/gu, "r_{\\mathrm{g}}"],
  [/\\betaUV(?![A-Za-z])/gu, "\\beta_{\\mathrm{UV}}"],
  [/\\textsc\{([^}]+)\}/gu, (_, s) => `\\mathrm{${s.toUpperCase()}}`],
];

export function expandAstrophysicsMacros(source) {
  let text = String(source || "");
  for (const [pattern, replacement] of ASTRO_LATEX_MACROS) {
    text = text.replace(pattern, replacement);
  }
  return text
    .replace(/\\\\([A-Za-z]+)\b/gu, "\\$1")
    .replace(/\\(log|ln|exp|sin|cos|tan|max|min|lim|det)(?=[^A-Za-z\s])/gu, "\\$1 ");
}

function findClosingMath(source, start, closing) {
  let cursor = start;
  while (cursor < source.length) {
    const found = source.indexOf(closing, cursor);
    if (found === -1) return -1;
    let backslashes = 0;
    for (let i = found - 1; i >= 0 && source[i] === "\\"; i--) backslashes++;
    if (backslashes % 2 === 0) return found;
    cursor = found + closing.length;
  }
  return -1;
}

export function tokenizeScientificText(sourceText) {
  const source = String(sourceText || "");
  const tokens = [];
  let textStart = 0;
  let cursor = 0;

  const pushText = (end) => {
    if (end > textStart) {
      tokens.push({ kind: "text", value: source.slice(textStart, end) });
    }
  };

  while (cursor < source.length) {
    const candidates = [
      { delimiter: "$$", closing: "$$", display: true, kind: "display_math" },
      { delimiter: "\\[", closing: "\\]", display: true, kind: "display_math" },
      { delimiter: "\\(", closing: "\\)", display: false, kind: "inline_math" },
      { delimiter: "$", closing: "$", display: false, kind: "inline_math" },
    ]
      .map((c) => ({ ...c, start: source.indexOf(c.delimiter, cursor) }))
      .filter((c) => c.start !== -1)
      .sort((a, b) => a.start - b.start);

    const match = candidates[0];
    if (!match) break;

    // Avoid treating first $ in $$ as inline math
    if (match.delimiter === "$" && source[match.start + 1] === "$") {
      cursor = match.start + 2;
      continue;
    }

    const contentStart = match.start + match.delimiter.length;
    const closing = findClosingMath(source, contentStart, match.closing);
    const content = closing === -1 ? "" : source.slice(contentStart, closing);

    if (closing === -1 || closing === contentStart || (!match.display && content.includes("\n"))) {
      cursor = contentStart;
      continue;
    }

    pushText(match.start);
    tokens.push({ kind: match.kind, value: content.trim(), display: match.display });
    cursor = closing + match.closing.length;
    textStart = cursor;
  }

  pushText(source.length);
  return tokens.length > 0 ? tokens : [{ kind: "text", value: source }];
}

function escapeHtml(val) {
  return String(val)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderScientificHtml(textInput) {
  const tokens = tokenizeScientificText(textInput);
  return tokens
    .map((token) => {
      if (token.kind === "text") return escapeHtml(token.value);
      const display = Boolean(token.display);
      const expanded = expandAstrophysicsMacros(token.value);
      try {
        let markup = katex.renderToString(expanded, {
          displayMode: display,
          output: "htmlAndMathml",
          throwOnError: true,
          strict: "ignore",
        });
        // Annotate with exact source for fidelity and accessibility
        markup = markup.replace(
          /<annotation\b[^>]*encoding=["']application\/x-tex["'][^>]*>[\s\S]*?<\/annotation>/u,
          `<annotation encoding="application/x-tex">${escapeHtml(token.value)}</annotation>`
        );
        return markup;
      } catch (err) {
        return `<span class="reader-math-error" data-math-status="error" role="img" aria-label="公式暂未渲染"><span class="reader-math-error-label">公式暂未渲染</span><code class="reader-math-source">${escapeHtml(token.value)}</code></span>`;
      }
    })
    .join("");
}

export function renderScientificPlainText(textInput) {
  const tokens = tokenizeScientificText(textInput);
  return tokens
    .map((token) => {
      if (token.kind === "text") return token.value;
      let expr = expandAstrophysicsMacros(token.value);
      return expr
        .replace(/\\mathrm\{([^}]+)\}/gu, "$1")
        .replace(/\\mathbf\{([^}]+)\}/gu, "$1")
        .replace(/\\mathit\{([^}]+)\}/gu, "$1")
        .replace(/\\mathcal\{([^}]+)\}/gu, "$1")
        .replace(/\\text\{([^}]+)\}/gu, "$1")
        .replace(/\\boldsymbol\{([^}]+)\}/gu, "$1")
        .replace(/\\bm\{([^}]+)\}/gu, "$1")
        .replace(/\\lesssim\b/gu, "≲")
        .replace(/\\gtrsim\b/gu, "≳")
        .replace(/\\sim\b/gu, "~")
        .replace(/\\approx\b/gu, "≈")
        .replace(/\\simeq\b/gu, "≃")
        .replace(/\\pm\b/gu, "±")
        .replace(/\\times\b/gu, "×")
        .replace(/\\le\b|\\leq\b/gu, "≤")
        .replace(/\\ge\b|\\geq\b/gu, "≥")
        .replace(/\\ne\b|\\neq\b/gu, "≠")
        .replace(/\\propto\b/gu, "∝")
        .replace(/\\odot\b|_\\odot\b/gu, "⊙")
        .replace(/M_⊙/gu, "M⊙")
        .replace(/\\alpha\b/gu, "α")
        .replace(/\\beta\b/gu, "β")
        .replace(/\\gamma\b/gu, "γ")
        .replace(/\\Delta\b/gu, "Δ")
        .replace(/\\sigma\b/gu, "σ")
        .replace(/\\omega\b/gu, "ω")
        .replace(/\\pi\b/gu, "π")
        .replace(/\\nu\b/gu, "ν")
        .replace(/\\mu\b/gu, "μ")
        .replace(/\\,/gu, " ")
        .replace(/\\;/gu, " ")
        .replace(/\\:/gu, " ")
        .replace(/\\!/gu, "")
        .replace(/\\quad/gu, " ")
        .replace(/\\qquad/gu, " ")
        .replace(/\\left[()\[\]|.]/gu, "")
        .replace(/\\right[()\[\]|.]/gu, "")
        .trim();
    })
    .join("");
}
