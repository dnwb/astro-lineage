import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  buildDailyRadarModel,
  knowledgePointDiagnostics,
  projectPotentialLineage,
  reconcileDailyRadarEdition,
  sourceFingerprint,
  radarCoverageDescription,
  validateDailyRadarPayload,
  editionFingerprint,
  guideFingerprint,
  openingBriefDiagnostics,
  radarCardAnchor,
} from "../scripts/daily-radar.mjs";

test("Daily Radar declares a compact desktop reading-column and text-measure contract", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../src/pages/arxiv-daily/index.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/global.css", import.meta.url), "utf8"),
  ]);
  const desktopStart = styles.indexOf("@media (min-width: 48.01rem)");
  const mobileStart = styles.indexOf("@media (max-width: 48rem)");
  assert.ok(desktopStart >= 0 && mobileStart > desktopStart, "desktop radar rules must precede mobile rules");
  const desktop = styles.slice(desktopStart, mobileStart);
  const mobile = styles.slice(mobileStart);

  assert.match(page, /<main class="site-shell index-page reader-page radar-page">/u);
  assert.match(desktop, /\.radar-page\s*\{[\s\S]*?max-width:\s*60rem;/u);
  assert.match(desktop, /\.radar-page \.reader-header,[\s\S]*?\.radar-page \.radar-status-disclosure\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*60rem;[\s\S]*?margin-inline:\s*auto;/u);
  assert.match(desktop, /\.radar-page \.radar-list-item\s*\{[\s\S]*?max-width:\s*none;/u);
  assert.match(desktop, /\.radar-page \.radar-card\s*\{[\s\S]*?width:\s*100%;[\s\S]*?box-sizing:\s*border-box;/u);
  assert.match(desktop, /\.radar-page \.reader-header \.language-primary,[\s\S]*?\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*45em;/u);
  assert.match(desktop, /\.radar-page \.reader-header \.language-english,[\s\S]*?\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*75ch;/u);
  assert.match(desktop, /\.radar-page \.radar-card > \.language-primary,[\s\S]*?\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/u);
  assert.match(desktop, /\.radar-page \.radar-card \.language-english,[\s\S]*?\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/u);
  assert.match(desktop, /\.radar-page \.radar-card p,[\s\S]*?max-width:\s*none;/u);
  assert.match(desktop, /\.radar-page \.radar-card \.language-primary > \.radar-must-summary,[\s\S]*?\.radar-page \.radar-card \.language-primary > \.radar-skim-summary,[\s\S]*?max-width:\s*45em;/u);
  assert.match(desktop, /\.radar-page \.radar-card \.radar-source-body,[\s\S]*?max-width:\s*75ch;/u);
  assert.match(desktop, /\.radar-page[\s\S]*?line-height:\s*1\.8;/u);
  assert.match(desktop, /\.radar-page \.radar-card h3\s*\{[\s\S]*?line-height:\s*1\.4;/u);
  assert.match(desktop, /\.radar-page[\s\S]*?margin-block-end:\s*1em;/u);
  assert.doesNotMatch(mobile, /\.radar-page/u);
});

test("Daily Radar keeps method detail, author attribution and source metadata available on demand", async () => {
  const [page, brief, guide, card, source, pending, knowledge] = await Promise.all([
    readFile(new URL("../src/pages/arxiv-daily/index.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DailyRadarBrief.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DailyRadarGuide.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DailyRadarCard.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DailyRadarSource.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DailyRadarPendingCard.astro", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DailyKnowledgePoint.astro", import.meta.url), "utf8"),
  ]);
  assert.match(guide, /方法与机制/u);
  assert.match(guide, /guide\.method/u);
  assert.match(guide, /summary[\s\S]*coverageSummary/u);
  assert.match(page, /work\.versions\)[\s\S]*?\.find/u);
  assert.doesNotMatch(page, /work\.preferred_version\.title/u);
  assert.match(page, /<p class="empty-state language-primary">/u);
  assert.match(page, /knowledge_points_pending\.length[\s\S]*?class="layer-intro language-primary"/u);
  assert.match(brief, /visibleWorkLinks/u);
  assert.match(brief, /related_work_ids/u);
  assert.match(brief, /worth_knowing.length/u);
  assert.match(brief, /groups\.skip\.length/u);
  assert.match(card, /作者报告的主要结果与限定/u);
  assert.match(card, /研究了什么/u);
  assert.match(card, /guide\.reason/u);
  assert.doesNotMatch(card, /radar-card-coverage/u);
  assert.doesNotMatch(card, /class="paper-meta"/u);
  assert.match(card, /item\.analysis\.priority === "skip"/u);
  assert.match(card, /radar-card-\$\{cardVariant\}/u);
  assert.match(card, /relationLabels/u);
  assert.match(card, /prerequisite_works/u);
  assert.match(card, /radarCoverageDescription/u);
  assert.doesNotMatch(card, /radar-coverage-card/u);
  assert.doesNotMatch(card, /radar-priority/u);
  assert.match(source, /radar-source-metadata/u);
  assert.match(source, /item\.authors/u);
  assert.match(source, /item\.published/u);
  assert.match(source, /item\.updated/u);
  assert.match(source, /coverage\.source_references/u);
  assert.match(source, /radarCoverageDescription/u);
  assert.match(source, /radar-skim-source/u);
  assert.doesNotMatch(source, /class="radar-original-abstract language-english"/u);
  assert.match(source, /class="radar-original-abstract"[^>]*lang="en"/u);
  assert.match(pending, /Array\.isArray\(coverage\?\.inspected_sections\)/u);
  assert.match(pending, /language-english/u);
  assert.match(knowledge, /class="knowledge-detail"/u);
  assert.match(knowledge, /展开推导与来源/u);
  assert.match(knowledge, /关键推导/u);
});

function feedEntry(arxiv_id, revision = 1) {
  return {
    arxiv_id,
    revision,
    title: `Paper ${arxiv_id}`,
    abstract: `Abstract for ${arxiv_id}.`,
    published: "2026-09-07T00:00:00Z",
    updated: "2026-09-07T00:00:00Z",
    authors: ["A. Researcher"],
    url: `https://arxiv.org/abs/${arxiv_id}v${revision}`,
  };
}

function coverageFor(entry, level) {
  const body = level !== "abstract_only";
  return {
    level,
    label: body ? "已检查正文指定部分" : "仅检查 arXiv 摘要",
    inspected_sections: body
      ? level === "full_body"
        ? ["Abstract", "Introduction", "Assumptions", "Methods", "Results", "Discussion", "Conclusions"]
        : ["Introduction"]
      : ["Abstract"],
    source_version: `arXiv:${entry.arxiv_id}v${entry.revision}`,
    source_references: [{
      kind: body ? "arxiv_source_package" : "arxiv_abstract",
      url: body ? `https://arxiv.org/src/${entry.arxiv_id}v${entry.revision}` : entry.url,
      locator: body ? (level === "body_partial" ? "Introduction" : "full body sections") : "Abstract",
      ...(body ? { sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } : {}),
    }],
    ...(level === "full_body" ? {
      section_coverage: {
        problem: true,
        assumptions: true,
        method: true,
        results: true,
        limitations: true,
        appendices: "not_needed",
      },
    } : {}),
  };
}

function validAnalysis(entry, overrides = {}) {
  return {
    arxiv_id: entry.arxiv_id,
    revision: entry.revision,
    status: "ready",
    source_fingerprint: sourceFingerprint(entry),
    priority: "must_read",
    coverage: coverageFor(entry, "full_body"),
    analysis: {
      origin: "manual",
      analyzed_at: "2026-09-07T00:00:00Z",
      reason: "与当前研究问题直接相关。",
      result: "正文结果段落报告了一个结果；讨论段落限定了适用范围。",
      reading_entry: "先读正文方法和结果段落，再回到讨论部分检查适用边界。",
      problem: "正文所界定的问题是什么。",
      method: "正文方法段落说明了数据或模型如何支撑结果。",
      assumptions: ["正文列出的假设需要结合方法段落理解。"],
      limits: ["结论仍限于实际检查的正文范围。"],
      citation_leads: ["正文结果段落可支持对结果的概括；限制见讨论段落。"],
      research_progress: "仅与当前缓存候选比较，不能代表全领域进展。",
      unresolved_checks: ["图表和推导尚未逐项独立复核。"],
      potential_lineage: {
        status: "no_match",
        reason: "当前材料不足以提出候选科学关系。",
        candidates: [],
      },
      prerequisite_works: [],
    },
    ...overrides,
  };
}

function validOpeningBrief(feed, mustReadAnalyses = []) {
  const referencesFor = (analyses) => analyses.map((analysis) => {
    const entry = feed.entries.find((candidate) => candidate.arxiv_id === analysis.arxiv_id && candidate.revision === analysis.revision);
    assert.ok(entry, "brief helper requires a current entry");
    return {
      arxiv_id: entry.arxiv_id,
      revision: entry.revision,
      source_fingerprint: sourceFingerprint(entry),
      guide_fingerprint: guideFingerprint(analysis),
    };
  });
  const allAnalyses = mustReadAnalyses;
  return {
    status: "ready",
    edition_fingerprint: editionFingerprint(feed),
    intro: "本期推荐关注吸积流能量预算与高能瞬变观测，它们帮助我们把模型假设和可观测结果放在同一条阅读线上。",
    worth_knowing_summary: "值得知道的工作补充了相关观测和模型背景，但结论仍以各自实际检查的正文范围为限。",
    skim_summary: "快速浏览部分提供摘要层面的近邻主题，适合决定是否稍后打开原文。",
    must_read: mustReadAnalyses.filter((analysis) => analysis.priority === "must_read").map((analysis) => {
      const entry = feed.entries.find((candidate) => candidate.arxiv_id === analysis.arxiv_id && candidate.revision === analysis.revision);
      assert.ok(entry, "brief helper requires a current Must Read entry");
      return {
        arxiv_id: entry.arxiv_id,
        revision: entry.revision,
        label: entry.title,
        text: "这篇论文给出与当前阅读焦点直接相关的可检查结果。",
        source_fingerprint: sourceFingerprint(entry),
        guide_fingerprint: guideFingerprint(analysis),
        anchor: radarCardAnchor(entry.arxiv_id, entry.revision),
      };
    }),
    worth_knowing: referencesFor(allAnalyses.filter((analysis) => analysis.priority === "worth_knowing")),
    skip: referencesFor(allAnalyses.filter((analysis) => analysis.priority === "skip")),
  };
}

test("equivalent arXiv URL and prefix forms match one normalized revision", () => {
  const entry = feedEntry("astro-ph/0001001");
  const analysis = validAnalysis(entry, { arxiv_id: "https://arxiv.org/abs/astro-ph/0001001v1" });
  const model = buildDailyRadarModel({ entries: [entry] }, { analyses: [analysis] });
  assert.equal(model.counts.analyzed, 1);
});

test("Skim source wording follows the recorded coverage and source references", () => {
  const abstractDescription = radarCoverageDescription({
    level: "abstract_only",
    label: "仅检查 arXiv 摘要",
    inspected_sections: ["Abstract"],
    source_references: [{ kind: "arxiv_abstract", locator: "Abstract" }],
  });
  assert.match(abstractDescription.primary, /摘要/u);
  assert.match(abstractDescription.english, /abstract/iu);

  const bodyDescription = radarCoverageDescription({
    level: "body_partial",
    label: "已检查 Results 与 Discussion",
    inspected_sections: ["Results", "Discussion"],
    source_references: [{ kind: "arxiv_source_package", locator: "Results, Discussion" }],
  });
  assert.match(bodyDescription.primary, /正文/u);
  assert.match(bodyDescription.english, /body|sections/iu);
  assert.doesNotMatch(bodyDescription.english, /based on the abstract/iu);
});

test("source references must identify the matched arXiv revision", () => {
  const entry = feedEntry("2609.00000");
  const analysis = validAnalysis(entry, {
    coverage: {
      level: "abstract_only",
      label: "仅检查 arXiv 摘要",
      inspected_sections: ["Abstract"],
      source_version: "arXiv:2609.00000v1",
      source_references: [{
        kind: "arxiv_abstract",
        url: "https://example.invalid/2609.00000v1",
        locator: "Abstract",
      }],
    },
  });

  const model = buildDailyRadarModel({ entries: [entry] }, { analyses: [analysis] });
  assert.equal(model.pending[0].pending_reason, "analysis_invalid");
  const validation = validateDailyRadarPayload({ entries: [entry] }, { analyses: [analysis] });
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.diagnostics, ["RADAR_SOURCE_REFERENCE_MISMATCH"]);
});

test("payload validation rejects an unclassified analysis outside the current cached feed", () => {
  const entry = feedEntry("2609.00000");
  const orphan = validAnalysis(feedEntry("2609.99999"));
  const validation = validateDailyRadarPayload({ entries: [entry] }, { analyses: [orphan] });
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.diagnostics, ["RADAR_ANALYSIS_SOURCE_UNKNOWN"]);
});

test("a rolling feed keeps matching guides, marks new entries pending and excludes retired entries", () => {
  const retired = feedEntry("2609.00011");
  const retained = feedEntry("2609.00012");
  const newEntry = feedEntry("2609.00013");
  const feed = { generated_at: "2026-09-08T00:00:00Z", entries: [retained, newEntry] };
  const retainedAnalysis = validAnalysis(retained);
  const radar = {
    analyses: [retainedAnalysis],
    historical_analyses: [{ ...validAnalysis(retired), historical_edition: "2026-09-07" }],
    opening_brief: validOpeningBrief(feed, [retainedAnalysis]),
  };
  const validation = validateDailyRadarPayload(
    feed,
    radar,
  );

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.diagnostics, []);
  assert.deepEqual(validation.model.groups.must_read.map(({ arxiv_id }) => arxiv_id), ["2609.00012"]);
  assert.deepEqual(validation.model.pending.map(({ arxiv_id, pending_reason }) => ({ arxiv_id, pending_reason })), [
    { arxiv_id: "2609.00013", pending_reason: "analysis_missing" },
  ]);
  assert.doesNotMatch(JSON.stringify(validation.model), /2609\.00011/u);
});

