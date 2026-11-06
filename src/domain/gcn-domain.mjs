/**
 * src/domain/gcn-domain.mjs
 *
 * Domain Logic & Pure Functions for Transient Event Tracking and Zero-Homogenization GCN Photometry.
 * Architecture Blueprint: docs/adr/0083-first-class-transient-events-and-zero-homogenization-gcn-photometry.md
 * Domain Glossary: CONTEXT.md (§ Transient Event Tracking & GCN Surveillance)
 */

import { extractTransientIdentifiers } from "./academic-domain.mjs";

/**
 * Normalizes a transient primary identifier into a canonical URL- and filesystem-safe slug.
 * e.g., "GRB 261029A" -> "grb-261029a", "AT 2026ahaw" -> "at-2026ahaw".
 *
 * @param {string} primaryId
 * @returns {string}
 */
export function normalizeEventSlug(primaryId) {
  if (!primaryId || typeof primaryId !== "string") return "";
  return primaryId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Instrument authority score ranking for resolving canonical burst trigger epoch T0.
 * Hierarchy: GW > Fermi/GBM > Swift/BAT > SVOM/ECLAIRs > EP/WXT > GECAM > other.
 */
export const T0_INSTRUMENT_AUTHORITY = [
  { regex: /\b(?:GW|LIGO|Virgo|KAGRA)\b/i, score: 100, label: "GW" },
  { regex: /\b(?:Fermi(?:\/GBM)?|GBM)\b/i, score: 90, label: "Fermi/GBM" },
  { regex: /\b(?:Swift(?:\/BAT)?|BAT)\b/i, score: 80, label: "Swift/BAT" },
  { regex: /\b(?:HETE(?:-2)?)\b/i, score: 75, label: "HETE-2" },
  { regex: /\b(?:SVOM(?:\/ECLAIRs)?|ECLAIRs)\b/i, score: 70, label: "SVOM/ECLAIRs" },
  { regex: /\b(?:EP(?:\/WXT)?|Einstein\s*Probe|WXT)\b/i, score: 60, label: "EP/WXT" },
  { regex: /\b(?:Konus(?:-Wind)?)\b/i, score: 55, label: "Konus-Wind" },
  { regex: /\b(?:GECAM(?:-[A-Z])?)\b/i, score: 50, label: "GECAM" },
];

/**
 * Resolves the canonical trigger epoch T0 from a list of trigger candidates.
 *
 * @param {Array<{ instrument: string, utc_iso: string, circular_id?: number|string }>} candidates
 * @returns {{ instrument: string, utc_iso: string, circular_id?: number|string } | null}
 */
export function resolveCanonicalT0(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const valid = candidates
    .filter((c) => c && c.utc_iso && !Number.isNaN(new Date(c.utc_iso).getTime()))
    .map((c) => {
      const inst = String(c.instrument || "").trim();
      let score = 10;
      let matchedLabel = inst || "Unknown";
      for (const rule of T0_INSTRUMENT_AUTHORITY) {
        if (rule.regex.test(inst)) {
          score = rule.score;
          matchedLabel = rule.label;
          break;
        }
      }
      return {
        candidate: c,
        score,
        matchedLabel,
        epochMs: new Date(c.utc_iso).getTime(),
      };
    });

  if (valid.length === 0) return null;

  // Sort descending by authority score, then ascending by earliest epoch timestamp
  valid.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.epochMs - b.epochMs;
  });

  const best = valid[0];
  return {
    instrument: best.matchedLabel,
    utc_iso: new Date(best.candidate.utc_iso).toISOString(),
    circular_id:
      best.candidate.circular_id != null ? Number(best.candidate.circular_id) : undefined,
  };
}

/**
 * Hierarchy for primary identifier determination:
 * GW > GRB > EP > SN > AT > FRB > other.
 */
const TYPE_PRIORITY = {
  GW: 100,
  GRB: 90,
  EP: 80,
  SN: 70,
  AT: 60,
  FRB: 50,
  SGR: 40,
};

