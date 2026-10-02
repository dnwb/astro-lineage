import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateHeatScore,
  classifyEventType,
  buildScientificEventClusters,
} from "../scripts/transient-event-cluster.mjs";

test("transient-event-cluster: calculateHeatScore applies 7-day half-life decay", () => {
  const papers = [
    { priority: "must_read" },    // 25
    { priority: "worth_knowing" }, // 15
    { priority: "skip" },          // 5
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
});
