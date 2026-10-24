import test from "node:test";
import assert from "node:assert/strict";
import {
  SCIENTIFIC_TAGS,
  TRANSIENT_IDENTIFIER_PATTERNS,
  extractTransientIdentifiers,
  matchScientificTags,
  DETERMINISTIC_SKIP_RULES,
  ASTROPHYSICS_SYSTEM_PROMPT,
  formatAnnouncementInBeijing,
  parseTransientEpoch,
  normalizeStructuredClaim,
  deriveFigurePhysicalCore,
  formatWeekIdZh,
  formatWeekIdEn,
} from "../src/domain/academic-domain.mjs";

test("academic-domain: extractTransientIdentifiers parses standard transient names", () => {
  assert.ok(SCIENTIFIC_TAGS.length > 5);
  assert.ok(TRANSIENT_IDENTIFIER_PATTERNS.length > 3);
  const sample =
    "Follow-up of GRB 250419A and early optical observation of SN 2024ggi with AT2018hyz and FRB 20240114A. Also GW170817 and SGR 1935+2154.";
  const identifiers = extractTransientIdentifiers(sample);

  assert.ok(identifiers.includes("GRB 250419A"));
  assert.ok(identifiers.includes("SN 2024GGI"));
  assert.ok(identifiers.includes("AT 2018HYZ") || identifiers.includes("AT2018HYZ"));
  assert.ok(identifiers.includes("FRB 20240114A"));
  assert.ok(identifiers.includes("GW170817"));
  assert.ok(identifiers.includes("SGR 1935+2154"));
});

test("academic-domain: matchScientificTags matches relevant high-energy tags", () => {
  const item1 = {
    title: "Plasma lensing and Faraday rotation of a repeating fast radio burst source",
    analysis: {
      problem: "Dispersion and scattering environment in FRB 20240114A",
      result: "Constrains electron column density",
      reason: "Direct probe of magnetar circum-burst plasma",
    },
  };
  const tags1 = matchScientificTags(item1);
  assert.ok(tags1.includes("FRB"));
  assert.ok(tags1.includes("MAG"));

  const item2 = {
    title:
      "Relativistic jet propagation in a collapsar wind: afterglow modeling of a long gamma-ray burst",
    analysis: {
      problem: "Jet deceleration and shock acceleration in GRB afterglows",
      result: "Lorentz factor Gamma > 100",
      reason: "Constraints on relativistic energy injection",
    },
  };
  const tags2 = matchScientificTags(item2);
  assert.ok(tags2.includes("GRB"));
});

test("academic-domain: deterministic skip rules catch off-domain papers", () => {
  assert.equal(DETERMINISTIC_SKIP_RULES.length, 4);
  const epRule = DETERMINISTIC_SKIP_RULES.find((r) => r.categoryPrefix === "astro-ph.EP");
  assert.ok(epRule);
  assert.ok(
    epRule.keywords.test("Transmission spectroscopy of hot Jupiters with transit observation")
  );
  assert.ok(!epRule.keywords.test("Supernova shock breakout in dense CSM"));

  assert.ok(ASTROPHYSICS_SYSTEM_PROMPT.includes("高能瞬变天体物理"));
});

test("academic-domain: formatAnnouncementInBeijing maps US announcement dates to Beijing Time correctly", () => {
  const sun = formatAnnouncementInBeijing("2026-10-04", "Sun");
  assert.equal(sun.beijingDate, "2026-10-05");
  assert.equal(sun.shortDate, "10-05");
  assert.equal(sun.chineseWeekday, "周一");
  assert.match(sun.batchKicker, /周一监测批次/u);

  const thu = formatAnnouncementInBeijing("2026-10-01", "Thu");
  assert.equal(thu.beijingDate, "2026-10-02");
  assert.equal(thu.shortDate, "10-02");
  assert.equal(thu.chineseWeekday, "周五");

  const wed = formatAnnouncementInBeijing("2026-09-30", "Wed");
  assert.equal(wed.beijingDate, "2026-10-01");
  assert.equal(wed.shortDate, "10-01");
  assert.equal(wed.chineseWeekday, "周四");

  const tue = formatAnnouncementInBeijing("2026-09-29", "Tue");
  assert.equal(tue.beijingDate, "2026-09-30");
  assert.equal(tue.chineseWeekday, "周三");

  const mon = formatAnnouncementInBeijing("2026-09-28", "Mon");
  assert.equal(mon.beijingDate, "2026-09-29");
  assert.equal(mon.chineseWeekday, "周二");
});

test("academic-domain: parseTransientEpoch accurately extracts discovery/eruption year or date", () => {
  assert.equal(parseTransientEpoch("GW170817"), "2017-08-17");
  assert.equal(parseTransientEpoch("GRB 250419A"), "2025-04-19");
  assert.equal(parseTransientEpoch("GRB 221009A"), "2022-10-09");
  assert.equal(parseTransientEpoch("SN 2024ggi"), "2024");
  assert.equal(parseTransientEpoch("AT 2018hyz"), "2018");
  assert.equal(parseTransientEpoch("FRB 20201124A"), "2020-11-24");
  assert.equal(parseTransientEpoch("UNKNOWN"), null);
});

