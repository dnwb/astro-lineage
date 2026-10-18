/**
 * src/domain/schemas/arxiv-radar.mjs
 *
 * Authoritative Zod Schemas for arXiv Daily Radar & Analysis Payloads.
 * Single Source of Truth for pipeline typing, runtime validation, and structured LLM constraints.
 */

import { z } from "zod";

export const RADAR_PRIORITY_VALUES = ["must_read", "worth_knowing", "skip"];
export const RADAR_COVERAGE_VALUES = ["abstract_only", "body_partial", "full_body"];
export const OPENING_BRIEF_STATUS_VALUES = ["ready", "unavailable", "partial"];

export const FigureSchema = z
  .object({
    url: z.string().min(1, "Figure url cannot be empty"),
    caption: z.string().default(""),
    label: z.string().default(""),
    category: z.string().default("general"),
    category_badge: z.string().default("插图"),
    is_schematic: z.boolean().default(false),
  })
  .passthrough();

export const CoverageSchema = z
  .object({
    level: z.enum(RADAR_COVERAGE_VALUES, {
      errorMap: () => ({
        message: "coverage.level must be one of abstract_only, body_partial, full_body",
      }),
    }),
    label: z.string().optional(),
    source_version: z.union([z.number(), z.string()]).optional(),
    inspected_sections: z.array(z.string()).default([]),
    source_references: z.array(z.any()).default([]),
  })
  .passthrough();

export const CitationLeadSchema = z.union([
  z.string(),
  z
    .object({
      arxiv_id: z.string().optional(),
      title: z.string().optional(),
      role: z.string().optional(),
      note: z.string().optional(),
    })
    .passthrough(),
]);

export const AnalysisBodySchema = z
  .object({
    origin: z.string().optional(),
    model: z.string().optional(),
    analyzed_at: z.string().optional(),
    title_zh: z.string().optional(),
    reason: z.string().default(""),
    result: z.string().default(""),
    reading_entry: z.string().optional(),
    problem: z.string().default(""),
    method: z.string().default(""),
    assumptions: z.array(z.string()).default([]),
    limits: z.array(z.string()).default([]),
    citation_leads: z.array(CitationLeadSchema).default([]),
    research_progress: z.string().optional(),
    figures: z.array(FigureSchema).default([]),
    unresolved_checks: z.array(z.string()).default([]),
    potential_lineage: z.any().optional(),
    prerequisite_works: z.array(z.any()).default([]),
  })
  .passthrough();

export const RadarAnalysisSchema = z
  .object({
    arxiv_id: z.string().min(1, "arxiv_id is required"),
    revision: z.coerce.number().int().positive("revision must be a positive integer"),
    status: z.string().default("ready"),
    source_fingerprint: z.string().min(1, "source_fingerprint is required"),
    guide_fingerprint: z.string().optional(),
    priority: z.enum(RADAR_PRIORITY_VALUES, {
      errorMap: () => ({ message: "priority must be one of must_read, worth_knowing, skip" }),
    }),
    historical_edition: z.string().optional(),
    historical_edition_fingerprint: z.string().optional(),
    coverage: CoverageSchema.default({ level: "abstract_only" }),
    analysis: AnalysisBodySchema.default({}),
    figures: z.array(FigureSchema).optional(),
  })
  .passthrough();

export const RadarEditionSchema = z
  .object({
    generated_at: z.string().optional(),
    query: z.string().nullable().optional(),
    coverage_kind: z.string().default("announcement_batch"),
    window: z.record(z.any()).nullable().optional(),
    source_url: z.string().nullable().optional(),
    page_count: z.number().optional(),
  })
  .passthrough();

export const OpeningBriefSectionSchema = z
  .object({
    title: z.string().default(""),
    summary: z.string().default(""),
    paper_ids: z.array(z.string()).default([]),
  })
  .passthrough();

export const OpeningBriefSchema = z
  .object({
    status: z.enum(OPENING_BRIEF_STATUS_VALUES).default("unavailable"),
    reason: z.string().optional(),
    generated_at: z.string().optional(),
    summary: z.string().optional(),
    thematic_highlights: z.array(z.any()).optional(),
    sections: z.array(OpeningBriefSectionSchema).optional(),
    must_read_count: z.number().optional(),
    worth_knowing_count: z.number().optional(),
  })
  .passthrough();

export const DailyRadarPayloadSchema = z
  .object({
    schema_version: z.string().optional(),
    edition: RadarEditionSchema.default({}),
    analyses: z.array(RadarAnalysisSchema).default([]),
    historical_analyses: z.array(RadarAnalysisSchema).default([]),
    opening_brief: OpeningBriefSchema.default({ status: "unavailable" }),
  })
  .passthrough();

/**
 * Validate a DailyRadar payload using Zod.
 * Returns { success, data, errors: string[] }
 */
export function safeValidateRadarPayload(payload) {
  const result = DailyRadarPayloadSchema.safeParse(payload);
  if (result.success) {
    return { success: true, data: result.data, errors: [] };
  }
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
  );
  return { success: false, data: null, errors };
}
