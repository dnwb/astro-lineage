#!/usr/bin/env node
/**
 * scripts/gcn-tracker-cli.mjs
 *
 * Standalone CLI entry runner for GCN Circulars Transient Surveillance.
 *
 * Usage:
 *   node scripts/gcn-tracker-cli.mjs [target]
 *   node scripts/gcn-tracker-cli.mjs "GRB 261029A"
 *   node scripts/gcn-tracker-cli.mjs --all
 *   npm run gcn:track
 */

import {
  trackEvent,
  runDailyGcnSurveillance,
  DEFAULT_STATE_PATH,
  DEFAULT_DATA_DIR,
  DEFAULT_FIGURES_DIR,
} from "./gcn-tracker.mjs";

async function main() {
  const args = process.argv.slice(2);
  let target = null;
  let useLlm = false;
  let generatePlot = true;
  let trackAll = false;
  let dryRun = false;
  let inspectMode = false;
  let statePath = DEFAULT_STATE_PATH;
  let dataDir = DEFAULT_DATA_DIR;
  let figuresDir = DEFAULT_FIGURES_DIR;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--use-llm") {
      useLlm = true;
    } else if (a === "--no-plot") {
      generatePlot = false;
    } else if (a === "--all") {
      trackAll = true;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--inspect") {
      inspectMode = true;
      dryRun = true;
    } else if (a === "--state" && args[i + 1]) {
      statePath = args[++i];
    } else if (a === "--data-dir" && args[i + 1]) {
      dataDir = args[++i];
    } else if (a === "--figures-dir" && args[i + 1]) {
      figuresDir = args[++i];
    } else if (!a.startsWith("--")) {
      target = a;
    }
  }

  // If --all is requested OR no target argument is specified, run daily surveillance
  if (trackAll || !target) {
    console.log("[GCN Tracker CLI] Running daily GCN surveillance (watchlist + auto-discovery)...");
    const results = await runDailyGcnSurveillance({
      dataDir,
      figuresDir,
      statePath,
      fetchFn: fetch,
      generatePlot,
      useLlm,
    });
    console.log(`[GCN Tracker CLI] ✓ Completed surveillance for ${results.length} events.`);
    return;
  }

  console.log(`[GCN Tracker CLI] Ingesting GCN Circulars for target: ${target}...`);
  const result = await trackEvent(target, {
    dataDir,
    figuresDir,
    statePath,
    fetchFn: fetch,
    useLlm,
    generatePlot: generatePlot && !dryRun,
    dryRun,
  });

  if (inspectMode) {
    const l = result.ledger;
    const bands = [...new Set((l.photometry_points || []).map((p) => p.band))].join(", ") || "none";
    console.log("--------------------------------------------------------------------------------");
    console.log(`[GCN Tracker CLI Inspect] Target: ${target}`);
    console.log(`  - Primary ID:        ${result.primary_id}`);
    console.log(`  - Event Type:        ${l.event_type || "unknown"}`);
    console.log(`  - Trigger T0:        ${JSON.stringify(l.canonical_t0)}`);
    console.log(`  - Best Redshift:     ${JSON.stringify(l.best_redshift)}`);
    console.log(`  - Circulars Count:   ${l.circular_count}`);
    console.log(`  - Photometry Points: ${l.photometry_points.length} (Filters: ${bands})`);
    console.log(`  - X-ray Points:      ${l.xray_points.length}`);
    console.log(`  - Radio Points:      ${l.radio_points.length}`);
    console.log(`  - Plot Eligible:     ${l.photometry_points.length >= 2}`);
    console.log(`  - Dry Run Mode:      ${Boolean(result.dryRun)}`);
    console.log("--------------------------------------------------------------------------------");
    return;
  }

  console.log(
    `[GCN Tracker CLI] ✓ Successfully processed ${result.primary_id} (${result.ledger.circular_count} circulars, ${result.ledger.photometry_points.length} photometry points).`
  );
  if (generatePlot && !dryRun) {
    console.log(`[GCN Tracker CLI] ✓ Figure generated at: ${result.figurePath}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("gcn-tracker-cli.mjs")) {
  main().catch((err) => {
    console.error("[GCN Tracker CLI Fatal]", err);
    process.exit(1);
  });
}