function getIdentifierType(id) {
  const upper = id.toUpperCase();
  if (upper.startsWith("GW")) return "GW";
  if (upper.startsWith("GRB")) return "GRB";
  if (upper.startsWith("EP")) return "EP";
  if (upper.startsWith("SN")) return "SN";
  if (upper.startsWith("AT")) return "AT";
  if (upper.startsWith("FRB")) return "FRB";
  if (upper.startsWith("SGR")) return "SGR";
  return "OTHER";
}

/**
 * Canonicalizes transient identifiers to standard IAU/GCN spacing and casing.
 * e.g., "GRB261029A" -> "GRB 261029A"
 *       "AT 2026AHAW" -> "AT 2026ahaw"
 *       "AT2026ahaw" -> "AT 2026ahaw"
 *       "SN2024abc" -> "SN 2024abc"
 *       "SN 2024ABC" -> "SN 2024abc"
 *       "EP240414a" -> "EP 240414a"
 *       "GOTO26LLT" -> "GOTO26LLT"
 *       "GW170817" -> "GW170817"
 *
 * @param {string} rawId
 * @returns {string}
 */
export function canonicalizeTransientId(rawId) {
  if (!rawId || typeof rawId !== "string") return "";
  const trimmed = rawId.trim();

  // 1. GRB: GRB 261029A or GRB261029A
  const grbMatch = trimmed.match(/^GRB\s*(\d{6}[A-Za-z]?)$/i);
  if (grbMatch) {
    return `GRB ${grbMatch[1].toUpperCase()}`;
  }

  // 2. AT: AT 2026ahaw or AT2026AHAW
  const atMatch = trimmed.match(/^AT\s*(\d{4})\s*([A-Za-z]{1,4})$/i);
  if (atMatch) {
    return `AT ${atMatch[1]}${atMatch[2].toLowerCase()}`;
  }

  // 3. SN: SN 2024abc or SN2024ABC
  const snMatch = trimmed.match(/^SN\s*(\d{4})\s*([A-Za-z]{1,4})$/i);
  if (snMatch) {
    return `SN ${snMatch[1]}${snMatch[2].toLowerCase()}`;
  }

  // 4. EP: EP 240414a or EP240414a
  const epMatch = trimmed.match(/^EP\s*(\d{6}[A-Za-z]?)$/i);
  if (epMatch) {
    return `EP ${epMatch[1].toLowerCase()}`;
  }

  // 5. GW: GW 170817 or GW170817
  const gwMatch = trimmed.match(/^GW\s*(\d{6}[A-Za-z]?)$/i);
  if (gwMatch) {
    return `GW${gwMatch[1]}`;
  }

  // 6. FRB: FRB 20220610A or FRB20220610A
  const frbMatch = trimmed.match(/^FRB\s*(\d{6,8}[A-Za-z]?)$/i);
  if (frbMatch) {
    return `FRB ${frbMatch[1].toUpperCase()}`;
  }

  // 7. GOTO: GOTO26LLT
  const gotoMatch = trimmed.match(/^GOTO\s*(\d{2}[A-Za-z]+)$/i);
  if (gotoMatch) {
    return `GOTO${gotoMatch[1].toUpperCase()}`;
  }

  return trimmed.replace(/\s+/g, " ");
}

/**
 * Key for deduplicating transient identifiers that only differ by spacing or casing.
 * e.g., "GRB 261029A" and "GRB261029A" -> "GRB261029A"
 *       "AT 2026ahaw" and "AT2026AHAW" -> "AT2026AHAW"
 *
 * @param {string} id
 * @returns {string}
 */
