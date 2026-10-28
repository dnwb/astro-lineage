/**
 * src/domain/academic-domain.mjs
 *
 * Domain-Driven Design (DDD) configuration layer for AstroLineage.
 * Decouples astrophysical taxonomy, prompt templates, deterministic triage filters,
 * and scientific transient event matching from runtime execution engines.
 */

// 1. Scientific Taxonomy & Phenomenon Tags
export const SCIENTIFIC_TAGS = [
  { id: "ALL", label: "All", englishLabel: "All" },
  { id: "MUST_READ", label: "Must Read ⭐", englishLabel: "Must Read" },
  { id: "WORTH_KNOWING", label: "Followed 📌", englishLabel: "Followed" },
  {
    id: "FRB",
    label: "Fast Radio Burst",
    englishLabel: "Fast Radio Burst",
    pattern: /\b(?:FRB|fast radio burst|plasma lens|法拉第|快速射电暴|等离子体透镜)\b/i,
  },
  {
    id: "GRB",
    label: "Gamma-Ray Burst & Jets",
    englishLabel: "Gamma-Ray Burst & Jets",
    pattern:
      /\b(?:GRB|gamma[- ]ray burst|relativistic jet|afterglow|cocoon|collapsar|伽马暴|相对论喷流|余辉)\b/i,
  },
  {
    id: "SN",
    label: "Supernova & CSM",
    englishLabel: "Supernova & CSM",
    pattern:
      /\b(?:supernov[ae]|circumstellar|\bCSM\b|shock breakout|shock cooling|前身星|超新星|星周介质|激波突破)\b/i,
  },
  {
    id: "GW",
    label: "Gravitational Waves & Compact Objects",
    englishLabel: "Gravitational Waves & Compact Objects",
    pattern:
      /\b(?:gravitational[- ]wave|kilonova|binary neutron star|neutron star merger|千新星|双中子星并合|引力波)\b/i,
  },
  {
    id: "MAG",
    label: "Magnetars & Pulsars",
    englishLabel: "Magnetars & Pulsars",
    pattern:
      /\b(?:magnetar|pulsar wind|intrabinary shock|spider pulsar|SGR|AXP|磁星|脉冲星风|蜘蛛脉冲星)\b/i,
  },
  {
    id: "TDE",
    label: "Tidal Disruption Events",
    englishLabel: "Tidal Disruption Events",
    pattern: /\b(?:tidal disruption|\bTDE\b|潮汐瓦解|黑洞潮汐)\b/i,
  },
  {
    id: "MULTI",
    label: "Multi-Messenger & Neutrinos",
    englishLabel: "Multi-Messenger & Neutrinos",
    pattern: /\b(?:neutrino|multi[- ]messenger|IceCube|高能中微子|多信使)\b/i,
  },
];

