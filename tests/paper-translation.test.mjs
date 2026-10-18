import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  cleanTitleZh,
  formatTranslatedPaperTitle,
  saveTranslationsCacheSync,
  resolvePaperTitleZhSync,
  resetTranslationMemoryCache,
} from "../scripts/paper-translation.mjs";

import {
  derivePaperTitleCandidate,
  formatPaperTitle,
  isTranslatedPaperTitle,
} from "../scripts/channel-title-policy.mjs";

test("cleanTitleZh removes book marks, quotes, trailing punctuation, and LaTeX", () => {
  assert.equal(
    cleanTitleZh("《超新星残骸中的磁流体动力学演化》"),
    "超新星残骸中的磁流体动力学演化"
  );
  assert.equal(cleanTitleZh('"快速射电暴的偏振机制探讨。"'), "快速射电暴的偏振机制探讨");
  assert.equal(
    cleanTitleZh("论文标题：关于 $L_{\\rm iso}$ 标度律的数值检验？"),
    "关于 L,iso 标度律的数值检验"
  );
});

test("formatTranslatedPaperTitle builds canonical [arxiv_id] title_zh format", () => {
  const formatted = formatTranslatedPaperTitle(
    "2610.13062",
    "宇宙线流中的非线性朗道阻尼效应与湍流作用"
  );
  assert.equal(formatted, "[2610.13062] 宇宙线流中的非线性朗道阻尼效应与湍流作用");

  // Normalizes arxiv: prefix
  const withPrefix = formatTranslatedPaperTitle("arxiv:2610.13062v2", "中子星潮汐形变限制");
  assert.equal(withPrefix, "[2610.13062] 中子星潮汐形变限制");

  // Throws on missing ID or content
  assert.throws(() => formatTranslatedPaperTitle("", "测试"), /CHANNEL_TITLE_ARXIV_ID_REQUIRED/u);
  assert.throws(
    () => formatTranslatedPaperTitle("2610.13062", ""),
    /CHANNEL_TITLE_PAPER_PROGRESS_REQUIRED/u
  );
});

test("formatPaperTitle accepts valid translated title and rejects uninformative bare ID", () => {
  assert.ok(isTranslatedPaperTitle("[2610.13062] 宇宙线流中的非线性朗道阻尼效应与湍流作用"));
  assert.equal(
    formatPaperTitle("[2610.13062] 宇宙线流中的非线性朗道阻尼效应与湍流作用"),
    "[2610.13062] 宇宙线流中的非线性朗道阻尼效应与湍流作用"
  );

  assert.ok(!isTranslatedPaperTitle("[2610.13062]"));
  assert.ok(!isTranslatedPaperTitle("[2610.13062] 论文更新"));
  assert.throws(() => formatPaperTitle("[2610.13062]"), /CHANNEL_TITLE_UNINFORMATIVE/u);
  assert.throws(() => formatPaperTitle("arXiv:2610.02653"), /CHANNEL_TITLE_UNINFORMATIVE/u);
});

test("resolvePaperTitleZhSync resolves title_zh from item, analysis, or cache", () => {
  resetTranslationMemoryCache();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-trans-test-"));
  const tmpCachePath = path.join(tmpDir, "translations.json");

  try {
    // 1. Direct item.title_zh
    const item1 = { arxiv_id: "2610.00001", title_zh: "直属中文标题" };
    assert.equal(resolvePaperTitleZhSync(item1, { cachePath: tmpCachePath }), "直属中文标题");

    // 2. Nested analysis.title_zh
    const item2 = {
      arxiv_id: "2610.00002",
      analysis: { title_zh: "来自Analysis的中文标题" },
    };
    assert.equal(
      resolvePaperTitleZhSync(item2, { cachePath: tmpCachePath }),
      "来自Analysis的中文标题"
    );

    // 3. Cache lookup
    saveTranslationsCacheSync({ 2610.00003: { title_zh: "来自缓存的中文标题" } }, tmpCachePath);
    const item3 = { arxiv_id: "2610.00003" };
    assert.equal(resolvePaperTitleZhSync(item3, { cachePath: tmpCachePath }), "来自缓存的中文标题");

    // 4. Missing returns null
    const item4 = { arxiv_id: "2610.00004" };
    assert.equal(resolvePaperTitleZhSync(item4, { cachePath: tmpCachePath }), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetTranslationMemoryCache();
  }
});

test("derivePaperTitleCandidate produces canonical [arxiv_id] title_zh when available and falls back cleanly", () => {
  resetTranslationMemoryCache();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-trans-test-"));
  const tmpCachePath = path.join(tmpDir, "translations.json");

  try {
    // Case A: Paper has title_zh
    const itemWithZh = {
      arxiv_id: "2610.13062",
      title_zh: "宇宙线流中的非线性朗道阻尼效应与湍流作用",
      analysis: {
        analysis: {
          problem: "宇宙线流朗道阻尼。",
          result: "证实了非线性阻尼效应。",
        },
      },
    };
    const titleA = derivePaperTitleCandidate(itemWithZh, { cachePath: tmpCachePath });
    assert.equal(titleA, "[2610.13062] 宇宙线流中的非线性朗道阻尼效应与湍流作用");

    // Case B: Paper in cache
    saveTranslationsCacheSync({ 2610.99999: "强磁化中子星地壳破裂模型" }, tmpCachePath);
    const itemInCache = {
      arxiv_id: "2610.99999",
      title: "Crust fracture in magnetars",
    };
    const titleB = derivePaperTitleCandidate(itemInCache, { cachePath: tmpCachePath });
    assert.equal(titleB, "[2610.99999] 强磁化中子星地壳破裂模型");

    // Case C: No translation available -> falls back to question/claim candidate
    const itemFallback = {
      title: "The blue supergiant collapsar progenitor of GRB 220627A",
      analysis: {
        analysis: {
          problem: "判断GRB 220627A是否来自蓝超巨星坍缩。",
          result: "模型支持蓝超巨星坍缩情景。",
        },
      },
    };
    const titleC = derivePaperTitleCandidate(itemFallback, { cachePath: tmpCachePath });
    assert.equal(titleC, "GRB 220627A是否来自蓝超巨星坍缩？");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetTranslationMemoryCache();
  }
});
