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
