/**
 * scripts/arxiv-triage-filter.mjs
 * 
 * Deterministic pre-filter seam for paper triage.
 * Eliminates remote LLM calls for definitively off-domain papers (e.g. pure exoplanets,
 * helioseismology, solar corona, or large-scale dark matter cosmological surveys)
 * that have no high-energy transient relevance.
 */

import { DETERMINISTIC_SKIP_RULES } from "../src/domain/academic-domain.mjs";

export function deterministicTriageFilter(entry) {
  const cats = Array.isArray(entry?.categories) ? entry.categories : [];
  // Never deterministically filter out papers with high-energy astrophysics category
  if (cats.includes("astro-ph.HE")) return null;

  const title = String(entry?.title || "");

  for (const rule of DETERMINISTIC_SKIP_RULES) {
    const isPure = cats.length > 0 && cats.every((c) => c.startsWith(rule.categoryPrefix));
    if (isPure && rule.keywords.test(title)) {
      return createDeterministicSkip(entry, rule.reason);
    }
  }

  return null;
}

function createDeterministicSkip(entry, reason) {
  const rawAbstract = String(entry.abstract || "").trim();
  let quote = "";
  if (rawAbstract.length >= 15) {
    const sentenceEnd = rawAbstract.search(/[.!?](?:\s|$)/);
    if (sentenceEnd >= 15 && sentenceEnd <= 150) {
      quote = rawAbstract.slice(0, sentenceEnd + 1);
    } else {
      quote = rawAbstract.slice(0, Math.min(100, rawAbstract.length));
    }
  } else {
    quote = rawAbstract;
  }

  return {
    priority: "skip",
    reason,
    result: "unknown",
    problem: "unknown",
    method: "unknown",
    reading_entry: "摘要",
    research_progress: "unknown",
    assumptions: [],
    limits: [],
    inspected_sections: ["Abstract"],
    evidence: [
      {
        section: "Abstract",
        quote,
        supports: ["reason", "result"],
      },
    ],
    filter_source: "deterministic_rule",
  };
}
