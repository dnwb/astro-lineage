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
