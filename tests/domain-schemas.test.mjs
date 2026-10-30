import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  safeValidateRadarPayload,
  safeValidateArxivFeed,
  RadarAnalysisSchema,
  FigureSchema,
  CoverageSchema,
  OpeningBriefSchema,
} from "../src/domain/schemas/index.mjs";
import { buildAnalysisRecord } from "../scripts/arxiv-ai-analyzer.mjs";
import { buildDailyRadarModel } from "../scripts/daily-radar.mjs";

test("domain-schemas: active daily-radar.json passes Zod schema validation", async () => {
  const raw = await readFile(resolve("src/data/daily-radar.json"), "utf8");
  const data = JSON.parse(raw);
  const result = safeValidateRadarPayload(data);
  assert.equal(result.success, true, `Validation failed: ${result.errors.join("; ")}`);
  assert.ok(Array.isArray(result.data.analyses), "analyses should be an array");
});

test("domain-schemas: active arxiv-daily.json passes Zod schema validation", async () => {
  const raw = await readFile(resolve("src/data/arxiv-daily.json"), "utf8");
  const data = JSON.parse(raw);
  const result = safeValidateArxivFeed(data);
  assert.equal(result.success, true, `Validation failed: ${result.errors.join("; ")}`);
  assert.ok(result.data.entries.length > 0, "Should contain entries");
});

test("domain-schemas: RadarAnalysisSchema rejects illegal priority and invalid revision", () => {
  const invalidPriority = {
    arxiv_id: "2610.99999",
    revision: 1,
    source_fingerprint: "abc",
    priority: "unsupported_level",
  };
  const res1 = RadarAnalysisSchema.safeParse(invalidPriority);
  assert.equal(res1.success, false);

  const invalidRevision = {
    arxiv_id: "2610.99999",
    revision: -1,
    source_fingerprint: "abc",
    priority: "must_read",
  };
  const res2 = RadarAnalysisSchema.safeParse(invalidRevision);
  assert.equal(res2.success, false);
});

test("domain-schemas: RadarAnalysisSchema supports journal records with source and doi", () => {
  const journalPaper = {
    id: "doi:10.1038/s41586-026-00099-1",
    source: "nature",
    doi: "10.1038/s41586-026-00099-1",
    source_fingerprint: "hash-123",
    priority: "must_read",
  };
  const res = RadarAnalysisSchema.safeParse(journalPaper);
  assert.equal(res.success, true, res.error?.message);
  assert.equal(res.data.source, "nature");
  assert.equal(res.data.doi, "10.1038/s41586-026-00099-1");
  assert.equal(res.data.revision, 1);
});

test("domain-schemas: CoverageSchema validates known levels and default values", () => {
  const valid = CoverageSchema.parse({ level: "full_body" });
  assert.equal(valid.level, "full_body");
  assert.deepEqual(valid.inspected_sections, []);

  const invalid = CoverageSchema.safeParse({ level: "summary_only" });
  assert.equal(invalid.success, false);
});

test("domain-schemas: FigureSchema enforces url and defaults category", () => {
  const emptyUrl = FigureSchema.safeParse({ url: "" });
  assert.equal(emptyUrl.success, false);

  const parsed = FigureSchema.parse({
    url: "/arxiv-figures/test.png",
    caption: "Model evolution",
  });
  assert.equal(parsed.url, "/arxiv-figures/test.png");
  assert.equal(parsed.category, "general");
  assert.equal(parsed.is_schematic, false);
});

test("domain-schemas: OpeningBriefSchema validates structured entities (focus_paper, key_highlights, skim_topics)", () => {
  const briefWithEntities = {
    status: "ready",
    intro: "Sample intro",
    focus_paper: {
      arxiv_id: "2610.12345",
      revision: 1,
      title: "Test Paper",
      anchor: "radar-paper-2610-12345-v1",
    },
    key_highlights: [
      {
        arxiv_id: "2610.23456",
        revision: 2,
        title: "Key Paper",
        anchor: "radar-paper-2610-23456-v2",
        result: "Significant constraint on jet break.",
      },
    ],
    skim_topics: [
      {
        arxiv_id: "2610.34567",
        revision: 1,
        title: "Skim Paper",
      },
    ],
  };

  const parsed = OpeningBriefSchema.parse(briefWithEntities);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.focus_paper?.arxiv_id, "2610.12345");
  assert.equal(parsed.key_highlights?.length, 1);
  assert.equal(parsed.key_highlights?.[0]?.result, "Significant constraint on jet break.");
  assert.equal(parsed.skim_topics?.length, 1);

  // focus_paper can be null
  const parsedNullFocus = OpeningBriefSchema.parse({
    status: "ready",
    intro: "Another intro",
    focus_paper: null,
  });
  assert.equal(parsedNullFocus.focus_paper, null);
});

