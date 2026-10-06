import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sanitizeModelJsonString,
  stripLatexFormatting,
  verifyQuoteEvidence,
  evaluateEvidenceGate,
} from "../scripts/pipeline-evidence-gate.mjs";

test("sanitizeModelJsonString handles unescaped backslashes in math blocks and strips markdown code fences", () => {
  const rawWithFence = '```json\n{"result": "Measured \\gamma-ray flux $F_{\\nu} \\propto \\nu^{-\\alpha}$ successfully."}\n```';
  const sanitized = sanitizeModelJsonString(rawWithFence);
  assert.ok(!sanitized.startsWith("```"));
  assert.ok(!sanitized.endsWith("```"));
  
  // Parse should succeed on valid JSON
  const parsed = JSON.parse(sanitized);
  assert.ok(parsed.result.includes("Measured"));
});

test("stripLatexFormatting eliminates cite, ref, ~ and comments while preserving text content", () => {
  const latex = "As shown in \\citet{Li2026}~and Figure~\\ref{fig:lc}, the kinetic energy is large % comment here\n\\textbf{significant} result.";
  const stripped = stripLatexFormatting(latex);
  assert.equal(stripped, "As shown in and Figure , the kinetic energy is large significant result.");
});

test("verifyQuoteEvidence performs multi-tier verbatim and normalized macro matching", () => {
  const bodyText = "We report the detection of a fast radio burst FRB 20260310A with dispersion measure DM = 450 pc cm^-3.";
  const sections = [
    { title: "Discussion", text: "The relativistic jet opening angle theta_j is constrained to be less than 0.05 rad." },
  ];

  // Verbatim match in body
  const res1 = verifyQuoteEvidence("dispersion measure DM = 450", bodyText, sections);
  assert.equal(res1.verified, true);
  assert.equal(res1.matchLocation, "verbatim_body");

  // Verbatim match in section
  const res2 = verifyQuoteEvidence("relativistic jet opening angle", bodyText, sections);
  assert.equal(res2.verified, true);
  assert.equal(res2.matchLocation, "section:Discussion");

  // Macro-normalized match
  const res3 = verifyQuoteEvidence("dispersion~measure DM = 450", bodyText, sections);
  assert.equal(res3.verified, true);

  // Missing / hallucinatory evidence
  const res4 = verifyQuoteEvidence("We found an extraterrestrial artifact orbiting the neutron star", bodyText, sections);
  assert.equal(res4.verified, false);
});

test("evaluateEvidenceGate enforces fail-closed downgrade when full body evidence is missing", () => {
  const analysisRecord = {
    priority: "must_read",
    coverage: { level: "abstract_only" },
    source_references: [
      { quote: "unverifiable claim" }
    ],
  };

  const bodyContext = {
    bodyText: "Only a short text",
    sections: [],
  };

  const gateResult = evaluateEvidenceGate(analysisRecord, bodyContext);
  assert.equal(gateResult.passed, false);
  assert.equal(gateResult.downgraded, true);
  assert.equal(gateResult.admittedPriority, "worth_knowing");
  assert.equal(gateResult.downgradeReason, "coverage_insufficient_must_read");
});

test("evaluateEvidenceGate admits must_read with verified full_body evidence", () => {
  const bodyText = "In this work we confirm the magnetar giant flare nature of SGR 1935+2154 using GECAM observations.";
  const analysisRecord = {
    priority: "must_read",
    coverage: { level: "full_body" },
    source_references: [
      { quote: "confirm the magnetar giant flare nature of SGR 1935+2154" }
    ],
  };

  const bodyContext = {
    bodyText,
    sections: [{ title: "Analysis", text: bodyText }],
  };

  const gateResult = evaluateEvidenceGate(analysisRecord, bodyContext);
  assert.equal(gateResult.passed, true);
  assert.equal(gateResult.downgraded, false);
  assert.equal(gateResult.admittedPriority, "must_read");
});