export function getTransientDedupeKey(id) {
  if (!id || typeof id !== "string") return "";
  return id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Unifies transient aliases and extracts primary transient event identifier from circular text.
 * Determines primary_id (preferring GW > GRB > EP > SN > AT > FRB, or preferredPrimaryId if provided) and aliases.
 *
 * @param {string} subject
 * @param {string} body
 * @param {string} [preferredPrimaryId]
 * @returns {{ primary_id: string, aliases: string[], all_ids: string[] }}
 */
export function unifyEventAliases(subject = "", body = "", preferredPrimaryId = null) {
  const combined = `${subject || ""}\n${body || ""}`;
  const rawFound = extractTransientIdentifiers(combined);

  // Also check for specific AT candidates formatted like AT 2026ahaw or AT2026ahaw
  const atMatches = combined.matchAll(/\b(AT\s*\d{4}\s*[a-z]{1,4})\b/gi);
  for (const m of atMatches) {
    rawFound.push(m[1]);
  }

  // Also check for GOTO candidates if mentioned as transient counterpart
  const gotoMatches = combined.matchAll(/\b(GOTO\s*\d{2}[a-z]+)\b/gi);
  for (const m of gotoMatches) {
    rawFound.push(m[1]);
  }

  if (preferredPrimaryId && typeof preferredPrimaryId === "string") {
    rawFound.unshift(preferredPrimaryId);
  }

  // Deduplicate and canonicalize
  const idMap = new Map(); // dedupeKey -> canonicalId
  for (const raw of rawFound) {
    const canonical = canonicalizeTransientId(raw);
    const key = getTransientDedupeKey(canonical);
    if (!key) continue;
    if (!idMap.has(key)) {
      idMap.set(key, canonical);
    }
  }

  const found = Array.from(idMap.values());
  if (found.length === 0) {
    return { primary_id: "", aliases: [], all_ids: [] };
  }

  const subjectIds = extractTransientIdentifiers(subject).map(canonicalizeTransientId);
  const preferredKey = preferredPrimaryId ? getTransientDedupeKey(preferredPrimaryId) : null;

  found.sort((a, b) => {
    if (preferredKey) {
      const keyA = getTransientDedupeKey(a);
      const keyB = getTransientDedupeKey(b);
      if (keyA === preferredKey) return -1;
      if (keyB === preferredKey) return 1;
    }

    const typeA = getIdentifierType(a);
    const typeB = getIdentifierType(b);
    const prioA = TYPE_PRIORITY[typeA] || 10;
    const prioB = TYPE_PRIORITY[typeB] || 10;

    const inSubjA = subjectIds.includes(a) ? 15 : 0;
    const inSubjB = subjectIds.includes(b) ? 15 : 0;

    if (prioB + inSubjB !== prioA + inSubjA) {
      return prioB + inSubjB - (prioA + inSubjA);
    }
    return a.localeCompare(b);
  });

  const primary_id = found[0];
  const primaryKey = getTransientDedupeKey(primary_id);
  const aliases = found.slice(1).filter((id) => getTransientDedupeKey(id) !== primaryKey);

  return {
    primary_id,
    aliases,
    all_ids: [primary_id, ...aliases],
  };
}

/**
 * Computes observer-frame elapsed time delta in hours (dt = T - T0).
 *
 * @param {string} [obsUtcIso]
 * @param {string} [canonicalT0Iso]
 * @param {number|string} [reportedDeltaHours]
 * @returns {number | null}
 */
export function computeObserverDeltaHours(obsUtcIso, canonicalT0Iso, reportedDeltaHours) {
  if (
    reportedDeltaHours !== undefined &&
    reportedDeltaHours !== null &&
    reportedDeltaHours !== ""
  ) {
    const val = Number(reportedDeltaHours);
    if (Number.isFinite(val) && val >= 0) {
      return Math.round(val * 10000) / 10000;
    }
  }

  if (!obsUtcIso || !canonicalT0Iso) return null;

  const tObs = new Date(obsUtcIso).getTime();
  const t0 = new Date(canonicalT0Iso).getTime();

  if (Number.isNaN(tObs) || Number.isNaN(t0)) return null;

  const diffHours = (tObs - t0) / (1000 * 3600);
  if (diffHours < 0) return null;

  return Math.round(diffHours * 10000) / 10000;
}

/**
 * Hierarchy for tiered redshift evidentiary authority:
 * spectroscopic > host > photometric > upper_limit.
 */
export const REDSHIFT_TYPE_AUTHORITY = {
  spectroscopic: 4,
  host: 3,
  photometric: 2,
  upper_limit: 1,
};

/**
 * Selects the best redshift record according to evidentiary authority and detects conflicts.
 *
 * @param {Array<{ circular_id?: number|string, z: number, z_err?: number|null, type: string, instrument?: string, note?: string }>} records
 * @returns {{ best_redshift: any, has_conflict: boolean, records: any[] }}
 */
export function selectBestRedshift(records = []) {
  if (!Array.isArray(records) || records.length === 0) {
    return { best_redshift: null, has_conflict: false, records: [] };
  }

  const valid = records
    .filter((r) => r && typeof r.z === "number" && !Number.isNaN(r.z) && r.z >= 0)
    .map((r) => {
      const typeKey = String(r.type || "photometric")
        .toLowerCase()
        .trim();
      const rank = REDSHIFT_TYPE_AUTHORITY[typeKey] || 2;
      return { ...r, type: typeKey, rank };
    });

  if (valid.length === 0) {
    return { best_redshift: null, has_conflict: false, records: [] };
  }

  // Sort descending by rank, then ascending by uncertainty if available
  valid.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    const errA = a.z_err != null ? Number(a.z_err) : Infinity;
    const errB = b.z_err != null ? Number(b.z_err) : Infinity;
    return errA - errB;
  });

  const best = valid[0];
  const topRank = best.rank;

  // Conflict detection: if multiple records have topRank and differ by > 0.05
  let has_conflict = false;
  const topRankRecords = valid.filter((r) => r.rank === topRank);
  if (topRankRecords.length > 1) {
    for (let i = 1; i < topRankRecords.length; i++) {
      if (Math.abs(topRankRecords[i].z - best.z) > 0.05) {
        has_conflict = true;
        break;
      }
    }
  }

  return {
    best_redshift: {
      z: best.z,
      z_err: best.z_err != null ? best.z_err : null,
      type: best.type,
      instrument: best.instrument || "",
      circular_id: best.circular_id != null ? Number(best.circular_id) : undefined,
      note: best.note || "",
    },
    has_conflict,
    records: valid.map(({ rank, ...rest }) => rest),
  };
}

