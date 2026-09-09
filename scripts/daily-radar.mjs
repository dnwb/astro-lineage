import { createHash } from "node:crypto";

export const RADAR_PRIORITIES = Object.freeze([
  "must_read",
  "worth_knowing",
  "skip",
]);

export const RADAR_COVERAGE_LEVELS = Object.freeze([
  "abstract_only",
  "body_partial",
  "full_body",
]);

export const RADAR_RELATIONS = Object.freeze([
  "builds_on",
  "extends",
  "tests",
  "constrains",
  "challenges",
  "replaces_assumption",
  "corrects",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identityKey(arxivId, revision) {
  return `${normalizeArxivId(arxivId)}@v${Number(revision)}`;
}

export function normalizeArxivId(value) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf|src)\//iu, "")
    .replace(/^arxiv:/iu, "")
    .replace(/\.pdf$/iu, "")
    .replace(/v\d+$/iu, "")
    .replace(/\/$/u, "")
    .toLowerCase();
}

/**
 * Fingerprint the feed material an editorial analysis was based on. This is
 * deliberately limited to the cached source record; it is not a canonical
 * content digest and is never written into canonical data.
 */
export function sourceFingerprint(entry) {
  const material = {
    arxiv_id: normalizeArxivId(entry?.arxiv_id),
    revision: Number(entry?.revision ?? 0),
    title: String(entry?.title ?? ""),
    abstract: String(entry?.abstract ?? ""),
    published: String(entry?.published ?? ""),
    updated: String(entry?.updated ?? ""),
    authors: Array.isArray(entry?.authors) ? entry.authors.map(String) : [],
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function textArray(value) {
  return Array.isArray(value) && value.every(hasText);
}

function httpUrl(value) {
  if (!hasText(value)) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function arxivReferenceIdentity(reference) {
  if (!isObject(reference) || !httpUrl(reference.url)) return null;
  let url;
  try {
    url = new URL(reference.url);
  } catch {
    return null;
  }
  if (!["arxiv.org", "export.arxiv.org"].includes(url.hostname.toLowerCase())) return null;
  let path;
  try {
    path = decodeURIComponent(url.pathname)
      .replace(/^\/(?:abs|src|pdf)\//iu, "")
      .replace(/\/$/u, "");
  } catch {
    return null;
  }
  const revision = path.match(/v([1-9]\d*)$/iu);
  if (!revision) return null;
  const kindByPath = {
    arxiv_abstract: "abs",
    arxiv_source_package: "src",
  };
  const expectedPath = kindByPath[reference.kind];
  const actualPath = url.pathname.match(/^\/(abs|src|pdf)\//iu)?.[1]?.toLowerCase();
  if (!expectedPath || actualPath !== expectedPath) return null;
  if (reference.kind === "arxiv_source_package" && !/^[a-f\d]{64}$/iu.test(reference.sha256 ?? "")) return null;
  return {
    arxiv_id: normalizeArxivId(path.slice(0, -revision[0].length)),
    revision: Number(revision[1]),
  };
}

function sourceReferences(value, entry) {
  if (!Array.isArray(value) || value.length === 0 || !isObject(entry)) return false;
  const expectedId = normalizeArxivId(entry.arxiv_id);
  const expectedRevision = Number(entry.revision);
  return value.every((reference) => {
    if (!hasText(reference?.locator)) return false;
    const identity = arxivReferenceIdentity(reference);
    return identity?.arxiv_id === expectedId && identity.revision === expectedRevision;
  });
}

function validDate(value) {
  return hasText(value) && !Number.isNaN(new Date(value).valueOf());
}

function analysisDiagnostics(analysis, entry) {
  if (!isObject(analysis)) return ["analysis_invalid"];
  if (analysis.status === "failed") return ["analysis_failed"];
  if (normalizeArxivId(analysis.arxiv_id) !== normalizeArxivId(entry.arxiv_id) || Number(analysis.revision) !== Number(entry.revision)) {
    return ["analysis_revision_mismatch"];
  }
  if (analysis.source_fingerprint !== sourceFingerprint(entry)) return ["source_changed"];
  if (!RADAR_PRIORITIES.includes(analysis.priority)) return ["analysis_invalid"];

  const coverage = analysis.coverage;
  if (!isObject(coverage) || !RADAR_COVERAGE_LEVELS.includes(coverage.level)) {
    return ["analysis_invalid"];
  }
  if (!hasText(coverage.label) || coverage.source_version !== `arXiv:${normalizeArxivId(entry.arxiv_id)}v${entry.revision}`) return ["analysis_invalid"];
  if (!Array.isArray(coverage.inspected_sections) || coverage.inspected_sections.length === 0) {
    return ["analysis_invalid"];
  }
  if (!sourceReferences(coverage.source_references, entry)) {
    return ["analysis_invalid"];
  }
  if (!isObject(analysis.analysis) || !hasText(analysis.analysis.origin) || !validDate(analysis.analysis.analyzed_at)) {
    return ["analysis_invalid"];
  }
  const requiredText = [
    "reason",
    "result",
    "reading_entry",
    "problem",
    "research_progress",
  ];
  if (requiredText.some((key) => !hasText(analysis.analysis[key]))) return ["analysis_invalid"];
  if (!textArray(analysis.analysis.assumptions) || !textArray(analysis.analysis.limits)) {
    return ["analysis_invalid"];
  }
  if (!textArray(analysis.analysis.citation_leads) || !textArray(analysis.analysis.unresolved_checks)) {
    return ["analysis_invalid"];
  }
  const lineage = analysis.analysis.potential_lineage;
  if (!isObject(lineage) || !hasText(lineage.status) || !hasText(lineage.reason)) return ["analysis_invalid"];
  if (!Array.isArray(lineage.candidates)) return ["analysis_invalid"];
  if (lineage.candidates.some((candidate) =>
    !isObject(candidate) || !RADAR_RELATIONS.includes(candidate.relation) || !hasText(candidate.target_work_id) ||
    !hasText(candidate.delta) || !hasText(candidate.support) || !textArray(candidate.unresolved_checks))) {
    return ["analysis_invalid"];
  }
  if (!Array.isArray(analysis.analysis.prerequisite_works) || analysis.analysis.prerequisite_works.some((prerequisite) =>
    !isObject(prerequisite) || !hasText(prerequisite.work_id) || !hasText(prerequisite.reason))) {
    return ["analysis_invalid"];
  }
  return [];
}

function pendingReasonFor(entry, analysesById) {
  const sameId = [...analysesById.values()].filter((analysis) => normalizeArxivId(analysis?.arxiv_id) === normalizeArxivId(entry.arxiv_id));
  if (sameId.length > 0 && !sameId.some((analysis) => Number(analysis.revision) === Number(entry.revision))) {
    return "analysis_revision_mismatch";
  }
  return "analysis_missing";
}

function knowledgePointDiagnostics(point, entry) {
  if (!isObject(point) || !isObject(entry)) return ["knowledge_point_invalid"];
  const source = point.source;
  if (!isObject(source) || normalizeArxivId(source.arxiv_id) !== normalizeArxivId(entry.arxiv_id) || Number(source.revision) !== Number(entry.revision)) {
    return ["knowledge_point_revision_mismatch"];
  }
  if (source.source_fingerprint !== sourceFingerprint(entry)) return ["knowledge_point_source_changed"];
  if (!hasText(point.id) || !hasText(point.title) || !hasText(point.why_it_matters) || !hasText(point.physical_picture) || !hasText(point.paper_use)) {
    return ["knowledge_point_invalid"];
  }
  if (!RADAR_COVERAGE_LEVELS.includes(source.level) || !Array.isArray(source.inspected_sections) || source.inspected_sections.length === 0 || source.source_version !== `arXiv:${normalizeArxivId(entry.arxiv_id)}v${entry.revision}`) {
    return ["knowledge_point_invalid"];
  }
  if (!textArray(point.assumptions) || !Array.isArray(point.symbols) || point.symbols.some((symbol) =>
    !isObject(symbol) || !hasText(symbol.symbol) || !hasText(symbol.meaning)) || !Array.isArray(point.derivation) || !textArray(point.units_checks) || !sourceReferences(point.source_references, entry) || !textArray(point.unresolved_checks)) {
    return ["knowledge_point_invalid"];
  }
  if (point.derivation.some((step) => !isObject(step) || !["paper", "teaching"].includes(step.kind) || !hasText(step.text))) {
    return ["knowledge_point_invalid"];
  }
  return [];
}

export { knowledgePointDiagnostics };

/**
 * Join the immutable feed snapshot to discovery-layer analyses. Invalid or
 * stale analyses stay visible as pending items so failures cannot be rendered
 * as a low-priority scientific judgement.
 */
export function buildDailyRadarModel(feed, radar = {}) {
  const entries = Array.isArray(feed?.entries) ? feed.entries : [];
  const analyses = Array.isArray(radar?.analyses) ? radar.analyses : [];
  const knowledgePointRecords = Array.isArray(radar?.knowledge_points) ? radar.knowledge_points : [];
  const feedWindow = isObject(feed?.window) ? feed.window : null;
  const radarEdition = isObject(radar?.edition) ? radar.edition : {};
  const entriesById = new Map(entries.map((entry) => [identityKey(entry.arxiv_id, entry.revision), entry]));
  const analysesById = new Map(
    analyses
      .filter((analysis) => isObject(analysis) && hasText(analysis.arxiv_id))
      .map((analysis) => [identityKey(analysis.arxiv_id, analysis.revision), analysis]),
  );
  const groups = { must_read: [], worth_knowing: [], skip: [] };
  const pending = [];
  const knowledge_points = [];
  const knowledge_points_pending = [];

  for (const entry of entries) {
    const analysis = analysesById.get(identityKey(entry.arxiv_id, entry.revision));
    const diagnostics = analysis
      ? analysisDiagnostics(analysis, entry)
      : [pendingReasonFor(entry, analysesById)];
    if (diagnostics.length > 0) {
      pending.push({
        ...entry,
        pending_reason: diagnostics[0],
        pending_detail: analysis
          ? analysis.status === "failed"
            ? `分析失败：${analysis.failure_reason ?? "失败原因未记录。"}`
            : "分析记录与当前缓存版本或必填阅读范围不匹配。"
          : "当前缓存条目尚未有有效的版本级科学导读。",
      });
      continue;
    }
    const item = { ...entry, analysis };
    groups[analysis.priority].push(item);
  }

  for (const point of knowledgePointRecords) {
    const source = point?.source;
    const hasSourceIdentity = hasText(source?.arxiv_id) && Number.isInteger(Number(source?.revision)) && Number(source.revision) >= 1;
    const entry = entriesById.get(identityKey(source?.arxiv_id, source?.revision));
    if (hasSourceIdentity && !entry) {
      // Knowledge points from retired feed editions remain historical records;
      // they are excluded before applying the two-point current-edition cap.
      continue;
    }
    if (knowledge_points.length >= 2) {
      knowledge_points_pending.push({
        id: point?.id ?? "unknown",
        pending_reason: "knowledge_point_limit",
      });
      continue;
    }
    const diagnostics = knowledgePointDiagnostics(point, entry);
    if (diagnostics.length > 0) {
      knowledge_points_pending.push({
        id: point?.id ?? "unknown",
        pending_reason: diagnostics[0],
      });
    } else {
      knowledge_points.push({ ...point, source_entry: entry });
    }
  }

  return {
    edition: {
      ...radarEdition,
      generated_at: feed?.generated_at ?? null,
      query: feed?.query ?? null,
      source_url: feed?.source_url ?? null,
      coverage_kind: ["announcement_day", "announcement_batch"].includes(feedWindow?.kind)
        ? feedWindow.kind
        : radarEdition.coverage_kind ?? "recent_submission_sample",
      ...(feedWindow ? { window: feedWindow } : {}),
      ...(Number.isInteger(feed?.page_count) ? { page_count: feed.page_count } : {}),
    },
    groups,
    pending,
    knowledge_points,
    knowledge_points_pending,
    counts: {
      total: entries.length,
      analyzed: entries.length - pending.length,
      pending: pending.length,
      must_read: groups.must_read.length,
      worth_knowing: groups.worth_knowing.length,
      skip: groups.skip.length,
    },
  };
}

/**
 * Keep discovery-layer lineage suggestions from leaking hidden canonical
 * Works. A suggestion is only linkable when its existing target is in the
 * supplied visible reader projection.
 */
export function projectPotentialLineage(lineage, visibleWorkIds) {
  if (!isObject(lineage)) return { status: "no_match", reason: "未提供候选科学关系。", candidates: [] };
  const visible = new Set(visibleWorkIds);
  const candidates = (Array.isArray(lineage.candidates) ? lineage.candidates : [])
    .filter((candidate) => isObject(candidate) && visible.has(candidate.target_work_id))
    .map((candidate) => ({ ...candidate }));
  return { ...lineage, candidates };
}

function historicalEditionFor(feed) {
  return feed?.window?.batch_id
    ?? feed?.window?.announcement_date
    ?? feed?.generated_at
    ?? "previous-edition";
}

function currentFeedIdentitySet(feed) {
  return new Set((Array.isArray(feed?.entries) ? feed.entries : [])
    .filter((entry) => hasText(entry?.arxiv_id) && Number.isInteger(Number(entry?.revision)) && Number(entry.revision) >= 1)
    .map((entry) => identityKey(entry.arxiv_id, entry.revision)));
}

function historicalKey(record, kind) {
  if (kind === "analysis") {
    return `${record?.historical_edition}\u0000${identityKey(record?.arxiv_id, record?.revision)}\u0000${record?.source_fingerprint ?? ""}`;
  }
  return `${record?.historical_edition}\u0000${record?.id ?? ""}\u0000${identityKey(record?.source?.arxiv_id, record?.source?.revision)}`;
}

function appendHistorical(records, record, kind, historicalEdition) {
  const candidate = { ...record, historical_edition: historicalEdition };
  const key = historicalKey(candidate, kind);
  if (!records.some((existing) => historicalKey(existing, kind) === key)) records.push(candidate);
}

/**
 * Reconcile the current discovery guides with a newly published feed before
 * the pair is written. Retired version-bound records remain auditable, but
 * only records whose exact version is in the new feed participate in the
 * current edition.
 */
export function reconcileDailyRadarEdition(previousFeed, radar, nextFeed) {
  const currentIds = currentFeedIdentitySet(nextFeed);
  const historicalEdition = historicalEditionFor(previousFeed);
  const source = isObject(radar) ? radar : {};
  const analyses = [];
  const historicalAnalyses = Array.isArray(source.historical_analyses) ? source.historical_analyses.map((record) => ({ ...record })) : [];
  for (const analysis of Array.isArray(source.analyses) ? source.analyses : []) {
    const key = hasText(analysis?.arxiv_id) && Number.isInteger(Number(analysis?.revision))
      ? identityKey(analysis.arxiv_id, analysis.revision)
      : null;
    if (key && currentIds.has(key)) analyses.push(analysis);
    else appendHistorical(historicalAnalyses, analysis, "analysis", historicalEdition);
  }

  const knowledgePoints = [];
  const historicalKnowledgePoints = Array.isArray(source.historical_knowledge_points)
    ? source.historical_knowledge_points.map((record) => ({ ...record }))
    : [];
  for (const point of Array.isArray(source.knowledge_points) ? source.knowledge_points : []) {
    const key = hasText(point?.source?.arxiv_id) && Number.isInteger(Number(point?.source?.revision))
      ? identityKey(point.source.arxiv_id, point.source.revision)
      : null;
    if (key && currentIds.has(key)) knowledgePoints.push(point);
    else appendHistorical(historicalKnowledgePoints, point, "knowledge_point", historicalEdition);
  }

  const nextEdition = {
    ...(isObject(source.edition) ? source.edition : {}),
    generated_at: nextFeed?.generated_at ?? null,
    query: nextFeed?.query ?? null,
    source_url: nextFeed?.source_url ?? null,
    coverage_kind: nextFeed?.window?.kind ?? source.edition?.coverage_kind ?? "recent_submission_sample",
    ...(isObject(nextFeed?.window) ? { window: nextFeed.window } : {}),
    ...(Number.isInteger(nextFeed?.page_count) ? { page_count: nextFeed.page_count } : {}),
  };
  return {
    ...source,
    edition: nextEdition,
    analyses,
    knowledge_points: knowledgePoints,
    ...(historicalAnalyses.length > 0 ? { historical_analyses: historicalAnalyses } : {}),
    ...(historicalKnowledgePoints.length > 0 ? { historical_knowledge_points: historicalKnowledgePoints } : {}),
  };
}

export function validateDailyRadarPayload(feed, radar) {
  const model = buildDailyRadarModel(feed, radar);
  const diagnostics = [];
  if (!isObject(feed) || !Array.isArray(feed.entries)) {
    diagnostics.push("RADAR_FEED_ENTRIES_MISSING");
  }
  if (!isObject(radar) || !Array.isArray(radar.analyses)) {
    diagnostics.push("RADAR_ANALYSES_MISSING");
  }
  const feedEntries = isObject(feed) && Array.isArray(feed.entries) ? feed.entries : [];
  const currentAnalyses = isObject(radar) && Array.isArray(radar.analyses) ? radar.analyses : [];
  const currentKnowledgePoints = isObject(radar) && Array.isArray(radar.knowledge_points) ? radar.knowledge_points : [];
  const entriesById = new Map(feedEntries.map((entry) => [identityKey(entry.arxiv_id, entry.revision), entry]));
  const feedArxivIds = new Set(feedEntries.map((entry) => normalizeArxivId(entry.arxiv_id)));
  for (const [key, code] of [["historical_analyses", "RADAR_HISTORICAL_ANALYSES_INVALID"], ["historical_knowledge_points", "RADAR_HISTORICAL_KNOWLEDGE_POINTS_INVALID"]]) {
    if (radar?.[key] !== undefined && !Array.isArray(radar[key])) diagnostics.push(code);
    for (const record of Array.isArray(radar?.[key]) ? radar[key] : []) {
      if (!isObject(record) || !hasText(record.historical_edition)) diagnostics.push(code);
    }
  }
  const seenAnalysisIds = new Set();
  for (const analysis of currentAnalyses) {
    if (!isObject(analysis) || !hasText(analysis.arxiv_id) || !Number.isInteger(Number(analysis.revision)) || Number(analysis.revision) < 1) {
      diagnostics.push("RADAR_ANALYSIS_IDENTITY_INVALID");
      continue;
    }
    const key = identityKey(analysis.arxiv_id, analysis.revision);
    if (seenAnalysisIds.has(key)) diagnostics.push("RADAR_ANALYSIS_DUPLICATE");
    seenAnalysisIds.add(key);
    const entry = entriesById.get(key);
    // The current-edition array must remain source-complete. Historical
    // analyses belong in historical_analyses, where they cannot participate
    // in this edition or make a valid rolling cache fail its build.
    if (!entry && !feedArxivIds.has(normalizeArxivId(analysis.arxiv_id))) diagnostics.push("RADAR_ANALYSIS_SOURCE_UNKNOWN");
    if (!entry) continue;
    if (entry && analysis.source_fingerprint === sourceFingerprint(entry) && isObject(analysis.coverage) && Array.isArray(analysis.coverage.source_references) && !sourceReferences(analysis.coverage.source_references, entry)) {
      diagnostics.push("RADAR_SOURCE_REFERENCE_MISMATCH");
    }
  }
  const seenKnowledgePointIds = new Set();
  for (const point of currentKnowledgePoints) {
    if (!isObject(point) || !hasText(point.id)) {
      diagnostics.push("RADAR_KNOWLEDGE_POINT_INVALID");
      continue;
    }
    if (seenKnowledgePointIds.has(point.id)) diagnostics.push("RADAR_KNOWLEDGE_POINT_DUPLICATE");
    seenKnowledgePointIds.add(point.id);
    const source = point.source;
    if (!isObject(source) || !hasText(source.arxiv_id) || !Number.isInteger(Number(source.revision)) || Number(source.revision) < 1) {
      diagnostics.push("RADAR_KNOWLEDGE_POINT_INVALID");
      continue;
    }
    const entry = entriesById.get(identityKey(source?.arxiv_id, source?.revision));
    // Historical knowledge points belong in historical_knowledge_points and
    // are excluded from the current page before the two-point cap is applied.
    if (!entry && !feedArxivIds.has(normalizeArxivId(source.arxiv_id))) diagnostics.push("RADAR_KNOWLEDGE_POINT_SOURCE_UNKNOWN");
    if (!entry) continue;
    if (entry && source?.source_fingerprint === sourceFingerprint(entry) && Array.isArray(point.source_references) && !sourceReferences(point.source_references, entry)) {
      diagnostics.push("RADAR_SOURCE_REFERENCE_MISMATCH");
    }
  }
  return { valid: diagnostics.length === 0, diagnostics: [...new Set(diagnostics)], model };
}
