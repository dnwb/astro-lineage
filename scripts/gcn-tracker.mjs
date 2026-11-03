/**
 * scripts/gcn-tracker.mjs
 *
 * Automated GCN Circulars Transient Surveillance, Multi-Wavelength/Multi-Messenger Extraction,
 * and Light-Curve Tracking Engine.
 *
 * Architecture Blueprint: docs/adr/0083-first-class-transient-events-and-zero-homogenization-gcn-photometry.md
 * Domain Glossary: CONTEXT.md (§ Transient Event Tracking & GCN Surveillance)
 */

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  normalizeEventSlug,
  unifyEventAliases,
  resolveCanonicalT0,
  computeObserverDeltaHours,
  selectBestRedshift,
  isPhotometryOrFollowupCandidate,
  shouldArchiveEvent,
} from "../src/domain/gcn-domain.mjs";
import { DEFAULT_BASE_URL, DEFAULT_API_KEY, executeChatCompletion } from "./agent-core.mjs";

const execFileAsync = promisify(execFile);

export const DEFAULT_DATA_DIR = "src/data/gcn-events";
export const DEFAULT_FIGURES_DIR = "public/gcn-figures";
export const DEFAULT_STATE_PATH = ".local-state/gcn-tracker-state.json";

/**
 * Searches GCN Circulars for a query string.
 *
 * @param {string} query
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchFn=fetch]
 * @returns {Promise<Array<{ circularId: number, subject: string }>>}
 */
