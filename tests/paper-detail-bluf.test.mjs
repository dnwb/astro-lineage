import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  detectContestedClaims,
  getHighEnergyConventions,
} from "../src/domain/academic-domain.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("academic-domain: detectContestedClaims identifies contested dispositions and challenging relationships", () => {
  const workId = "work:sample-model";

  // Case 1: Contested disposition
  const edgesWithContested = [
    {
      id: "edge:1",
      source_work_id: "work:sample-model",
      target_work_id: "work:challenger-2025",
      relation: "tests",
      disposition: "contested",
      reason: "Observational data from Swift rules out the primary emission zone.",
    },
  ];
  const res1 = detectContestedClaims(workId, edgesWithContested);
  assert.equal(res1.isContested, true);
  assert.equal(res1.contestedCount, 1);

  // Case 2: Relation is challenges or corrects
  const edgesWithChallenges = [
    {
      id: "edge:2",
      source_work_id: "work:challenger-2025",
      target_work_id: "work:sample-model",
      relation: "challenges",
      disposition: "accepted",
      reason: "Numeric relativistic simulations reveal instability in the initial jet geometry.",
    },
  ];
  const res2 = detectContestedClaims(workId, edgesWithChallenges);
  assert.equal(res2.isContested, true);
  assert.equal(res2.contestedCount, 1);

  // Case 3: Completely unchallenged / uncontested edges
  const edgesClean = [
    {
      id: "edge:3",
      source_work_id: "work:sample-model",
      target_work_id: "work:prior-foundation",
      relation: "builds_on",
      disposition: "accepted",
      reason: "Adopts the standard fireball scenario.",
    },
    {
      id: "edge:4",
      source_work_id: "work:later-extension",
      target_work_id: "work:sample-model",
      relation: "extends",
      disposition: "accepted",
      reason: "Generalizes to stratified circumstellar media.",
    },
  ];
  const res3 = detectContestedClaims(workId, edgesClean);
  assert.equal(res3.isContested, false);
  assert.equal(res3.contestedCount, 0);

  // Case 4: Empty edges
  const res4 = detectContestedClaims(workId, []);
  assert.equal(res4.isContested, false);
  assert.equal(res4.contestedCount, 0);
});

test("academic-domain: getHighEnergyConventions returns standard HEA conventions line text", () => {
  const conventions = getHighEnergyConventions();
  assert.match(conventions, /F_\\nu/u);
  assert.match(conventions, /\\Gamma/u);
  assert.match(conventions, /90% CL/u);
  assert.match(conventions, /\\Lambda\\mathrm\{CDM\}|Planck18/u);
});

test("paper-detail-bluf: papers/[workId].astro renders BLUF panel, dispute banner, and conventions line", async () => {
  const astroCode = await readFile(join(projectRoot, "src", "pages", "papers", "[workId].astro"), "utf8");

  // Dispute alert banner
  assert.match(astroCode, /class=["'][^"']*paper-dispute-banner[^"']*["']/u);
  assert.match(astroCode, /detectContestedClaims/u);

  // Conventions line
  assert.match(astroCode, /class=["'][^"']*paper-conventions-line[^"']*["']/u);
  assert.match(astroCode, /getHighEnergyConventions/u);

  // Observational setup fallback when no physical stages exist
  assert.match(astroCode, /class=["'][^"']*observational-setup-card[^"']*["']/u);
});
