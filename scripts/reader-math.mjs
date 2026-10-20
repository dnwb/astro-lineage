import {
  ASTRO_LATEX_MACROS,
  expandAstrophysicsMacros,
  renderKatexFormula,
  escapeHtml,
} from "../src/domain/scientific-text/index.mjs";

const renderedMathCache = new Map();
const warnedMathFailures = new Set();

export { ASTRO_LATEX_MACROS };

export function normalizeLegacyTex(source) {
  return expandAstrophysicsMacros(source);
}

function mathErrorMarkup(source, reason) {
  const key = `${reason}\u0000${source}`;
  if (!warnedMathFailures.has(key)) {
    warnedMathFailures.add(key);
    console.warn(`[reader-math] ${reason}: ${source}`);
  }
  return `<span class="reader-math-error" data-math-status="error" role="img" aria-label="公式暂未渲染"><span class="reader-math-error-label">公式暂未渲染</span><code class="reader-math-source">${escapeHtml(source)}</code></span>`;
}

function isUnsafeMarkup(value) {
  return /<(?:script|iframe|object|embed|style)\b|\son[a-z-]+\s*=|javascript\s*:/iu.test(value);
}

function renderWithKatex(source, display) {
  try {
    const markup = renderKatexFormula(source, { display });
    if (isUnsafeMarkup(markup)) return mathErrorMarkup(source, "KaTeX 输出包含不安全标记");
    return markup;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return mathErrorMarkup(source, `KaTeX 转换失败：${detail}`);
  }
}

function findClosing(source, start, closing) {
  let cursor = start;
  while (cursor < source.length) {
    const found = source.indexOf(closing, cursor);
    if (found === -1) return -1;
    let backslashes = 0;
    for (let index = found - 1; index >= 0 && source[index] === "\\"; index -= 1) backslashes += 1;
    if (backslashes % 2 === 0) return found;
    cursor = found + closing.length;
  }
  return -1;
}

export function splitMath(value) {
  const source = String(value);
  const segments = [];
  let textStart = 0;
  let cursor = 0;
  const addText = (end) => {
    if (end > textStart) segments.push({ kind: "text", value: source.slice(textStart, end) });
  };

  while (cursor < source.length) {
    const candidates = [
      { delimiter: "$$", closing: "$$", display: true },
      { delimiter: "\\[", closing: "\\]", display: true },
      { delimiter: "\\(", closing: "\\)", display: false },
      { delimiter: "$", closing: "$", display: false },
    ]
      .map((candidate) => ({ ...candidate, start: source.indexOf(candidate.delimiter, cursor) }))
      .filter((candidate) => candidate.start !== -1)
      .sort((left, right) => left.start - right.start);
    const candidate = candidates[0];
    if (!candidate) break;
    if (candidate.delimiter === "$" && source[candidate.start + 1] === "$") {
      cursor = candidate.start + 2;
      continue;
    }
    const contentStart = candidate.start + candidate.delimiter.length;
    const closing = findClosing(source, contentStart, candidate.closing);
    const content = closing === -1 ? "" : source.slice(contentStart, closing);
    if (
      closing === -1 ||
      closing === contentStart ||
      (!candidate.display && content.includes("\n"))
    ) {
      cursor = contentStart;
      continue;
    }
    addText(candidate.start);
    segments.push({ kind: "math", value: content.trim(), display: candidate.display });
    cursor = closing + candidate.closing.length;
    textStart = cursor;
  }
  addText(source.length);
  return segments.length > 0 ? segments : [{ kind: "text", value: source }];
}

export function renderMathMarkup(value, display = false) {
  const source = String(value).trim();
  const cacheKey = `${display ? "display" : "inline"}\u0000${source}`;
  if (!renderedMathCache.has(cacheKey))
    renderedMathCache.set(cacheKey, renderWithKatex(source, display));
  return renderedMathCache.get(cacheKey);
}