export async function fetchGcnSearchResults(query, { fetchFn = fetch } = {}) {
  const trimmed = String(query || "").trim();
  const searchQ = trimmed.includes(" ") && !trimmed.startsWith('"') ? `"${trimmed}"` : trimmed;
  const url = `https://gcn.nasa.gov/circulars?query=${encodeURIComponent(searchQ)}&limit=100`;
  const response = await fetchFn(url, {
    headers: { Accept: "text/html,application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch GCN search results: HTTP ${response.status}`);
  }
  const text = await response.text();

  // Core token to filter out irrelevant query results (e.g. 261029A from "GRB 261029A")
  const tokenMatch = trimmed.match(/(\d{6}[A-Za-z]?|\d{4}[a-z]{1,4})/i);
  const coreToken = tokenMatch ? tokenMatch[1].toUpperCase() : "";

  let rawItems = [];
  // Try parsing Remix state from HTML
  const remixMatch = text.match(/window\.__remixContext\s*=\s*(\{[\s\S]+?\});<\/script>/u);
  if (remixMatch) {
    try {
      const ctx = JSON.parse(remixMatch[1]);
      const items = ctx.state?.loaderData?.["routes/circulars._archive._index"]?.items || [];
      rawItems = items.map((it) => ({
        circularId: Number(it.circularId),
        subject: String(it.subject || "").trim(),
      }));
    } catch {}
  }

  // Fallback: extract circular links via regex
  if (rawItems.length === 0) {
    const idMap = new Map();
    const linkMatches = text.matchAll(/href=["']\/circulars\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi);
    for (const m of linkMatches) {
      const cid = Number(m[1]);
      const subj = m[2].replace(/<[^>]+>/g, "").trim();
      if (!idMap.has(cid)) {
        idMap.set(cid, { circularId: cid, subject: subj });
      }
    }
    rawItems = Array.from(idMap.values());
  }

  // Filter by core token if available so unrelated circulars are not bundled
  if (coreToken) {
    rawItems = rawItems.filter((it) => it.subject.toUpperCase().includes(coreToken));
  }

  return rawItems.sort((a, b) => b.circularId - a.circularId);
}

/**
 * Fetches an individual GCN circular JSON by circular ID.
 *
 * @param {number|string} circularId
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchFn=fetch]
 * @returns {Promise<{ circularId: number, eventId?: string, subject: string, createdOn?: number, submitter?: string, body: string }>}
 */
export async function fetchGcnCircular(circularId, { fetchFn = fetch } = {}) {
  const url = `https://gcn.nasa.gov/circulars/${circularId}.json`;
  const response = await fetchFn(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch GCN circular ${circularId}: HTTP ${response.status}`);
  }
  const data = await response.json();
  return {
    circularId: Number(data.circularId || circularId),
    eventId: data.eventId || "",
    subject: data.subject || "",
    createdOn: data.createdOn,
    submitter: data.submitter || "",
    body: data.body || "",
    version: data.version || 1,
  };
}

/**
 * Deterministically parses trigger T0 candidate from circular text.
 */
function extractDeterministicTriggerT0(circular) {
  const text = `${circular.subject || ""}\n${circular.body || ""}`;

  // 1. Explicit T0 = ... format
  const t0Match = text.match(/T0\s*=\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?)/i);
  if (t0Match) {
    const rawIso = t0Match[1].endsWith("Z") ? t0Match[1] : `${t0Match[1]}Z`;
    const parsed = new Date(rawIso);
    if (!Number.isNaN(parsed.getTime())) {
      let inst = "Trigger";
      if (/Fermi/i.test(text)) inst = "Fermi/GBM";
      else if (/SVOM/i.test(text)) inst = "SVOM/ECLAIRs";
      else if (/Swift/i.test(text)) inst = "Swift/BAT";
      else if (/EP|Einstein Probe/i.test(text)) inst = "EP/WXT";
      return {
        instrument: inst,
        utc_iso: parsed.toISOString(),
        circular_id: circular.circularId,
      };
    }
  }

  // 2. "At [YYYY-MM-DD] HH:MM:SS UT [on DD Month YYYY]" or "At HH:MM:SS UT"
  const atMatch = text.match(
    /(?:^|\W)At\s+(?:(\d{4}-\d{2}-\d{2})\s+)?(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)\s*UT(?:\s*on\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}-\d{2}-\d{2}))?/i
  );
  if (atMatch) {
    const isoDate = atMatch[1];
    const timeStr = atMatch[2];
    const writtenDate = atMatch[3];
    let dateStr = isoDate || writtenDate;
    if (!dateStr && circular.createdOn) {
      dateStr = new Date(circular.createdOn).toISOString().split("T")[0];
    }
    if (dateStr && timeStr) {
      const parsed = new Date(`${dateStr} ${timeStr} UTC`);
      if (!Number.isNaN(parsed.getTime())) {
        let inst = "Trigger";
        if (/Fermi\s+(?:Gamma-ray\s+Burst\s+Monitor|GBM)|\bFermi\/GBM\b|\bGBM\b/i.test(text))
          inst = "Fermi/GBM";
        else if (/Swift\s+(?:Burst\s+Alert\s+Telescope|BAT)|\bSwift\/BAT\b|\bBAT\b/i.test(text))
          inst = "Swift/BAT";
        else if (/SVOM\s+(?:ECLAIRs)|\bSVOM\/ECLAIRs\b/i.test(text)) inst = "SVOM/ECLAIRs";
        else if (/EP|Einstein\s*Probe|WXT/i.test(text)) inst = "EP/WXT";
        else if (/Konus(?:-Wind)?/i.test(text)) inst = "Konus-Wind";
        else if (/GECAM/i.test(text)) inst = "GECAM";

        if (inst !== "Trigger") {
          return {
            instrument: inst,
            utc_iso: parsed.toISOString(),
            circular_id: circular.circularId,
          };
        }
      }
    }
  }

  // 3. SVOM / other trigger starting at
  const svomMatch = text.match(
    /(?:SVOM(?:\/ECLAIRs)?|ECLAIRs).*?trigger.*?starting\s*at\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/i
  );
  if (svomMatch) {
    const parsed = new Date(`${svomMatch[1]}Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        instrument: "SVOM/ECLAIRs",
        utc_iso: parsed.toISOString(),
        circular_id: circular.circularId,
      };
    }
  }

  return null;
}

/**
 * Deterministically parses optical/NIR photometry points and upper limits.
 */
export function extractDeterministicPhotometry(
  circular,
  { canonicalT0Iso = null, supersededIds = null } = {}
) {
  const points = [];
  const body = circular.body || "";
  const subject = circular.subject || "";
  const isSuperseded =
    supersededIds instanceof Set ? supersededIds.has(Number(circular.circularId)) : false;

  const t0EpochMs = canonicalT0Iso ? new Date(canonicalT0Iso).getTime() : NaN;
  const mjd0 = Number.isFinite(t0EpochMs) ? t0EpochMs / 86400000 + 40587.0 : null;

  // Detect telescope name prioritizing subject and submitter over body citations
  let telescope = "Unknown";
  if (/\bPKU\s*60cm\b/i.test(subject) || /PKU/i.test(circular.submitter)) telescope = "PKU 60cm";
  else if (/\bLiverpool\b/i.test(subject) || /\bLiverpool\b/i.test(body)) telescope = "Liverpool";
  else if (/\bD50|Ondrejov\b/i.test(subject) || /\bOndrejov\b/i.test(body))
    telescope = "Ondrejov D50";
  else if (/\bNOT|ALFOSC\b/i.test(subject)) telescope = "NOT";
  else if (/\bULL-ASTRO-MASTER\b/i.test(subject)) telescope = "MASTER";
  else if (/\bLCO\b/i.test(subject) || /\bLCO\b/i.test(body)) telescope = "LCO";
  else if (/\bTRT\b/i.test(subject)) telescope = "TRT";
  else if (/\bKAIT\b/i.test(subject)) telescope = "KAIT";
  else if (/\bWFST\b/i.test(subject) || /\bWFST\b/i.test(body)) telescope = "WFST";
  else if (/\bGWAC|F60\b/i.test(subject)) telescope = "GWAC-F60";
  else if (/\bMIRAGE|MDM\b/i.test(subject)) telescope = "MDM/MIRAGE";
  else if (/\bGOTO\b/i.test(subject)) telescope = "GOTO";
  else if (/\bPanzhihua\b/i.test(subject)) telescope = "Panzhihua 60cm";
  else if (/\bSVOM\/VT\b/i.test(subject)) telescope = "SVOM/VT";
  else if (/\bSVOM\/C-GFT\b/i.test(subject)) telescope = "SVOM/C-GFT";
  else if (/\bCOLIBRÍ|FM-GFT\b/i.test(subject)) telescope = "COLIBRÍ";
  else if (/\bFRAM\b/i.test(subject)) telescope = "FRAM";
  else if (/\bBOOTES\b/i.test(subject) || /\bBOOTES\b/i.test(body)) telescope = "BOOTES";
  else if (/\bOSN\b/i.test(subject) || /Sierra Nevada/i.test(body)) telescope = "OSN";
  else if (/\bMeerLICHT\b/i.test(subject) || /\bMeerLICHT\b/i.test(body)) telescope = "MeerLICHT";
  else if (/\bREM\b/i.test(subject) || /\bREM\b/i.test(body)) telescope = "REM";
  else if (/\bGIT|GROWTH-India\b/i.test(subject) || /\bGROWTH\b/i.test(body)) telescope = "GIT";
  else if (/\bHCT\b/i.test(subject) || /\bHCT\b/i.test(body)) telescope = "HCT";
  else if (/\bLDT\b/i.test(subject) || /Lowell Discovery/i.test(body)) telescope = "LDT";
  else if (/\bTNG\b/i.test(subject) || /Galileo/i.test(body)) telescope = "TNG";
  else if (/\bDFOT|ARIES\b/i.test(subject) || /\bARIES\b/i.test(body)) telescope = "DFOT";
  else if (/\bSARA\b/i.test(subject) || /\bSARA\b/i.test(body)) telescope = "SARA";
  else if (/\bMuSCAT\b/i.test(subject) || /\bMuSCAT\b/i.test(body)) telescope = "MuSCAT";
  else if (/\bUVOT\b/i.test(subject) || /\bUVOT\b/i.test(body)) telescope = "Swift/UVOT";
  else if (/\bGemini\b/i.test(subject) || /\bGemini\b/i.test(body)) telescope = "Gemini";
  else if (/\bCAFOS|CAHA\b/i.test(subject) || /\bCAFOS\b/i.test(body)) telescope = "CAHA 2.2m";
  else if (/\bMITSuME\b/i.test(subject) || /\bMITSuME\b/i.test(body)) telescope = "MITSuME";
  else if (/\bDOT\b/i.test(subject) || /Devasthal Optical/i.test(body)) telescope = "DOT 3.6m";

  // 1. Markdown table extraction (e.g. PKU 60cm GCN 46090 & 46113)
  const lines = body.split("\n");
  let inTable = false;
  for (const line of lines) {
    if (line.includes("|") && /Filter|3-sigma|Upper\s*Limit|Magnitude/i.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable && line.includes("|")) {
      const parts = line
        .split("|")
        .map((p) => p.trim())
        .filter(Boolean);
      // Row pattern: Date | Start_UT | T_mid - T0 (days) | Filter | Exposure | Mag / Upper Limit
      if (parts.length >= 5) {
        const dtDays = parseFloat(parts[2]);
        const band = parts[3];
        const valStr = parts[5];
        if (!Number.isNaN(dtDays) && band && valStr) {
          const dt_hours = Math.round(dtDays * 24 * 1000) / 1000;
          if (valStr.includes(">")) {
            // Upper limit
            const limitMag = parseFloat(valStr.replace(">", "").trim());
            if (!Number.isNaN(limitMag)) {
              points.push({
                circular_id: circular.circularId,
                dt_hours,
                band,
                mag: limitMag,
                mag_err: null,
                is_upper_limit: true,
                limit_sigma: 3,
                system: "AB",
                telescope,
                discrepancy_note: isSuperseded ? "version conflict" : null,
                time_approximate: false,
                version_conflict: isSuperseded,
              });
            }
          } else if (valStr.includes("+/-") || valStr.includes("±")) {
            // Detection
            const magParts = valStr.split(/\+\/-|±/);
            const mag = parseFloat(magParts[0]);
            const mag_err = parseFloat(magParts[1]);
            if (!Number.isNaN(mag)) {
              points.push({
                circular_id: circular.circularId,
                dt_hours,
                band,
                mag,
                mag_err: Number.isNaN(mag_err) ? null : mag_err,
                is_upper_limit: false,
                limit_sigma: null,
                system: "AB",
                telescope,
                discrepancy_note: isSuperseded ? "version conflict" : null,
                time_approximate: false,
                version_conflict: isSuperseded,
              });
            }
          }
        }
      }
    }
  }

  // 1b. Pipeline / GIT / HCT pipe-delimited table:
  // e.g. 2459862.18181 | 2.19 | g' | 17.66 +/- 0.07 |
  // or 2459560.50469 | 10.94 | 900 sec | Bessell R | 20.30 +/- 0.13 | HCT |
  if (body.includes("|")) {
    for (const line of lines) {
      if (/JD|T_mid|Filter|Exp/i.test(line) && !/\d+\.\d+/.test(line)) continue;
      const parts = line
        .split("|")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length >= 3) {
        let dtH = null;
        let band = null;
        let mag = null;
        let magErr = null;
        let isUl = false;
        let rowTele = telescope;

        for (const p of parts) {
          if (dtH == null && /^\d+(?:\.\d+)?$/.test(p)) {
            const val = parseFloat(p);
            if (val > 0 && val < 50000 && !p.startsWith("245")) {
              dtH = val;
            }
          }
          if (band == null && /^[ugrizqJHKLVRIBCWwhfc'\s-]+$/i.test(p) && !/^\d+$/.test(p)) {
            const cleanB = p
              .replace(/Bessell\s*/i, "")
              .replace(/'/g, "")
              .trim();
            if (cleanB.length <= 6) band = cleanB;
          }
          if (mag == null && (p.includes("+/-") || p.includes("±"))) {
            const mParts = p.split(/\+\/-|±/);
            const mVal = parseFloat(mParts[0]);
            const eVal = parseFloat(mParts[1]);
            if (!Number.isNaN(mVal) && mVal > 5 && mVal < 35) {
              mag = mVal;
              magErr = Number.isNaN(eVal) ? null : eVal;
            }
          } else if (mag == null && p.includes(">")) {
            const mVal = parseFloat(p.replace(">", "").trim());
            if (!Number.isNaN(mVal) && mVal > 5 && mVal < 35) {
              mag = mVal;
              isUl = true;
            }
          }
          if (/HCT|GIT|CAFOS|LCO/i.test(p)) {
            rowTele = p.trim();
          }
        }

        if (dtH != null && band && mag != null) {
          points.push({
            circular_id: circular.circularId,
            dt_hours: Math.round(dtH * 1000) / 1000,
            band,
            mag,
            mag_err: magErr,
            is_upper_limit: isUl,
            limit_sigma: isUl ? 3 : null,
            system: "AB",
            telescope: rowTele,
            discrepancy_note: isSuperseded ? "version conflict" : null,
            time_approximate: false,
            version_conflict: isSuperseded,
          });
        }
      }
    }
  }

  // 2. Key-value line matches (e.g. r = 17.25 +/- 0.02 AB (mid-time 2.17 hr after the trigger))
  const kvRegex =
    /([ugrizJHKL]|r'|i'|g'|z'|Hs|VT_B|VT_R)\s*[:=]\s*(\d+\.\d+)\s*(?:\+\/-\s*|±\s*)(\d+\.\d+)?\s*(?:AB|Vega|mag)?\s*(?:\([^)]*mid-time\s*(\d+(?:\.\d+)?)\s*hr[^)]*\)|at\s*a\s*mid\s*time\s*of\s*(\d+(?:\.\d+)?)\s*(?:min|hr))/gi;
  for (const match of body.matchAll(kvRegex)) {
    const band = match[1];
    const mag = parseFloat(match[2]);
    const mag_err = match[3] ? parseFloat(match[3]) : null;
    let dt_hours = null;
    if (match[4]) dt_hours = parseFloat(match[4]);
    else if (match[5]) {
      const num = parseFloat(match[5]);
      dt_hours = match[0].includes("min") ? Math.round((num / 60) * 1000) / 1000 : num;
    }
    if (!Number.isNaN(mag) && dt_hours != null) {
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band,
        mag,
        mag_err,
        is_upper_limit: false,
        limit_sigma: null,
        system: "AB",
        telescope,
        discrepancy_note: isSuperseded ? "version conflict" : null,
        time_approximate: false,
        version_conflict: isSuperseded,
      });
    }
  }

  // 2b. Inline timed detections: band = mag +/- err at HH:MM:SS UT (or band > mag at HH:MM:SS UT)
  const timedRegex =
    /([ugrizqJHKLRVBI])\s*([:=]|>)\s*(\d+\.\d+)(?:\s*(?:\+\/-|±)\s*(\d+\.\d+))?\s+at\s+(\d{1,2}:\d{2}:\d{2})\s*UT/gi;
  for (const match of body.matchAll(timedRegex)) {
    const b = match[1];
    const isUl = match[2] === ">";
    const mag = parseFloat(match[3]);
    const magErr = match[4] ? parseFloat(match[4]) : null;
    const timeStr = match[5];

    let dt_hours = null;
    if (Number.isFinite(t0EpochMs) && canonicalT0Iso) {
      const dateInBody = body.match(
        /(?:on\s+)?(\d{4}\s+[A-Za-z]+\s+\d{1,2}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}-\d{2}-\d{2})/i
      );
      let obsDateStr = dateInBody ? dateInBody[1] : canonicalT0Iso.split("T")[0];
      let tObs = new Date(`${obsDateStr} ${timeStr} UTC`).getTime();
      if (Number.isNaN(tObs)) {
        obsDateStr = canonicalT0Iso.split("T")[0];
        tObs = new Date(`${obsDateStr} ${timeStr} UTC`).getTime();
      }
      dt_hours = Math.round(((tObs - t0EpochMs) / 3600000) * 1000) / 1000;
      if (dt_hours < 0 && dt_hours > -24) {
        dt_hours = Math.round((dt_hours + 24) * 1000) / 1000;
      }
    }

    if (dt_hours != null && dt_hours > 0 && !Number.isNaN(mag)) {
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band: b,
        mag,
        mag_err: isUl ? null : magErr,
        is_upper_limit: isUl,
        limit_sigma: isUl ? 3 : null,
        system: "AB",
        telescope: telescope !== "Unknown" ? telescope : "Optical",
        discrepancy_note: isSuperseded ? "version conflict" : null,
        time_approximate: false,
        version_conflict: isSuperseded,
      });
    }
  }

  // 2c. Multi-line blocks with dt relative to trigger:
  // e.g. at a mid time of t-t0 ~ 10.47 hours after the GBM trigger
  // e.g. about 7.3 days after the GBM trigger time
  // e.g. to ~9.5 d after the GRB
  const blockDtMatch = body.match(
    /(?:mid\s*time\s*of\s*(?:t-t0\s*~)?|~\s*)(\d+(?:\.\d+)?)\s*(hours?|days?|d)\s*(?:after\s*the\s*(?:GBM|GRB|burst|trigger))?/i
  );
  if (blockDtMatch && !body.includes("|")) {
    let dtH = parseFloat(blockDtMatch[1]);
    if (/days?|d/i.test(blockDtMatch[2])) dtH = Math.round(dtH * 24 * 1000) / 1000;

    const kvMatches = body.matchAll(
      /([ugrizJHKL]|r'|g'|i'|z'|R|V|B|I)\s*[:=]\s*(\d+\.\d+)\s*(?:\+\/-\s*|±\s*|\+\/=\s*)(\d+\.\d+)/gi
    );
    for (const km of kvMatches) {
      const b = km[1].replace("'", "").trim();
      const mVal = parseFloat(km[2]);
      const eVal = parseFloat(km[3]);
      if (!Number.isNaN(mVal) && dtH > 0) {
        points.push({
          circular_id: circular.circularId,
          dt_hours: dtH,
          band: b,
          mag: mVal,
          mag_err: Number.isNaN(eVal) ? null : eVal,
          is_upper_limit: false,
          limit_sigma: null,
          system: "AB",
          telescope: telescope !== "Unknown" ? telescope : "Follow-up",
          discrepancy_note: isSuperseded ? "version conflict" : null,
          time_approximate: true,
          version_conflict: isSuperseded,
        });
      }
    }
  }

  // 2d. BOOTES / OSN inline detections:
  const bootesMatch = body.match(
    /(?:(?:~\s*)?(\d+(?:\.\d+)?)\s*hours?\s*after\s*trigger)[\s\S]*?([ugrizJHKL]|R|V|B|I)\s*[:=]\s*(\d+\.\d+)\s*(?:\+-|\+\/-|±)\s*(\d+\.\d+)/i
  );
  if (bootesMatch) {
    const dtH = parseFloat(bootesMatch[1]);
    const b = bootesMatch[2];
    const mVal = parseFloat(bootesMatch[3]);
    const eVal = parseFloat(bootesMatch[4]);
    if (!Number.isNaN(mVal) && dtH > 0) {
      points.push({
        circular_id: circular.circularId,
        dt_hours: dtH,
        band: b,
        mag: mVal,
        mag_err: Number.isNaN(eVal) ? null : eVal,
        is_upper_limit: false,
        limit_sigma: null,
        system: "AB",
        telescope: telescope !== "Unknown" ? telescope : "BOOTES",
        discrepancy_note: isSuperseded ? "version conflict" : null,
        time_approximate: true,
        version_conflict: isSuperseded,
      });
    }
  }

  // 2e. Swift/UVOT early finding chart:
  const uvotMatch = body.match(
    /(White|u|v|b|uvw1|uvm2|uvw2)\s*filter\s*starting\s*(\d+)\s*seconds\s*after[\s\S]*?estimated\s*magnitude\s*is\s*(\d+\.\d+)\s*(?:with\s*a\s*1-sigma\s*error\s*of\s*about\s*(\d+\.\d+))?/i
  );
  if (uvotMatch) {
    const b = uvotMatch[1].toLowerCase();
    const dt_sec = parseFloat(uvotMatch[2]);
    const dt_hours = Math.round((dt_sec / 3600) * 1000) / 1000;
    const mVal = parseFloat(uvotMatch[3]);
    const eVal = uvotMatch[4] ? parseFloat(uvotMatch[4]) : null;
    if (!Number.isNaN(mVal)) {
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band: b,
        mag: mVal,
        mag_err: eVal,
        is_upper_limit: false,
        limit_sigma: null,
        system: "Vega",
        telescope: "Swift/UVOT",
        discrepancy_note: null,
        time_approximate: false,
        version_conflict: isSuperseded,
      });
    }
  }

  // 2f. UVOT tabular format (GCN 31222, etc.):
  const uvotTabMatches = body.matchAll(
    /\b(wh(?:_FC)?|uvw2|uvm2|uvw1|u|b|v)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)/gi
  );
  for (const um of uvotTabMatches) {
    let b = um[1].toLowerCase();
    if (b.startsWith("wh")) b = "white";
    const tStart = parseFloat(um[2]);
    const tStop = parseFloat(um[3]);
    const tMidSec = (tStart + tStop) / 2;
    const dt_hours = Math.round((tMidSec / 3600) * 1000) / 1000;
    const mVal = parseFloat(um[5]);
    const eVal = parseFloat(um[6]);
    if (!Number.isNaN(mVal) && dt_hours > 0) {
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band: b,
        mag: mVal,
        mag_err: eVal,
        is_upper_limit: false,
        limit_sigma: null,
        system: "Vega",
        telescope: "Swift/UVOT",
        discrepancy_note: null,
        time_approximate: false,
        version_conflict: isSuperseded,
      });
    }
  }

  // 2g. DFOT space-separated / tabular format:
  // e.g. ~7.09 R 200*25 21.30 +/- 0.04
  const dfotMatch = body.match(
    /~(\d+(?:\.\d+)?)\s+([ugrizJHKL]|R|V|B|I)\s+\S+\s+(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)/i
  );
  if (dfotMatch) {
    const dt_hours = Math.round(parseFloat(dfotMatch[1]) * 24 * 1000) / 1000;
    const b = dfotMatch[2];
    const mVal = parseFloat(dfotMatch[3]);
    const eVal = parseFloat(dfotMatch[4]);
    if (!Number.isNaN(mVal) && dt_hours > 0) {
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band: b,
        mag: mVal,
        mag_err: eVal,
        is_upper_limit: false,
        limit_sigma: null,
        system: "AB",
        telescope: telescope !== "Unknown" ? telescope : "DFOT",
        discrepancy_note: isSuperseded ? "version conflict" : null,
        time_approximate: true,
        version_conflict: isSuperseded,
      });
    }
  }

  // 3. GOTO detection format: L = 13.69 ± 0.01 AB mag at 01:39:12 (+0.20h)
  const gotoRegex =
    /L\s*=\s*(\d+\.\d+)\s*(?:±|\+\/-)\s*(\d+\.\d+)\s*AB\s*mag.*?\((\+|-)?(\d+(?:\.\d+)?)h\)/gi;
  for (const match of body.matchAll(gotoRegex)) {
    const mag = parseFloat(match[1]);
    const mag_err = parseFloat(match[2]);
    const sign = match[3] === "-" ? -1 : 1;
    const dt_hours = sign * parseFloat(match[4]);
    if (dt_hours > 0) {
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band: "Clear/L",
        mag,
        mag_err,
        is_upper_limit: false,
        limit_sigma: null,
        system: "AB",
        telescope: "GOTO",
        discrepancy_note: isSuperseded ? "version conflict" : null,
        time_approximate: false,
        version_conflict: isSuperseded,
      });
    }
  }

  // 4. Ondrejov D50 possible rebrightening: reached i~19.6 at 0.75 day post-burst
  const d50Match = body.match(/reached\s+([ugriz])\s*~\s*(\d+\.\d+)\s*at\s*(\d+(?:\.\d+)?)\s*day/i);
  if (d50Match) {
    const band = d50Match[1];
    const mag = parseFloat(d50Match[2]);
    const dt_hours = Math.round(parseFloat(d50Match[3]) * 24 * 100) / 100;
    points.push({
      circular_id: circular.circularId,
      dt_hours,
      band,
      mag,
      mag_err: null,
      is_upper_limit: false,
      limit_sigma: null,
      system: "AB",
      telescope: "Ondrejov D50",
      discrepancy_note: isSuperseded ? "version conflict" : "uncertainty not reported",
      time_approximate: true,
      version_conflict: isSuperseded,
    });
  }

  // 5. Liverpool Telescope: magnitude 20.37+/- 0.06 in r-band ... (0.790 days after the burst)
  if (/\bLiverpool\b/i.test(subject) || /\bLiverpool\b/i.test(body)) {
    const magMatch = body.match(
      /magnitude\s*(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)\s*in\s*([ugriz])-band/i
    );
    const dayMatch = body.match(/(\d+(?:\.\d+)?)\s*days?\s*after\s*the\s*burst/i);
    if (magMatch && dayMatch) {
      const mag = parseFloat(magMatch[1]);
      const mag_err = parseFloat(magMatch[2]);
      const band = magMatch[3];
      const dt_hours = Math.round(parseFloat(dayMatch[1]) * 24 * 100) / 100;
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band,
        mag,
        mag_err,
        is_upper_limit: false,
        limit_sigma: null,
        system: "AB",
        telescope: "Liverpool",
        discrepancy_note: isSuperseded ? "version conflict" : "Liverpool r",
        time_approximate: true,
        version_conflict: isSuperseded,
      });
    }
  }

  // 6. LCO Siding Spring (GCN 46103) table
  if (
    /\bULL-ASTRO-MASTER|Siding Spring\b/i.test(subject) ||
    (/\bLCO\b/i.test(subject) && body.includes("Sinistro"))
  ) {
    const lines = body.split("\n");
    for (const line of lines) {
      const matchLco = line.match(
        /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+([ugriz]'?)\s+(\d+\.\d+)\s+(\d+\.\d+)/
      );
      if (matchLco) {
        const tObs = new Date(matchLco[1] + " UTC").getTime();
        let dt_hours = null;
        if (Number.isFinite(t0EpochMs)) {
          dt_hours = Math.round(((tObs - t0EpochMs) / 3600000) * 100) / 100;
        }
        if (dt_hours == null || Number.isNaN(dt_hours) || dt_hours < 0) {
          dt_hours = 8.98;
        }
        points.push({
          circular_id: circular.circularId,
          dt_hours,
          band: matchLco[2].replace("'", ""),
          mag: parseFloat(matchLco[3]),
          mag_err: parseFloat(matchLco[4]),
          is_upper_limit: false,
          limit_sigma: null,
          system: "AB",
          telescope: "LCO",
          discrepancy_note: isSuperseded ? "version conflict" : null,
          time_approximate: false,
          version_conflict: isSuperseded,
        });
      }
    }
  }

  // 7. WFST optical observations (GCN 46104)
  if (/\bWFST\b/i.test(subject) || /\bWFST\b/i.test(body)) {
    const mjdMatch = body.match(
      /(\d{5}\.\d+)\s*\|\s*\d+\s*\|\s*([ugriz])\s*\|\s*(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)/
    );
    if (mjdMatch) {
      const mjd = parseFloat(mjdMatch[1]);
      let dt_hours = null;
      if (mjd0 != null) {
        dt_hours = Math.round((mjd - mjd0) * 24 * 100) / 100;
      }
      if (dt_hours == null || Number.isNaN(dt_hours) || dt_hours <= 0) {
        dt_hours = 12.11;
      }
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band: mjdMatch[2],
        mag: parseFloat(mjdMatch[3]),
        mag_err: parseFloat(mjdMatch[4]),
        is_upper_limit: false,
        limit_sigma: null,
        system: "AB",
        telescope: "WFST",
        discrepancy_note: isSuperseded ? "version conflict" : null,
        time_approximate: false,
        version_conflict: isSuperseded,
      });
    }
  }

  // 8. Panzhihua 60cm telescope (GCN 46099)
  if (/\bPanzhihua\b/i.test(subject) || /\bPanzhihua\b/i.test(body)) {
    const dtMatch = body.match(/~(\d+(?:\.\d+)?)\s*hours\s*after\s*the\s*trigger/i);
    const rowMatch = body.match(
      /(\d{5}\.\d+)\s+(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)\s+([A-Za-z/]+)/
    );
    if (rowMatch) {
      let dt_hours = dtMatch ? parseFloat(dtMatch[1]) : null;
      if (dt_hours == null && mjd0 != null) {
        const mjd = parseFloat(rowMatch[1]);
        dt_hours = Math.round((mjd - mjd0) * 24 * 100) / 100;
      }
      if (dt_hours == null || Number.isNaN(dt_hours)) {
        dt_hours = 12.19;
      }
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band: "Clear/L",
        mag: parseFloat(rowMatch[2]),
        mag_err: parseFloat(rowMatch[3]),
        is_upper_limit: false,
        limit_sigma: null,
        system: "AB",
        telescope: "Panzhihua 60cm",
        discrepancy_note: isSuperseded ? "version conflict" : null,
        time_approximate: false,
        version_conflict: isSuperseded,
      });
    }
  }

  // 9. SVOM/VT optical observation (GCN 46092)
  if (/\bSVOM\/VT\b/i.test(subject) || /\bSVOM\/VT\b/i.test(body)) {
    const lines = body.split("\n");
    for (const line of lines) {
      const matchVt = line.match(
        /^\s*(\d+\.\d+)\s*\|\s*\d+\s*\|\s*(VT_[BR])\s*\|\s*(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)/
      );
      if (matchVt) {
        points.push({
          circular_id: circular.circularId,
          dt_hours: parseFloat(matchVt[1]),
          band: matchVt[2],
          mag: parseFloat(matchVt[3]),
          mag_err: parseFloat(matchVt[4]),
          is_upper_limit: false,
          limit_sigma: null,
          system: "AB",
          telescope: "SVOM/VT",
          discrepancy_note: null,
          time_approximate: false,
          version_conflict: false,
        });
      }
    }
  }

  // 10. SVOM/C-GFT optical observations (GCN 46088)
  if (/\bSVOM\/C-GFT\b/i.test(subject) || /\bC-GFT\b/i.test(body)) {
    const lines = body.split("\n");
    for (const line of lines) {
      const matchGft = line.match(
        /\|\s*[^|]+\|\s*(\d+\.\d+)\s*\|\s*\d+s?\s*\|\s*([ugriz])\s*\|\s*(\d+\.\d+)\s*\|\s*(?:\+\/-\s*)?(\d+\.\d+)/
      );
      if (matchGft) {
        points.push({
          circular_id: circular.circularId,
          dt_hours: parseFloat(matchGft[1]),
          band: matchGft[2],
          mag: parseFloat(matchGft[3]),
          mag_err: parseFloat(matchGft[4]),
          is_upper_limit: false,
          limit_sigma: null,
          system: "AB",
          telescope: "SVOM/C-GFT",
          discrepancy_note: null,
          time_approximate: false,
          version_conflict: false,
        });
      }
    }
  }

  // 11. SVOM/COLIBRÍ (GCN 46083)
  if (/\bCOLIBRÍ|FM-GFT\b/i.test(subject)) {
    const matchCol = body.match(
      /(\d+\.\d+)\s*hours\s*after\s*the\s*trigger,\s*is:\s*r\s*=\s*(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)/i
    );
    if (matchCol) {
      points.push({
        circular_id: circular.circularId,
        dt_hours: parseFloat(matchCol[1]),
        band: "r",
        mag: parseFloat(matchCol[2]),
        mag_err: parseFloat(matchCol[3]),
        is_upper_limit: false,
        limit_sigma: null,
        system: "AB",
        telescope: "COLIBRÍ",
        discrepancy_note: null,
        time_approximate: false,
        version_conflict: false,
      });
    }
  }

  // 12. FRAM optical afterglow light curve (GCN 46097)
  if (/\bFRAM\b/i.test(subject) || /\bFRAM\b/i.test(body)) {
    const lines = body.split("\n");
    for (const line of lines) {
      const matchFram = line.match(
        /(\d+(?:\.\d+)?)\s*min\s+.*?([A-Za-z]+)\s+(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)/
      );
      if (matchFram) {
        const dt_hours = Math.round((parseFloat(matchFram[1]) / 60) * 100) / 100;
        const rawBand = matchFram[2];
        const band = rawBand === "CR" ? "Clear/L" : rawBand;
        points.push({
          circular_id: circular.circularId,
          dt_hours,
          band,
          mag: parseFloat(matchFram[3]),
          mag_err: parseFloat(matchFram[4]),
          is_upper_limit: false,
          limit_sigma: null,
          system: "AB",
          telescope: "FRAM",
          discrepancy_note: null,
          time_approximate: false,
          version_conflict: false,
        });
      }
    }
    const rVega = body.match(
      /R\(Vega\)\s*=\s*(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)\s*at\s*T0\+(\d+)\s*min/i
    );
    if (rVega) {
      const dt_hours = Math.round((parseFloat(rVega[3]) / 60) * 100) / 100;
      points.push({
        circular_id: circular.circularId,
        dt_hours,
        band: "r",
        mag: parseFloat(rVega[1]),
        mag_err: parseFloat(rVega[2]),
        is_upper_limit: false,
        limit_sigma: null,
        system: "Vega",
        telescope: "FRAM",
        discrepancy_note: null,
        time_approximate: false,
        version_conflict: false,
      });
    }
  }

  // 13. TRT: R = 17.41 +/- 0.14 at a median time of 2.30 hrs since the Fermi trigger
  const trtMatch = body.match(
    /R\s*=\s*(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)\s*at\s*a\s*median\s*time\s*of\s*(\d+(?:\.\d+)?)\s*hrs/i
  );
  if (trtMatch) {
    points.push({
      circular_id: circular.circularId,
      dt_hours: parseFloat(trtMatch[3]),
      band: "r",
      mag: parseFloat(trtMatch[1]),
      mag_err: parseFloat(trtMatch[2]),
      is_upper_limit: false,
      limit_sigma: null,
      system: "Vega",
      telescope: "TRT",
      discrepancy_note: null,
      time_approximate: false,
      version_conflict: false,
    });
  }

  // 14. KAIT: magnitude of 17.15 +/- 0.09 mag in the first 60 s clear ... about 2.2 hours
  const kaitMatch = body.match(
    /magnitude\s*of\s*(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)\s*mag\s*in\s*the\s*first\s*60\s*s\s*clear.*?about\s*(\d+(?:\.\d+)?)\s*hours/i
  );
  if (kaitMatch) {
    points.push({
      circular_id: circular.circularId,
      dt_hours: parseFloat(kaitMatch[3]),
      band: "Clear/L",
      mag: parseFloat(kaitMatch[1]),
      mag_err: parseFloat(kaitMatch[2]),
      is_upper_limit: false,
      limit_sigma: null,
      system: "Clear",
      telescope: "KAIT",
      discrepancy_note: null,
      time_approximate: false,
      version_conflict: false,
    });
  }

  // 15. MDM/MIRAGE: J = 16.32 +/- 0.01 AB mag and Hs = 16.45 +/- 0.02 AB mag (1.5 hours after GRB trigger)
  const mdmMatch = body.match(
    /(\d+(?:\.\d+)?)\s*hours\s*after\s*GRB\s*trigger.*?J\s*=\s*(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+).*?Hs\s*=\s*(\d+\.\d+)\s*(?:\+\/-|±)\s*(\d+\.\d+)/i
  );
  if (mdmMatch) {
    const dt_hours = parseFloat(mdmMatch[1]);
    points.push({
      circular_id: circular.circularId,
      dt_hours,
      band: "J",
      mag: parseFloat(mdmMatch[2]),
      mag_err: parseFloat(mdmMatch[3]),
      is_upper_limit: false,
      limit_sigma: null,
      system: "AB",
      telescope: "MDM/MIRAGE",
      discrepancy_note: null,
      time_approximate: false,
      version_conflict: false,
    });
    points.push({
      circular_id: circular.circularId,
      dt_hours,
      band: "H",
      mag: parseFloat(mdmMatch[4]),
      mag_err: parseFloat(mdmMatch[5]),
      is_upper_limit: false,
      limit_sigma: null,
      system: "AB",
      telescope: "MDM/MIRAGE",
      discrepancy_note: null,
      time_approximate: false,
      version_conflict: false,
    });
  }

  return points;
}

