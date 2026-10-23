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
 * 5. renderScientificMarkdownWithMath: Unified Markdown + KaTeX rendering with MathML support.
 * 6. renderInlineScientificMarkdownWithMath: Single-line markdown + math without wrapping <p>.
 */

import katex from "katex";
import { micromark } from "micromark";

export const ASTRO_LATEX_MACROS = [
  // =========================================================================
  // 1. AASTeX, MNRAS, IAU, SIunitx & Standard Physics Package Macros
  // =========================================================================
  [/\\betag(?![A-Za-z])/gu, "\\boldsymbol{\\beta}"],
  [/\\Pvec(?![A-Za-z])/gu, "\\mathbf{P}"],
  [/\\Msun(?![A-Za-z])/gu, "M_\\odot"],
  [/\\msun(?![A-Za-z])/gu, "M_\\odot"],
  [/\\Msol(?![A-Za-z])/gu, "M_\\odot"],
  [/\\Rsun(?![A-Za-z])/gu, "R_\\odot"],
  [/\\Lsun(?![A-Za-z])/gu, "L_\\odot"],
  [/\\lsun(?![A-Za-z])/gu, "L_\\odot"],
  [/\\lstar(?![A-Za-z])/gu, "L_\\star"],
  [/\\MBH(?![A-Za-z])/gu, "M_{\\mathrm{BH}}"],
  [/\\Mbh(?![A-Za-z])/gu, "M_{\\mathrm{BH}}"],
  [/\\Mdot(?![A-Za-z])/gu, "\\dot{M}"],
  [/\\mdot(?![A-Za-z])/gu, "\\dot{m}"],
  [/\\Lbol(?![A-Za-z])/gu, "L_{\\mathrm{bol}}"],
  [/\\REdd(?![A-Za-z])/gu, "R_{\\mathrm{Edd}}"],
  [/\\LEdd(?![A-Za-z])/gu, "L_{\\mathrm{Edd}}"],
  [/\\Rs(?![A-Za-z])/gu, "R_{\\mathrm{s}}"],
  [/\\fdg(?![A-Za-z])/gu, "^{\\circ}\\mkern-3mu."],
  [/\\farcs(?![A-Za-z])/gu, "^{\\prime\\prime}\\mkern-4mu."],
  [/\\farcm(?![A-Za-z])/gu, "^{\\prime}\\mkern-3mu."],
  [/\\arcsec(?![A-Za-z])/gu, "^{\\prime\\prime}"],
  [/\\arcmin(?![A-Za-z])/gu, "^{\\prime}"],
  [/\\teff(?![A-Za-z])/gu, "T_{\\mathrm{eff}}"],
  [/\\thd(?![A-Za-z])/gu, "\\theta_{\\mathrm{d}}"],
  [/\\thr(?![A-Za-z])/gu, "\\theta_{\\mathrm{r}}"],
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
  [/\\mev(?![A-Za-z])/gu, "\\mathrm{MeV}"],
  [/\\keV(?![A-Za-z])/gu, "\\mathrm{keV}"],
  [/\\eV(?![A-Za-z])/gu, "\\mathrm{eV}"],
  [/\\solarmass(?![A-Za-z])/gu, "M_\\odot"],
  [/\\degrees(?![A-Za-z])/gu, "^{\\circ}"],
  [/\\degree(?![A-Za-z])/gu, "^{\\circ}"],
  [/\\DM(?![A-Za-z])/gu, "\\mathrm{DM}"],
  [/\\textsc\{([^}]+)\}/gu, (_, s) => `\\mathrm{${s.toUpperCase()}}`],
  [/\\avg\{([^}]+)\}/gu, "\\langle $1 \\rangle"],
  [/\\mbf\{([^}]+)\}/gu, "\\mathbf{$1}"],
  [/\\micro(?![A-Za-z])/gu, "\\mu"],
  [/\\dd(?![A-Za-z])/gu, "\\mathrm{d}"],
  [
    /\\qty\{([^}]+)\}\{([^}]+)\}/gu,
    (_, val, unit) => {
      const cleanUnit = unit.replace(/^\\/, "");
      return `${val}\\,\\mathrm{${cleanUnit}}`;
    },
  ],

  // =========================================================================
  // 2. Historical arXiv Fallback Macros (verified across src/data archives)
  // New papers expand author macros dynamically at acquisition time;
  // these ensure backward compatibility for committed static historical data.
  // =========================================================================
  [/\\moperyear(?![A-Za-z])/gu, "M_\\odot\\,\\mathrm{yr}^{-1}"],
  [/\\Le(?![A-Za-z])/gu, "L_{\\mathrm{e}}"],
  [/\\wrap(?![A-Za-z])/gu, "\\mathrm{wrap}"],
  [/\\ant(?![A-Za-z])/gu, "\\mathrm{ant}"],
  [/\\rec(?![A-Za-z])/gu, "\\mathrm{rec}"],
  [/\\niv(?![A-Za-z])/gu, "\\mathrm{N}\\,\\mathrm{IV}"],
  [/\\niii(?![A-Za-z])/gu, "\\mathrm{N}\\,\\mathrm{III}"],
  [/\\lpisl(?![A-Za-z])/gu, "\\ell_{\\mathrm{pisl}}"],
  [/\\Rmw(?![A-Za-z])/gu, "R_{\\mathrm{mw}}"],
  [/\\ffrbmw(?![A-Za-z])/gu, "f_{\\mathrm{frb,mw}}"],
  [/\\Rgap(?![A-Za-z])/gu, "R_{\\mathrm{gap}}"],
  [/\\Spix(?![A-Za-z])/gu, "S_{\\mathrm{pix}}"],
  [/\\Sscale(?![A-Za-z])/gu, "S_{\\mathrm{scale}}"],
  [/\\bb(?![A-Za-z])/gu, "{\\mathrm{bb}}"],
  [/\\DMCosmic(?:\{\})?/gu, "{\\mathrm{DM}_{\\mathrm{cosmic}}}"],
  [/\\DMHost(?:\{\})?/gu, "{\\mathrm{DM}_{\\mathrm{host}}}"],
  [/\\DMSI\{([^}]+)\}/gu, "$1\\,\\mathrm{pc}\\,\\mathrm{cm}^{-3}"],
  [/\\galfit(?:\{\})?/gu, "\\mathrm{GALFIT}"],
  [/\\ba(?![A-Za-z])/gu, "(b/a)"],
  [/\\Rsph(?![A-Za-z])/gu, "R_{\\mathrm{sph}}"],
  [/\\Ruv(?![A-Za-z])/gu, "R_{\\mathrm{uv}}"],
  [/\\rg(?![A-Za-z])/gu, "r_{\\mathrm{g}}"],
  [/\\betaUV(?![A-Za-z])/gu, "\\beta_{\\mathrm{UV}}"],
];