test("reconciling a rolling feed moves retired guides to a historical edition before validation", () => {
  const retired = feedEntry("2609.00015");
  const retained = feedEntry("2609.00016");
  const next = feedEntry("2609.00017");
  const previousFeed = {
    generated_at: "2026-09-07T20:00:00Z",
    window: { kind: "announcement_batch", batch_id: "announcement-2026-09-07", announcement_date: "2026-09-07" },
    entries: [retired, retained],
  };
  const nextFeed = {
    generated_at: "2026-09-08T20:00:00Z",
    window: { kind: "announcement_batch", batch_id: "announcement-2026-09-08", announcement_date: "2026-09-08" },
    entries: [retained, next],
  };
  const reconciled = reconcileDailyRadarEdition(previousFeed, {
    analyses: [validAnalysis(retired), validAnalysis(retained)],
    knowledge_points: [],
  }, nextFeed);

  assert.deepEqual(reconciled.analyses.map(({ arxiv_id }) => arxiv_id), ["2609.00016"]);
  assert.equal(reconciled.historical_analyses.length, 1);
  assert.equal(reconciled.historical_analyses[0].arxiv_id, "2609.00015");
  assert.equal(reconciled.historical_analyses[0].historical_edition, "announcement-2026-09-07");
  assert.equal(reconciled.opening_brief.status, "unavailable");
  const validation = validateDailyRadarPayload(nextFeed, reconciled);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.model.pending.map(({ arxiv_id }) => arxiv_id), ["2609.00017"]);
});