test("academic-domain: normalizeStructuredClaim does not truncate on em-dash compound terms or leave unclosed parentheses", () => {
  const text =
    "强一级相变虽可在静态质量—半径关系中产生同引力质量、不同半径的孪生星，但这些解是否能由超新星产生的PNS沿守恒重子质量的冷却轨迹形成？尤其需要区分引力质量孪生与重子质量孪生，以及稳定强子解对混合分支可达性的限制。";
  const claim = normalizeStructuredClaim(text, "研究课题");

  assert.doesNotMatch(
    claim.headline,
    /静态质量$/u,
    "Headline must not be truncated right at em-dash in '静态质量—半径关系'"
  );
  assert.doesNotMatch(
    claim.headline,
    /[（(][^）)]*$/u,
    "Headline must not have unclosed opening parenthesis"
  );
  assert.notEqual(claim.headline, "强一级相变虽可在静态质量");
  assert.ok(claim.headline.length <= 35, "Headline should be within 35 characters");
  assert.equal(claim.detailed_text, text);
});

test("academic-domain: formatWeekIdZh and formatWeekIdEn format week identifiers naturally", () => {
  assert.equal(formatWeekIdZh("2026-W42"), "2026 年第 42 周 (2026-W42)");
  assert.equal(formatWeekIdZh("2026-W05"), "2026 年第 5 周 (2026-W05)");
  assert.equal(formatWeekIdZh("2026-W42", { withCode: false }), "2026 年第 42 周");
  assert.equal(formatWeekIdZh(""), "");
  assert.equal(formatWeekIdZh(null), "");

  assert.equal(formatWeekIdEn("2026-W42"), "Week 42, 2026");
  assert.equal(formatWeekIdEn("2026-W05"), "Week 5, 2026");
});

test("academic-domain: deriveFigurePhysicalCore extracts explicit core or derives in paper context", () => {
  // 1. Explicit physical core takes precedence
  const explicitFig = {
    label: "Fig. 1",
    caption: "Figure 1: Evolution of magnetic field lines.",
    physical_core: "展示黑洞吸积盘中磁重联驱动非热电子注入的微观物理演化机制。",
  };
  assert.equal(
    deriveFigurePhysicalCore(explicitFig),
    "展示黑洞吸积盘中磁重联驱动非热电子注入的微观物理演化机制。"
  );

  // 2. Theoretical schematic
  const theoFig = {
    label: "Fig. 2",
    category: "theoretical",
    category_badge: "核心物理演化图",
    caption: "Figure 2: Schematic showing jet breakout through the stellar envelope.",
  };
  const core1 = deriveFigurePhysicalCore(theoFig);
  assert.equal(core1, "展示核心天体物理驱动机制、几何拓扑与理论演化模型架构。");

  // 3. Category priority: fitting takes precedence over caption mentioning 'model' or 'light curve'
  const fitFig = {
    label: "Fig. 4",
    category: "fitting",
    category_badge: "数据拟合与模型对比",
    caption: "Figure 4: Observed light curve and best-fit analytic model with residuals.",
  };
  const coreFit = deriveFigurePhysicalCore(fitFig);
  assert.equal(coreFit, "展示理论模型与实际观测数据的拟合对比及关键参数后验约束。");

  // 4. Grounded observational: sky localization map does not hallucinate light curves
  const skyMapFig = {
    category: "observational",
    caption: "Figure 1: Sky localization probability map.",
  };
  assert.equal(deriveFigurePhysicalCore(skyMapFig), "展示暂现源空间天区概率分布与天体物理定位。");

  // 5. Grounded observational: light curve
  const obsFig = {
    label: "Fig. 3",
    category: "observational",
    category_badge: "观测总体曲线/能谱",
    caption: "Figure 3: Multiband radio light curve showing temporal decay.",
  };
  assert.equal(deriveFigurePhysicalCore(obsFig), "展示暂现源多波段辐射光度与流量随时间演化行为。");

  // 6. Grounded observational: spectra
  const specFig = {
    category: "observational",
    caption: "Figure 5: Optical spectra and broadband spectral energy distribution.",
  };
  assert.equal(
    deriveFigurePhysicalCore(specFig),
    "展示天体物理辐射宽波段能谱 (SED) 与特征光谱结构。"
  );

  // 7. Empty or ungrounded figure returns empty string (fail-closed)
  assert.equal(deriveFigurePhysicalCore(null), "");
  assert.equal(deriveFigurePhysicalCore({}), "");
  assert.equal(deriveFigurePhysicalCore({ category: "unknown", caption: "random plot" }), "");
});