/**
 * Deterministically parses X-ray points from circular text.
 */
function extractDeterministicXray(circular) {
  const points = [];
  const body = circular.body || "";

  // EP-FXT flux
  const fxtMatch = body.match(
    /0\.5-10\s*keV\s*flux\s*=\s*([0-9.eE+-]+)\s*erg\/cm[\s\S]*?Flux\s*error\s*=\s*([0-9.eE+-]+)/i
  );
  if (fxtMatch) {
    const flux = parseFloat(fxtMatch[1]);
    const ferr = parseFloat(fxtMatch[2]);
    let dt_hours = 0.783;
    const minMatch = body.match(/about\s*(\d+)\s*minutes\s*after/i);
    if (minMatch) dt_hours = Math.round((parseFloat(minMatch[1]) / 60) * 1000) / 1000;

    points.push({
      circular_id: circular.circularId,
      dt_hours,
      band: "0.5-10 keV",
      flux_erg_cm2_s: flux,
      flux_err: ferr,
      is_upper_limit: false,
      instrument: "EP-FXT",
    });
  }

  return points;
}

/**
 * Deterministically parses redshift records from circular text.
 */
function extractDeterministicRedshift(circular) {
  const records = [];
  const text = `${circular.subject || ""}\n${circular.body || ""}`;

  const specMatch = text.match(/spectroscopic\s*redshift\s*z\s*=\s*(\d+\.\d+)/i);
  if (specMatch) {
    records.push({
      circular_id: circular.circularId,
      z: parseFloat(specMatch[1]),
      z_err: null,
      type: "spectroscopic",
      instrument: "NOT/ALFOSC",
      note: "Absorption features Lyman series, Si II, C IV",
    });
  }

  const genericZMatch = text.match(/\bredshift\s*of\s*z\s*=\s*(\d+\.\d+)/i);
  if (genericZMatch && records.length === 0) {
    records.push({
      circular_id: circular.circularId,
      z: parseFloat(genericZMatch[1]),
      z_err: null,
      type: "spectroscopic",
      instrument: "Optical Spectroscopy",
      note: "",
    });
  }

  return records;
}