/**
 * Fast deterministic regex pre-filter to identify GCN circulars containing
 * photometry, upper limits, X-ray flux, radio flux density, redshift, or multi-messenger data.
 *
 * @param {string} [subject=""]
 * @param {string} [body=""]
 * @returns {boolean}
 */
export function isPhotometryOrFollowupCandidate(subject = "", body = "") {
  const text = `${subject || ""}\n${body || ""}`;

  const patterns = [
    /\b(?:mag|magnitude|magnitudes|AB|Vega)\b/i,
    /\b(?:upper\s*limit|upper\s*limits|non-detection|limiting\s*magnitude)\b/i,
    /\b(?:filter|band|filters|bands)\b/i,
    /\b[ugrizJHKL]\s*(?:[-=~>]|band|filter|\b)/i,
    /\b(?:flux|fluxes|erg\s*\/?\s*cm|keV|mJy|uJy|microJy)\b/i,
    /\b(?:redshift|z\s*=\s*\d|spectr|absorption\s*feature|emission\s*line)\b/i,
    /\b(?:radio|x-ray|infrared|optical|counterpart|photometry)\b/i,
    /\b(?:trigger|triggered|T0|burst\s*detection|initial\s*alert)\b/i,
  ];

  return patterns.some((p) => p.test(text));
}

