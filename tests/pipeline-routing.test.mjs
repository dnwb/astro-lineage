import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PIPELINE_STAGES,
  DEFAULT_ROUTING_CONFIG,
  resolveRoutingLadder,
  classifyModelError,
} from "../scripts/pipeline-routing.mjs";

test("resolveRoutingLadder sets gemini-3.8-flash-high as default primary for DEEP_READ", () => {
  const ladder = resolveRoutingLadder(PIPELINE_STAGES.DEEP_READ, {});
  assert.equal(ladder.primary, "gemini-3.8-flash-high");
  assert.ok(ladder.candidates.includes("gemini-3.8-flash-high"));
  assert.ok(ladder.candidates.includes("gpt-6.1-sol"));
  assert.ok(ladder.candidates.includes("claude-opus-4-6-thinking"));
  assert.equal(ladder.candidates[0], "gemini-3.8-flash-high");
});

test("resolveRoutingLadder respects environment overrides for DEEP_READ and TRIAGE", () => {
  const customEnv = {
    AI_MODEL_BODY: "claude-opus-4.6",
    AI_BODY_FALLBACK_MODELS: "gemini-3.8-flash,gpt-6-sol",
    AI_MODEL_TRIAGE: "gpt-6-luna",
    AI_TRIAGE_FALLBACK_MODELS: "gemini-3.5-flash-lite",
  };

  const bodyLadder = resolveRoutingLadder(PIPELINE_STAGES.DEEP_READ, customEnv);
  assert.equal(bodyLadder.primary, "claude-opus-4-6-thinking");
  assert.deepEqual(bodyLadder.fallbacks, ["gemini-3.8-flash-high", "gpt-6-sol"]);

  const triageLadder = resolveRoutingLadder(PIPELINE_STAGES.TRIAGE, customEnv);
  assert.equal(triageLadder.primary, "gpt-6-luna");
  assert.deepEqual(triageLadder.fallbacks, ["gemini-3.5-flash-lite"]);
});

test("classifyModelError correctly distinguishes terminal fail-fast vs transient retry errors", () => {
  // Terminal errors: MUST NOT fallback
  const badReq = { status: 400, message: "Invalid request payload format" };
  const classification400 = classifyModelError(badReq);
  assert.equal(classification400.shouldFallback, false);
  assert.equal(classification400.terminal, true);

  const contextOverflow = { message: "Maximum context length exceeded (128000 tokens)" };
  const classificationOverflow = classifyModelError(contextOverflow);
  assert.equal(classificationOverflow.shouldFallback, false);
  assert.equal(classificationOverflow.terminal, true);

  const authError = { status: 401, message: "Incorrect API key" };
  const classificationAuth = classifyModelError(authError);
  assert.equal(classificationAuth.shouldFallback, false);
  assert.equal(classificationAuth.terminal, true);

  // Transient errors: MUST fallback
  const rateLimit = { status: 429, message: "Too many requests" };
  const classification429 = classifyModelError(rateLimit);
  assert.equal(classification429.shouldFallback, true);
  assert.equal(classification429.reason, "transient_rate_limit");

  const serverError = { status: 503, message: "Service Unavailable" };
  const classification503 = classifyModelError(serverError);
  assert.equal(classification503.shouldFallback, true);

  const netTimeout = { message: "ETIMEDOUT: Connection timed out" };
  const classificationTimeout = classifyModelError(netTimeout);
  assert.equal(classificationTimeout.shouldFallback, true);

  const malformedJson = { message: "SyntaxError: Unexpected token in JSON at position 120" };
  const classificationJson = classifyModelError(malformedJson);
  assert.equal(classificationJson.shouldFallback, true);
});