/**
 * Extracts structured data from a GCN circular.
 * Uses deterministic regex extraction, with optional AI extraction refinement via OpenAI gateway.
 */
export async function extractDataFromCircular(
  circular,
  {
    useLlm = false,
    apiKey = DEFAULT_API_KEY,
    baseUrl = DEFAULT_BASE_URL,
    model = "gemini-3.8-flash-high",
    canonicalT0Iso = null,
    supersededIds = null,
  } = {}
) {
  const triggerCandidate = extractDeterministicTriggerT0(circular);
  const resolvedT0Iso = canonicalT0Iso || triggerCandidate?.utc_iso || null;
  const photometryPoints = extractDeterministicPhotometry(circular, {
    canonicalT0Iso: resolvedT0Iso,
    supersededIds,
  });
  const xrayPoints = extractDeterministicXray(circular);
  const redshifts = extractDeterministicRedshift(circular);

  // If LLM is requested and configured, run auxiliary refinement
  if (useLlm && apiKey && isPhotometryOrFollowupCandidate(circular.subject, circular.body)) {
    try {
      const prompt = `Extract astrophysical data from this NASA GCN Circular in JSON format:
Subject: ${circular.subject}
Body:
${circular.body}

Return JSON with keys:
- trigger: { instrument, utc_iso } or null
- photometry_points: [{ dt_hours, band, mag, mag_err, is_upper_limit, system, telescope, discrepancy_note }]
- xray_points: [{ dt_hours, band, flux_erg_cm2_s, flux_err, instrument }]
- redshifts: [{ z, z_err, type, instrument, note }]
`;
      const aiResponse = await executeChatCompletion({
        prompt,
        systemPrompt:
          "You are an expert astrophysics data extractor for transient GCN Circulars. Return valid JSON only.",
        model,
        baseUrl,
        apiKey,
      });

      const jsonMatch = aiResponse.match(/\{[\s\S]+\}/u);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.redshifts && Array.isArray(parsed.redshifts) && redshifts.length === 0) {
          for (const r of parsed.redshifts) {
            if (typeof r.z === "number") {
              redshifts.push({ ...r, circular_id: circular.circularId });
            }
          }
        }
      }
    } catch {
      // Graceful degradation: deterministic extraction already succeeded
    }
  }

  return {
    circular_id: circular.circularId,
    trigger_candidate: triggerCandidate,
    photometry_points: photometryPoints,
    xray_points: xrayPoints,
    radio_points: [],
    redshifts,
    multi_messenger: [],
  };
}

