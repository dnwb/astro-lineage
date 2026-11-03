import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  partitionScientificEdges,
  formatVersionPinnedLocator,
} from "../src/domain/academic-domain.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("academic-domain: partitionScientificEdges separates upstream foundations and downstream tests with polarity", () => {
  const currentWorkId = "work:grb221009a-afterglow";

  const edges = [
    // Outbound: current paper builds on Sari et al. (upstream foundation)
    {
      id: "edge:1",
      source_work_id: "work:grb221009a-afterglow",
      target_work_id: "work:sari-1998-synchrotron",
      relation: "builds_on",
      disposition: "supporting",
      reason: "Adopts standard synchrotron blast-wave scaling laws.",
    },
    // Outbound: current paper challenges an earlier spherical blast model
    {
      id: "edge:2",
      source_work_id: "work:grb221009a-afterglow",
      target_work_id: "work:early-spherical-model",
      relation: "challenges",
      disposition: "contested",
      reason: "Rejects isotropic blast wave in favor of structured jet.",
    },
    // Inbound: subsequent paper tests current paper's jet opening angle
    {
      id: "edge:3",
      source_work_id: "work:subsequent-vlbi-2023",
      target_work_id: "work:grb221009a-afterglow",
      relation: "tests",
      disposition: "neutral",
      reason: "VLBI astrometry places strict upper limit on core jet opening angle.",
    },
    // Inbound: subsequent paper contradicts current paper's magnetic equipartition parameter
    {
      id: "edge:4",
      source_work_id: "work:subsequent-alma-polarization",
      target_work_id: "work:grb221009a-afterglow",
      relation: "challenges",
      disposition: "contested",
      reason: "Millimeter polarization rules out high epsilon_B in reverse shock.",
    },
  ];

  const partitioned = partitionScientificEdges(currentWorkId, edges);

  assert.equal(partitioned.upstream.length, 2);
  assert.equal(partitioned.downstream.length, 2);

  // Check upstream items
  const upstream1 = partitioned.upstream.find((e) => e.id === "edge:1");
  assert.equal(upstream1.direction, "outbound");
  assert.equal(upstream1.polarity, "supports");

  const upstream2 = partitioned.upstream.find((e) => e.id === "edge:2");
  assert.equal(upstream2.direction, "outbound");
  assert.equal(upstream2.polarity, "contradicts");

  // Check downstream items
  const downstream1 = partitioned.downstream.find((e) => e.id === "edge:3");
  assert.equal(downstream1.direction, "inbound");
  assert.equal(downstream1.polarity, "neutral");

  const downstream2 = partitioned.downstream.find((e) => e.id === "edge:4");
  assert.equal(downstream2.direction, "inbound");
  assert.equal(downstream2.polarity, "contradicts");
});

test("academic-domain: formatVersionPinnedLocator constructs standard pinned locator labels", () => {
  const locator1 = {
    section: "3.2",
    equation: "14",
  };
  const version1 = {
    arxiv_id: "2305.12345",
    arxiv_revision: "2",
  };
  const label1 = formatVersionPinnedLocator(locator1, version1);
  assert.equal(label1, "arXiv:2305.12345v2 §3.2, Eq. 14");

  const locator2 = {
    table: "1",
    page: 5,
  };
  const version2 = {
    journal: { name: "ApJ", volume: 950 },
  };
  const label2 = formatVersionPinnedLocator(locator2, version2);
  assert.equal(label2, "Table 1, p. 5");

  const locator3 = null;
  const label3 = formatVersionPinnedLocator(locator3);
  assert.equal(label3, "Locator unavailable");
});

test("evidence-ledger-component: EvidenceLedger.astro renders anchors, KaTeX math, and external links", async () => {
  const componentPath = join(projectRoot, "src", "components", "EvidenceLedger.astro");
  const componentCode = await readFile(componentPath, "utf8");

  // Verifies anchor ID for smooth jumping
  assert.match(componentCode, /id=\{`evidence-\$\{.*id\}`\}/u);

  // Verifies KaTeX SSOT for quote excerpts and notes
  assert.match(componentCode, /renderInlineScientificMarkdownWithMath/u);

  // Verifies ar5iv or arXiv HTML link support
  assert.match(componentCode, /ar5iv|arxiv\.org/u);
});

test("paper-detail-lineage: papers/[workId].astro implements directed lineage streams and evidence ledger", async () => {
  const pagePath = join(projectRoot, "src", "pages", "papers", "[workId].astro");
  const pageCode = await readFile(pagePath, "utf8");

  // Verifies split into Foundational Lineage and Downstream Tests
  assert.match(pageCode, /Foundational Lineage/u);
  assert.match(pageCode, /Empirical Tests & Applications/u);

  // Verifies partitionScientificEdges import and usage
  assert.match(pageCode, /partitionScientificEdges/u);

  // Verifies EvidenceLedger import and usage
  assert.match(pageCode, /EvidenceLedger/u);

  // Verifies evidence chip anchor link pattern
  assert.match(pageCode, /href=\{`#evidence-\$\{/u);
});