export function findMatchingBrace(text, startIdx) {
  if (text[startIdx] !== "{") return -1;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i++;
      continue;
    }
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function extractLatexMacros(source) {
  const macros = new Map();
  const text = String(source || "");

  const cmdRegex =
    /\\(?:(?:re|provide)?newcommand\*?|DeclareMathOperator\*?)\s*(?:\{?\\([A-Za-z]+)\}?|\s*\\([A-Za-z]+))/gu;
  for (const match of text.matchAll(cmdRegex)) {
    const name = match[1] || match[2];
    if (!name) continue;
    let cursor = match.index + match[0].length;
    const optArgMatch = text.slice(cursor).match(/^\s*\[(\d+)\]/);
    if (optArgMatch) {
      const arity = parseInt(optArgMatch[1], 10);
      cursor += optArgMatch[0].length;
      if (arity > 0) continue;
    }
    const braceStart = text.indexOf("{", cursor);
    if (braceStart === -1 || braceStart - cursor > 10) continue;
    const braceEnd = findMatchingBrace(text, braceStart);
    if (braceEnd !== -1 && !macros.has(name)) {
      const body = text.slice(braceStart + 1, braceEnd).trim();
      macros.set(name, match[0].includes("DeclareMathOperator") ? `\\operatorname{${body}}` : body);
    }
  }

  const defRegex = /\\def\s*\\([A-Za-z]+)\s*(?=[^{]*\{)/gu;
  for (const match of text.matchAll(defRegex)) {
    const name = match[1];
    if (!name) continue;
    let cursor = match.index + match[0].length;
    const between = text.slice(cursor, text.indexOf("{", cursor));
    if (/#\d/.test(between)) continue;
    const braceStart = text.indexOf("{", cursor);
    if (braceStart === -1 || braceStart - cursor > 20) continue;
    const braceEnd = findMatchingBrace(text, braceStart);
    if (braceEnd !== -1 && !macros.has(name)) {
      const body = text.slice(braceStart + 1, braceEnd).trim();
      macros.set(name, body);
    }
  }

  return macros;
}

export function expandAuthorMacros(source, macros) {
  if (!macros || (macros instanceof Map ? macros.size === 0 : Object.keys(macros).length === 0)) {
    return source;
  }
  let text = String(source || "");
  const entries = macros instanceof Map ? macros.entries() : Object.entries(macros);
  for (const [name, repl] of entries) {
    if (!name || !repl || repl.includes(`\\${name}`)) continue;
    const re = new RegExp(`\\\\${name}(?![A-Za-z])`, "gu");
    text = text.replace(re, repl);
  }
  return text;
}

export function sanitizeLatexForKaTeX(source) {
  let s = String(source || "");
  // 1. Remove TeX line-breaking penalties
  s = s.replace(/\\penalty(?:\\[\s]*|\s+-?\d+(?:\\[\s]*)?)/gu, " ");

  // 2. Remove stray JSON newline escapes inside math (\n followed by non-letters)
  // Preserves valid LaTeX commands like \nu, \nabla, \neq, \notin, \natural
  s = s.replace(/\\n(?![A-Za-z])/gu, " ");

  // 3. Fix unescaped left/right braces \left{ and \right}
  s = s.replace(/(^|[^\\])\\left\{/gu, "$1\\left\\{");
  s = s.replace(/(^|[^\\])\\right\}/gu, "$1\\right\\}");

  // 4. Fix \rm{...} -> \mathrm{...}
  s = s.replace(/_\\rm\{([^}]+)\}/gu, "_{\\mathrm{$1}}");
  s = s.replace(/\\rm\{([^}]+)\}/gu, "{\\mathrm{$1}}");

  // 5. Fix bare underscores in \texttt{...}
  s = s.replace(/\\texttt\{([^}]+)\}/gu, (_, c) => `\\texttt{${c.replace(/_/g, "\\_")}}`);

  return s;
}