test("the Radar edition preserves an announcement-day feed window instead of relabeling it as a sample", () => {
  const model = buildDailyRadarModel(
    {
      generated_at: "2026-09-08T00:30:00Z",
      query: "(cat:astro-ph.HE OR cat:astro-ph.GA) AND submittedDate:[202609070400 TO 202609080400]",
      source_url: "https://export.arxiv.org/api/query",
      page_count: 2,
      window: {
        kind: "announcement_day",
        announcement_date: "2026-09-07",
        time_zone: "America/New_York",
      },
      entries: [],
    },
    { edition: { kind: "cached_first_edition", coverage_kind: "recent_submission_sample" }, analyses: [] },
  );
  assert.equal(model.edition.coverage_kind, "announcement_day");
  assert.equal(model.edition.window.announcement_date, "2026-09-07");
  assert.equal(model.edition.page_count, 2);
});

test("Radar validation reports malformed collection shapes instead of throwing", () => {
  const validation = validateDailyRadarPayload({ entries: {} }, { analyses: {}, knowledge_points: {} });
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.diagnostics, ["RADAR_FEED_ENTRIES_MISSING", "RADAR_ANALYSES_MISSING"]);
});

test("historical Radar records require an explicit edition marker", () => {
  const entry = feedEntry("2609.00014");
  const validation = validateDailyRadarPayload(
    { entries: [entry] },
    { analyses: [], historical_analyses: [validAnalysis(entry)] },
  );
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.diagnostics, ["RADAR_HISTORICAL_ANALYSES_INVALID"]);
});

