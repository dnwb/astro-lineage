import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

export const CAUSAL_ANCHOR_RELATIONS = Object.freeze([
  "supports",
  "constrains",
  "challenges",
  "extends",
  "tests",
]);

export const CausalAnchorStageLinkSchema = z.object({
  stage_id: z.string().startsWith("stage:"),
  work_slug: z.string(),
  relation: z.enum(["supports", "constrains", "challenges", "extends", "tests"]),
  reason: z.string().min(5),
});

export const CausalAnchorSchema = z.object({
  primary_axis: z.string().min(2),
  anchored_stages: z.array(CausalAnchorStageLinkSchema).min(1),
  review_state: z
    .enum(["unreviewed_machine_inference", "reviewed"])
    .default("unreviewed_machine_inference"),
  anchored_at: z.string().optional(),
});

/**
 * Loads the 41-work causal graph catalog from content/works.
 */
export function loadCausalCatalog(contentWorksDir = resolve("content/works")) {
  const works = [];
  const stagesMap = new Map();
  const stagesByWork = new Map();

  let dirEntries;
  try {
    dirEntries = readdirSync(contentWorksDir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Failed to read works directory at ${contentWorksDir}: ${err.message}`);
  }

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;
    const workSlug = entry.name;
    const workDir = join(contentWorksDir, workSlug);
    const workFile = join(workDir, "work.yaml");
    const accountFile = join(workDir, "physical-account.yaml");

    let workTitle = workSlug;
    try {
      const workRaw = readFileSync(workFile, "utf8");
      const workData = yaml.load(workRaw);
      if (workData?.title) workTitle = workData.title;
    } catch {}

    let stages = [];
    try {
      const accRaw = readFileSync(accountFile, "utf8");
      const accData = yaml.load(accRaw);
      if (Array.isArray(accData?.stages)) {
        for (const st of accData.stages) {
          if (!st?.id) continue;
          const stageItem = {
            id: st.id,
            label: st.label || st.id,
            work_slug: workSlug,
            work_title: workTitle,
            annotation_id: st.annotation_id || null,
          };
          stages.push(stageItem);
          stagesMap.set(st.id, stageItem);
        }
      }
    } catch {}

    works.push({
      slug: workSlug,
      title: workTitle,
      stage_count: stages.length,
    });
    stagesByWork.set(workSlug, stages);
  }

  return {
    works,
    total_stages: stagesMap.size,
    hasStage(stageId) {
      return stagesMap.has(stageId);
    },
    getStage(stageId) {
      return stagesMap.get(stageId);
    },
    getStagesForWork(slug) {
      return stagesByWork.get(slug) || [];
    },
    getAllStages() {
      return Array.from(stagesMap.values());
    },
    validateAnchor(anchor) {
      const parsed = CausalAnchorSchema.safeParse(anchor);
      if (!parsed.success) {
        return {
          valid: false,
          errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        };
      }
      const errors = [];
      for (const st of parsed.data.anchored_stages) {
        if (!stagesMap.has(st.stage_id)) {
          errors.push(`Invalid stage_id "${st.stage_id}": not found in 41-work catalog`);
          continue;
        }
        const catalogStage = stagesMap.get(st.stage_id);
        if (catalogStage.work_slug !== st.work_slug) {
          errors.push(
            `Mismatched work_slug for stage "${st.stage_id}": expected "${catalogStage.work_slug}", got "${st.work_slug}"`
          );
        }
      }
      return {
        valid: errors.length === 0,
        errors,
        data: parsed.data,
      };
    },
  };
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "that",
  "this",
  "using",
  "study",
  "model",
  "models",
  "observations",
  "observation",
  "emission",
  "physics",
  "high",
  "energy",
  "astrophysics",
]);

function extractTerms(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
  );
}

/**
 * Selects the top-K most relevant canonical works and their stages for a candidate paper
 * so prompts stay compact instead of injecting all 41 works (~27k chars).
 */
export function selectRelevantCausalWorks(paper, catalog, { maxWorks = 5 } = {}) {
  if (!catalog || !Array.isArray(catalog.works) || catalog.works.length === 0) return [];
  const paperText = `${paper?.title || ""} ${paper?.abstract || ""} ${paper?.problem || ""}`;
  const paperTerms = extractTerms(paperText);
  if (paperTerms.size === 0) return [];

  const scored = catalog.works
    .map((work) => {
      const stages = catalog.getStagesForWork(work.slug);
      const workTerms = extractTerms(
        `${work.slug} ${work.title} ${stages.map((s) => s.label).join(" ")}`
      );
      let overlap = 0;
      for (const term of paperTerms) {
        if (workTerms.has(term)) overlap += 1;
      }
      return { work, stages, overlap };
    })
    .filter((entry) => entry.overlap > 0 && entry.stages.length > 0)
    .sort((a, b) => b.overlap - a.overlap || a.work.slug.localeCompare(b.work.slug))
    .slice(0, maxWorks);

  return scored.map(({ work, stages }) => ({
    slug: work.slug,
    title: work.title,
    stages: stages.map((s) => ({ id: s.id, label: s.label })),
  }));
}

/**
 * Formats selected causal works into a compact prompt reference block.
 */
export function formatCausalContext(selectedWorks) {
  if (!Array.isArray(selectedWorks) || selectedWorks.length === 0) return "";
  return selectedWorks
    .map(
      (w) =>
        `- ${w.slug} (${w.title}):\n${w.stages.map((s) => `  - ${s.id}: ${s.label}`).join("\n")}`
    )
    .join("\n");
}
