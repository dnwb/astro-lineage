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

不得补写来源中没有的信息。需要输出原文中可逐字核对的短证据摘录和对应实际章节标题；无法判断的字段写 unknown。所有论文事实都要能由给定材料支持。

【数学物理与核心公式呈现要求】：
对于理论推导、辐射机制、数值解或观测标度律论文，凡原文能用公式或标度关系更清晰呈现物理本质的内容（如光度 $L_{\\rm iso}$、特征时延 $t_{\\rm delay} \\propto \\nu^{-2}$、辐射效率 $\\eta$、临界磁场 $B$、洛伦兹因子 $\\Gamma$、质量损失率 $\\dot{M}$、能谱指数 $\\alpha, \\beta$ 等），在 result、method、research_progress 等研读字段中必须优先以标准 LaTeX 行内公式（如 $...$）或块级公式（$$...$$）精准呈现，切忌用模糊笼统的定性文字替代清晰的数学物理表述。注意在输出 JSON 字符串时反斜杠必须做合法转义（如 $\\\\nu$, $\\\\times$, \\\\mathrm{...}）。`;

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

/**
 * 5. Structured Scientific Claim Normalization
 * 
 * Splits scientific claims (result, problem, method) into crisp headlines (titles)
 * and comprehensive body descriptions, ensuring sharp visual demarcation between
 * headings and narrative content.
 */
export function normalizeStructuredClaim(claimInput, fallbackCategory = "结论") {
  if (!claimInput) {
    return {
      headline: `未记录${fallbackCategory}`,
      bluf: `未能从已检查材料中获得${fallbackCategory}。`,
      detailed_text: `未能从已检查材料中获得${fallbackCategory}。`,
    };
  }

  if (typeof claimInput === "object" && !Array.isArray(claimInput)) {
    const headline = typeof claimInput.headline === "string" && claimInput.headline.trim() !== ""
      ? claimInput.headline.trim()
      : (typeof claimInput.bluf === "string" ? claimInput.bluf.slice(0, 35) : `核心${fallbackCategory}`);
    const bluf = typeof claimInput.bluf === "string" && claimInput.bluf.trim() !== ""
      ? claimInput.bluf.trim()
      : (typeof claimInput.detailed_text === "string" ? claimInput.detailed_text : headline);
    const detailed_text = typeof claimInput.detailed_text === "string" && claimInput.detailed_text.trim() !== ""
      ? claimInput.detailed_text.trim()
      : (typeof claimInput.result === "string" ? claimInput.result : bluf);

    return {
      headline,
      bluf,
      detailed_text,
      evidence_locator: claimInput.evidence_locator || claimInput.locator || undefined,
    };
  }

  // If claimInput is a legacy string:
  const text = String(claimInput).trim();
  if (!text || text === "unknown" || text.startsWith("未能从已检查材料")) {
    return {
      headline: `未形成${fallbackCategory}`,
      bluf: text || `未能从已检查材料中核实${fallbackCategory}。`,
      detailed_text: text || `未能从已检查材料中核实${fallbackCategory}。`,
    };
  }

  // Check if there's an explicit separator: "模型总结：...", "突破点：..."
  const separatorMatch = text.match(/^([^：:——–—\n]{4,30})[：:——–—]\s*(.+)$/su);
  if (separatorMatch) {
    return {
      headline: separatorMatch[1].trim(),
      bluf: separatorMatch[2].trim(),
      detailed_text: text,
    };
  }

  // Extract first sentence or first clause as headline
  const sentenceMatch = text.match(/^([^。！？；;!\?\n]+[。！？；;!\?]?)/u);
  let headline = sentenceMatch ? sentenceMatch[1].trim() : text;

  if (headline.length > 35) {
    const commaMatch = headline.match(/^([^，,]+)/u);
    if (commaMatch && commaMatch[1].length >= 6 && commaMatch[1].length <= 32) {
      headline = commaMatch[1].trim();
    } else {
      headline = headline.slice(0, 32) + "...";
    }
  }

  return {
    headline,
    bluf: sentenceMatch ? sentenceMatch[1].trim() : text,
    detailed_text: text,
  };
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
  if (raw.includes("\n- ") || raw.includes("\n* ") || raw.startsWith("- ") || raw.startsWith("* ")) {
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
  const lastMatch = remainder.match(/([^。！？\n]*(?:筛选|推荐|主线|未入选|不作为|整体上)[^。！？\n]*[。！？]?)$/);
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