test("daily radar model groups valid analyses and keeps pending separate from Skip", () => {
  const must = feedEntry("2609.00001");
  const worth = feedEntry("2609.00002");
  const skip = feedEntry("2609.00003");
  const pending = feedEntry("2609.00004");
  const model = buildDailyRadarModel(
    {
      generated_at: "2026-09-06T22:59:05.745Z",
      query: "cat:astro-ph.HE OR cat:astro-ph.GA",
      source_url: "https://export.arxiv.org/api/query",
      entries: [must, worth, skip, pending],
    },
    {
      analyses: [
        validAnalysis(must),
        validAnalysis(worth, { priority: "worth_knowing" }),
        validAnalysis(skip, { priority: "skip" }),
      ],
    },
  );

  assert.equal(model.counts.total, 4);
  assert.equal(model.counts.analyzed, 3);
  assert.equal(model.groups.must_read.length, 1);
  assert.equal(model.groups.worth_knowing.length, 1);
  assert.equal(model.groups.skip.length, 1);
  assert.equal(model.pending.length, 1);
  assert.equal(model.pending[0].pending_reason, "analysis_missing");
  assert.equal(model.groups.skip[0].analysis.priority, "skip");
});

test("reader priority requires the coverage needed for its claim", () => {
  const fullMust = feedEntry("2609.00031");
  const partialMust = feedEntry("2609.00032");
  const partialWorth = feedEntry("2609.00033");
  const abstractWorth = feedEntry("2609.00034");
  const abstractSkim = feedEntry("2609.00035");
  const model = buildDailyRadarModel(
    { entries: [fullMust, partialMust, partialWorth, abstractWorth, abstractSkim] },
    {
      analyses: [
        validAnalysis(fullMust, { priority: "must_read" }),
        validAnalysis(partialMust, { priority: "must_read", coverage: coverageFor(partialMust, "body_partial") }),
        validAnalysis(partialWorth, { priority: "worth_knowing", coverage: coverageFor(partialWorth, "body_partial") }),
        validAnalysis(abstractWorth, { priority: "worth_knowing", coverage: coverageFor(abstractWorth, "abstract_only") }),
        validAnalysis(abstractSkim, { priority: "skip", coverage: coverageFor(abstractSkim, "abstract_only") }),
      ],
    },
  );

  assert.deepEqual(model.groups.must_read.map(({ arxiv_id }) => arxiv_id), ["2609.00031"]);
  assert.deepEqual(model.groups.worth_knowing.map(({ arxiv_id }) => arxiv_id), ["2609.00033"]);
  assert.deepEqual(model.groups.skip.map(({ arxiv_id }) => arxiv_id), ["2609.00035"]);
  assert.deepEqual(model.pending.map(({ arxiv_id, pending_reason }) => ({ arxiv_id, pending_reason })), [
    { arxiv_id: "2609.00032", pending_reason: "coverage_insufficient_must_read" },
    { arxiv_id: "2609.00034", pending_reason: "coverage_insufficient_worth_knowing" },
  ]);
});

