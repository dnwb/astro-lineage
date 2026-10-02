/**
 * src/domain/academic-domain.mjs
 * 
 * Domain-Driven Design (DDD) configuration layer for AstroLineage.
 * Decouples astrophysical taxonomy, prompt templates, deterministic triage filters,
 * and scientific transient event matching from runtime execution engines.
 */

// 1. Scientific Taxonomy & Phenomenon Tags
export const SCIENTIFIC_TAGS = [
  { id: "ALL", label: "全部", englishLabel: "All" },
  { id: "MUST_READ", label: "必读 ⭐", englishLabel: "Must Read" },
  { id: "WORTH_KNOWING", label: "关注 📌", englishLabel: "Worth Knowing" },
  { id: "FRB", label: "FRB 快速射电暴", englishLabel: "Fast Radio Burst", pattern: /\b(?:FRB|fast radio burst|plasma lens|法拉第|快速射电暴|等离子体透镜)\b/i },
  { id: "GRB", label: "GRB 伽马暴与喷流", englishLabel: "Gamma-Ray Burst & Jets", pattern: /\b(?:GRB|gamma[- ]ray burst|relativistic jet|afterglow|cocoon|collapsar|伽马暴|相对论喷流|余辉)\b/i },
  { id: "SN", label: "SN/CSM 超新星与星周介质", englishLabel: "Supernova & CSM", pattern: /\b(?:supernov[ae]|circumstellar|\bCSM\b|shock breakout|shock cooling|前身星|超新星|星周介质|激波突破)\b/i },
  { id: "GW", label: "GW 引力波与致密双星", englishLabel: "Gravitational Waves & Compact Objects", pattern: /\b(?:gravitational[- ]wave|kilonova|binary neutron star|neutron star merger|千新星|双中子星并合|引力波)\b/i },
  { id: "MAG", label: "磁星与脉冲星风", englishLabel: "Magnetars & Pulsars", pattern: /\b(?:magnetar|pulsar wind|intrabinary shock|spider pulsar|SGR|AXP|磁星|脉冲星风|蜘蛛脉冲星)\b/i },
  { id: "TDE", label: "TDE 潮汐瓦解", englishLabel: "Tidal Disruption Events", pattern: /\b(?:tidal disruption|\bTDE\b|潮汐瓦解|黑洞潮汐)\b/i },
  { id: "MULTI", label: "多信使与高能中微子", englishLabel: "Multi-Messenger & Neutrinos", pattern: /\b(?:neutrino|multi[- ]messenger|IceCube|高能中微子|多信使)\b/i },
];

// 2. Transient Observational Identifier Regexes (for Scientific Event Clustering)
export const TRANSIENT_IDENTIFIER_PATTERNS = [
  // GRBs: e.g. GRB 221009A, GRB 250419A, GRB230307A
  { type: "GRB", regex: /\b(GRB\s*\d{6}[A-Z]?)\b/gi },
  // Supernovae: e.g. SN 2024ggi, SN 1987A, SN 2023ixf
  { type: "SN", regex: /\b(SN\s*\d{4}[a-z]{1,4})\b/gi },
  // Astronomical Transients: e.g. AT 2024ggi, AT2018hyz, AT 2020mrf
  { type: "AT", regex: /\b(AT\s*\d{4}[a-z]{1,4})\b/gi },
  // Fast Radio Bursts: e.g. FRB 20240114A, FRB 20121102A, FRB 20190520B, FRB 20180916B
  { type: "FRB", regex: /\b(FRB\s*\d{6,8}[A-Z]?)\b/gi },
  // Gravitational Waves: e.g. GW170817, GW190425, GW230529
  { type: "GW", regex: /\b(GW\s*\d{6}[a-z]?)\b/gi },
  // Soft Gamma Repeaters: e.g. SGR 1935+2154, SGR 1806-20
  { type: "SGR", regex: /\b(SGR\s*\d{4}[+-]\d{2,4})\b/gi },
];

