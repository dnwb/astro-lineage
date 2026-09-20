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

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function guideFingerprint(analysis) {
  return digest(analysis ?? null);
}

export function radarCardAnchor(arxivId, revision) {
  const slug = normalizeArxivId(arxivId).replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return `radar-paper-${slug || "unknown"}-v${Number(revision)}`;
}

export function editionFingerprint(feed) {
  return digest({
    generated_at: feed?.generated_at ?? null,
    query: feed?.query ?? null,
    source_url: feed?.source_url ?? null,
    window: feed?.window ?? null,
    entries: (Array.isArray(feed?.entries) ? feed.entries : []).map((entry) => ({
      arxiv_id: normalizeArxivId(entry?.arxiv_id),
      revision: Number(entry?.revision ?? 0),
      source_fingerprint: sourceFingerprint(entry),
    })),
  });
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

function coverageEvidenceDiagnostics(coverage) {
  const bodyLevel = ["body_partial", "full_body"].includes(coverage?.level);
  if (!bodyLevel) return [];
  const inspected = Array.isArray(coverage?.inspected_sections) ? coverage.inspected_sections : [];
  const hasBodySection = inspected.some((section) => hasText(section) && !/^abstract$/iu.test(section.trim()));
  const bodyReferences = Array.isArray(coverage?.source_references)
    ? coverage.source_references.filter((reference) => reference?.kind === "arxiv_source_package")
    : [];
  const hasBodySource = bodyReferences.length > 0;
  if (!hasBodySource || !hasBodySection) return ["analysis_invalid"];
  if (coverage.level === "body_partial" && !bodyReferences.some((reference) =>
    hasText(reference.locator) && !/^(?:abstract|full body sections?)$/iu.test(reference.locator.trim()))) {
    return ["analysis_invalid"];
  }
  if (coverage.level === "full_body") {
    const sectionCoverage = coverage.section_coverage;
    if (!isObject(sectionCoverage) ||
      ["problem", "assumptions", "method", "results", "limitations"].some((field) => sectionCoverage[field] !== true) ||
      !["checked", "not_needed", "not_applicable", "not_checked"].includes(sectionCoverage.appendices)) {
      return ["analysis_invalid"];
    }
    const sectionPatterns = {
      problem: /problem|introduction|background/iu,
      assumptions: /assumption|model|setup/iu,
      method: /method|model|approach|data/iu,
      results: /result|finding|analysis|experiment/iu,
      limitations: /discussion|limit|conclusion/iu,
    };
    if (Object.entries(sectionPatterns).some(([field, pattern]) =>
      sectionCoverage[field] !== true || !inspected.some((section) => hasText(section) && pattern.test(section)))) {
      return ["analysis_invalid"];
    }
  }
  return [];
}

function validDate(value) {
  return hasText(value) && !Number.isNaN(new Date(value).valueOf());
}

function analysisDiagnostics(analysis, entry) {
  if (!isObject(analysis)) return ["analysis_invalid"];
  if (analysis.status === "failed") return ["analysis_failed"];
  if (analysis.status !== "ready") return ["analysis_pending"];
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
  const coverageEvidenceErrors = coverageEvidenceDiagnostics(coverage);
  if (coverageEvidenceErrors.length > 0) return coverageEvidenceErrors;
  if (analysis.priority === "must_read" && coverage.level !== "full_body") {
    return ["coverage_insufficient_must_read"];
  }
  if (analysis.priority === "worth_knowing" && coverage.level === "abstract_only") {
    return ["coverage_insufficient_worth_knowing"];
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
  if (analysis.priority === "must_read" && !hasText(analysis.analysis.method)) return ["analysis_invalid"];
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

function pendingDetailFor(analysis, reason) {
  const coverageLabel = (hasText(analysis?.coverage?.label) ? analysis.coverage.label : "当前阅读范围记录无效").replace(/[。；]$/u, "");
  if (reason === "coverage_insufficient_must_read") {
    return `当前记录为${coverageLabel}，未达到 Must Read 所需的全文分析门槛；补读全文后才能作为正式推荐。`;
  }
  if (reason === "coverage_insufficient_worth_knowing") {
    return `当前记录为${coverageLabel}，Worth Knowing 需要支撑判断的正文段落；补读正文前暂不作为正式 Worth Knowing。`;
  }
  if (reason === "analysis_pending") {
    return `分析尚未完成（当前状态：${analysis.status ?? "未记录"}）；完成前不会进入正式阅读分组。`;
  }
  if (analysis.status === "failed") {
    return `分析失败：${analysis.failure_reason ?? "失败原因未记录。"}`;
  }
  return "分析记录与当前缓存版本或必填阅读范围不匹配。";
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
  if (coverageEvidenceDiagnostics({ ...source, source_references: point.source_references }).length > 0) return ["knowledge_point_invalid"];
  if (!textArray(point.assumptions) || !Array.isArray(point.symbols) || point.symbols.some((symbol) =>
    !isObject(symbol) || !hasText(symbol.symbol) || !hasText(symbol.meaning)) || !Array.isArray(point.derivation) || !textArray(point.units_checks) || !sourceReferences(point.source_references, entry) || !textArray(point.unresolved_checks)) {
    return ["knowledge_point_invalid"];
  }
  if (point.derivation.some((step) => !isObject(step) || !["paper", "teaching"].includes(step.kind) || !hasText(step.text))) {
    return ["knowledge_point_invalid"];
  }
  return [];
}

function openingBriefDiagnostics(brief, feed, model, options = {}) {
  const visibleWorkIds = options.visibleWorkIds === undefined ? null : new Set(options.visibleWorkIds);
  const eligibleCount = model.groups.must_read.length + model.groups.worth_knowing.length + model.groups.skip.length;
  if (brief === undefined || brief === null) return eligibleCount === 0 ? [] : ["RADAR_OPENING_BRIEF_MISSING"];
  if (!isObject(brief) || !["ready", "unavailable"].includes(brief.status)) {
    return ["RADAR_OPENING_BRIEF_INVALID"];
  }
  if (eligibleCount === 0 && brief.status === "ready") return ["RADAR_OPENING_BRIEF_STALE"];
  if (brief.status === "unavailable") {
    return hasText(brief.reason) ? [] : ["RADAR_OPENING_BRIEF_INVALID"];
  }
  if (!hasText(brief.edition_fingerprint) || brief.edition_fingerprint !== editionFingerprint(feed) || !hasText(brief.intro)) {
    return ["RADAR_OPENING_BRIEF_STALE"];
  }
  if (!Array.isArray(brief.must_read)) return ["RADAR_OPENING_BRIEF_INVALID"];
  if (model.groups.must_read.length !== brief.must_read.length) return ["RADAR_OPENING_BRIEF_STALE"];

  const expectedMustRead = new Map(model.groups.must_read.map((item) => [
    identityKey(item.arxiv_id, item.revision),
    item,
  ]));
  const seen = new Set();
  for (const sentence of brief.must_read) {
    if (!isObject(sentence) || !hasText(sentence.arxiv_id) || !Number.isInteger(Number(sentence.revision)) || Number(sentence.revision) < 1 ||
      !hasText(sentence.label) || !hasText(sentence.text) || !hasText(sentence.source_fingerprint) || !hasText(sentence.guide_fingerprint) ||
      !hasText(sentence.anchor)) {
      return ["RADAR_OPENING_BRIEF_INVALID"];
    }
    const key = identityKey(sentence.arxiv_id, sentence.revision);
    const item = expectedMustRead.get(key);
    if (!item || seen.has(key)) return ["RADAR_OPENING_BRIEF_STALE"];
    seen.add(key);
    if (sentence.source_fingerprint !== sourceFingerprint(item) || sentence.guide_fingerprint !== guideFingerprint(item.analysis) ||
      sentence.anchor !== radarCardAnchor(item.arxiv_id, item.revision)) {
      return ["RADAR_OPENING_BRIEF_STALE"];
    }
    if (sentence.related_work_ids !== undefined) {
      if (!Array.isArray(sentence.related_work_ids) ||
        sentence.related_work_ids.some((workId) => !hasText(workId)) ||
        new Set(sentence.related_work_ids).size !== sentence.related_work_ids.length) {
        return ["RADAR_OPENING_BRIEF_INVALID"];
      }
      const guide = item.analysis?.analysis;
      const supportedWorkIds = new Set([
        ...(Array.isArray(guide?.potential_lineage?.candidates)
          ? guide.potential_lineage.candidates.map((candidate) => candidate?.target_work_id)
          : []),
        ...(Array.isArray(guide?.prerequisite_works)
          ? guide.prerequisite_works.map((prerequisite) => prerequisite?.work_id)
          : []),
      ]);
      if (sentence.related_work_ids.some((workId) => !supportedWorkIds.has(workId) || (visibleWorkIds && !visibleWorkIds.has(workId)))) {
        return ["RADAR_OPENING_BRIEF_STALE"];
      }
    }
  }
  if (seen.size !== expectedMustRead.size) return ["RADAR_OPENING_BRIEF_STALE"];
  if (model.groups.worth_knowing.length > 0 && !hasText(brief.worth_knowing_summary)) return ["RADAR_OPENING_BRIEF_INVALID"];
  if (model.groups.skip.length > 0 && !hasText(brief.skim_summary)) return ["RADAR_OPENING_BRIEF_INVALID"];

  for (const [field, group] of [["worth_knowing", model.groups.worth_knowing], ["skip", model.groups.skip]]) {
    const references = brief[field];
    if (group.length === 0) {
      if (Array.isArray(references) && references.length > 0) return ["RADAR_OPENING_BRIEF_STALE"];
      continue;
    }
    if (!Array.isArray(references)) return ["RADAR_OPENING_BRIEF_INVALID"];
    if (references.length !== group.length) return ["RADAR_OPENING_BRIEF_STALE"];
    const expected = new Map(group.map((item) => [identityKey(item.arxiv_id, item.revision), item]));
    const seenReferences = new Set();
    for (const reference of references) {
      if (!isObject(reference) || !hasText(reference.arxiv_id) || !Number.isInteger(Number(reference.revision)) || Number(reference.revision) < 1 ||
        !hasText(reference.source_fingerprint) || !hasText(reference.guide_fingerprint)) {
        return ["RADAR_OPENING_BRIEF_INVALID"];
      }
      const key = identityKey(reference.arxiv_id, reference.revision);
      const item = expected.get(key);
      if (!item || seenReferences.has(key)) return ["RADAR_OPENING_BRIEF_STALE"];
      seenReferences.add(key);
      if (reference.source_fingerprint !== sourceFingerprint(item) || reference.guide_fingerprint !== guideFingerprint(item.analysis)) {
        return ["RADAR_OPENING_BRIEF_STALE"];
      }
    }
    if (seenReferences.size !== expected.size) return ["RADAR_OPENING_BRIEF_STALE"];
  }
  return [];
}

export { knowledgePointDiagnostics, openingBriefDiagnostics };

/**
 * Join the immutable feed snapshot to discovery-layer analyses. Invalid or
 * stale analyses stay visible as pending items so failures cannot be rendered
 * as a low-priority scientific judgement.
 */
export function buildDailyRadarModel(feed, radar = {}, options = {}) {
  const entries = Array.isArray(feed?.entries) ? feed.entries : [];
  const analyses = Array.isArray(radar?.analyses) ? radar.analyses : [];
  const knowledgePointRecords = Array.isArray(radar?.knowledge_points) ? radar.knowledge_points : [];
  const feedWindow = isObject(feed?.window) ? feed.window : null;
  const radarEdition = isObject(radar?.edition) ? radar.edition : {};
  const entriesById = new Map(entries.map((entry) => [identityKey(entry.arxiv_id, entry.revision), entry]));
  const feedArxivIds = new Set(entries.map((entry) => normalizeArxivId(entry.arxiv_id)));
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
      const pendingReason = diagnostics[0];
      pending.push({
        ...entry,
        pending_reason: pendingReason,
        pending_detail: analysis
          ? pendingDetailFor(analysis, pendingReason)
          : "当前缓存条目尚未有有效的版本级科学导读。",
        ...(analysis ? { pending_analysis: analysis } : {}),
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
      knowledge_points_pending.push({
        id: point?.id ?? "unknown",
        pending_reason: feedArxivIds.has(normalizeArxivId(source.arxiv_id))
          ? "knowledge_point_revision_mismatch"
          : "knowledge_point_source_unknown",
      });
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

  const candidateBrief = isObject(radar?.opening_brief) ? radar.opening_brief : null;
  const openingBriefErrors = openingBriefDiagnostics(candidateBrief, feed, { groups }, options);

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
    opening_brief: openingBriefErrors.length === 0 ? candidateBrief : null,
    opening_brief_diagnostics: openingBriefErrors,
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
export function radarCoverageDescription(coverage) {
  const record = isObject(coverage) ? coverage : {};
  const label = hasText(record.label) ? record.label.trim() : "阅读范围未记录";
  const sections = Array.isArray(record.inspected_sections)
    ? record.inspected_sections.filter(hasText).map((section) => section.trim())
    : [];
  const references = Array.isArray(record.source_references) ? record.source_references : [];
  const hasBodySource = references.some((reference) => reference?.kind === "arxiv_source_package");
  const hasAbstractSource = references.some((reference) => reference?.kind === "arxiv_abstract");
  if (hasBodySource) {
    return {
      primary: `本条导读依据记录的正文材料（${label}）整理。`,
      english: `This guide uses the recorded body material${sections.length > 0 ? `; inspected sections: ${sections.join(", ")}` : ""}.`,
    };
  }
  if (hasAbstractSource) {
    return {
      primary: `本条导读依据记录的摘要材料（${label}）整理。`,
      english: "This entry is limited to the recorded abstract source.",
    };
  }
  return {
    primary: `本条导读依据记录的${label}整理。`,
    english: `This entry uses the recorded source; coverage label: ${label}.`,
  };
}

export function projectPotentialLineage(lineage, visibleWorkIds) {
  if (!isObject(lineage)) return { status: "no_match", reason: "未提供候选科学关系。", candidates: [] };
  const visible = new Set(visibleWorkIds);
  const allCandidates = Array.isArray(lineage.candidates)
    ? lineage.candidates.filter((candidate) => isObject(candidate) && hasText(candidate.target_work_id))
    : [];
  const hiddenTargetIds = new Set(allCandidates
    .filter((candidate) => !visible.has(candidate.target_work_id))
    .map((candidate) => candidate.target_work_id));
  const candidates = allCandidates
    .filter((candidate) => visible.has(candidate.target_work_id))
    .map((candidate) => {
      const candidateText = [candidate.delta, candidate.support, ...(Array.isArray(candidate.unresolved_checks) ? candidate.unresolved_checks : [])]
        .filter(hasText)
        .join(" ");
      if ([...hiddenTargetIds].some((workId) => candidateText.includes(workId))) {
        return {
          ...candidate,
          delta: "关系说明已按当前可见 Work 范围过滤。",
          support: "公开定位未提供",
          unresolved_checks: [],
        };
      }
      return { ...candidate };
    });
  const hiddenWorkExists = hiddenTargetIds.size > 0;
  return {
    status: hiddenWorkExists && candidates.length === 0 ? "no_match" : lineage.status,
    reason: hiddenWorkExists
      ? candidates.length > 0
        ? "当前页面仅保留可见 Work 的候选关系；关系仍待审核。"
        : "当前没有可公开展示的候选科学关系。"
      : (hasText(lineage.reason) ? lineage.reason : "未提供候选科学关系。"),
    candidates,
    unresolved_checks: hiddenWorkExists
      ? []
      : (Array.isArray(lineage.unresolved_checks) ? lineage.unresolved_checks.filter(hasText) : []),
  };
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
  const { opening_brief: _staleOpeningBrief, ...sourceWithoutBrief } = source;
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
    ...sourceWithoutBrief,
    edition: nextEdition,
    analyses,
    knowledge_points: knowledgePoints,
    opening_brief: {
      status: "unavailable",
      reason: "本期缓存版本已变化，导读需要重新绑定当前论文后才能显示。",
    },
    ...(historicalAnalyses.length > 0 ? { historical_analyses: historicalAnalyses } : {}),
    ...(historicalKnowledgePoints.length > 0 ? { historical_knowledge_points: historicalKnowledgePoints } : {}),
  };
}

export function validateDailyRadarPayload(feed, radar, options = {}) {
  const model = buildDailyRadarModel(feed, radar, options);
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
  const openingBriefErrors = openingBriefDiagnostics(radar?.opening_brief, feed, model, options);
  diagnostics.push(...openingBriefErrors);
  const uniqueDiagnostics = [...new Set(diagnostics)];
  const fatalDiagnostics = uniqueDiagnostics.filter((code) => !["RADAR_OPENING_BRIEF_STALE", "RADAR_OPENING_BRIEF_MISSING"].includes(code));
  return {
    valid: uniqueDiagnostics.length === 0,
    diagnostics: uniqueDiagnostics,
    fatalDiagnostics,
    model,
  };
}