test("full-body coverage cannot be declared from an introduction-only inspection", () => {
  const entry = feedEntry("2609.00030");
  const analysis = validAnalysis(entry, {
    coverage: {
      ...coverageFor(entry, "full_body"),
      inspected_sections: ["Abstract", "Introduction"],
    },
  });
  const model = buildDailyRadarModel({ entries: [entry] }, { analyses: [analysis] });
  assert.equal(model.groups.must_read.length, 0);
  assert.equal(model.pending[0].pending_reason, "analysis_invalid");
});

test("malformed full-body section lists stay pending instead of throwing or entering legacy validation", () => {
  const item = feedEntry("2609.00028");
  for (const invalid of [
    { source_sections: ["Introduction", "Methods"], inspected_sections: ["Introduction", 42] },
    { source_sections: null },
  ]) {
    const analysis = validAnalysis(item, {
      coverage: { ...coverageFor(item, "full_body"), ...invalid },
    });
    const model = buildDailyRadarModel({ entries: [item] }, { analyses: [analysis] });
    assert.equal(model.groups.must_read.length, 0);
    assert.equal(model.pending[0].pending_reason, "analysis_invalid");
  }
});

test("non-terminal analyses remain pending until explicitly ready", () => {
  const entry = feedEntry("2609.00029");
  const model = buildDailyRadarModel(
    { entries: [entry] },
    { analyses: [validAnalysis(entry, { status: "pending" })] },
  );
  assert.equal(model.groups.must_read.length, 0);
  assert.equal(model.pending[0].pending_reason, "analysis_pending");
});

test("analyses without an explicit ready status remain pending", () => {
  const missingStatus = feedEntry("2609.00043");
  const unknownStatus = feedEntry("2609.00044");
  const missing = validAnalysis(missingStatus);
  delete missing.status;
  const model = buildDailyRadarModel(
    { entries: [missingStatus, unknownStatus] },
    { analyses: [missing, validAnalysis(unknownStatus, { status: "queued" })] },
  );

  assert.deepEqual(model.groups.must_read, []);
  assert.deepEqual(model.pending.map(({ arxiv_id, pending_reason }) => ({ arxiv_id, pending_reason })), [
    { arxiv_id: "2609.00043", pending_reason: "analysis_pending" },
    { arxiv_id: "2609.00044", pending_reason: "analysis_pending" },
  ]);
});

test("an edition-bound opening brief is usable only while its guides and feed remain unchanged", () => {
  const must = feedEntry("2609.00036");
  const feed = {
    generated_at: "2026-09-09T00:00:00Z",
    query: "q",
    source_url: "https://export.arxiv.org/api/query",
    entries: [must],
  };
  const analysis = validAnalysis(must, { priority: "must_read" });
  const radar = { analyses: [analysis], opening_brief: validOpeningBrief(feed, [analysis]) };
  const valid = validateDailyRadarPayload(feed, radar);
  assert.equal(valid.valid, true);
  assert.equal(valid.model.opening_brief.status, "ready");
  assert.deepEqual(valid.model.opening_brief_diagnostics, []);

  const changedGuide = { ...analysis, analysis: { ...analysis.analysis, result: "Changed guide prose." } };
  const stale = validateDailyRadarPayload(feed, { ...radar, analyses: [changedGuide] });
  assert.equal(stale.valid, false);
  assert.deepEqual(stale.fatalDiagnostics, []);
  assert.deepEqual(stale.model.opening_brief, null);
  assert.deepEqual(stale.model.opening_brief_diagnostics, ["RADAR_OPENING_BRIEF_STALE"]);

  const changedEdition = validateDailyRadarPayload(
    { ...feed, generated_at: "2026-09-10T00:00:00Z" },
    radar,
  );
  assert.equal(changedEdition.model.opening_brief, null);
  assert.deepEqual(changedEdition.model.opening_brief_diagnostics, ["RADAR_OPENING_BRIEF_STALE"]);
});

