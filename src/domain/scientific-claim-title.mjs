/**
 * Scientific Claim Title Normalization (Deep Module)
 *
 * Encapsulates:
 * - LaTeX math preservation during tokenization & splitting (splitOutsideMath)
 * - Bracket & parenthesis depth balance (stripping unclosed opening brackets)
 * - Clause dependency / conditional boundary recognition
 * - Compound noun protection (e.g. em-dash in "质量—半径关系")
 * - Trailing dangling punctuation and stop-word trimming
 *
 * Single Seam for both Web UI Reader Cards and External Channel / Bot publication.
 */

export function cleanLatexMathInTitle(text) {
  if (!text) return "";
  return String(text)
    .replace(/\\mathrm\{([^}]+)\}/gu, "$1")
    .replace(/\\mathbf\{([^}]+)\}/gu, "$1")
    .replace(/\\mathit\{([^}]+)\}/gu, "$1")
    .replace(/\\mathcal\{([^}]+)\}/gu, "$1")
    .replace(/\\text\{([^}]+)\}/gu, "$1")
    .replace(/\\rm\s+([A-Za-z0-9]+)/gu, "$1")
    .replace(/\\bm\{([^}]+)\}/gu, "$1")
    .replace(/\\boldsymbol\{([^}]+)\}/gu, "$1")
    .replace(/\\dot\{([^}]+)\}/gu, "$1̇")
    .replace(/\\ddot\{([^}]+)\}/gu, "$1̈")
    .replace(/\\tilde\{([^}]+)\}/gu, "$1̃")
    .replace(/\\hat\{([^}]+)\}/gu, "$1̂")
    .replace(/\\bar\{([^}]+)\}/gu, "$1̄")
    .replace(/\\vec\{([^}]+)\}/gu, "$1⃗")
    .replace(/\\pm\b/gu, "±")
    .replace(/\\times\b/gu, "×")
    .replace(/\\sim\b/gu, "~")
    .replace(/\\approx\b/gu, "≈")
    .replace(/\\propto\b/gu, "∝")
    .replace(/\\le\b|\\leq\b/gu, "≤")
    .replace(/\\ge\b|\\geq\b/gu, "≥")
    .replace(/\\ne\b|\\neq\b/gu, "≠")
    .replace(/\\ll\b/gu, "≪")
    .replace(/\\gg\b/gu, "≫")
    .replace(/\\odot\b/gu, "⊙")
    .replace(/\\ast\b/gu, "*")
    .replace(/\\star\b/gu, "★")
    .replace(/\\infty\b/gu, "∞")
    .replace(/\\circ\b/gu, "°")
    .replace(/\\alpha\b/gu, "α")
    .replace(/\\beta\b/gu, "β")
    .replace(/\\gamma\b/gu, "γ")
    .replace(/\\Gamma\b/gu, "Γ")
    .replace(/\\delta\b/gu, "δ")
    .replace(/\\Delta\b/gu, "Δ")
    .replace(/\\epsilon\b/gu, "ε")
    .replace(/\\zeta\b/gu, "ζ")
    .replace(/\\eta\b/gu, "η")
    .replace(/\\theta\b/gu, "θ")
    .replace(/\\Theta\b/gu, "Θ")
    .replace(/\\kappa\b/gu, "κ")
    .replace(/\\lambda\b/gu, "λ")
    .replace(/\\Lambda\b/gu, "Λ")
    .replace(/\\mu\b/gu, "μ")
    .replace(/\\nu\b/gu, "ν")
    .replace(/\\xi\b/gu, "ξ")
    .replace(/\\pi\b/gu, "π")
    .replace(/\\Pi\b/gu, "Π")
    .replace(/\\rho\b/gu, "ρ")
    .replace(/\\sigma\b/gu, "σ")
    .replace(/\\Sigma\b/gu, "Σ")
    .replace(/\\tau\b/gu, "τ")
    .replace(/\\phi\b/gu, "φ")
    .replace(/\\Phi\b/gu, "Φ")
    .replace(/\\chi\b/gu, "χ")
    .replace(/\\psi\b/gu, "ψ")
    .replace(/\\omega\b/gu, "ω")
    .replace(/\\Omega\b/gu, "Ω")
    .replace(/\\,/gu, " ")
    .replace(/\\;/gu, " ")
    .replace(/\\:/gu, " ")
    .replace(/\\!/gu, "")
    .replace(/\\quad/gu, " ")
    .replace(/\\qquad/gu, " ");
}

