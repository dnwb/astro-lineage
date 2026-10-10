/**
 * scripts/pipeline-evidence-gate.mjs
 *
 * Evidence Gate (证据闸门) and LaTeX text sanitization engine for AstroLineage.
 * Implements defensive checks inspired by agent-fullstack-template:
 * - Robust parsing of LaTeX math formulas within JSON
 * - AST/macro stripping for verbatim citation verification
 * - Fail-closed evaluation of scientific evidence before tier promotion
 */

/**
 * Normalizes LaTeX math expressions in raw model output before JSON parsing.
 * Specifically handles backslash escapes within math delimiters ($...$ or $$...$$)
 * where models frequently emit invalid JSON escape sequences like \g, \n, \t, \v, \p.
 */
export function sanitizeModelJsonString(raw) {
  if (typeof raw !== "string") return "";

  // 1. Strip markdown fences
  let text = raw.trim();
  text = text
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();

  // 2. Fix LaTeX commands that start with valid JSON escape characters (\n, \t)
  text = text.replace(
    /(?<!\\)\\(nu|nabla|neq|natural|newcommand|noindent|times|tau|theta|tilde|text|textbf|textit|mathrm|mathbf|mathit|tag|top|to)(?![a-zA-Z])/g,
    "\\\\$1"
  );

  // 3. Fix any single backslash not followed by a valid JSON escape (\", \\, \/, \b, \f, \n, \r, \t, \uXXXX)
  text = text.replace(/(?<!\\)\\(?![\\"/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");

  return text;
}

export function repairMathInRawJson(raw) {
  if (typeof raw !== "string") return "";
  // 1. Repair $ ... $ inline math
  let text = raw.replace(/\$([^$]+)\$/gu, (_match, mathContent) => {
    const fixed = mathContent.replace(/(\\*)([a-zA-Z()])/gu, (m, slashes) => {
      if (slashes.length % 2 === 1) return `\\${m}`;
      return m;
    });
    return `$${fixed}$`;
  });

  // 2. Repair \( ... \) and \[ ... \] math
  text = text.replace(/\\([()[\]])([\s\S]*?)\\([()[\]])/gu, (_match, open, mathContent, close) => {
    const fixed = mathContent.replace(/(\\*)([a-zA-Z()])/gu, (m, slashes) => {
      if (slashes.length % 2 === 1) return `\\${m}`;
      return m;
    });
    return `\\${open}${fixed}\\${close}`;
  });

  // 3. Normalize single backslash on known astrophysics LaTeX commands that conflict with JSON escapes (n, t, r, b, f)
  text = text.replace(/(?<!\\)\\([ntrbf])([a-zA-Z]{1,15})(?![a-zA-Z])/gu, (match, letter, rest) => {
    const word = `${letter}${rest}`.toLowerCase();
    if (
      [
        "nu",
        "tau",
        "rho",
        "beta",
        "times",
        "theta",
        "tilde",
        "frac",
        "nabla",
        "neq",
        "bar",
        "bf",
        "right",
        "rangle",
        "ref",
        "begin",
        "bibitem",
        "bullet",
        "big",
        "bmod",
        "flat",
        "forall",
      ].includes(word)
    ) {
      return `\\\\${match.slice(1)}`;
    }
    return match;
  });

  return text;
}

export function repairMathDelimiterEscapes(raw) {
  let unsupported = false;
  const repaired = raw.replace(/(\\+)(.)/gsu, (matched, slashes, next, offset) => {
    if (slashes.length % 2 === 0 || /^["\\/bfnrt]$/u.test(next)) return matched;
    if (
      next === "u" &&
      /^[0-9a-fA-F]{4}$/u.test(raw.slice(offset + slashes.length + 1, offset + slashes.length + 5))
    )
      return matched;
    if (next === "(" || next === ")" || /^[a-zA-Z]$/u.test(next)) return `${slashes}\\${next}`;
    unsupported = true;
    return matched;
  });
  if (unsupported)
    throw new Error(
      "Model response has an unsupported JSON escape; use JSON-escaped TeX backslashes"
    );
  return repaired;
}

export function rejectAmbiguousText(value) {
  if (typeof value === "string" && /[\u0000-\u0008\u000b\u000c\u000d\u000e-\u001f]/u.test(value)) {
    throw new Error(
      "Model response contains an ambiguous JSON escape; use JSON-escaped TeX backslashes"
    );
  }
  if (Array.isArray(value)) value.forEach(rejectAmbiguousText);
  else if (value && typeof value === "object") Object.values(value).forEach(rejectAmbiguousText);
  return value;
}

export function safeParseJson(raw) {
  if (raw && typeof raw === "object") return rejectAmbiguousText(raw);
  const text = sanitizeModelJsonString(raw);
  const preRepaired = repairMathInRawJson(text);
  try {
    return rejectAmbiguousText(JSON.parse(preRepaired));
  } catch (initialErr) {
    if (initialErr.message?.includes("ambiguous JSON escape")) throw initialErr;
    const match = preRepaired.match(/[\[\{][\s\S]*[\]\}]/u);
    if (!match) throw initialErr;
    try {
      return rejectAmbiguousText(JSON.parse(repairMathDelimiterEscapes(match[0])));
    } catch {
      const fixed = match[0].replace(/(?<!\\)\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");
      return rejectAmbiguousText(JSON.parse(fixed));
    }
  }
}

/**
 * Strips LaTeX macros, citation keys, cross-references, and extraneous whitespace
 * from academic text for robust verbatim matching.
 */
export function stripLatexFormatting(text) {
  if (!text || typeof text !== "string") return "";

  return (
    text
      // Strip comments
      .replace(/(?<!\\)%.*$/gm, "")
      // Strip citations: \cite{...}, \citep{...}, \citet{...}
      .replace(/\\cite[pt]?\{[^}]*\}/g, "")
      // Strip cross-references: \ref{...}, \eqref{...}, \label{...}
      .replace(/\\(?:eq)?ref\{[^}]*\}/g, "")
      .replace(/\\label\{[^}]*\}/g, "")
      // Strip text formatting macros but keep inner text: \textbf{abc} -> abc
      .replace(/\\(?:textbf|textit|emph|textrm|texttt|underline)\{([^}]*)\}/g, "$1")
      // Replace non-breaking spaces ~ with normal space
      .replace(/~/g, " ")
      // Collapse consecutive whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Verifies whether a claimed evidence quote can be verified in the body text or sections.
 *
 * @param {string} claimedQuote - The short evidence quote produced by the LLM
 * @param {string} bodyText - The full article text extracted from TeX / PDF
 * @param {Array<{ title: string, text: string }>} sections - Parsed article sections
 * @returns {{ verified: boolean, confidence: number, matchLocation?: string }}
 */
export function verifyQuoteEvidence(claimedQuote, bodyText, sections = []) {
  if (!claimedQuote || typeof claimedQuote !== "string" || claimedQuote.trim().length === 0) {
    return { verified: false, confidence: 0, reason: "empty_quote" };
  }

  const rawCleanQuote = claimedQuote.trim();
  if (rawCleanQuote.length < 5) {
    // Too short to be meaningful evidence
    return { verified: false, confidence: 0, reason: "quote_too_short" };
  }

  // Tier 1: Exact verbatim substring check
  if (bodyText && bodyText.includes(rawCleanQuote)) {
    return { verified: true, confidence: 1.0, matchLocation: "verbatim_body" };
  }

  // Tier 2: Check sections directly
  for (const sec of sections) {
    if (sec.text && sec.text.includes(rawCleanQuote)) {
      return { verified: true, confidence: 1.0, matchLocation: `section:${sec.title}` };
    }
  }

  // Tier 3: Macro-stripped normalized check (handles \cite, \ref, ~, spacing divergence)
  const normalizedQuote = stripLatexFormatting(rawCleanQuote).toLowerCase();
  const normalizedBody = stripLatexFormatting(bodyText || "").toLowerCase();

  if (normalizedQuote.length >= 8 && normalizedBody.includes(normalizedQuote)) {
    return { verified: true, confidence: 0.95, matchLocation: "normalized_macro_match" };
  }

  // Tier 4: Section-level normalized check
  for (const sec of sections) {
    const normSec = stripLatexFormatting(sec.text || "").toLowerCase();
    if (normalizedQuote.length >= 8 && normSec.includes(normalizedQuote)) {
      return { verified: true, confidence: 0.95, matchLocation: `normalized_section:${sec.title}` };
    }
  }

  // Failed all tiers: Evidence cannot be verified
  return {
    verified: false,
    confidence: 0,
    reason: "unverifiable_evidence_not_found_in_source",
  };
}

/**
 * Evaluates the Evidence Gate for an analyzed paper item.
 * Enforces Fail-Closed invariant:
 * - Must Read papers REQUIRE verified full_body or high-confidence body evidence.
 * - Worth Knowing papers REQUIRE at least partial body evidence.
 * - If evidence fails, returns graceful downgrade status.
 */
export function evaluateEvidenceGate(analysisRecord, bodyContext = {}) {
  const priority = analysisRecord?.priority || "skip";
  const coverageLevel = analysisRecord?.coverage?.level || "abstract_only";
  const evidenceList = analysisRecord?.source_references || [];
  const bodyText = bodyContext.bodyText || "";
  const sections = bodyContext.sections || [];

  if (priority === "skip") {
    return {
      passed: true,
      admittedPriority: "skip",
      downgraded: false,
    };
  }

  // Check quotes in source references
  let verifiedQuotesCount = 0;
  for (const ref of evidenceList) {
    const quote = ref.quote || ref.exact_quote;
    if (quote) {
      const check = verifyQuoteEvidence(quote, bodyText, sections);
      if (check.verified) {
        verifiedQuotesCount++;
      }
    }
  }

  // Must Read validation
  if (priority === "must_read") {
    const hasFullBody = coverageLevel === "full_body";
    const hasSufficientEvidence =
      verifiedQuotesCount >= 1 || (bodyText.length > 2000 && sections.length >= 2);

    if (hasFullBody && hasSufficientEvidence) {
      return {
        passed: true,
        admittedPriority: "must_read",
        downgraded: false,
        verifiedQuotes: verifiedQuotesCount,
      };
    }

    // Graceful Fail-Closed Downgrade
    return {
      passed: false,
      admittedPriority: "worth_knowing",
      downgraded: true,
      downgradeReason: "coverage_insufficient_must_read",
      diagnostic: `Must Read evidence gate rejected: coverage=${coverageLevel}, verified_quotes=${verifiedQuotesCount}`,
    };
  }

  // Worth Knowing validation
  if (priority === "worth_knowing") {
    const hasBodyPartial = coverageLevel === "body_partial" || coverageLevel === "full_body";
    const hasSufficientEvidence =
      verifiedQuotesCount >= 1 || (bodyText.length > 500 && sections.length >= 1);

    if (hasBodyPartial && hasSufficientEvidence) {
      return {
        passed: true,
        admittedPriority: "worth_knowing",
        downgraded: false,
        verifiedQuotes: verifiedQuotesCount,
      };
    }

    return {
      passed: false,
      admittedPriority: "skip",
      downgraded: true,
      downgradeReason: "coverage_insufficient_worth_knowing",
      diagnostic: `Worth Knowing evidence gate rejected: coverage=${coverageLevel}, verified_quotes=${verifiedQuotesCount}`,
    };
  }

  return {
    passed: true,
    admittedPriority: priority,
    downgraded: false,
  };
}