/**
 * Extract transient observational event names from text.
 * Returns normalized unique IDs, e.g. ["GRB 250419A", "SN 2024ggi"]
 */
export function extractTransientIdentifiers(text) {
  if (!text || typeof text !== "string") return [];
  const found = new Set();
  for (const { regex } of TRANSIENT_IDENTIFIER_PATTERNS) {
    const matches = text.matchAll(new RegExp(regex.source, regex.flags));
    for (const match of matches) {
      if (match[1]) {
        // Normalize whitespace e.g. "GRB  221009A" -> "GRB 221009A"
        const normalized = match[1].replace(/\s+/g, " ").toUpperCase();
        found.add(normalized);
      }
    }
  }
  return Array.from(found);
}

/**
 * Assign scientific tags to a paper item based on title, problem, and reason.
 */
export function matchScientificTags(item) {
  const analysisObj = item?.analysis?.analysis || item?.analysis || {};
  const text = [
    item?.title || "",
    analysisObj.problem || "",
    analysisObj.reason || "",
    analysisObj.result || "",
  ].join(" ");

  const tags = [];
  for (const tag of SCIENTIFIC_TAGS) {
    if (tag.pattern && tag.pattern.test(text)) {
      tags.push(tag.id);
    }
  }
  return tags;
}

// 3. System Prompt & Research Group Core Persona
export const ASTROPHYSICS_SYSTEM_PROMPT = `你是高能瞬变天体物理研究组的论文筛选与研读助手。研究兴趣包括 FRB/PRS 及其周围环境、超新星中心引擎、激波破越与周星介质相互作用、平台期、光电离与色散测量、相对论喷流、中微子及致密天体高能观测。

按研究效用判断相关性，不以“是否突破”作为唯一标准。增量观测、理论限制、方法改进和能检验研究假设的结果都可能有用。与上述方向无实质联系的工作应为 skip。输入中出现的教师优先论文只影响处理顺序，不能决定 priority。

不得补写来源中没有的信息。需要输出原文中可逐字核对的短证据摘录和对应实际章节标题；无法判断的字段写 unknown。所有论文事实都要能由给定材料支持。`;

// 4. Deterministic Triage Skip Rules
export const DETERMINISTIC_SKIP_RULES = [
  {
    categoryPrefix: "astro-ph.EP",
    keywords: /\b(?:exoplanets?|hot jupiters?|transit transmission|habitable zone|planetary atmospheres?|sub-neptunes?|protoplanetary disks?|asteroids?|meteoroids?|lunar surface|orbital debris)\b/i,
    reason: "论文属于行星科学、太阳系小天体或系外行星大气方向，与高能瞬变源（FRB、超新星、激波、喷流及致密天体）无实质联系。",
  },
  {
    categoryPrefix: "astro-ph.SR",
    keywords: /\b(?:helioseismology|solar corona|solar wind|sunspots?|solar cycle|chromosphere|solar active region)\b/i,
    reason: "论文属于太阳与日球物理观测方向，与高能瞬变天体物理及致密天体高能观测无实质联系。",
  },
  {
    categoryPrefix: "astro-ph.CO",
    keywords: /\b(?:baryon acoustic oscillations|cosmic microwave background|dark energy survey|weak lensing cosmic shear|dark matter halo mass function)\b/i,
    reason: "论文属于宇宙学大尺度结构与暗能量测量方向，与高能瞬变天体物理核心研究方向无实质联系。",
  },
  {
    categoryPrefix: "astro-ph.IM",
    keywords: /\b(?:wavefront sens(?:ing|or)|pointing accuracy|mirror alignment|cryogenic detector readout|fiber positioner|ccd flat[- ]fielding|calibration of the ccd)\b/i,
    reason: "论文属于望远镜工程、光学波前传感或硬件测试标定方向，与高能瞬变天体物理及致密天体研究无实质联系。",
  },
];