/**
 * Splits text outside LaTeX math environments ($...$) and matched parenthesis pairs.
 */
export function splitOutsideMath(text, pattern = /[，,]/u) {
  if (!text) return [];
  const normalized = cleanLatexMathInTitle(text);
  const parts = [];
  let inMath = false;
  let parenDepth = 0;
  let current = "";

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === "$" && (i === 0 || normalized[i - 1] !== "\\")) {
      inMath = !inMath;
      current += char;
      continue;
    }
    if (!inMath) {
      if (char === "(" || char === "（" || char === "[" || char === "【") parenDepth++;
      else if ((char === ")" || char === "）" || char === "]" || char === "】") && parenDepth > 0)
        parenDepth--;
    }
    const isThousandsComma =
      char === "," &&
      i > 0 &&
      i < normalized.length - 1 &&
      /\d/.test(normalized[i - 1]) &&
      /\d/.test(normalized[i + 1]);
    if (!inMath && parenDepth === 0 && !isThousandsComma && pattern.test(char)) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Trims unclosed brackets, trailing particles, dangling syntax characters, and LaTeX artifacts.
 */
export function cleanTitleArtifacts(str) {
  if (!str) return "";
  return String(str)
    .replace(/[（(][^）)]*$/u, "")
    .replace(/(?:在中|在|与|和|且|但|因|为|的)$/u, "")
    .replace(/[\$\\`~_^{}\\\/]+$/g, "")
    .trim();
}

/**
 * Checks if a clause is a dependent introductory condition rather than an independent assertion.
 */
export function isDependentIntroClause(str) {
  if (!str) return true;
  const chars = Array.from(str);
  if (chars.length < 12) return true;
  const isIntro =
    /^(?:若|如果|假设|当|在|从|基于|随着|针对|对于|根据|通过|由于|在线性|在不包含|在具有|在核燃烧)\b/u.test(
      str
    );
  const hasVerbOrFinding =
    /(?:能否|是否|如何|为何|产生|形成|主导|改变|解释|限制|约束|发现|给出|推断|演化|衰减|削弱|增强|模型|结构|特征|率|能量|喷流|超额|联系|双星)/u.test(
      str
    );
  return isIntro || !hasVerbOrFinding;
}

/**
 * Extract clean, high-density scientific display title within character limit.
 *
 * @param {string} rawTitle - Raw title or narrative claim
 * @param {object} [options]
 * @param {number} [options.maxLength=35]
 * @param {string} [options.fallbackCategory="结论"]
 * @returns {string} Clean, bounded display title
 */
export function extractDisplayTitle(rawTitle, { maxLength = 35, fallbackCategory = "结论" } = {}) {
  if (!rawTitle) return `未形成${fallbackCategory}`;
  let clean = cleanLatexMathInTitle(rawTitle);

  const DEPENDENT_LEAD =
    /^(?:若(?:该解释|上述|此)?成立|对比之下|相比之下|总体而言|研究表明|分析指出|计算显示|典型相关分析显示|味组成计算显示|作者提出(?:了)?|作者认为|给定正文摘要报告|正文报告(?:了)?|研究发现|结果显示|通过模拟)[，,:：]?\s*/u;
  clean = clean.replace(DEPENDENT_LEAD, "");

  if (Array.from(clean).length <= maxLength) {
    return cleanTitleArtifacts(clean);
  }

  const matchPrefix = clean.match(/^(「\d{2}-\d{2}」|\[\d{4}-W\d{2}\][^｜]*｜\s*)/u);
  const prefix = matchPrefix ? matchPrefix[0] : "";
  const body = clean.slice(prefix.length);

  const parts = splitOutsideMath(body, /[，,；;：:。]/u).filter(Boolean);
  if (
    parts.length > 1 &&
    !isDependentIntroClause(parts[0]) &&
    Array.from(prefix + parts[0]).length <= maxLength
  ) {
    return cleanTitleArtifacts(prefix + parts[0]);
  }

  if (
    parts.length > 1 &&
    isDependentIntroClause(parts[0]) &&
    parts[1] &&
    !isDependentIntroClause(parts[1]) &&
    Array.from(prefix + parts[1]).length <= maxLength
  ) {
    return cleanTitleArtifacts(prefix + parts[1]);
  }

  const maxBodyLen = maxLength - Array.from(prefix).length;
  const truncated = prefix + Array.from(body).slice(0, maxBodyLen).join("");
  return cleanTitleArtifacts(truncated);
}

/**
 * Normalizes a structured claim input (object or legacy narrative text)
 * into a crisp headline and detailed text.
 */
export function normalizeStructuredScientificClaim(claimInput, fallbackCategory = "结论") {
  if (!claimInput) {
    return {
      headline: `未记录${fallbackCategory}`,
      bluf: `未能从已检查材料中获得${fallbackCategory}。`,
      detailed_text: `未能从已检查材料中获得${fallbackCategory}。`,
    };
  }

  if (typeof claimInput === "object" && !Array.isArray(claimInput)) {
    const headline =
      typeof claimInput.headline === "string" && claimInput.headline.trim() !== ""
        ? cleanTitleArtifacts(claimInput.headline.trim())
        : typeof claimInput.bluf === "string"
          ? cleanTitleArtifacts(claimInput.bluf.slice(0, 35))
          : `核心${fallbackCategory}`;
    const bluf =
      typeof claimInput.bluf === "string" && claimInput.bluf.trim() !== ""
        ? claimInput.bluf.trim()
        : typeof claimInput.detailed_text === "string"
          ? claimInput.detailed_text
          : headline;
    const detailed_text =
      typeof claimInput.detailed_text === "string" && claimInput.detailed_text.trim() !== ""
        ? claimInput.detailed_text.trim()
        : typeof claimInput.result === "string"
          ? claimInput.result
          : bluf;

    return {
      headline,
      bluf,
      detailed_text,
      evidence_locator: claimInput.evidence_locator || claimInput.locator || undefined,
    };
  }

  const text = String(claimInput).trim();
  if (!text || text === "unknown" || text.startsWith("未能从已检查材料")) {
    return {
      headline: `未形成${fallbackCategory}`,
      bluf: text || `未能从已检查材料中核实${fallbackCategory}。`,
      detailed_text: text || `未能从已检查材料中核实${fallbackCategory}。`,
    };
  }

  // Check explicit title colon: "模型总结：...", "突破点: ..."
  const colonMatch = text.match(/^([^：:\n]{2,30})[：:]\s*(.+)$/su);
  if (colonMatch) {
    return {
      headline: cleanTitleArtifacts(colonMatch[1]),
      bluf: colonMatch[2].trim(),
      detailed_text: text,
    };
  }

  // Check explicit em-dash with whitespace separator: "核心结论 —— ..."
  const dashMatch = text.match(/^([^—–\n]{2,30})\s+(?:——|—|–)\s+(.+)$/su);
  if (dashMatch) {
    return {
      headline: cleanTitleArtifacts(dashMatch[1]),
      bluf: dashMatch[2].trim(),
      detailed_text: text,
    };
  }

  // Extract first sentence or first clause as headline
  const sentenceMatch = text.match(/^([^。！？；;!\?\n]+[。！？；;!\?]?)/u);
  let headline = sentenceMatch ? sentenceMatch[1].trim() : text;

  if (headline.length > 35) {
    const commaMatch = headline.match(/^([^，,]+)/u);
    if (commaMatch && commaMatch[1].length >= 6 && commaMatch[1].length <= 35) {
      headline = commaMatch[1].trim();
    } else {
      headline = headline.slice(0, 32) + "...";
    }
  }

  return {
    headline: cleanTitleArtifacts(headline),
    bluf: sentenceMatch ? sentenceMatch[1].trim() : text,
    detailed_text: text,
  };
}