test("opening brief Work references are bound to supported guide relations", () => {
  const entry = feedEntry("2609.00031");
  const feed = { generated_at: "2026-09-07T00:00:00Z", entries: [entry] };
  const analysis = validAnalysis(entry);
  analysis.analysis.potential_lineage = {
    status: "candidate",
    reason: "需要继续核查双方正文。",
    candidates: [{
      relation: "extends",
      target_work_id: "work:visible",
      delta: "把代表状态扩展为演化轨迹。",
      support: "Results",
      unresolved_checks: ["双方正文对读待完成。"],
    }],
  };
  const brief = validOpeningBrief(feed, [analysis]);
  brief.must_read[0].related_work_ids = ["work:visible"];

  assert.deepEqual(openingBriefDiagnostics(brief, feed, {
    groups: { must_read: [{ ...entry, analysis }], worth_knowing: [], skip: [] },
  }), []);

  const unsupported = structuredClone(brief);
  unsupported.must_read[0].related_work_ids = ["work:unsupported"];
  assert.deepEqual(openingBriefDiagnostics(unsupported, feed, {
    groups: { must_read: [{ ...entry, analysis }], worth_knowing: [], skip: [] },
  }), ["RADAR_OPENING_BRIEF_STALE"]);

  assert.deepEqual(openingBriefDiagnostics(brief, feed, {
    groups: { must_read: [{ ...entry, analysis }], worth_knowing: [], skip: [] },
  }, { visibleWorkIds: ["work:other"] }), ["RADAR_OPENING_BRIEF_STALE"]);
  assert.deepEqual(openingBriefDiagnostics(brief, feed, {
    groups: { must_read: [{ ...entry, analysis }], worth_knowing: [], skip: [] },
  }, { visibleWorkIds: ["work:visible"] }), []);
});

test("a ready opening brief is suppressed when the edition has no eligible guides", () => {
  const feed = { generated_at: "2026-09-07T00:00:00Z", entries: [] };
  const brief = {
    status: "ready",
    edition_fingerprint: editionFingerprint(feed),
    intro: "不应在没有有效导读时展示科学概括。",
    must_read: [],
  };
  assert.deepEqual(openingBriefDiagnostics(brief, feed, {
    groups: { must_read: [], worth_knowing: [], skip: [] },
  }), ["RADAR_OPENING_BRIEF_STALE"]);
});

test("reconciling a new feed drops the old opening brief instead of carrying stale prose", () => {
  const oldEntry = feedEntry("2609.00037");
  const nextEntry = feedEntry("2609.00038");
  const previousFeed = { generated_at: "2026-09-09T00:00:00Z", entries: [oldEntry] };
  const nextFeed = { generated_at: "2026-09-10T00:00:00Z", entries: [nextEntry] };
  const analysis = validAnalysis(oldEntry);
  const reconciled = reconcileDailyRadarEdition(previousFeed, {
    analyses: [analysis],
    opening_brief: validOpeningBrief(previousFeed, [analysis]),
  }, nextFeed);
  assert.equal(reconciled.opening_brief.status, "unavailable");
  assert.match(reconciled.opening_brief.reason, /重新绑定/u);
});

test("collective opening summaries bind every current guide identity and fingerprint", () => {
  const must = feedEntry("2609.00039");
  const worth = feedEntry("2609.00040");
  const skim = feedEntry("2609.00041");
  const feed = { generated_at: "2026-09-09T00:00:00Z", entries: [must, worth, skim] };
  const analyses = [
    validAnalysis(must),
    validAnalysis(worth, { priority: "worth_knowing", coverage: coverageFor(worth, "body_partial") }),
    validAnalysis(skim, { priority: "skip", coverage: coverageFor(skim, "abstract_only") }),
  ];
  const radar = { analyses, opening_brief: validOpeningBrief(feed, analyses) };
  assert.equal(validateDailyRadarPayload(feed, radar).valid, true);

  const changedWorth = { ...analyses[1], analysis: { ...analyses[1].analysis, result: "Changed collective guide." } };
  const stale = validateDailyRadarPayload(feed, { ...radar, analyses: [analyses[0], changedWorth, analyses[2]] });
  assert.deepEqual(stale.model.opening_brief, null);
  assert.deepEqual(stale.model.opening_brief_diagnostics, ["RADAR_OPENING_BRIEF_STALE"]);
});

test("an eligible edition without an opening brief is diagnosed but still keeps valid cards readable", () => {
  const entry = feedEntry("2609.00042");
  const validation = validateDailyRadarPayload({ entries: [entry] }, { analyses: [validAnalysis(entry)] });
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.diagnostics, ["RADAR_OPENING_BRIEF_MISSING"]);
  assert.deepEqual(validation.fatalDiagnostics, []);
  assert.equal(validation.model.groups.must_read.length, 1);
  assert.equal(validation.model.opening_brief, null);
});

