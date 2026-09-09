import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  buildDailyRadarModel,
  knowledgePointDiagnostics,
  projectPotentialLineage,
  reconcileDailyRadarEdition,
  sourceFingerprint,
  validateDailyRadarPayload,
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
  assert.match(desktop, /\.radar-page \.reader-header,[\s\S]*?\.radar-page \.radar-priority-section\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*52rem;[\s\S]*?margin-inline:\s*auto;/u);
  assert.match(desktop, /\.radar-page \.radar-list-item\s*\{[\s\S]*?max-width:\s*none;/u);
  assert.match(desktop, /\.radar-page \.radar-card\s*\{[\s\S]*?width:\s*100%;[\s\S]*?box-sizing:\s*border-box;/u);
  assert.match(desktop, /\.radar-page \.reader-header \.language-primary,[\s\S]*?\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*45em;/u);
  assert.match(desktop, /\.radar-page \.reader-header \.language-english,[\s\S]*?\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*75ch;/u);
  assert.match(desktop, /\.radar-page \.radar-card > \.language-primary,[\s\S]*?\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/u);
  assert.match(desktop, /\.radar-page \.radar-card \.language-english,[\s\S]*?\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;/u);
  assert.match(desktop, /\.radar-page \.radar-card p,[\s\S]*?max-width:\s*none;/u);
  assert.match(desktop, /\.radar-page[\s\S]*?line-height:\s*1\.8;/u);
  assert.match(desktop, /\.radar-page \.radar-card h3\s*\{[\s\S]*?line-height:\s*1\.4;/u);
  assert.match(desktop, /\.radar-page[\s\S]*?margin-block-end:\s*1em;/u);
  assert.doesNotMatch(mobile, /\.radar-page/u);
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

function validAnalysis(entry, overrides = {}) {
  return {
    arxiv_id: entry.arxiv_id,
    revision: entry.revision,
    source_fingerprint: sourceFingerprint(entry),
    priority: "must_read",
    coverage: {
      level: "abstract_only",
      label: "仅检查 arXiv 摘要",
      inspected_sections: ["Abstract"],
      source_version: `arXiv:${entry.arxiv_id}v${entry.revision}`,
      source_references: [{ kind: "arxiv_abstract", url: entry.url, locator: "Abstract" }],
    },
    analysis: {
      origin: "manual",
      analyzed_at: "2026-09-07T00:00:00Z",
      reason: "与当前研究问题直接相关。",
      result: "摘要报告了一个结果。正文限制尚未核查。",
      reading_entry: "先读摘要；正文入口仍待核查。",
      problem: "摘要试图回答什么问题。",
      assumptions: ["摘要中的假设尚未由正文核查。"],
      limits: ["不能据此声称全文验证。"],
      citation_leads: ["摘要可支持对摘要结果的概括；正文定位待核查。"],
      research_progress: "仅与当前缓存候选比较，不能代表全领域进展。",
      unresolved_checks: ["正文方法、图表和推导尚未检查。"],
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

test("equivalent arXiv URL and prefix forms match one normalized revision", () => {
  const entry = feedEntry("astro-ph/0001001");
  const analysis = validAnalysis(entry, { arxiv_id: "https://arxiv.org/abs/astro-ph/0001001v1" });
  const model = buildDailyRadarModel({ entries: [entry] }, { analyses: [analysis] });
  assert.equal(model.counts.analyzed, 1);
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
  const radar = {
    analyses: [validAnalysis(retained)],
    historical_analyses: [{ ...validAnalysis(retired), historical_edition: "2026-09-07" }],
  };
  const validation = validateDailyRadarPayload(
    { generated_at: "2026-09-08T00:00:00Z", entries: [retained, newEntry] },
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
            inspected_sections: ["全文"],
            source_version: "arXiv:2609.00007v1",
            source_references: [{ kind: "arxiv_source_package", url: "https://arxiv.org/src/2609.00007v1", locator: "全文", sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
          },
        }),
      ],
    },
  );
  assert.equal(model.counts.analyzed, 2);
  assert.equal(model.pending.length, 0);
  assert.deepEqual(model.groups.must_read.map(({ arxiv_id }) => arxiv_id), ["2609.00006", "2609.00007"]);
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