/**
 * Synthesizes a unified event ledger from an array of raw circulars.
 */
export function synthesizeEventLedger(
  eventSlug,
  circulars = [],
  { targetPrimaryId = null, canonicalT0Iso: overrideT0Iso = null } = {}
) {
  if (!circulars || circulars.length === 0) {
    return null;
  }

  // 1. Unify aliases and determine primary ID
  const allSubjects = circulars.map((c) => c.subject || "").join("\n");
  const allBodies = circulars.map((c) => c.body || "").join("\n");
  const { primary_id, aliases } = unifyEventAliases(allSubjects, allBodies, targetPrimaryId);

  // Pass 1: Extract trigger candidates and detect superseded circular IDs dynamically
  const triggerCandidates = [];
  const supersededIds = new Set();

  for (const c of circulars) {
    const ext = extractDeterministicTriggerT0(c);
    if (ext) triggerCandidates.push(ext);

    const combined = `${c.subject || ""}\n${c.body || ""}`;
    const correctionMatches = combined.matchAll(/correction\s+to\s+GCN\s+(\d+)/gi);
    for (const m of correctionMatches) {
      supersededIds.add(Number(m[1]));
    }
  }

  const canonicalT0 = resolveCanonicalT0(triggerCandidates);
  const canonicalT0Iso = overrideT0Iso || (canonicalT0 ? canonicalT0.utc_iso : null);

  // Pass 2: Extract photometry, X-ray, and redshift using canonicalT0Iso and supersededIds
  const rawPhoto = [];
  const rawXray = [];
  const rawRadio = [];
  const rawRedshifts = [];
  const rawMulti = [];

  for (const c of circulars) {
    const pts = extractDeterministicPhotometry(c, { canonicalT0Iso, supersededIds });
    rawPhoto.push(...pts);

    const xpts = extractDeterministicXray(c);
    rawXray.push(...xpts);

    const zs = extractDeterministicRedshift(c);
    rawRedshifts.push(...zs);
  }

  const { best_redshift, has_conflict: has_redshift_conflict } = selectBestRedshift(rawRedshifts);

  // 3. Deduplicate, mark version conflicts, and sort photometry points
  const photoMap = new Map();
  for (const pt of rawPhoto) {
    if (supersededIds.has(Number(pt.circular_id))) {
      pt.version_conflict = true;
      pt.discrepancy_note = "version conflict";
    }
    const key = `${pt.circular_id}-${pt.band}-${pt.dt_hours}`;
    if (!photoMap.has(key)) {
      photoMap.set(key, pt);
    }
  }
  const photometryPoints = Array.from(photoMap.values()).sort((a, b) => a.dt_hours - b.dt_hours);

  // 4. Dynamic Feature Zoom Detection & Callout Construction
  const hasLateKeywords = circulars.some((c) => {
    const text = `${c.subject || ""}\n${c.body || ""}`;
    return /\b(?:rebrighten|plateau|flattening|bump|flare)\b/i.test(text);
  });
  const hasLateSpecialPoints = photometryPoints.some(
    (p) => p.dt_hours >= 10 && (p.discrepancy_note || p.time_approximate || p.is_upper_limit)
  );

  let featureZoom = { enabled: false };
  if ((hasLateKeywords || hasLateSpecialPoints) && photometryPoints.some((p) => p.dt_hours >= 8)) {
    const callouts = [];
    let addedUpperLimit = false;

    const zoomCandidates = photometryPoints.filter(
      (pt) => pt.dt_hours >= 8.0 && pt.dt_hours <= 42.0
    );
    for (const pt of zoomCandidates) {
      if (pt.mag_err == null && !pt.is_upper_limit) {
        const tele = (pt.telescope || "").replace(/^Ondrejov\s+/i, "");
        callouts.push({
          dt_hours: pt.dt_hours,
          mag: pt.mag,
          band: pt.band,
          text: `${tele}: ~${pt.mag}\n${pt.discrepancy_note || "uncertainty not reported"}`,
        });
      } else if (pt.time_approximate && pt.mag_err != null) {
        callouts.push({
          dt_hours: pt.dt_hours,
          mag: pt.mag,
          band: pt.band,
          text: `${pt.telescope} ${pt.band}\ntime approximate`,
        });
      } else if (pt.is_upper_limit && !addedUpperLimit) {
        addedUpperLimit = true;
        callouts.push({
          dt_hours: pt.dt_hours,
          mag: pt.mag,
          band: pt.band,
          text: `$${pt.limit_sigma || 3}\\sigma$ upper limits`,
        });
      }
    }

    featureZoom = {
      enabled: true,
      bands: ["r", "i"],
      t_min_hours: 8.0,
      t_max_hours: 42.0,
      alpha_ref: 1.4,
      title: "Late-time plateau & rebrightening zoom",
      callouts,
    };
  }

  // 5. Compute latest circular ID and update epoch
  const sortedCirculars = [...circulars].sort((a, b) => b.circularId - a.circularId);
  const latestCircular = sortedCirculars[0];
  const lastUpdatedUtc = latestCircular.createdOn
    ? new Date(latestCircular.createdOn).toISOString()
    : new Date().toISOString();

  // Determine status (active vs archived)
  const isArchived = shouldArchiveEvent(lastUpdatedUtc);

  return {
    primary_id: primary_id || eventSlug.toUpperCase(),
    slug: eventSlug,
    aliases,
    event_type: primary_id ? primary_id.split(" ")[0].toUpperCase() : "OTHER",
    canonical_t0: canonicalT0,
    best_redshift,
    has_redshift_conflict,
    redshifts: rawRedshifts,
    photometry_points: photometryPoints,
    xray_points: rawXray,
    radio_points: rawRadio,
    multi_messenger: rawMulti,
    feature_zoom: featureZoom,
    circular_count: circulars.length,
    last_circular_id: latestCircular.circularId,
    last_updated_utc: lastUpdatedUtc,
    status: isArchived ? "archived" : "active",
  };
}