test("revision, source changes and invalid coverage become pending instead of stale guides", () => {
  const entry = feedEntry("2609.00005", 2);
  const old = feedEntry("2609.00005", 1);
  const changed = validAnalysis(entry, { source_fingerprint: "different-source" });
  const invalid = validAnalysis(entry, {
    coverage: { level: "abstract_only" },
  });

  const stale = buildDailyRadarModel(
    { generated_at: "2026-09-07T00:00:00Z", query: "q", source_url: "u", entries: [entry] },
    { analyses: [validAnalysis(old)] },
  );
  assert.equal(stale.pending[0].pending_reason, "analysis_revision_mismatch");

  const changedModel = buildDailyRadarModel(
    { generated_at: "2026-09-07T00:00:00Z", query: "q", source_url: "u", entries: [entry] },
    { analyses: [changed] },
  );
  assert.equal(changedModel.pending[0].pending_reason, "source_changed");

  const invalidModel = buildDailyRadarModel(
    { generated_at: "2026-09-07T00:00:00Z", query: "q", source_url: "u", entries: [entry] },
    { analyses: [invalid] },
  );
  assert.equal(invalidModel.pending[0].pending_reason, "analysis_invalid");

  const failed = buildDailyRadarModel(
    { entries: [entry] },
    { analyses: [{ ...validAnalysis(entry), status: "failed", failure_reason: "正文读取不可用" }] },
  );
  assert.equal(failed.pending[0].pending_reason, "analysis_failed");
  assert.match(failed.pending[0].pending_detail, /正文读取不可用/u);
});

test("a valid edition may have zero Must Read items without converting pending items to Skip", () => {
  const worth = feedEntry("2609.00009");
  const pending = feedEntry("2609.00010");
  const model = buildDailyRadarModel(
    { entries: [worth, pending] },
    { analyses: [validAnalysis(worth, { priority: "worth_knowing" })] },
  );
  assert.equal(model.groups.must_read.length, 0);
  assert.equal(model.groups.skip.length, 0);
  assert.equal(model.pending.length, 1);
});

