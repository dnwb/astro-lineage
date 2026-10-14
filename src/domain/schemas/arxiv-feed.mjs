/**
 * src/domain/schemas/arxiv-feed.mjs
 *
 * Authoritative Zod Schemas for arXiv Raw Feeds & Paper Entries.
 * Single Source of Truth for ingest typing and validation.
 */

import { z } from "zod";

export const ArxivEntrySchema = z
  .object({
    arxiv_id: z.string().min(1, "arxiv_id is required"),
    revision: z.coerce.number().int().positive("revision must be a positive integer"),
    title: z.string().default(""),
    abstract: z.string().default(""),
    published: z.string().optional(),
    updated: z.string().optional(),
    authors: z.array(z.string()).default([]),
    url: z.string().default(""),
    categories: z.array(z.string()).default([]),
    primary_category: z.string().default("astro-ph.HE"),
  })
  .passthrough();

export const BatchWindowSchema = z
  .object({
    kind: z.string().default("announcement_batch"),
    batch_id: z.string().default(""),
    announcement_date: z.string().optional(),
    announcement_weekday: z.string().optional(),
    submission_start_date: z.string().optional(),
    submission_end_date: z.string().optional(),
    local_start: z.string().optional(),
    local_end: z.string().optional(),
    utc_start: z.string().optional(),
    utc_end: z.string().optional(),
  })
  .passthrough();

export const ArxivFeedSchema = z
  .object({
    schema_version: z.string().default("arxiv-daily-discovery-v1"),
    generated_at: z.string().optional(),
    query: z.string().optional(),
    base_query: z.string().optional(),
    source_url: z.string().optional(),
    window: BatchWindowSchema.optional(),
    entries: z.array(ArxivEntrySchema).default([]),
  })
  .passthrough();

/**
 * Validate an ArxivFeed payload using Zod.
 * Returns { success, data, errors: string[] }
 */
export function safeValidateArxivFeed(feed) {
  const result = ArxivFeedSchema.safeParse(feed);
  if (result.success) {
    return { success: true, data: result.data, errors: [] };
  }
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
  );
  return { success: false, data: null, errors };
}
