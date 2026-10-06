import test from "node:test";
import assert from "node:assert/strict";
import {
  SCIENTIFIC_TAGS,
  TRANSIENT_IDENTIFIER_PATTERNS,
  extractTransientIdentifiers,
  matchScientificTags,
  DETERMINISTIC_SKIP_RULES,
  ASTROPHYSICS_SYSTEM_PROMPT,
  formatAnnouncementInBeijing,
  parseTransientEpoch,
} from "../src/domain/academic-domain.mjs";

test("academic-domain: extractTransientIdentifiers parses standard transient names", () => {
  assert.ok(SCIENTIFIC_TAGS.length > 5);
  assert.ok(TRANSIENT_IDENTIFIER_PATTERNS.length > 3);
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

test("academic-domain: formatAnnouncementInBeijing maps US announcement dates to Beijing Time correctly", () => {
  const sun = formatAnnouncementInBeijing("2026-10-04", "Sun");
  assert.equal(sun.beijingDate, "2026-10-05");
  assert.equal(sun.shortDate, "10-05");
  assert.equal(sun.chineseWeekday, "周一");
  assert.match(sun.batchKicker, /周一监测批次/u);

  const thu = formatAnnouncementInBeijing("2026-10-01", "Thu");
  assert.equal(thu.beijingDate, "2026-10-02");
  assert.equal(thu.shortDate, "10-02");
  assert.equal(thu.chineseWeekday, "周五");

  const wed = formatAnnouncementInBeijing("2026-09-30", "Wed");
  assert.equal(wed.beijingDate, "2026-10-01");
  assert.equal(wed.shortDate, "10-01");
  assert.equal(wed.chineseWeekday, "周四");

  const tue = formatAnnouncementInBeijing("2026-09-29", "Tue");
  assert.equal(tue.beijingDate, "2026-09-30");
  assert.equal(tue.chineseWeekday, "周三");

  const mon = formatAnnouncementInBeijing("2026-09-28", "Mon");
  assert.equal(mon.beijingDate, "2026-09-29");
  assert.equal(mon.chineseWeekday, "周二");
});

test("academic-domain: parseTransientEpoch accurately extracts discovery/eruption year or date", () => {
  assert.equal(parseTransientEpoch("GW170817"), "2017-08-17");
  assert.equal(parseTransientEpoch("GRB 250419A"), "2025-04-19");
  assert.equal(parseTransientEpoch("GRB 221009A"), "2022-10-09");
  assert.equal(parseTransientEpoch("SN 2024ggi"), "2024");
  assert.equal(parseTransientEpoch("AT 2018hyz"), "2018");
  assert.equal(parseTransientEpoch("FRB 20201124A"), "2020-11-24");
  assert.equal(parseTransientEpoch("UNKNOWN"), null);
});