test("expanded guide contracts accept partial and full coverage and retain explicit unknowns", () => {
  const partial = feedEntry("2609.00006");
  const full = feedEntry("2609.00007");
  const model = buildDailyRadarModel(
    { generated_at: "2026-09-07T00:00:00Z", query: "q", source_url: "u", entries: [partial, full] },
    {
      analyses: [
        validAnalysis(partial, {
          priority: "worth_knowing",
          coverage: {
            level: "body_partial",
            label: "已检查正文指定部分",
            inspected_sections: ["Introduction", "Results"],
            source_version: "arXiv:2609.00006v1",
            source_references: [{ kind: "arxiv_source_package", url: "https://arxiv.org/src/2609.00006v1", locator: "Introduction, Results", sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
          },
        }),
        validAnalysis(full, {
          coverage: {
            level: "full_body",
            label: "已检查正文全文",
            inspected_sections: ["Introduction", "Assumptions", "Methods", "Results", "Discussion", "Conclusions"],
            source_version: "arXiv:2609.00007v1",
            source_references: [{ kind: "arxiv_source_package", url: "https://arxiv.org/src/2609.00007v1", locator: "全文", sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
            section_coverage: {
              problem: true,
              assumptions: true,
              method: true,
              results: true,
              limitations: true,
              appendices: "not_needed",
            },
          },
        }),
      ],
    },
  );
  assert.equal(model.counts.analyzed, 2);
  assert.equal(model.pending.length, 0);
  assert.deepEqual(model.groups.must_read.map(({ arxiv_id }) => arxiv_id), ["2609.00007"]);
  assert.deepEqual(model.groups.worth_knowing.map(({ arxiv_id }) => arxiv_id), ["2609.00006"]);
});

test("potential lineage keeps direction and removes hidden Work targets", () => {
  const projected = projectPotentialLineage({
    status: "candidate",
    reason: "需要进一步核对双方材料。",
    candidates: [
      {
        relation: "extends",
        target_work_id: "work:visible",
        delta: "扩大了计算范围。",
        support: "Results, section 3",
        unresolved_checks: ["独立复核待完成。"],
      },
      {
        relation: "challenges",
        target_work_id: "work:hidden",
        delta: "不应出现在 reader 页面。",
        support: "Abstract",
        unresolved_checks: [],
      },
    ],
  }, ["work:visible"]);

  assert.equal(projected.candidates.length, 1);
  assert.equal(projected.candidates[0].relation, "extends");
  assert.equal(projected.candidates[0].target_work_id, "work:visible");
  assert.doesNotMatch(JSON.stringify(projected), /work:hidden/u);
});

test("potential lineage also removes hidden Work explanation text", () => {
  const projected = projectPotentialLineage({
    status: "candidate",
    reason: "这条关系依赖 work:hidden 的旧模型。",
    unresolved_checks: ["需要与 work:hidden 的正文对读。", "公开候选仍需复核。"],
    candidates: [
      {
        relation: "extends",
        target_work_id: "work:visible",
        delta: "公开候选的可见变化。",
        support: "Results",
        unresolved_checks: [],
      },
      {
        relation: "tests",
        target_work_id: "work:hidden",
        delta: "不应泄露 work:hidden 的解释。",
        support: "Discussion",
        unresolved_checks: [],
      },
    ],
  }, ["work:visible"]);

  assert.doesNotMatch(JSON.stringify(projected), /work:hidden/u);
  assert.equal(projected.candidates.length, 1);
  assert.deepEqual(projected.unresolved_checks, []);
});

test("knowledge points require an exact source revision and preserve paper versus teaching derivations", () => {
  const entry = feedEntry("2609.00008");
  const point = {
    id: "knowledge-point:test",
    title: "A grounded point",
    why_it_matters: "It matters.",
    physical_picture: "A physical picture.",
    assumptions: ["An assumption."],
    symbols: [{ symbol: "$E$", meaning: "Energy." }],
    derivation: [
      { kind: "paper", text: "The paper writes $E$." },
      { kind: "teaching", text: "Teaching expansion." },
    ],
    units_checks: ["The units close."],
    paper_use: "The paper uses it.",
    source_references: [{ kind: "arxiv_source_package", url: "https://arxiv.org/src/2609.00008v1", locator: "Results", sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }],
    unresolved_checks: ["Independent check pending."],
    source: {
      arxiv_id: entry.arxiv_id,
      revision: entry.revision,
      source_fingerprint: sourceFingerprint(entry),
      source_version: "arXiv:2609.00008v1",
      level: "body_partial",
      label: "已检查正文指定部分",
      inspected_sections: ["Results"],
    },
  };
  assert.deepEqual(knowledgePointDiagnostics(point, entry), []);
  assert.deepEqual(knowledgePointDiagnostics({ ...point, source: { ...point.source, revision: 2 } }, entry), ["knowledge_point_revision_mismatch"]);
  const model = buildDailyRadarModel(
    { entries: [entry] },
    { analyses: [], knowledge_points: [point] },
  );
  assert.equal(model.knowledge_points.length, 1);
  assert.equal(model.knowledge_points_pending.length, 0);

  const rolling = buildDailyRadarModel(
    { entries: [entry] },
    {
      analyses: [],
      knowledge_points: [point],
      historical_knowledge_points: [{ ...point, id: "knowledge-point:retired", historical_edition: "2026-09-07", source: { ...point.source, arxiv_id: "2609.99998" } }],
    },
  );
  assert.deepEqual(rolling.knowledge_points.map(({ id }) => id), ["knowledge-point:test"]);
  assert.deepEqual(rolling.knowledge_points_pending, []);

  const mismatched = buildDailyRadarModel(
    { entries: [entry] },
    { analyses: [], knowledge_points: [{ ...point, source: { ...point.source, revision: 2 } }] },
  );
  assert.deepEqual(mismatched.knowledge_points, []);
  assert.equal(mismatched.knowledge_points_pending[0].pending_reason, "knowledge_point_revision_mismatch");

  const broken = buildDailyRadarModel(
    { entries: [entry] },
    { analyses: [], knowledge_points: [{ ...point, symbols: [null] }] },
  );
  assert.equal(broken.knowledge_points.length, 0);
  assert.equal(broken.knowledge_points_pending[0].pending_reason, "knowledge_point_invalid");

  const limited = buildDailyRadarModel(
    { entries: [entry] },
    { analyses: [], knowledge_points: [point, { ...point, id: "knowledge-point:test-2" }, { ...point, id: "knowledge-point:test-3" }] },
  );
  assert.equal(limited.knowledge_points.length, 2);
  assert.equal(limited.knowledge_points_pending.at(-1).pending_reason, "knowledge_point_limit");
});

test("the cached edition keeps ineligible guides pending without requiring a forced recommendation", async () => {
  const feed = JSON.parse(await readFile(new URL("../src/data/arxiv-daily.json", import.meta.url), "utf8"));
  const radar = JSON.parse(await readFile(new URL("../src/data/daily-radar.json", import.meta.url), "utf8"));
  const validation = validateDailyRadarPayload(feed, radar);
  assert.equal(validation.valid, true);
  if (feed.entries?.some(({ arxiv_id }) => arxiv_id === "2609.04145")) {
    assert.deepEqual(validation.model.groups.must_read, []);
    assert.deepEqual(validation.model.groups.worth_knowing, []);
    assert.deepEqual(validation.model.groups.skip.map(({ arxiv_id }) => arxiv_id), ["2609.04077", "2609.03859"]);
    assert.deepEqual(
      validation.model.pending.filter(({ arxiv_id }) => ["2609.04145", "2609.04130", "2609.04118", "2609.04051"].includes(arxiv_id)).map(({ arxiv_id, pending_reason }) => ({ arxiv_id, pending_reason })),
      [
        { arxiv_id: "2609.04145", pending_reason: "coverage_insufficient_must_read" },
        { arxiv_id: "2609.04130", pending_reason: "coverage_insufficient_worth_knowing" },
        { arxiv_id: "2609.04118", pending_reason: "coverage_insufficient_worth_knowing" },
        { arxiv_id: "2609.04051", pending_reason: "coverage_insufficient_worth_knowing" },
      ],
    );
  } else {
    const eligible = validation.model.groups.must_read.length + validation.model.groups.worth_knowing.length + validation.model.groups.skip.length;
    assert.equal(eligible + validation.model.pending.length, feed.entries.length);
    if (eligible === 0) assert.notEqual(validation.model.opening_brief?.status, "ready");
  }
});
