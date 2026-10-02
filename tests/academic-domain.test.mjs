import test from "node:test";
import assert from "node:assert/strict";
import {
  SCIENTIFIC_TAGS,
  TRANSIENT_IDENTIFIER_PATTERNS,
  extractTransientIdentifiers,
  matchScientificTags,
  DETERMINISTIC_SKIP_RULES,
  ASTROPHYSICS_SYSTEM_PROMPT,
} from "../src/domain/academic-domain.mjs";

test("academic-domain: extractTransientIdentifiers parses standard transient names", () => {
  const sample = "Follow-up of GRB 250419A and early optical observation of SN 2024ggi with AT2018hyz and FRB 20240114A. Also GW170817 and SGR 1935+2154.";
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
    title: "Relativistic jet propagation in a collapsar wind: afterglow modeling of a long gamma-ray burst",
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
  assert.ok(epRule.keywords.test("Transmission spectroscopy of hot Jupiters with transit observation"));
  assert.ok(!epRule.keywords.test("Supernova shock breakout in dense CSM"));

  assert.ok(ASTROPHYSICS_SYSTEM_PROMPT.includes("高能瞬变天体物理"));
});