export const TOPIC_FILTER_SPECS = [
  { id: "FRB", label: "Fast Radio Bursts (FRB)", short: "FRB", emoji: "⚡" },
  { id: "SN", label: "Supernovae & CSM (SN)", short: "SN / CSM", emoji: "💥" },
  { id: "GRB", label: "Gamma-Ray Bursts & Jets (GRB)", short: "GRB Jets", emoji: "🌌" },
  { id: "GW", label: "Gravitational Waves (GW)", short: "GW / Binaries", emoji: "🌊" },
  { id: "MAG", label: "Magnetars & Pulsars (MAG)", short: "Magnetars", emoji: "🧲" },
  { id: "TDE", label: "Tidal Disruption Events (TDE)", short: "TDE", emoji: "🕳️" },
  { id: "MULTI", label: "Multi-Messenger & Neutrinos", short: "Multi-Messenger", emoji: "🛰️" },
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
 * Parse observational discovery / trigger epoch from standard astronomical transient ID.
 * Returns formatted date string or year string, e.g. "2017-08-17", "2025-04-19", "2024", or null.
 */
export function parseTransientEpoch(eventId) {
  if (!eventId || typeof eventId !== "string") return null;
  const id = eventId.trim();
  let m = id.match(/^GW\s*(\d{2})(\d{2})(\d{2})/i);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  m = id.match(/^GRB\s*(\d{2})(\d{2})(\d{2})/i);
  if (m) return `${parseInt(m[1], 10) > 50 ? "19" : "20"}${m[1]}-${m[2]}-${m[3]}`;
  m = id.match(/^(?:SN|AT)\s*(\d{4})/i);
  if (m) return m[1];
  m = id.match(/^FRB\s*(\d{4}|\d{2})(\d{2})(\d{2})/i);
  if (m) {
    const yr = m[1].length === 4 ? m[1] : `${parseInt(m[1], 10) > 50 ? "19" : "20"}${m[1]}`;
    return `${yr}-${m[2]}-${m[3]}`;
  }
  return null;
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

不得补写来源中没有的信息。需要输出原文中可逐字核对的短证据摘录和对应实际章节标题；无法判断的字段写 unknown。所有论文事实都要能由给定材料支持。

【数学物理与核心公式呈现要求】：
对于理论推导、辐射机制、数值解或观测标度律论文，凡原文能用公式或标度关系更清晰呈现物理本质的内容（如光度 $L_{\\rm iso}$、特征时延 $t_{\\rm delay} \\propto \\nu^{-2}$、辐射效率 $\\eta$、临界磁场 $B$、洛伦兹因子 $\\Gamma$、质量损失率 $\\dot{M}$、能谱指数 $\\alpha, \\beta$ 等），在 result、method、research_progress 等研读字段中必须优先以标准 LaTeX 行内公式（如 $...$）或块级公式（$$...$$）精准呈现，切忌用模糊笼统的定性文字替代清晰的数学物理表述。注意在输出 JSON 字符串时反斜杠必须做合法转义（如 $\\\\nu$, $\\\\times$, \\\\mathrm{...}）。`;

// 4. Deterministic Triage Skip Rules
export const DETERMINISTIC_SKIP_RULES = [
  {
    categoryPrefix: "astro-ph.EP",
    keywords:
      /\b(?:exoplanets?|hot jupiters?|transit transmission|habitable zone|planetary atmospheres?|sub-neptunes?|protoplanetary disks?|asteroids?|meteoroids?|lunar surface|orbital debris)\b/i,
    reason:
      "论文属于行星科学、太阳系小天体或系外行星大气方向，与高能瞬变源（FRB、超新星、激波、喷流及致密天体）无实质联系。",
  },
  {
    categoryPrefix: "astro-ph.SR",
    keywords:
      /\b(?:helioseismology|solar corona|solar wind|sunspots?|solar cycle|chromosphere|solar active region)\b/i,
    reason: "论文属于太阳与日球物理观测方向，与高能瞬变天体物理及致密天体高能观测无实质联系。",
  },
  {
    categoryPrefix: "astro-ph.CO",
    keywords:
      /\b(?:baryon acoustic oscillations|cosmic microwave background|dark energy survey|weak lensing cosmic shear|dark matter halo mass function)\b/i,
    reason: "论文属于宇宙学大尺度结构与暗能量测量方向，与高能瞬变天体物理核心研究方向无实质联系。",
  },
  {
    categoryPrefix: "astro-ph.IM",
    keywords:
      /\b(?:wavefront sens(?:ing|or)|pointing accuracy|mirror alignment|cryogenic detector readout|fiber positioner|ccd flat[- ]fielding|calibration of the ccd)\b/i,
    reason:
      "论文属于望远镜工程、光学波前传感或硬件测试标定方向，与高能瞬变天体物理及致密天体研究无实质联系。",
  },
];

import {
  normalizeStructuredScientificClaim,
  extractDisplayTitle,
  cleanLatexMathInTitle,
  splitOutsideMath,
} from "./scientific-claim-title.mjs";

export {
  extractDisplayTitle,
  cleanLatexMathInTitle,
  splitOutsideMath,
  normalizeStructuredScientificClaim,
  normalizeStructuredScientificClaim as normalizeStructuredClaim,
};

/**
 * Synthesize or retrieve the specific physical core explanation of a scientific figure
 * in the context of the paper (e.g., core physical evolution, astrophysical image, observational SED/light curve).
 *
 * @param {Object} figure
 * @param {string} [figure.physical_core]
 * @param {string} [figure.physicalCore]
 * @param {string} [figure.category]
 * @param {string} [figure.category_badge]
 * @param {string} [figure.caption]
 * @param {Object} [context]
 * @param {string} [context.result]
 * @param {string} [context.problem]
 * @param {string[]} [context.assumptions]
 * @param {string[]} [context.limits]
 * @returns {string}
 */
export function deriveFigurePhysicalCore(figure, context = {}, options = {}) {
  if (!figure || typeof figure !== "object") return "";

  const explicit = (figure.physical_core || figure.physicalCore || "").trim();
  const badge = figure.category_badge || figure.categoryBadge || "";
  const rawCategory = figure.category || "";
  const caption = figure.caption || "";

  // Determine language:
  // If explicitly specified in options, use it.
  // Otherwise, if badge or explicit physical_core contains CJK, default to "zh".
  // Otherwise default to "en".
  let lang = typeof options === "string" ? options : options?.lang;
  if (!lang) {
    if (/[\u4e00-\u9fa5]/u.test(badge) || /[\u4e00-\u9fa5]/u.test(explicit)) {
      lang = "zh";
    } else {
      lang = "en";
    }
  }
  const isZh = lang === "zh";

  // 1. Explicit physical core annotation (from AI selector or review)
  if (explicit) {
    if (isZh) return explicit;
    // For English: if explicit has no CJK, use it directly!
    if (!/[\u4e00-\u9fa5]/u.test(explicit)) return explicit;
    // If explicit contains CJK and English was requested, derive English description below.
  }

  // 2. Resolve primary category: explicit category strictly takes precedence over badge and caption
  let primaryType = null;
  if (
    rawCategory === "fitting" ||
    rawCategory === "theoretical" ||
    rawCategory === "observational"
  ) {
    primaryType = rawCategory;
  } else if (/拟合|后验|残差|约束|fitting|posterior|residual|constraint/i.test(badge)) {
    primaryType = "fitting";
  } else if (
    /物理演化|模型示意|理论模型|几何结构|schematic|evolution|theoretical|geometry/i.test(badge)
  ) {
    primaryType = "theoretical";
  } else if (
    /观测|光变|能谱|图像|巡天|observational|light\s*curve|spectrum|sed|image/i.test(badge)
  ) {
    primaryType = "observational";
  } else {
    // Only infer from caption keywords when explicit category and badge are absent
    if (/\b(?:fitting|posterior|constraint|corner\s+plot|residuals?)\b/i.test(caption)) {
      primaryType = "fitting";
    } else if (
      /\b(?:light\s*curve|spectrum|spectra|sed|sky\s*map|flux|photometr|color-magnitude)\b/i.test(
        caption
      )
    ) {
      primaryType = "observational";
    } else if (
      /\b(?:schematic|geometry|evolution|mechanism|hydrodynamic|analytic\s+model)\b/i.test(caption)
    ) {
      primaryType = "theoretical";
    }
  }

  if (!primaryType) return "";

  // 3. Ground explanations strictly in the figure's concrete evidence (no unsupported paper-level claims)
  if (primaryType === "fitting") {
    return isZh
      ? "展示理论模型与实际观测数据的拟合对比及关键参数后验约束。"
      : "Comparison between theoretical models and observational data with posterior parameter constraints.";
  }

  if (primaryType === "theoretical") {
    return isZh
      ? "展示核心天体物理驱动机制、几何拓扑与理论演化模型架构。"
      : "Core astrophysical driving mechanism, geometry, and theoretical evolution model.";
  }

  if (primaryType === "observational") {
    // Discriminate observational evidence based on caption
    // Spatial / celestial localization (requires explicit sky/celestial cues, not mere statistical probability)
    if (
      /\b(?:sky\s*map|skymap|sky\s+localization|celestial|healpix|all-sky|mollweide)\b/i.test(
        caption
      ) ||
      /\b(?:right\s+ascension|declination|\bRA\b.*\bDec\b)\b/i.test(caption)
    ) {
      return isZh
        ? "展示暂现源空间天区概率分布与天体物理定位。"
        : "Spatial celestial probability distribution and astrophysical localization.";
    }

    // Temporal timing / Fourier power spectrum (PDS / QPO / oscillation frequency)
    if (
      /\b(?:power\s+spectrum|power\s+spectra|power\s+spectral\s+density|\bpds\b|periodogram|fourier\s+frequency|qpo|quasi-periodic)\b/i.test(
        caption
      )
    ) {
      return isZh
        ? "展示时域功率谱密度 (PDS) 与暂现源周期/准周期振荡 (QPO) 演化特征。"
        : "Power spectral density (PDS) and quasi-periodic oscillation (QPO) signatures.";
    }

    // Radiative energy spectrum / photon energy distribution / SED
    if (
      /\b(?:spectral\s+energy\s+distribution|\bsed\b|broadband\s+spectr\w*|energy\s+spectrum|energy\s+spectra|optical\s+spectr\w*|x-ray\s+spectr\w*|gamma-ray\s+spectr\w*|emission\s+line|absorption\s+line)\b/i.test(
        caption
      )
    ) {
      return isZh
        ? "展示天体物理辐射宽波段能谱 (SED) 与特征光谱结构。"
        : "Broadband spectral energy distribution (SED) and characteristic spectral structure.";
    }

    // Statistical distribution / sample population / histogram
    if (
      /\b(?:sample|population|distribution|histogram|scatter|correlation|fraction)\b/i.test(caption)
    ) {
      return isZh
        ? "展示观测样本的关键物理参量统计分布与总体特征对比。"
        : "Statistical distribution and comparative population properties of the sample.";
    }

    // Light curves / photometric evolution
    if (
      /\b(?:light\s*curve|photometr\w*|magnitude|flux\s+density|temporal\s+decay|outburst)\b/i.test(
        caption
      )
    ) {
      return isZh
        ? "展示暂现源多波段辐射光度与流量随时间演化行为。"
        : "Multi-wavelength photometric evolution and temporal light curves.";
    }

    // Spatial imaging / high-resolution morphology
    if (/\b(?:image|spatial|morphology|radio\s+map|slice|interferom\w*)\b/i.test(caption)) {
      return isZh
        ? "展示辐射源区的高分辨率成像形态与空间几何结构。"
        : "High-resolution morphology and spatial structure of the emission region.";
    }

    return isZh
      ? "展示天体物理观测数据与多波段暂现源探测特征。"
      : "Astrophysical observations and multi-wavelength transient signatures.";
  }

  return "";
}

/**
 * 6. Structured Executive Summary Parser
 *
 * Transforms dense paragraph weekly summaries into clear, structured components:
 * - lead: The core overarching causal/physical chain
 * - items: Array of domain breakdown bullet items ({ topic, body })
 * - boundary: Curation boundary, scope filtering, or concluding remarks
 */
export function parseStructuredExecutiveSummary(textInput) {
  if (!textInput) {
    return { lead: "", items: [], boundary: "" };
  }

  if (typeof textInput === "object" && !Array.isArray(textInput)) {
    return {
      lead: textInput.lead || "",
      items: Array.isArray(textInput.items) ? textInput.items : [],
      boundary: textInput.boundary || textInput.conclusion || "",
    };
  }

  const raw = String(textInput).trim();
  if (!raw) {
    return { lead: "", items: [], boundary: "" };
  }

  // Case 1: Markdown bullet list
  if (
    raw.includes("\n- ") ||
    raw.includes("\n* ") ||
    raw.startsWith("- ") ||
    raw.startsWith("* ")
  ) {
    const lines = raw.split("\n");
    let lead = "";
    const items = [];
    let boundary = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("> ") || trimmed.includes("筛选边界")) {
        boundary += (boundary ? " " : "") + trimmed.replace(/^>\s*/, "");
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        const itemText = trimmed.replace(/^[-*]\s*/, "");
        const match = itemText.match(/^\*\*([^*]+)\*\*[：:]\s*(.+)$/);
        if (match) {
          items.push({ topic: match[1].trim(), body: match[2].trim() });
        } else {
          items.push({ topic: "核心要点", body: itemText.trim() });
        }
      } else if (!items.length) {
        lead += (lead ? " " : "") + trimmed;
      } else {
        boundary += (boundary ? " " : "") + trimmed;
      }
    }
    return { lead, items, boundary };
  }

  // Case 2: Parse paragraph text into structured sections
  let lead = "";
  let remainder = raw;

  // First sentence is the lead
  const leadMatch = remainder.match(/^([^。！？\n]+[。！？])/);
  if (leadMatch) {
    lead = leadMatch[1].trim();
    remainder = remainder.slice(leadMatch[0].length).trim();
  }

  // Last sentence if it discusses screening/curation/boundary
  let boundary = "";
  const lastMatch = remainder.match(
    /([^。！？\n]*(?:筛选|推荐|主线|未入选|不作为|整体上)[^。！？\n]*[。！？]?)$/
  );
  if (lastMatch) {
    boundary = lastMatch[1].trim();
    remainder = remainder.slice(0, remainder.length - lastMatch[0].length).trim();
  }

  // Split remainder into sentences (by semicolon or period followed by domain start)
  const sentences = remainder
    .split(/(?<=[；;。！？\n])\s*/g)
    .map((s) => s.trim().replace(/[；;]$/, "。"))
    .filter(Boolean);

  const items = [];
  for (const sentence of sentences) {
    let topic = "";
    let body = sentence;

    if (/FRB|快速射电暴/i.test(sentence)) {
      topic = "⚡ 快速射电暴 (FRB)";
    } else if (/超新星|SN|CSM/i.test(sentence)) {
      topic = "💥 超新星与周星介质 (SNe & CSM)";
    } else if (/GRB|伽马暴|引力波|多信使|短暴/i.test(sentence)) {
      topic = "🔭 伽马暴与多信使 (GRBs & GW)";
    } else if (/千新星|TDE|脉冲星|致密星|磁星/i.test(sentence)) {
      topic = "🌟 致密天体爆发与观测支撑";
    } else {
      topic = "📌 前沿突破与理论进展";
    }

    items.push({ topic, body });
  }

  return { lead, items, boundary };
}

/**
 * Utilities for formatting arXiv announcement dates and times in Beijing Time (Asia/Shanghai, UTC+8).
 *
 * arXiv releases new announcements at 20:00 US Eastern Time (America/New_York) on Sun-Thu.
 * In Beijing Time (UTC+8), this corresponds to 08:00 (EDT) or 09:00 (EST) the NEXT calendar day (Mon-Fri).
 */
export function formatAnnouncementInBeijing(usDateStr, usWeekday) {
  if (!usDateStr || typeof usDateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(usDateStr)) {
    return {
      beijingDate: usDateStr || "",
      shortDate: usDateStr?.slice(5) || "",
      chineseWeekday: "周一",
      displayLabel: usDateStr || "",
      batchKicker: "监测批次",
      usDate: usDateStr || "",
      usWeekday: usWeekday || "",
    };
  }

  const [year, month, day] = usDateStr.split("-").map(Number);
  // Estimate UTC for 20:00 in America/New_York on usDateStr
  // At 20:00 EDT, UTC is 00:00 next day (UTC-4)
  // At 20:00 EST, UTC is 01:00 next day (UTC-5)
  const candidateUtc = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  const nyFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  });
  const nyHour = Number(nyFmt.format(candidateUtc));
  const announcementUtc =
    nyHour === 20 ? candidateUtc : new Date(Date.UTC(year, month - 1, day + 1, 1, 0, 0));

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(announcementUtc);

  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const beijingDate = `${p.year}-${p.month}-${p.day}`;
  const shortDate = `${p.month}-${p.day}`;

  const weekdayMap = {
    周日: "周日",
    周一: "周一",
    周二: "周二",
    周三: "周三",
    周四: "周四",
    周五: "周五",
    周六: "周六",
    Sun: "周日",
    Mon: "周一",
    Tue: "周二",
    Wed: "周三",
    Thu: "周四",
    Fri: "周五",
    Sat: "周六",
  };
  const englishWeekdayMap = {
    周日: "Sun",
    周一: "Mon",
    周二: "Tue",
    周三: "Wed",
    周四: "Thu",
    周五: "Fri",
    周六: "Sat",
    Sun: "Sun",
    Mon: "Mon",
    Tue: "Tue",
    Wed: "Wed",
    Thu: "Thu",
    Fri: "Fri",
    Sat: "Sat",
  };
  const rawWk = p.weekday || "";
  const chineseWeekday = rawWk.startsWith("周") ? rawWk : weekdayMap[rawWk] || `周${rawWk}`;
  const englishWeekday = englishWeekdayMap[rawWk] || rawWk;

  return {
    beijingDate,
    shortDate,
    chineseWeekday,
    englishWeekday,
    displayLabel: `${beijingDate} (${chineseWeekday})`,
    batchKicker: `${chineseWeekday}监测批次 · 截稿于 02:00`,
    usDate: usDateStr,
    usWeekday: usWeekday || "",
  };
}

/**
 * Format a Date or timestamp as Beijing Time string (YYYY-MM-DD HH:mm:ss, Asia/Shanghai, UTC+8).
 *
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} e.g. "2026/10/10 02:00:00"
 */
export function formatBeijingTimestamp(date = new Date()) {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/**
 * Get the Beijing Date string (YYYY-MM-DD, Asia/Shanghai, UTC+8) for any given timestamp.
 *
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} e.g. "2026-10-10"
 */
export function getBeijingDateString(date = new Date()) {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Calculate the ISO week identifier (e.g. "2026-W41") for a given date in Beijing Time (Asia/Shanghai, UTC+8).
 *
 * @param {Date|string|number} [dateInput=new Date()]
 * @returns {string} weekId
 */
export function getBeijingWeekId(dateInput = new Date()) {
  const d =
    typeof dateInput === "string" || typeof dateInput === "number"
      ? new Date(dateInput)
      : new Date(dateInput.getTime());

  const beijingStr = getBeijingDateString(d);
  const [year, month, day] = beijingStr.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

/**
 * Calculate the previous academic week ID (prior week in Beijing Time, e.g. for Monday 08:00 group broadcasts).
 *
 * @param {Date|string|number} [dateInput=new Date()]
 * @returns {string} weekId
 */
export function getPreviousAcademicWeekId(dateInput = new Date()) {
  const d =
    typeof dateInput === "string" || typeof dateInput === "number"
      ? new Date(dateInput)
      : new Date(dateInput.getTime());
  const lastWeekTime = d.getTime() - 7 * 86400000;
  return getBeijingWeekId(new Date(lastWeekTime));
}

/**
 * Calculate academic natural week bounds for an ISO week ID (e.g. "2026-W41").
 *
 * Natural calendar bounds: Monday to Sunday.
 * Academic announcement batches: [Sunday_prior, Monday, Tuesday, Wednesday, Thursday] (US Eastern announcement dates).
 *
 * @param {string} weekId
 */
export function getNaturalWeekBounds(weekId) {
  const [yearStr, weekStr] = weekId.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = (jan4.getUTCDay() + 6) % 7;
  const mondayWeek1 = new Date(jan4.valueOf() - day * 86400000);
  const mondayTarget = new Date(mondayWeek1.valueOf() + (week - 1) * 7 * 86400000);

  const announcementDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayTarget.valueOf() + i * 86400000);
    announcementDates.push(d.toISOString().slice(0, 10));
  }
  const sunday = announcementDates.at(-1);
  const sundayPrior = new Date(mondayTarget.valueOf() - 86400000).toISOString().slice(0, 10);
  const academicAnnouncementDates = [
    sundayPrior,
    announcementDates[0],
    announcementDates[1],
    announcementDates[2],
    announcementDates[3],
  ];
  return {
    monday: announcementDates[0],
    sunday,
    announcementDates,
    academicAnnouncementDates,
    dateRange: `${announcementDates[0]} ~ ${sunday}`,
  };
}

/**
 * Format ISO week ID (e.g. "2026-W42") into natural language Chinese.
 *
 * @param {string} weekId - e.g. "2026-W42" or "2026-W05"
 * @param {Object} [options]
 * @param {boolean} [options.withCode=false] - Whether to include the code e.g. " (2026-W42)"
 * @returns {string} e.g. "2026 年第 42 周" or "2026 年第 42 周 (2026-W42)"
 */
export function formatWeekIdZh(weekId, { withCode = true } = {}) {
  if (!weekId) return "";
  const match = String(weekId).match(/^(\d{4})-W(\d{1,2})$/i);
  if (!match) return String(weekId);
  const year = match[1];
  const weekNum = parseInt(match[2], 10);
  const zh = `${year} 年第 ${weekNum} 周`;
  return withCode ? `${zh} (${match[1]}-W${match[2]})` : zh;
}

/**
 * Format ISO week ID (e.g. "2026-W42") into natural English.
 *
 * @param {string} weekId
 * @returns {string} e.g. "Week 42, 2026"
 */
export function formatWeekIdEn(weekId) {
  if (!weekId) return "";
  const match = String(weekId).match(/^(\d{4})-W(\d{1,2})$/i);
  if (!match) return String(weekId);
  return `Week ${parseInt(match[2], 10)}, ${match[1]}`;
}

export const DEFAULT_CANONICAL_HOST = "10.131.43.83";
export const DEFAULT_CANONICAL_PORT = "4321";
export const DEFAULT_WEBSITE_BASE = `http://${DEFAULT_CANONICAL_HOST}:${DEFAULT_CANONICAL_PORT}`;
export const DEFAULT_PUBLIC_SITE_URL = "https://astro-lineage.pages.dev";

/**
 * Sanitize website base URL to strip localhost / 127.0.0.1 and trailing slashes.
 * Replaces localhost or loopback addresses with the canonical host.
 *
 * @param {string} [url]
 * @returns {string}
 */
export function sanitizeWebsiteBase(url) {
  if (!url) return DEFAULT_WEBSITE_BASE;
  return String(url)
    .replace("localhost", DEFAULT_CANONICAL_HOST)
    .replace("127.0.0.1", DEFAULT_CANONICAL_HOST)
    .replace(/\/+$/u, "");
}

/**
 * Get default sanitized website base from environment variables or canonical fallback.
 *
 * @returns {string}
 */
export function getDefaultWebsiteBase() {
  const envUrl =
    typeof process !== "undefined" && process?.env
      ? process.env.PUBLIC_SITE_URL || process.env.SITE_BASE_URL || process.env.ASTRO_SITE_URL
      : undefined;
  return sanitizeWebsiteBase(envUrl || DEFAULT_PUBLIC_SITE_URL);
}

/**
 * Get default sanitized local website base (intranet / LAN direct connect).
 *
 * @returns {string}
 */
export function getDefaultLocalWebsiteBase() {
  const envUrl =
    typeof process !== "undefined" && process?.env ? process.env.LOCAL_SITE_URL : undefined;
  return sanitizeWebsiteBase(envUrl || DEFAULT_WEBSITE_BASE);
}

/**
 * Resolve public and local website bases with option override support.
 *
 * @param {{ websiteBase?: string, localWebsiteBase?: string }} [options]
 * @returns {{ publicBase: string, localBase: string }}
 */
export function resolveWebsiteUrls(options = {}) {
  const publicBase = options.websiteBase
    ? sanitizeWebsiteBase(options.websiteBase)
    : getDefaultWebsiteBase();
  const localBase = options.localWebsiteBase
    ? sanitizeWebsiteBase(options.localWebsiteBase)
    : getDefaultLocalWebsiteBase();
  return { publicBase, localBase };
}

/**
 * Canonical bibliographic provider default ('scix').
 */
export const CANONICAL_BIBLIOGRAPHIC_PROVIDER = "scix";

/**
 * Get active bibliographic provider default.
 * Respects process.env.BIBLIOGRAPHIC_PROVIDER if set to a valid provider ('scix' | 'ads').
 *
 * @returns {'scix' | 'ads'}
 */
export function getDefaultBibliographicProvider() {
  const envProvider =
    typeof process !== "undefined" && process?.env?.BIBLIOGRAPHIC_PROVIDER?.trim()?.toLowerCase();
  if (envProvider === "ads" || envProvider === "scix") {
    return envProvider;
  }
  return CANONICAL_BIBLIOGRAPHIC_PROVIDER;
}

/**
 * Default bibliographic provider constant for backwards compatibility.
 * Supports 'scix' (NASA Science Explorer) and 'ads' (NASA ADS legacy).
 */
export const DEFAULT_BIBLIOGRAPHIC_PROVIDER = CANONICAL_BIBLIOGRAPHIC_PROVIDER;

/**
 * Default labels for bibliographic providers.
 */
export const BIBLIOGRAPHIC_PROVIDER_LABELS = {
  scix: "SciX (ADS)",
  ads: "NASA ADS",
};

/**
 * Resolve SciX forceMode from discipline context or category.
 *
 * @param {string | { category?: string, primary_category?: string, tags?: string[] }} [discipline]
 * @returns {string}
 */
export function resolveBibliographicDisciplineMode(discipline) {
  if (!discipline) return "astrophysics";
  if (typeof discipline === "string") {
    const d = discipline.toLowerCase().trim();
    if (d.startsWith("astro-ph.ep") || d === "planetary" || d === "earth") return "planetary";
    if (d.startsWith("physics.geo-ph") || d === "heliophysics") return "heliophysics";
    if (d.startsWith("physics.bio-ph") || d.startsWith("q-bio") || d === "biological")
      return "biological";
    return "astrophysics";
  }
  const cat = discipline.primary_category || discipline.category || "";
  return resolveBibliographicDisciplineMode(cat);
}

/**
 * Generate canonical external bibliographic URL for a paper.
 *
 * @param {string} arxivId - Normalized or raw arXiv ID (e.g. "2610.12345" or "arXiv:2610.12345v1")
 * @param {{ provider?: 'scix' | 'ads', forceMode?: string | null, discipline?: string | { category?: string, primary_category?: string, tags?: string[] } }} [options]
 * @returns {string}
 */
export function getBibliographicUrl(arxivId, options = {}) {
  if (!arxivId || typeof arxivId !== "string") return "";
  const cleanedId = arxivId.replace(/^arXiv:/i, "").trim();
  if (!cleanedId) return "";

  const provider = options.provider || getDefaultBibliographicProvider();
  const forceMode =
    options.forceMode !== undefined
      ? options.forceMode
      : provider === "scix"
        ? resolveBibliographicDisciplineMode(options.discipline)
        : null;

  if (provider === "ads") {
    return `https://ui.adsabs.harvard.edu/abs/arXiv:${cleanedId}`;
  }

  const baseUrl = `https://scixplorer.org/abs/arXiv:${cleanedId}`;
  if (forceMode) {
    return `${baseUrl}?forceMode=${encodeURIComponent(forceMode)}`;
  }
  return baseUrl;
}

/**
 * Get display label for external bibliographic provider link.
 *
 * @param {{ provider?: 'scix' | 'ads', short?: boolean }} [options]
 * @returns {string}
 */
export function getBibliographicSourceName(options = {}) {
  const provider = options.provider || getDefaultBibliographicProvider();
  if (options.short) {
    return provider === "scix" ? "SciX" : "ADS";
  }
  return BIBLIOGRAPHIC_PROVIDER_LABELS[provider] || "SciX (ADS)";
}