test("domain-schemas: contract test between buildAnalysisRecord and analysisDiagnostics", () => {
  const skipEntry = {
    id: "http://arxiv.org/abs/2610.12345v1",
    arxiv_id: "2610.12345",
    revision: 1,
    title: "Test Calibration Note",
    abstract: "A brief instrument calibration report.",
    authors: ["Test Author"],
    categories: ["astro-ph.IM"],
    primary_category: "astro-ph.IM",
    published: "2026-10-28T00:00:00Z",
    updated: "2026-10-28T00:00:00Z",
    url: "https://arxiv.org/abs/2610.12345v1",
  };
  const skipParsed = {
    priority: "skip",
    reason: "Standard instrumental monitoring note outside priority topics.",
  };
  const skipChecked = {
    reason: "Standard instrumental monitoring note outside priority topics.",
    result: "Routine calibration check.",
    reading_entry: "Brief note on calibration.",
    problem: "Instrumental detector stability.",
    method: "Photometric zero-point tracking.",
    assumptions: ["Linear detector response."],
    limits: ["Only valid for current cycle."],
    evidence: [],
    research_progress: "Ongoing instrument monitoring.",
    figures: [],
    inspectedSections: ["Abstract"],
  };

  const skipRecord = buildAnalysisRecord(skipEntry, skipParsed, skipChecked, {
    modelName: "test-model",
  });
  const skipSchemaResult = RadarAnalysisSchema.safeParse(skipRecord);
  assert.equal(
    skipSchemaResult.success,
    true,
    `RadarAnalysisSchema rejected skip record: ${JSON.stringify(skipSchemaResult.error?.issues)}`
  );
  const skipRadar = buildDailyRadarModel({ entries: [skipEntry] }, { analyses: [skipRecord] });
  assert.equal(skipRadar.pending.length, 0, "skip record should not land in pending");
  assert.equal(skipRadar.groups.skip.length, 1);
  assert.equal(skipRadar.groups.skip[0].arxiv_id, "2610.12345");

  const mustReadEntry = {
    id: "http://arxiv.org/abs/2610.23456v1",
    arxiv_id: "2610.23456",
    revision: 1,
    title: "Groundbreaking Fast Radio Burst Discovery",
    abstract: "Discovery of coherent radio emission from magnetar.",
    authors: ["Lead Author"],
    categories: ["astro-ph.HE"],
    primary_category: "astro-ph.HE",
    published: "2026-10-28T00:00:00Z",
    updated: "2026-10-28T00:00:00Z",
    url: "https://arxiv.org/abs/2610.23456v1",
  };
  const mustReadParsed = {
    priority: "must_read",
    title_zh: "磁星相干射电爆发的突破性发现",
  };
  const mustReadChecked = {
    title_zh: "磁星相干射电爆发的突破性发现",
    reason: "First direct detection of high energy counterpart.",
    result: "Coherent GHz burst coincident with hard X-ray flare.",
    reading_entry: "Examines light curves and polarization signatures.",
    problem: "Mechanism of prompt FRB emission.",
    method: "Simultaneous radio and X-ray timing.",
    assumptions: ["Single impulsive trigger event."],
    limits: ["Bandwidth limited to 1.2-1.6 GHz."],
    evidence: [{ section: "Method", quote: "Time difference was measured below 1 ms." }],
    research_progress: "Confirms magnetar origin hypothesis.",
    figures: [],
    inspectedSections: [
      "Introduction",
      "Model Setup",
      "Methodology",
      "Observation Results",
      "Discussion and Limits",
    ],
  };
  const source = {
    url: "https://arxiv.org/src/2610.23456v1",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };
  const mustReadRecord = buildAnalysisRecord(mustReadEntry, mustReadParsed, mustReadChecked, {
    modelName: "test-model",
    source,
  });
  const mustReadSchemaResult = RadarAnalysisSchema.safeParse(mustReadRecord);
  assert.equal(
    mustReadSchemaResult.success,
    true,
    `RadarAnalysisSchema rejected must_read record: ${JSON.stringify(mustReadSchemaResult.error?.issues)}`
  );
  const mustReadRadar = buildDailyRadarModel(
    { entries: [mustReadEntry] },
    { analyses: [mustReadRecord] }
  );
  assert.equal(mustReadRadar.pending.length, 0, "must_read record should not land in pending");
  assert.equal(mustReadRadar.groups.must_read.length, 1);
  assert.equal(mustReadRadar.groups.must_read[0].arxiv_id, "2610.23456");
});
