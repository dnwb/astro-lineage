/**
 * scripts/pipeline-routing.mjs
 * 
 * Model routing strategy and resilient fallback ladder for AstroLineage.
 * Implements deterministic fail-fast rules to avoid token exhaustion loops
 * across tiered LLM gateways, based on agent-fullstack-template & Opus architectural review.
 */

import { normalizeModelName } from "./agent-core.mjs";

export const PIPELINE_STAGES = {
  TRIAGE: "triage",
  DEEP_READ: "deep_read",
  QA_BOT: "qa_bot",
};

export const DEFAULT_ROUTING_CONFIG = {
  [PIPELINE_STAGES.TRIAGE]: {
    primary: "gpt-6-luna",
    fallbacks: ["gemini-3.5-flash-lite", "claude-sonnet-4-6"],
    description: "极速、低时延摘要初筛与分类",
  },
  [PIPELINE_STAGES.DEEP_READ]: {
    primary: "gemini-3.8-flash-high",
    fallbacks: ["gpt-6.1-sol", "claude-opus-4-6-thinking"],
    description: "超长上下文、百万 Token 级正文深度研读与物理突破分析",
  },
  [PIPELINE_STAGES.QA_BOT]: {
    primary: "gpt-6.1-sol",
    fallbacks: ["gemini-3.8-flash-high", "claude-opus-4-6-thinking", "gpt-6-astra"],
    description: "学术情报交互与官方机器人即时问答",
  },
};

/**
 * Resolves model candidates ladder for a given pipeline stage,
 * honoring environment overrides while preserving safe normalization.
 */
export function resolveRoutingLadder(stage = PIPELINE_STAGES.DEEP_READ, env = process.env) {
  const defaults = DEFAULT_ROUTING_CONFIG[stage] || DEFAULT_ROUTING_CONFIG[PIPELINE_STAGES.DEEP_READ];

  let primary = defaults.primary;
  let fallbacks = [...defaults.fallbacks];

  if (stage === PIPELINE_STAGES.TRIAGE) {
    primary = env.AI_MODEL_TRIAGE || env.AI_MODEL_SKIM || env.AI_MODEL || primary;
    if (env.AI_TRIAGE_FALLBACK_MODELS) {
      fallbacks = env.AI_TRIAGE_FALLBACK_MODELS.split(",").map((s) => s.trim()).filter(Boolean);
    }
  } else if (stage === PIPELINE_STAGES.DEEP_READ) {
    primary = env.AI_MODEL_BODY || env.AI_MODEL_READING || primary;
    if (env.AI_BODY_FALLBACK_MODELS) {
      fallbacks = env.AI_BODY_FALLBACK_MODELS.split(",").map((s) => s.trim()).filter(Boolean);
    }
  } else if (stage === PIPELINE_STAGES.QA_BOT) {
    primary = env.BOT_AI_MODEL || env.AI_MODEL || primary;
    if (env.BOT_FALLBACK_MODELS) {
      fallbacks = env.BOT_FALLBACK_MODELS.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  const normalizedPrimary = normalizeModelName(primary);
  const candidates = [normalizedPrimary];

  for (const fallback of fallbacks) {
    const normalized = normalizeModelName(fallback);
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  }

  return {
    stage,
    primary: normalizedPrimary,
    fallbacks: candidates.slice(1),
    candidates,
  };
}

/**
 * Deterministic error classifier to prevent token exhaustion loops.
 * 
 * Rules:
 * - 429 (Rate Limit), 5xx (Gateway/Server Error), Network Timeout/Reset -> Retry via Fallback ladder.
 * - 400 (Bad Request), 401/403 (Auth/Permissions), Context Length Exceeded -> TERMINAL FAIL-FAST.
 *   Never cascade dirty/oversized payloads into expensive flagship models.
 */
export function classifyModelError(err) {
  if (!err) return { shouldFallback: false, reason: "unknown_empty" };

  const status = Number(err.status || err.statusCode || err.code);
  const msg = String(err.message || "").toLowerCase();

  // 1. Terminal / Non-retryable errors -> Do NOT fallback
  if (status === 400 || msg.includes("bad request") || msg.includes("invalid request")) {
    return { shouldFallback: false, reason: "terminal_bad_request", terminal: true };
  }
  if (status === 401 || status === 403 || msg.includes("unauthorized") || msg.includes("forbidden")) {
    return { shouldFallback: false, reason: "terminal_auth_error", terminal: true };
  }
  if (msg.includes("maximum context length") || msg.includes("prompt is too long") || msg.includes("context_length_exceeded")) {
    return { shouldFallback: false, reason: "terminal_context_overflow", terminal: true };
  }

  // 2. Transient errors -> Safe to fallback to next candidate
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("quota")) {
    return { shouldFallback: true, reason: "transient_rate_limit" };
  }
  if (status >= 500 && status <= 599) {
    return { shouldFallback: true, reason: `transient_upstream_${status}` };
  }
  if (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  ) {
    return { shouldFallback: true, reason: "transient_network_timeout" };
  }
  if (msg.includes("json") && (msg.includes("syntaxerror") || msg.includes("unterminated") || msg.includes("unexpected token"))) {
    // Model output truncation / malformed JSON
    return { shouldFallback: true, reason: "transient_malformed_output" };
  }

  // Default: Fallback with caution
  return { shouldFallback: true, reason: "transient_generic_error" };
}
