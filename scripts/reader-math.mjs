import {
  normalizeLegacyTex as domainNormalizeLegacyTex,
  splitMath as domainSplitMath,
  renderMathMarkup as domainRenderMathMarkup,
} from "../src/domain/scientific-text/index.mjs";

export function normalizeLegacyTex(source) {
  return domainNormalizeLegacyTex(source);
}

export function splitMath(value) {
  return domainSplitMath(value);
}

export function renderMathMarkup(value, display = false) {
  return domainRenderMathMarkup(value, display);
}