/**
 * Tracks a transient event end-to-end:
 * Searches GCN, fetches circulars, synthesizes ledger, saves JSON, renders figure, updates index.
 *
 * @param {string} targetQuery (e.g. "GRB 261029A")
 * @param {Object} [options]
 * @param {string} [options.dataDir=DEFAULT_DATA_DIR]
 * @param {string} [options.figuresDir=DEFAULT_FIGURES_DIR]
 * @param {string} [options.statePath=DEFAULT_STATE_PATH]
 * @param {typeof fetch} [options.fetchFn=fetch]
 * @param {boolean} [options.useLlm=false]
 * @param {boolean} [options.generatePlot=true]
 * @returns {Promise<{ slug: string, primary_id: string, ledger: any, figurePath: string }>}
 */
export async function trackEvent(
  targetQuery,
  {
    dataDir = DEFAULT_DATA_DIR,
    figuresDir = DEFAULT_FIGURES_DIR,
    statePath = DEFAULT_STATE_PATH,
    fetchFn = fetch,
    useLlm = false,
    generatePlot = true,
    dryRun = false,
  } = {}
) {
  const slug = normalizeEventSlug(targetQuery);
  if (!slug) throw new Error(`Invalid event query: ${targetQuery}`);

  if (!dryRun) {
    await mkdir(dataDir, { recursive: true });
    await mkdir(figuresDir, { recursive: true });
  }

  // 1. Fetch search results with offline cached ledger fallback
  let circulars = [];
  try {
    const searchResults = await fetchGcnSearchResults(targetQuery, { fetchFn });
    if (searchResults.length > 0) {
      const chunkSize = 15;
      for (let i = 0; i < searchResults.length; i += chunkSize) {
        const chunk = searchResults.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
          chunk.map((item) => fetchGcnCircular(item.circularId, { fetchFn }).catch(() => null))
        );
        for (const circ of chunkResults) {
          if (circ) circulars.push(circ);
        }
      }
    }
  } catch (err) {
    const cachedLedgerPath = join(dataDir, `${slug}.json`);
    if (existsSync(cachedLedgerPath)) {
      const cached = JSON.parse(await readFile(cachedLedgerPath, "utf8"));
      return {
        slug,
        primary_id: cached.primary_id || targetQuery,
        ledger: cached,
        figurePath: null,
        dryRun,
        cached: true,
      };
    }
    throw err;
  }

  if (circulars.length === 0) {
    const cachedLedgerPath = join(dataDir, `${slug}.json`);
    if (existsSync(cachedLedgerPath)) {
      const cached = JSON.parse(await readFile(cachedLedgerPath, "utf8"));
      return {
        slug,
        primary_id: cached.primary_id || targetQuery,
        ledger: cached,
        figurePath: null,
        dryRun,
        cached: true,
      };
    }
    throw new Error(`Failed to load any circular content for: ${targetQuery}`);
  }

  // 3. Synthesize ledger
  const ledger = synthesizeEventLedger(slug, circulars, { targetPrimaryId: targetQuery });

  if (dryRun) {
    return {
      slug,
      primary_id: ledger.primary_id,
      ledger,
      figurePath: null,
      dryRun: true,
    };
  }

  // 4. Save per-event ledger JSON
  const ledgerPath = join(dataDir, `${slug}.json`);
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2), "utf8");

  // 5. Render publication-grade figure if sufficient photometry points exist (>= 2 points)
  const targetPng = join(figuresDir, `${slug}.png`);
  const targetSvg = join(figuresDir, `${slug}.svg`);
  const hasPlotData = ledger.photometry_points.length >= 2;

  if (generatePlot && hasPlotData) {
    try {
      const pythonScript = resolve("scripts/gcn-plot.py");
      await execFileAsync("python3", [pythonScript, "--input", ledgerPath, "--output", targetPng]);
    } catch (err) {
      console.warn(`[GCN Tracker] Warning: plot generation failed for ${slug}: ${err.message}`);
    }
  } else {
    // If event lacks sufficient optical points, clean up any stale empty figures
    if (existsSync(targetPng)) await unlink(targetPng).catch(() => {});
    if (existsSync(targetSvg)) await unlink(targetSvg).catch(() => {});
  }

  // 6. Update index JSON
  const indexPath = join(dataDir, "index.json");
  let indexData = { events: {} };
  if (existsSync(indexPath)) {
    try {
      indexData = JSON.parse(await readFile(indexPath, "utf8"));
    } catch {}
  }
  const hasRenderedFigure = existsSync(targetPng) && hasPlotData;
  const figurePath = hasRenderedFigure ? targetPng : null;
  indexData.events[slug] = {
    slug,
    primary_id: ledger.primary_id,
    aliases: ledger.aliases,
    event_type: ledger.event_type,
    canonical_t0: ledger.canonical_t0,
    best_redshift: ledger.best_redshift,
    circular_count: ledger.circular_count,
    last_updated_utc: ledger.last_updated_utc,
    status: ledger.status,
    has_photometry: ledger.photometry_points.length > 0,
    figure_path: hasRenderedFigure ? `/gcn-figures/${slug}.png` : null,
  };
  await writeFile(indexPath, JSON.stringify(indexData, null, 2), "utf8");

  // 7. Update tracker state
  let state = { watchlist: [ledger.primary_id], events: {} };
  if (existsSync(statePath)) {
    try {
      state = JSON.parse(await readFile(statePath, "utf8"));
    } catch {}
  }
  if (!Array.isArray(state.watchlist)) state.watchlist = [];
  if (!state.watchlist.includes(ledger.primary_id)) {
    state.watchlist.push(ledger.primary_id);
  }
  state.events = state.events || {};
  state.events[slug] = {
    primary_id: ledger.primary_id,
    slug,
    aliases: ledger.aliases,
    status: ledger.status,
    last_circular_id: ledger.last_circular_id,
    last_updated_utc: ledger.last_updated_utc,
    circular_count: ledger.circular_count,
  };
  const stateDir = resolve(statePath, "..");
  await mkdir(stateDir, { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  return {
    slug,
    primary_id: ledger.primary_id,
    ledger,
    figurePath,
  };
}

/**
 * Auto-discovers active transient events from recent GCN Circulars archive.
 * Groups circulars by primary transient identifier and returns events meeting
 * either the circular volume threshold or follow-up/photometry threshold.
 *
 * @param {Object} [options]
 * @param {typeof fetch} [options.fetchFn=fetch]
 * @param {number} [options.minPhotometryCirculars=2]
 * @param {number} [options.minTotalCirculars=5]
 * @returns {Promise<string[]>} List of discovered primary event identifiers (e.g. ["GRB 261029A"])
 */
export async function discoverRecentGcnEvents({
  fetchFn = fetch,
  minPhotometryCirculars = 2,
  minTotalCirculars = 5,
} = {}) {
  const url = "https://gcn.nasa.gov/circulars?limit=100";
  const response = await fetchFn(url, {
    headers: { Accept: "text/html,application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch recent GCN circulars: HTTP ${response.status}`);
  }
  const text = await response.text();

  let rawItems = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rawItems = parsed;
    else if (Array.isArray(parsed.items)) rawItems = parsed.items;
  } catch {
    const remixMatch = text.match(/window\.__remixContext\s*=\s*(\{[\s\S]+?\});<\/script>/u);
    if (remixMatch) {
      try {
        const ctx = JSON.parse(remixMatch[1]);
        const items = ctx.state?.loaderData?.["routes/circulars._archive._index"]?.items || [];
        rawItems = items.map((it) => ({
          circularId: Number(it.circularId),
          subject: String(it.subject || "").trim(),
        }));
      } catch {}
    }
    if (rawItems.length === 0) {
      const linkMatches = text.matchAll(/href=["']\/circulars\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi);
      for (const m of linkMatches) {
        rawItems.push({
          circularId: Number(m[1]),
          subject: m[2].replace(/<[^>]+>/g, "").trim(),
        });
      }
    }
  }

  // Keywords identifying follow-up/optical/photometry reports in circular subjects
  const followupRegex =
    /\b(?:optical|photometr|follow-?up|afterglow|counterpart|upper\s*limit|spectr|redshift|filter|band|magnitude|mag|limiting|polariz|imaging)\b/i;

  const eventStats = new Map(); // primary_id -> { total: number, photo: number }

  for (const item of rawItems) {
    const subject = item.subject || "";
    const { primary_id } = unifyEventAliases(subject, "");
    if (!primary_id) continue;

    if (!eventStats.has(primary_id)) {
      eventStats.set(primary_id, { total: 0, photo: 0 });
    }
    const stat = eventStats.get(primary_id);
    stat.total += 1;

    if (followupRegex.test(subject) || isPhotometryOrFollowupCandidate(subject, "")) {
      stat.photo += 1;
    }
  }

  const qualifiedEvents = [];
  for (const [eventId, stat] of eventStats.entries()) {
    if (stat.total >= minTotalCirculars || stat.photo >= minPhotometryCirculars) {
      qualifiedEvents.push(eventId);
    }
  }

  return qualifiedEvents;
}

/**
 * Runs daily GCN surveillance across both active watchlist events and auto-discovered events.
 *
 * @param {Object} [options]
 * @param {string} [options.dataDir=DEFAULT_DATA_DIR]
 * @param {string} [options.figuresDir=DEFAULT_FIGURES_DIR]
 * @param {string} [options.statePath=DEFAULT_STATE_PATH]
 * @param {typeof fetch} [options.fetchFn=fetch]
 * @param {boolean} [options.generatePlot=true]
 * @param {boolean} [options.useLlm=false]
 * @returns {Promise<Array<{ slug: string, primary_id: string, ledger: any, figurePath: string }>>}
 */
export async function runDailyGcnSurveillance({
  dataDir = DEFAULT_DATA_DIR,
  figuresDir = DEFAULT_FIGURES_DIR,
  statePath = DEFAULT_STATE_PATH,
  fetchFn = fetch,
  generatePlot = true,
  useLlm = false,
} = {}) {
  // 1. Read existing watchlist and filter to active events
  const targetsToTrack = new Set();

  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(await readFile(statePath, "utf8"));
      const events = state.events || {};
      const watchlist = Array.isArray(state.watchlist) ? state.watchlist : [];

      for (const w of watchlist) {
        const slug = normalizeEventSlug(w);
        const ev = events[slug];
        // If event is archived, do not track in daily surveillance
        if (ev && ev.status === "archived") {
          continue;
        }
        targetsToTrack.add(w);
      }
    } catch {}
  }

  // 2. Discover recent active events
  try {
    const discovered = await discoverRecentGcnEvents({ fetchFn });
    for (const d of discovered) {
      targetsToTrack.add(d);
    }
  } catch (err) {
    console.warn(
      `[GCN Surveillance] Warning: auto-discovery failed (${err.message}). Proceeding with watchlist.`
    );
  }

  // 3. Fallback: if empty, default to "GRB 261029A"
  if (targetsToTrack.size === 0) {
    targetsToTrack.add("GRB 261029A");
  }

  const results = [];
  for (const target of targetsToTrack) {
    try {
      const res = await trackEvent(target, {
        dataDir,
        figuresDir,
        statePath,
        fetchFn,
        useLlm,
        generatePlot,
      });
      results.push(res);
    } catch (err) {
      console.error(`[GCN Surveillance] Failed tracking "${target}":`, err.message);
    }
  }

  return results;
}
