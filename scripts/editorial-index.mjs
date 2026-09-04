import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { loadCanonicalContent } from "./content-loader.mjs";

const DEFAULT_CONTENT_ROOT = new URL("../content/", import.meta.url);
const DEFAULT_GENERATED_ROOT = resolve(process.cwd(), "generated");
const OUTPUT_FILE = "work-research-lines.json";

function asPath(value) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  return resolve(value);
}

function compareBytewise(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function workRecord(work) {
  return isObject(work?.files?.["work.yaml"]) ? work.files["work.yaml"] : null;
}

function isVisibleWork(work) {
  return workRecord(work)?.reader_state === "visible";
}

function isVisibleResearchLine(researchLine) {
  return researchLine?.line?.reader_state === "visible";
}

function membershipsFor(researchLine) {
  const memberships = researchLine?.line?.memberships;
  return Array.isArray(memberships) ? memberships : [];
}

/**
 * Build the reader-facing reverse index from canonical snapshot data.
 *
 * The index is deliberately derived data: it contains only reviewed
 * memberships connecting visible Works to visible Research Lines. Draft
 * entities and draft/unreviewed secondary memberships remain canonical but
 * are not exposed through this reader-facing artifact.
 */
export function buildWorkResearchLineIndex(snapshot) {
  const visibleWorkIds = new Set(
    (Array.isArray(snapshot?.works) ? snapshot.works : [])
      .filter(isVisibleWork)
      .map((work) => work.id)
      .filter((id) => typeof id === "string"),
  );
  const visibleLines = (Array.isArray(snapshot?.researchLines) ? snapshot.researchLines : [])
    .filter(isVisibleResearchLine)
    .filter((researchLine) => typeof researchLine.id === "string")
    .sort((left, right) => compareBytewise(left.id, right.id));

  const index = {};
  for (const workId of [...visibleWorkIds].sort(compareBytewise)) {
    const entries = [];
    for (const researchLine of visibleLines) {
      for (const membership of membershipsFor(researchLine)) {
        if (!isObject(membership) || membership.work_id !== workId) {
          continue;
        }
        if (membership.review_state !== "reviewed") {
          continue;
        }

        const readingRoles = Array.isArray(membership.reading_roles)
          ? [...new Set(membership.reading_roles)]
            .filter((role) => typeof role === "string")
            .sort(compareBytewise)
          : [];
        entries.push({
          line_id: researchLine.id,
          membership_id: typeof membership.id === "string" ? membership.id : null,
          reading_roles: readingRoles,
          editorial_anchor: membership.editorial_anchor === true,
        });
      }
    }
    entries.sort((left, right) => {
      const lineOrder = compareBytewise(left.line_id, right.line_id);
      if (lineOrder !== 0) {
        return lineOrder;
      }
      return compareBytewise(left.membership_id ?? "", right.membership_id ?? "");
    });
    index[workId] = entries;
  }

  return index;
}

/**
 * Write the deterministic reader-facing Work-to-Research-Line index.
 *
 * `generatedRoot` is intentionally supplied by the caller so tests and build
 * workflows can target an isolated output directory. It is never read by
 * canonical content discovery.
 */
export async function writeEditorialIndexes(
  snapshot,
  generatedRoot = DEFAULT_GENERATED_ROOT,
) {
  const outputRoot = asPath(generatedRoot);
  const outputPath = join(outputRoot, OUTPUT_FILE);
  const index = buildWorkResearchLineIndex(snapshot);
  await mkdir(outputRoot, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export async function readEditorialIndex(generatedRoot = DEFAULT_GENERATED_ROOT) {
  return JSON.parse(
    await readFile(join(asPath(generatedRoot), OUTPUT_FILE), "utf8"),
  );
}

export { OUTPUT_FILE };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const snapshot = await loadCanonicalContent(DEFAULT_CONTENT_ROOT);
  await writeEditorialIndexes(snapshot, DEFAULT_GENERATED_ROOT);
}