export function expandAstrophysicsMacros(source) {
  let text = sanitizeLatexForKaTeX(source);
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
    tokens.push({
      kind: match.kind,
      value: content.trim(),
      display: match.display,
      delimiter: match.delimiter,
      closing: match.closing,
      fullMatch: source.slice(match.start, closing + match.closing.length),
    });
    cursor = closing + match.closing.length;
    textStart = cursor;
  }

  pushText(source.length);
  return tokens.length > 0 ? tokens : [{ kind: "text", value: source }];
}

export function escapeHtml(val) {
  return String(val)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Compile text containing Markdown syntax and LaTeX formulas into clean, accessible HTML.
 * Preserves math delimiters from being altered by the Markdown parser using placeholder protection.
 *
 * @param {string} source
 * @returns {string}
 */
export function renderScientificMarkdownWithMath(source) {
  if (!source) return "";
  const tokens = tokenizeScientificText(source);
  const mathPlaceholders = [];
  let protectedText = "";

  for (const token of tokens) {
    if (token.kind === "text") {
      protectedText += token.value;
    } else {
      const idx = mathPlaceholders.length;
      const placeholder = `%%%MATH_PLACEHOLDER_${idx}%%%`;
      const expanded = expandAstrophysicsMacros(token.value);
      let mathHtml;
      try {
        mathHtml = katex.renderToString(expanded, {
          displayMode: Boolean(token.display),
          output: "htmlAndMathml",
          strict: "ignore",
        });
      } catch {
        mathHtml = `<code class="math-raw">${escapeHtml(token.value)}</code>`;
      }
      mathPlaceholders.push({ placeholder, mathHtml });
      protectedText += placeholder;
    }
  }

  let html = micromark(protectedText);
  for (const item of mathPlaceholders) {
    html = html.replaceAll(item.placeholder, item.mathHtml);
  }
  return html;
}

/**
 * Render single-line markdown text with math, stripping outer <p>...</p> wrapper.
 *
 * @param {string} source
 * @returns {string}
 */
export function renderInlineScientificMarkdownWithMath(source) {
  const html = renderScientificMarkdownWithMath(source);
  return html.replace(/^<p>\s*([\s\S]*?)\s*<\/p>$/u, "$1");
}

/**
 * Compile a single LaTeX formula string into static KaTeX visual HTML and MathML.
 *
 * @param {string} source
 * @param {Object} [options]
 * @param {boolean} [options.display=false]
 * @returns {string}
 */
export function renderKatexFormula(source, { display = false } = {}) {
  const normalizedSource = expandAstrophysicsMacros(source);
  let markup = katex.renderToString(normalizedSource, {
    displayMode: display,
    output: "htmlAndMathml",
    throwOnError: true,
    trust: false,
    strict: "ignore",
  });
  if (!/<span\b[^>]*class=["']katex["'][\s\S]*<math\b[\s\S]*<\/math>/u.test(markup)) {
    throw new Error("TeX 未生成 KaTeX 和 MathML");
  }
  if (
    !/<semantics\b[\s\S]*<annotation\b[^>]*encoding=["']application\/x-tex["'][\s\S]*<\/annotation>/u.test(
      markup
    )
  ) {
    throw new Error("MathML 缺少原始 TeX annotation");
  }
  markup = markup.replace(
    /<annotation\b[^>]*encoding=["']application\/x-tex["'][^>]*>[\s\S]*?<\/annotation>/u,
    `<annotation encoding="application/x-tex">${escapeHtml(source)}</annotation>`
  );
  return markup;
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
        .replace(/\\(?:rm|bf|it|cal)\b\s*/gu, "")
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

export function validateFormulaWithKatex(source, { display = false } = {}) {
  try {
    renderKatexFormula(source, { display });
    return { valid: true, error: null };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function findInvalidFormulas(text) {
  const tokens = tokenizeScientificText(text);
  const invalid = [];
  for (const token of tokens) {
    if (token.kind === "inline_math" || token.kind === "display_math") {
      const check = validateFormulaWithKatex(token.value, { display: Boolean(token.display) });
      if (!check.valid) {
        invalid.push({
          rawToken: token.value,
          display: Boolean(token.display),
          error: check.error,
          delimiter: token.delimiter || (token.display ? "$$" : "$"),
          closing: token.closing || (token.display ? "$$" : "$"),
          fullMatch:
            token.fullMatch ||
            `${token.display ? "$$" : "$"}${token.value}${token.display ? "$$" : "$"}`,
        });
      }
    }
  }
  return invalid;
}
