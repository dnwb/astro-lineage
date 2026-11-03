import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { writeFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

import {
  canonicalizeTransientId,
  unifyEventAliases,
  resolveCanonicalT0,
  selectBestRedshift,
  shouldArchiveEvent,
  formatCanonicalT0Badge,
  formatRedshiftBadge,
  formatAliasList,
  formatMultiMessengerBadges,
} from "../src/domain/gcn-domain.mjs";

import {
  extractDataFromCircular,
  extractDeterministicPhotometry,
  synthesizeEventLedger,
  discoverRecentGcnEvents,
  trackEvent,
} from "../scripts/gcn-tracker.mjs";

const execFileAsync = promisify(execFile);

// =============================================================================
// Slice 1: Alias Unification, Deduplication & Canonical T0 Priority
// =============================================================================
test("Slice 1: canonicalizeTransientId standardizes casing and spacing across transient classes", () => {
  assert.equal(canonicalizeTransientId("GRB261029A"), "GRB 261029A");
  assert.equal(canonicalizeTransientId("GRB 261029A"), "GRB 261029A");
  assert.equal(canonicalizeTransientId("AT 2026AHAW"), "AT 2026ahaw");
  assert.equal(canonicalizeTransientId("AT2026ahaw"), "AT 2026ahaw");
  assert.equal(canonicalizeTransientId("SN 2024ABC"), "SN 2024abc");
  assert.equal(canonicalizeTransientId("SN2024abc"), "SN 2024abc");
  assert.equal(canonicalizeTransientId("EP240414a"), "EP 240414a");
  assert.equal(canonicalizeTransientId("GW170817"), "GW170817");
  assert.equal(canonicalizeTransientId("GOTO26LLT"), "GOTO26LLT");
});

test("Slice 1: unifyEventAliases eliminates duplicate/noisy variants and normalizes primary + aliases", () => {
  const subject = "GRB 261029A: Optical observations of afterglow";
  const body = `
    We report follow-up observations of GRB261029A detected by Fermi and SVOM.
    The optical counterpart was first identified as AT 2026AHAW (AT2026ahaw)
    and GOTO candidate GOTO26LLT.
  `;

  const unified = unifyEventAliases(subject, body, "GRB 261029A");

  assert.equal(unified.primary_id, "GRB 261029A");
  // Spaceless duplicates like GRB261029A and casing duplicate AT2026AHAW must be eliminated
  assert.deepEqual(unified.aliases, ["AT 2026ahaw", "GOTO26LLT"]);
  assert.deepEqual(unified.all_ids, ["GRB 261029A", "AT 2026ahaw", "GOTO26LLT"]);

  // Title formatting preview check:
  const title = `${unified.primary_id}${unified.aliases.length ? " / " + unified.aliases.join(" / ") : ""}`;
  assert.equal(title, "GRB 261029A / AT 2026ahaw / GOTO26LLT");
});

test("Slice 1: resolveCanonicalT0 enforces strict instrument priority hierarchy (GW > Fermi/GBM > Swift/BAT > SVOM/ECLAIRs)", () => {
  // Candidate pool with SVOM, Fermi, Swift, and EP
  const candidates = [
    { instrument: "SVOM/ECLAIRs", utc_iso: "2026-10-29T01:27:00.000Z", circular_id: 46072 },
    { instrument: "Swift/BAT", utc_iso: "2026-10-29T01:27:01.000Z", circular_id: 46074 },
    { instrument: "Fermi/GBM", utc_iso: "2026-10-29T01:27:03.000Z", circular_id: 46071 },
    { instrument: "EP/WXT", utc_iso: "2026-10-29T01:27:05.000Z", circular_id: 46075 },
  ];

  const canonical = resolveCanonicalT0(candidates);
  assert.ok(canonical);
  assert.equal(canonical.instrument, "Fermi/GBM");
  assert.equal(canonical.utc_iso, "2026-10-29T01:27:03.000Z");
  assert.equal(canonical.circular_id, 46071);

  // If a GW candidate arrives, GW takes precedence over Fermi
  const withGw = [
    ...candidates,
    { instrument: "GW/LIGO", utc_iso: "2026-10-29T01:26:59.000Z", circular_id: 46070 },
  ];
  const gwWinner = resolveCanonicalT0(withGw);
  assert.equal(gwWinner.instrument, "GW");
  assert.equal(gwWinner.utc_iso, "2026-10-29T01:26:59.000Z");
});

// =============================================================================
// Slice 2: Zero-Homogenization Photometry Extraction Across Diverse Facilities
// =============================================================================
test("Slice 2: extracts zero-homogenization photometry, missing uncertainties, approximate epochs, and 3-sigma limits", async () => {
  // Mock circulars representing real GCN reports
  const circulars = [
    // GCN 46071: Fermi GBM trigger (canonical T0)
    {
      circularId: 46071,
      subject: "GRB 261029A: Fermi GBM Detection",
      submitter: "Fermi",
      createdOn: new Date("2026-10-29T01:30:00Z").getTime(),
      body: "At 01:27:03.00 UT on 29 October 2026, the Fermi Gamma-ray Burst Monitor (GBM) triggered and located GRB 261029A.",
    },
    // GCN 46073: GOTO early detection (L band)
    {
      circularId: 46073,
      subject: "GRB 261029A: GOTO detection of optical counterpart",
      submitter: "D. O'Neill",
      createdOn: new Date("2026-10-29T02:00:00Z").getTime(),
      body: "We detected the afterglow: L = 13.69 ± 0.01 AB mag at 01:39:12 (+0.20h)",
    },
    // GCN 46082: LCO initial report (will be superseded by 46084)
    {
      circularId: 46082,
      subject: "GRB 261029A: LCO observations",
      submitter: "Yin",
      createdOn: new Date("2026-10-29T04:00:00Z").getTime(),
      body: "r = 17.25 +/- 0.02 AB (mid-time 2.17 hr after the trigger)\nz = 17.34 +/- 0.04 AB (mid-time 2.83 hr after the trigger)",
    },
    // GCN 46084: LCO corrected calibration
    {
      circularId: 46084,
      subject: "GRB 261029A: correction to GCN 46082 (LCO observations)",
      submitter: "Yin",
      createdOn: new Date("2026-10-29T05:00:00Z").getTime(),
      body: "r = 17.25 +/- 0.02 AB (mid-time 2.17 hr after the trigger)\nz = 17.34 +/- 0.04 AB (mid-time 2.83 hr after the trigger)",
    },
    // GCN 46101: Liverpool Telescope (approximate epoch + detection)
    {
      circularId: 46101,
      subject: "GRB 261029A: Liverpool Telescope observations",
      submitter: "Dimple",
      createdOn: new Date("2026-10-29T21:00:00Z").getTime(),
      body: "Observations started on 2026-10-29 at 20:11:47 UT (0.790 days after the burst).\nWe clearly detected the afterglow with magnitude 20.37+/- 0.06 in r-band.",
    },
    // GCN 46102: Ondrejov D50 (unreported uncertainty + approximate epoch)
    {
      circularId: 46102,
      subject: "GRB 261029A: Ondrejov D50 optical observations, possible rebrightening",
      submitter: "Novotny",
      createdOn: new Date("2026-10-29T22:00:00Z").getTime(),
      body: "The photometry suggests the afterglow reached i~19.6 at 0.75 day post-burst.",
    },
    // GCN 46103: LCO Siding Spring table (r', i', g')
    {
      circularId: 46103,
      subject:
        "GRB 261029A: ULL-ASTRO-MASTER observations with LCO 1-m telescope at Siding Spring Observatory",
      submitter: "Rodriguez-Torres",
      createdOn: new Date("2026-10-29T23:00:00Z").getTime(),
      body: `
Date (UT, mid-time)       | filter  |  mag   | error | 
------------------------------------------------------
2026-10-29 10:25:56           r'      19.61     0.05
2026-10-29 10:56:32           i'      19.33     0.07
2026-10-29 11:32:06           g'      20.78     0.10
      `,
    },
    // GCN 46104: WFST table (g band)
    {
      circularId: 46104,
      subject: "GRB 261029A: WFST optical observations",
      submitter: "Yan-Long Hua",
      createdOn: new Date("2026-10-30T00:00:00Z").getTime(),
      body: `
MJD | exposure time (s) | band |  mag (AB) 
-------------|-------------------|------|---------------
    61342.56469907407     |         120        | g |  20.73+/-0.02
      `,
    },
    // GCN 46099: Panzhihua 60cm (L band)
    {
      circularId: 46099,
      subject: "GRB 261029A: Optical detection with 60cm Panzhihua Telescope",
      submitter: "Zhao",
      createdOn: new Date("2026-10-30T01:00:00Z").getTime(),
      body: `
The observations were initiated at 2026-10-29T13:38:33.40 (~12.19 hours after the trigger) with the 60cm Panzhihua Telescope.
MJD (Exp_Start)       MAG                          FILTER
61342.56844            20.23 +/- 0.15              L
      `,
    },
    // GCN 46113: PKU 60cm late-time 3-sigma upper limits
    {
      circularId: 46113,
      subject: "GRB 261029A: PKU 60cm telescope observations",
      submitter: "Kang",
      createdOn: new Date("2026-10-30T12:00:00Z").getTime(),
      body: `
Filter | Start_UT | T_mid - T0 (days) | Filter | Exposure | Mag / Upper Limit
---|---|---|---|---|---
| 2026-10-30 | 11:00 | 1.430 | r | 1800 | > 22.14 |
| 2026-10-30 | 12:00 | 1.500 | i | 1800 | > 21.48 |
      `,
    },
  ];

  const ledger = synthesizeEventLedger("grb-261029a", circulars, {
    targetPrimaryId: "GRB 261029A",
  });
  assert.ok(ledger);
  assert.equal(ledger.primary_id, "GRB 261029A");
  assert.ok(ledger.canonical_t0);
  assert.equal(ledger.canonical_t0.instrument, "Fermi/GBM");
  assert.equal(ledger.canonical_t0.utc_iso, "2026-10-29T01:27:03.000Z");

  const pts = ledger.photometry_points;
  assert.ok(pts.length >= 10, `Expected >= 10 photometry points, got ${pts.length}`);

  // 1. GOTO L-band
  const gotoPt = pts.find((p) => p.telescope === "GOTO");
  assert.ok(gotoPt);
  assert.equal(gotoPt.mag, 13.69);
  assert.equal(gotoPt.mag_err, 0.01);
  assert.equal(gotoPt.band, "Clear/L");
  assert.equal(gotoPt.dt_hours, 0.2);

  // 2. Liverpool Telescope (GCN 46101): r = 20.37 +/- 0.06 at 18.96h
  const ltPt = pts.find((p) => p.telescope === "Liverpool" && p.band === "r");
  assert.ok(ltPt, "Liverpool r-band point must be extracted");
  assert.equal(ltPt.mag, 20.37);
  assert.equal(ltPt.mag_err, 0.06);
  assert.equal(ltPt.dt_hours, 18.96);
  assert.equal(ltPt.time_approximate, true);

  // 3. Ondrejov D50 (GCN 46102): i~19.6 at 18h (missing error, approximate time)
  const d50Pt = pts.find((p) => p.telescope === "Ondrejov D50");
  assert.ok(d50Pt, "D50 point must be extracted");
  assert.equal(d50Pt.mag, 19.6);
  assert.equal(d50Pt.mag_err, null);
  assert.equal(d50Pt.time_approximate, true);
  assert.equal(d50Pt.discrepancy_note, "uncertainty not reported");

  // 4. LCO Siding Spring (GCN 46103): r'=19.61, i'=19.33, g'=20.78
  const lcoR = pts.find((p) => p.circular_id === 46103 && p.band === "r");
  const lcoI = pts.find((p) => p.circular_id === 46103 && p.band === "i");
  const lcoG = pts.find((p) => p.circular_id === 46103 && p.band === "g");
  assert.ok(lcoR, "LCO Siding Spring r' must be extracted");
  assert.ok(lcoI, "LCO Siding Spring i' must be extracted");
  assert.ok(lcoG, "LCO Siding Spring g' must be extracted");
  assert.equal(lcoR.mag, 19.61);
  assert.equal(lcoI.mag, 19.33);
  assert.equal(lcoG.mag, 20.78);
  assert.equal(lcoR.dt_hours, 8.98);
  assert.equal(lcoI.dt_hours, 9.49);
  assert.equal(lcoG.dt_hours, 10.08);

  // 5. WFST (GCN 46104): g = 20.73 +/- 0.02
  const wfstPt = pts.find((p) => p.telescope === "WFST" && p.band === "g");
  assert.ok(wfstPt, "WFST g-band point must be extracted");
  assert.equal(wfstPt.mag, 20.73);
  assert.equal(wfstPt.mag_err, 0.02);
  assert.ok(
    Math.abs(wfstPt.dt_hours - 12.11) <= 0.05,
    `WFST dt expected ~12.11, got ${wfstPt.dt_hours}`
  );

  // 6. Panzhihua (GCN 46099): L = 20.23 +/- 0.15
  const panPt = pts.find((p) => p.telescope === "Panzhihua 60cm");
  assert.ok(panPt, "Panzhihua L-band point must be extracted");
  assert.equal(panPt.mag, 20.23);
  assert.equal(panPt.mag_err, 0.15);
  assert.equal(panPt.dt_hours, 12.19);

  // 7. Version conflict: GCN 46082 vs 46084
  const conflictPt = pts.find((p) => p.circular_id === 46082);
  const correctedPt = pts.find((p) => p.circular_id === 46084);
  assert.ok(conflictPt && correctedPt);
  assert.equal(conflictPt.version_conflict, true);
  assert.equal(correctedPt.version_conflict, false);

  // 8. 3-sigma Upper Limit: PKU 60cm GCN 46113
  const ulPt = pts.find((p) => p.circular_id === 46113 && p.band === "r");
  assert.ok(ulPt);
  assert.equal(ulPt.is_upper_limit, true);
  assert.equal(ulPt.limit_sigma, 3);
  assert.equal(ulPt.mag, 22.14);
  assert.equal(ulPt.mag_err, null);

  // 9. Feature zoom callouts contain $3\sigma$ LaTeX string
  assert.ok(ledger.feature_zoom.enabled);
  const ulCallout = ledger.feature_zoom.callouts.find((c) => c.text.includes("upper limit"));
  assert.ok(ulCallout);
  assert.ok(ulCallout.text.includes("$3\\sigma$"), "Callout text must format math as $3\\sigma$");
});

// =============================================================================
// Slice 3: Tiered Redshift Selection & Multi-Messenger Metadata
// =============================================================================
test("Slice 3: selectBestRedshift enforces spectroscopic > host > photometric > upper_limit hierarchy and conflict detection", () => {
  const records = [
    { z: 3.1, z_err: 0.15, type: "photometric", instrument: "GROND" },
    { z: 3.2, z_err: 0.05, type: "host", instrument: "VLT/MUSE" },
    { z: 3.27, z_err: 0.005, type: "spectroscopic", instrument: "NOT/ALFOSC" },
    { z: 4.5, z_err: null, type: "upper_limit", instrument: "UVOT" },
  ];

  const selection = selectBestRedshift(records);
  assert.ok(selection.best_redshift);
  assert.equal(selection.best_redshift.z, 3.27);
  assert.equal(selection.best_redshift.type, "spectroscopic");
  assert.equal(selection.best_redshift.instrument, "NOT/ALFOSC");
  assert.equal(selection.has_conflict, false);

  // Conflict detection: two top-tier spectroscopic values diverging > 0.05
  const conflictRecords = [
    { z: 3.27, type: "spectroscopic", instrument: "NOT/ALFOSC" },
    { z: 3.42, type: "spectroscopic", instrument: "Keck/LRIS" },
  ];
  const conflictResult = selectBestRedshift(conflictRecords);
  assert.equal(conflictResult.has_conflict, true);
});

test("Slice 3: extractDataFromCircular extracts EP-FXT X-ray flux metadata", async () => {
  const xrayCirc = {
    circularId: 46086,
    subject: "GRB 261029A: EP-FXT observation",
    submitter: "Kan",
    body: "EP-FXT began observation about 47 minutes after the burst. 0.5-10 keV flux = 2.822e-11 erg/cm2/s. Flux error = 1.28e-12 erg/cm2/s.",
  };

  const data = await extractDataFromCircular(xrayCirc);
  assert.ok(data.xray_points.length > 0);
  const xp = data.xray_points[0];
  assert.equal(xp.band, "0.5-10 keV");
  assert.equal(xp.flux_erg_cm2_s, 2.822e-11);
  assert.equal(xp.flux_err, 1.28e-12);
  assert.equal(xp.instrument, "EP-FXT");
});

// =============================================================================
// Slice 4: Incremental Cursor & 7-Day Inactivity Sunset
// =============================================================================
test("Slice 4: tracks last_circular_id cursor and evaluates 7-day inactivity sunset", () => {
  const circulars = [
    {
      circularId: 46071,
      subject: "Alert",
      createdOn: new Date("2026-10-29T01:27:03Z").getTime(),
      body: "Trigger",
    },
    {
      circularId: 46117,
      subject: "Refinement",
      createdOn: new Date("2026-10-30T21:20:00Z").getTime(),
      body: "Data",
    },
  ];

  const ledger = synthesizeEventLedger("grb-261029a", circulars);
  assert.equal(ledger.last_circular_id, 46117);
  assert.equal(ledger.circular_count, 2);

  // 1. Active: updated 2 days ago
  const twoDaysAgo = new Date("2026-11-01T21:20:00Z");
  assert.equal(shouldArchiveEvent("2026-10-30T21:20:00Z", twoDaysAgo, 7), false);

  // 2. Sunset: updated 8 days ago (> 7 days)
  const eightDaysAgo = new Date("2026-11-08T21:20:00Z");
  assert.equal(shouldArchiveEvent("2026-10-30T21:20:00Z", eightDaysAgo, 7), true);
});

// =============================================================================
// Slice 5: Sandboxed Light-Curve Plot Generation & Zero Workspace Leakage
// =============================================================================
test("Slice 5: gcn-plot.py renders publication-grade figure into sandboxed directory with zero workspace leakage", async (t) => {
  const ws = await createTemporaryWorkspace("gcn-plot-test-", t);

  const mockLedger = {
    primary_id: "GRB 261029A",
    aliases: ["AT 2026ahaw", "GOTO26LLT"],
    canonical_t0: {
      instrument: "Fermi/GBM",
      utc_iso: "2026-10-29T01:27:03.000Z",
    },
    best_redshift: {
      z: 3.27,
      type: "spectroscopic",
      instrument: "NOT/ALFOSC",
    },
    photometry_points: [
      {
        dt_hours: 0.2,
        band: "Clear/L",
        mag: 13.69,
        mag_err: 0.01,
        is_upper_limit: false,
        system: "AB",
      },
      { dt_hours: 1.56, band: "r", mag: 16.61, mag_err: 0.01, is_upper_limit: false, system: "AB" },
      { dt_hours: 8.98, band: "r", mag: 19.61, mag_err: 0.05, is_upper_limit: false, system: "AB" },
      {
        dt_hours: 18.0,
        band: "i",
        mag: 19.6,
        mag_err: null,
        is_upper_limit: false,
        discrepancy_note: "uncertainty not reported",
        time_approximate: true,
      },
      {
        dt_hours: 18.96,
        band: "r",
        mag: 20.37,
        mag_err: 0.06,
        is_upper_limit: false,
        telescope: "Liverpool",
        time_approximate: true,
      },
      {
        dt_hours: 34.32,
        band: "r",
        mag: 22.14,
        mag_err: null,
        is_upper_limit: true,
        limit_sigma: 3,
      },
    ],
    xray_points: [],
    feature_zoom: {
      enabled: true,
      bands: ["r", "i"],
      t_min_hours: 8.0,
      t_max_hours: 42.0,
      alpha_ref: 1.4,
      title: "Late-time plateau & rebrightening zoom",
      callouts: [
        { dt_hours: 18.0, mag: 19.6, text: "D50: ~19.6\nuncertainty not reported" },
        { dt_hours: 18.96, mag: 20.37, text: "Liverpool r\ntime approximate" },
        { dt_hours: 34.32, mag: 22.14, text: "$3\\sigma$ upper limits" },
      ],
    },
  };

  const inputJsonPath = join(ws.path, "event-ledger.json");
  const outputPngPath = join(ws.path, "test-figure.png");

  await writeFile(inputJsonPath, JSON.stringify(mockLedger, null, 2), "utf8");

  // Execute plotting script with injected paths
  await execFileAsync("python3", [
    "scripts/gcn-plot.py",
    "--input",
    inputJsonPath,
    "--output",
    outputPngPath,
  ]);

  assert.ok(existsSync(outputPngPath), "Figure PNG must exist in temporary sandbox");
  const fileStat = await stat(outputPngPath);
  assert.ok(fileStat.size > 20000, `Figure PNG should have valid size, got ${fileStat.size} bytes`);

  // Verify zero leakage to public directory
  assert.equal(existsSync(join(process.cwd(), "public", "test-figure.png")), false);
});

// =============================================================================
// Slice 6: SSOT Metadata Formatting Pure Functions
// =============================================================================
test("Slice 6: formatCanonicalT0Badge renders formatted badge or empty string", () => {
  assert.equal(
    formatCanonicalT0Badge({ instrument: "Fermi/GBM", utc_iso: "2026-10-29T01:27:03.000Z" }),
    "2026-10-29 01:27:03 UTC (Fermi/GBM)"
  );
  assert.equal(
    formatCanonicalT0Badge({ utc_iso: "2026-10-29T01:27:03.000Z" }),
    "2026-10-29 01:27:03 UTC"
  );
  assert.equal(formatCanonicalT0Badge(null), "");
  assert.equal(formatCanonicalT0Badge({ utc_iso: "invalid-date" }), "");
});

test("Slice 6: formatRedshiftBadge renders tiered authority badge with conflict flag", () => {
  assert.equal(
    formatRedshiftBadge({ z: 3.27, type: "spectroscopic", instrument: "NOT/ALFOSC" }),
    "z = 3.27 (spectroscopic · NOT/ALFOSC)"
  );
  assert.equal(
    formatRedshiftBadge({ z: 3.27, type: "spectroscopic", instrument: "NOT/ALFOSC" }, true),
    "z = 3.27 (spectroscopic · NOT/ALFOSC) [conflict]"
  );
  assert.equal(formatRedshiftBadge({ z: 2.1 }), "z = 2.1");
  assert.equal(formatRedshiftBadge(null), "");
  assert.equal(formatRedshiftBadge({ z: NaN }), "");
});

test("Slice 6: formatAliasList and formatMultiMessengerBadges render standard strings", () => {
  assert.equal(formatAliasList(["AT 2026ahaw", "GOTO26LLT"]), "AT 2026ahaw / GOTO26LLT");
  assert.equal(formatAliasList([]), "");
  assert.equal(formatAliasList(null), "");

  const mmBadges = formatMultiMessengerBadges([
    { type: "GW", instrument: "LIGO/Virgo", circular_id: 46070 },
    { type: "Neutrino", detector: "IceCube", circular_id: 46075 },
    "Custom Alert (GCN #46080)",
  ]);
  assert.deepEqual(mmBadges, [
    "GW: LIGO/Virgo (GCN #46070)",
    "Neutrino: IceCube (GCN #46075)",
    "Custom Alert (GCN #46080)",
  ]);
});

// =============================================================================
// Slice 7: Dynamic Version-Conflict Detection & Dynamic T0 Propagation
// =============================================================================
test("Slice 7: dynamically detects version conflicts from correction circulars without hardcoded IDs", () => {
  const circulars = [
    {
      circularId: 88801,
      subject: "GRB 990101A: Initial optical detection",
      submitter: "Telescope A",
      body: "r = 18.20 +/- 0.05 AB (mid-time 1.50 hr after the trigger)",
    },
    {
      circularId: 88802,
      subject: "GRB 990101A: Correction to GCN 88801 (updated calibration)",
      submitter: "Telescope A",
      body: "r = 18.45 +/- 0.05 AB (mid-time 1.50 hr after the trigger)",
    },
  ];

  const ledger = synthesizeEventLedger("grb-990101a", circulars);
  assert.ok(ledger);

  const supersededPoint = ledger.photometry_points.find((p) => p.circular_id === 88801);
  const correctedPoint = ledger.photometry_points.find((p) => p.circular_id === 88802);

  assert.ok(supersededPoint, "Point from 88801 must be extracted");
  assert.ok(correctedPoint, "Point from 88802 must be extracted");
  assert.equal(supersededPoint.version_conflict, true);
  assert.equal(supersededPoint.discrepancy_note, "version conflict");
  assert.equal(correctedPoint.version_conflict, false);
});

test("Slice 7: extractDeterministicPhotometry dynamically shifts dt_hours based on injected canonicalT0Iso", () => {
  const tableCircular = {
    circularId: 77701,
    subject: "GRB 990101A: ULL-ASTRO-MASTER observations with LCO at Siding Spring",
    submitter: "Observer",
    body: `
Date (UT, mid-time)       | filter  |  mag   | error |
------------------------------------------------------
2026-10-29 10:25:56           r'      19.61     0.05
    `,
  };

  // With T0 at 01:27:03 UTC -> dt = ~8.98 hours
  const pts1 = extractDeterministicPhotometry(tableCircular, {
    canonicalT0Iso: "2026-10-29T01:27:03.000Z",
  });
  assert.equal(pts1.length, 1);
  assert.equal(pts1[0].dt_hours, 8.98);

  // With T0 shifted by 4 hours to 05:25:56 UTC -> dt = 5.00 hours
  const pts2 = extractDeterministicPhotometry(tableCircular, {
    canonicalT0Iso: "2026-10-29T05:25:56.000Z",
  });
  assert.equal(pts2.length, 1);
  assert.equal(pts2[0].dt_hours, 5.0);
});

// =============================================================================
// Slice 8: Auto-Discovery Surveillance (discoverRecentGcnEvents)
// =============================================================================
test("Slice 8: discoverRecentGcnEvents filters transient candidates by volume and follow-up keywords", async () => {
  const mockArchiveHtml = `
    <html>
      <body>
        <!-- GRB 261101A has 5 circulars (meets minTotalCirculars = 5) -->
        <a href="/circulars/50001">GRB 261101A: Fermi trigger</a>
        <a href="/circulars/50002">GRB 261101A: Swift detection</a>
        <a href="/circulars/50003">GRB 261101A: Radio follow-up</a>
        <a href="/circulars/50004">GRB 261101A: X-ray afterglow</a>
        <a href="/circulars/50005">GRB 261101A: Refinement</a>

        <!-- AT 2026xyz has 2 circulars with optical/photometry keywords (meets minPhotometryCirculars = 2) -->
        <a href="/circulars/50006">AT 2026xyz: Optical counterpart discovery</a>
        <a href="/circulars/50007">AT 2026xyz: Photometry and upper limits</a>

        <!-- FRB 261102A has only 1 circular without optical follow-up (below both thresholds) -->
        <a href="/circulars/50008">FRB 261102A: CHIME alert notice</a>
      </body>
    </html>
  `;

  const mockFetch = async (url) => {
    assert.ok(url.includes("https://gcn.nasa.gov/circulars"));
    return {
      ok: true,
      status: 200,
      text: async () => mockArchiveHtml,
    };
  };

  const discovered = await discoverRecentGcnEvents({
    fetchFn: mockFetch,
    minPhotometryCirculars: 2,
    minTotalCirculars: 5,
  });

  assert.ok(
    discovered.includes("GRB 261101A"),
    "GRB 261101A must qualify via total circular count"
  );
  assert.ok(
    discovered.includes("AT 2026xyz"),
    "AT 2026xyz must qualify via optical photometry count"
  );
  assert.equal(discovered.includes("FRB 261102A"), false, "FRB 261102A must be filtered out");
});

// =============================================================================
// Slice 9: Expanded Photometry Formats & Empty Plot Suppression
// =============================================================================
test("Slice 9: extracts GIT tabular, MeerLICHT timed, and REM block photometry correctly", () => {
  const canonicalT0Iso = "2022-10-09T13:16:59.000Z";

  // GIT table
  const gitCirc = {
    circularId: 32662,
    subject: "GRB 221009A: GIT detection of the optical afterglow",
    body: `
-------------------------------------------------------------------
 JD (mid) | T_mid-T0(hrs) | Filter | Magnitude (AB) |
-------------------------------------------------------------------
2459862.18181 | 2.19 | g' | 17.66 +/- 0.07 |
2459862.18451 | 2.25 | r' | 16.16 +/- 0.07 |
-------------------------------------------------------------------
`,
  };
  const gitPts = extractDeterministicPhotometry(gitCirc, { canonicalT0Iso });
  assert.equal(gitPts.length, 2);
  assert.equal(gitPts[0].dt_hours, 2.19);
  assert.equal(gitPts[0].band, "g");
  assert.equal(gitPts[0].mag, 17.66);
  assert.equal(gitPts[0].telescope, "GIT");

  // MeerLICHT timed lines
  const mlCirc = {
    circularId: 32646,
    subject: "GRB 221009A: MeerLICHT observations",
    createdOn: new Date("2022-10-10T00:00:00Z").getTime(),
    body: `
Observations began at 17:49:44 UT on 2022 October 9.
u > 17.91 at 18:06:27 UT
g = 18.22 +/- 0.33 at 18:21:07 UT
r = 17.76 +/- 0.08 at 18:23:59 UT
`,
  };
  const mlPts = extractDeterministicPhotometry(mlCirc, { canonicalT0Iso });
  assert.ok(mlPts.length >= 2, "Must extract MeerLICHT detections and limits");
  const rPt = mlPts.find((p) => p.band === "r");
  assert.ok(rPt);
  assert.equal(rPt.mag, 17.76);
  assert.equal(rPt.telescope, "MeerLICHT");
  assert.equal(rPt.dt_hours > 5.0 && rPt.dt_hours < 5.2, true);

  // REM multi-line block
  const remCirc = {
    circularId: 32652,
    subject: "GRB 221009A: REM optical and NIR detection",
    body: `
The optical and NIR afterglow is detected. We derive:
r = 17.36 +/- 0.12
H = 12.21 +/- 0.04
at a mid time of t-t0 ~ 10.47 hours after the GBM trigger.
`,
  };
  const remPts = extractDeterministicPhotometry(remCirc, { canonicalT0Iso });
  assert.equal(remPts.length, 2);
  assert.equal(remPts[0].dt_hours, 10.47);
  assert.equal(remPts[0].telescope, "REM");
});

test("Slice 9: gcn-plot.py suppresses plot generation when photometry points are insufficient (< 2)", async (t) => {
  const sandbox = await createTemporaryWorkspace("gcn-suppress-test", t);
  const ledgerPath = join(sandbox.path, "test-event.json");
  const outputPath = join(sandbox.path, "test-event.png");

  // Event with 0 optical points and 1 X-ray point
  const zeroOpticalLedger = {
    primary_id: "GRB 261026A",
    canonical_t0: { instrument: "SVOM/ECLAIRs", utc_iso: "2026-10-26T06:09:37.000Z" },
    photometry_points: [],
    xray_points: [
      { dt_hours: 0.78, band: "0.5-10 keV", flux_erg_cm2_s: 2.8e-12, flux_err: 1.8e-13 },
    ],
  };

  await writeFile(ledgerPath, JSON.stringify(zeroOpticalLedger), "utf8");

  // Run gcn-plot.py
  const pythonScript = resolve("scripts/gcn-plot.py");
  await execFileAsync("python3", [pythonScript, "--input", ledgerPath, "--output", outputPath]);

  // Output file must NOT exist
  assert.equal(
    existsSync(outputPath),
    false,
    "gcn-plot.py must not generate an empty canvas when optical points < 2"
  );
});

test("Slice 10: trackEvent supports dryRun mode without writing files or mutating state", async (t) => {
  const sandbox = await createTemporaryWorkspace("gcn-dryrun-test", t);
  const mockFetch = async (url) => {
    if (url.includes("/circulars?query=")) {
      const html = '<a href="/circulars/99901">GRB 261101A: Discovery</a>';
      return {
        ok: true,
        text: async () => html,
      };
    }
    if (url.includes("/circulars/99901")) {
      return {
        ok: true,
        json: async () => ({
          circularId: 99901,
          subject: "GRB 261101A: Swift detection",
          createdOn: 1730500000000,
          body: "Observations began ~ 1.50 hours after the trigger.\nr = 19.50 +/- 0.05",
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const result = await trackEvent("GRB 261101A", {
    dataDir: sandbox.path,
    figuresDir: sandbox.path,
    fetchFn: mockFetch,
    generatePlot: true,
    dryRun: true,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.primary_id, "GRB 261101A");
  assert.equal(result.figurePath, null);
  assert.equal(result.ledger.photometry_points.length, 1);

  // Assert no files were created in dataDir/figuresDir
  const files = await readdir(sandbox.path);
  assert.equal(files.length, 0, "dryRun must not emit files to disk");
});

test("Slice 10: gcn-tracker-cli supports --dry-run and --inspect flags", async (t) => {
  const cliScript = resolve("scripts/gcn-tracker-cli.mjs");
  const { stdout } = await execFileAsync("node", [cliScript, "GRB 261026A", "--inspect"]);

  assert.match(stdout, /\[GCN Tracker CLI Inspect\] Target: GRB 261026A/);
  assert.match(stdout, /Primary ID:\s*GRB 261026A/);
  assert.match(stdout, /Photometry Points:\s*2/);
  assert.match(stdout, /Plot Eligible:\s*true/);
  assert.match(stdout, /Dry Run Mode:\s*true/);
});