/**
 * Evaluates the 7-day inactivity sunset rule for transient event surveillance.
 *
 * @param {string|Date} lastUpdatedUtc
 * @param {Date} [now=new Date()]
 * @param {number} [sunsetDays=7]
 * @returns {boolean}
 */
export function shouldArchiveEvent(lastUpdatedUtc, now = new Date(), sunsetDays = 7) {
  if (!lastUpdatedUtc) return false;
  const updateTime = new Date(lastUpdatedUtc).getTime();
  const refTime = new Date(now).getTime();
  if (Number.isNaN(updateTime) || Number.isNaN(refTime)) return false;

  const diffMs = refTime - updateTime;
  const sunsetMs = sunsetDays * 24 * 3600 * 1000;
  return diffMs >= sunsetMs;
}

/**
 * Formats canonical burst trigger epoch T0 and instrument as a presentation badge.
 * e.g., "2026-10-29 01:27:03 UTC (Fermi/GBM)" or "" if missing/invalid.
 *
 * @param {{ instrument?: string, utc_iso?: string } | null} canonicalT0
 * @returns {string}
 */
export function formatCanonicalT0Badge(canonicalT0) {
  if (!canonicalT0 || !canonicalT0.utc_iso) return "";
  const d = new Date(canonicalT0.utc_iso);
  if (Number.isNaN(d.getTime())) return "";
  const iso = d.toISOString();
  const timePart = iso.slice(0, 19).replace("T", " ");
  const inst = canonicalT0.instrument ? ` (${canonicalT0.instrument})` : "";
  return `${timePart} UTC${inst}`;
}

/**
 * Formats tiered best redshift and observational authority as a presentation badge.
 * e.g., "z = 3.27 (spectroscopic · NOT/ALFOSC)" (appending " [conflict]" if hasConflict), or "" if missing.
 *
 * @param {{ z: number, z_err?: number|null, type?: string, instrument?: string } | null} bestRedshift
 * @param {boolean} [hasConflict=false]
 * @returns {string}
 */
export function formatRedshiftBadge(bestRedshift, hasConflict = false) {
  if (!bestRedshift || typeof bestRedshift.z !== "number" || Number.isNaN(bestRedshift.z)) {
    return "";
  }
  const details = [bestRedshift.type, bestRedshift.instrument].filter(Boolean).join(" · ");
  const base = details ? `z = ${bestRedshift.z} (${details})` : `z = ${bestRedshift.z}`;
  return hasConflict ? `${base} [conflict]` : base;
}

/**
 * Formats secondary transient alias identifiers for headings or badges.
 * e.g., "AT 2026ahaw / GOTO26LLT" or "" if empty.
 *
 * @param {string[]} aliases
 * @returns {string}
 */
export function formatAliasList(aliases) {
  if (!Array.isArray(aliases) || aliases.length === 0) return "";
  const filtered = aliases.filter((a) => a && typeof a === "string" && a.trim().length > 0);
  return filtered.join(" / ");
}

/**
 * Formats multi-messenger associations into badge strings.
 * e.g., ["GW: LIGO/Virgo (GCN #...)", "Neutrino: IceCube (GCN #...)"]
 *
 * @param {Array<string | { type?: string, detector?: string, instrument?: string, circular_id?: number|string }>} multiMessenger
 * @returns {string[]}
 */
export function formatMultiMessengerBadges(multiMessenger = []) {
  if (!Array.isArray(multiMessenger) || multiMessenger.length === 0) return [];
  return multiMessenger
    .map((m) => {
      if (!m) return "";
      if (typeof m === "string") return m.trim();
      const type = m.type || m.messenger || "Multi-Messenger";
      const inst = m.detector || m.instrument || m.facility || "";
      const cid = m.circular_id != null ? ` (GCN #${m.circular_id})` : "";
      if (inst) {
        return `${type}: ${inst}${cid}`;
      }
      return `${type}${cid}`;
    })
    .filter(Boolean);
}
