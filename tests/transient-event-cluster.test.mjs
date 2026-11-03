import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  calculateHeatScore,
  classifyEventType,
  buildScientificEventClusters,
  extractVerifiedFigures,
} from "../scripts/transient-event-cluster.mjs";

test("transient-event-cluster: calculateHeatScore applies 7-day half-life decay", () => {
  const papers = [
    { priority: "must_read" }, // 25
    { priority: "worth_knowing" }, // 15
    { priority: "skip" }, // 5
  ];
  // Total base = 45

  const refDate = new Date("2026-10-01T00:00:00Z");
  // Day 0: no decay -> 45
  const heatDay0 = calculateHeatScore(papers, "2026-10-01", refDate);
  assert.equal(heatDay0, 45);

  // Day 7: 1 half-life -> 22.5
  const heatDay7 = calculateHeatScore(papers, "2026-09-24", refDate);
  assert.equal(heatDay7, 22.5);

  // Day 14: 2 half-lives -> 11.3
  const heatDay14 = calculateHeatScore(papers, "2026-09-17", refDate);
  assert.equal(heatDay14, 11.3);
});

test("transient-event-cluster: classifyEventType properly classifies event prefixes", () => {
  assert.equal(classifyEventType("GRB 250419A"), "GRB");
  assert.equal(classifyEventType("SN 2024ggi"), "SN");
  assert.equal(classifyEventType("FRB 20240114A"), "FRB");
  assert.equal(classifyEventType("GW170817"), "GW");
  assert.equal(classifyEventType("AT 2024ggi"), "AT");
  assert.equal(classifyEventType("SGR 1935+2154"), "SGR");
});

test("transient-event-cluster: buildScientificEventClusters returns structured events", async () => {
  const result = await buildScientificEventClusters({
    archiveDir: "src/data/arxiv-archives/daily",
    radarPath: "src/data/daily-radar.json",
  });

  assert.ok(result.total_events > 0);
  assert.ok(Array.isArray(result.events));

  // Verify top event has positive heat score
  const top = result.events[0];
  assert.ok(top.heat_score >= 0);
  assert.ok(top.paper_count >= 1);
  assert.ok(top.event_id);
  assert.ok(top.event_type);
  assert.ok(Array.isArray(top.papers));

  // Verify at least some events have lead_figure and papers have primary_figure
  const eventsWithLeadFigure = result.events.filter((e) => e.lead_figure);
  assert.ok(eventsWithLeadFigure.length > 0);
  const sample = eventsWithLeadFigure[0];
  assert.ok(sample.lead_figure.url);
  assert.ok(sample.lead_figure_arxiv_id);
});

test("transient-event-cluster: extractVerifiedFigures filters by publicDir and synthesizes core", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "figure-verify-test-"));
  t.after(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  const figDir = join(sandbox, "arxiv-figures", "9999.00001");
  await mkdir(figDir, { recursive: true });
  await writeFile(join(figDir, "curve.png"), "fake image data");

  const item = {
    arxiv_id: "9999.00001",
    title: "Discovery of Ultra-Luminous Supernova SN 2026xyz",
    figures: [
      {
        url: "/arxiv-figures/9999.00001/curve.png",
        label: "Fig. 1",
        caption: "Light curve evolution of SN 2026xyz",
        category_badge: "Observational Light Curve",
      },
      {
        url: "/arxiv-figures/9999.00001/missing.png",
        label: "Fig. 2",
        caption: "Missing file",
      },
      {
        url: "https://example.com/external.png",
        label: "Fig. 3",
        caption: "Remote figure",
      },
    ],
  };

  const verified = extractVerifiedFigures(item, item.title, sandbox);
  assert.equal(verified.length, 2);
  assert.equal(verified[0].url, "/arxiv-figures/9999.00001/curve.png");
  assert.equal(verified[0].category_badge, "Observational Light Curve");
  assert.ok(verified[0].physical_core.length > 0);
  assert.equal(verified[1].url, "https://example.com/external.png");
});
