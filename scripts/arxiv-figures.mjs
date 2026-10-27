import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { safeParseJson } from "./pipeline-evidence-gate.mjs";

function hashBytes(data) {
  return createHash("sha256").update(data).digest("hex");
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIGURES_DIR = resolve(ROOT, "public/arxiv-figures");

/**
 * Three core scientific figure categories:
 * 1. THEORETICAL: Physical model schematic, cartoon, geometry, scenario.
 * 2. OBSERVATIONAL: Multi-wavelength light curves, full spectra, SED, skymaps.
 * 3. FITTING: Model fitting vs observed data, residuals, best-fit comparisons.
 */
export const SCIENTIFIC_FIGURE_CRITERIA = [
  {
    type: "theoretical",
    badge: "Physical Model Schematic",
    pattern:
      /\b(schematic|cartoon|illustrat\w*|geometry|scenario|sketch|setup|model\s+overview|system\s+geometry|configuration|concept|framework|analytic\s+model|physical\s+picture|jet\s+structure|binary\s+orbit|adiabatic\s+loss|funnel\s+leakage|temperature|luminosity|density\s+profile|radiation\s+field)\b/i,
    baseScore: 30,
  },
  {
    type: "observational",
    badge: "Observational Light Curve / SED",
    pattern:
      /\b(light\s*curve|multi-wavelength|broadband|photometric\s+evolution|full\s+spectrum|spectral\s+energy\s+distribution|sed|sky\s*map|waterfall|flux\s+density|dynamic\s+spectrum|polarization\s+evolution|dispersion\s+measure|\bdmhost\b|\bdm_host\b|color-magnitude|spectra)\b/i,
    baseScore: 25,
  },
  {
    type: "fitting",
    badge: "Model vs Data Fitting",
    pattern:
      /\b(best-fit|model\s+fit|fitting\s+comparison|model\s+vs\s+data|comparison\s+between\s+data\s+and\s+model|residuals|posterior\s+distribution|mcmc\s+corner|parameter\s+constraints|linear\s+fit|correlation|scaling\s+relation)\b/i,
    baseScore: 20,
  },
];

function defaultCategoryBadge(type) {
  const matched = SCIENTIFIC_FIGURE_CRITERIA.find((c) => c.type === type);
  return matched ? matched.badge : "Physical Model Schematic";
}

const NEGATIVE_KEYWORDS =
  /\b(flowchart|pipeline\s+diagram|software|architecture\s+of\s+the\s+code|training\s+loss|loss\s+curve|confusion\s+matrix|detector\s+efficiency|camera\s+response|calibration\s+curve|instrumental\s+setup|table\s+as\s+image)\b/i;

/**
 * Clean HTML tags from caption and preserve mathematical formulas enclosed in MathML / LaTeX.
 */
export function cleanCaption(text) {
  if (!text) return "";
  let processed = text.replace(/<math[\s\S]*?<\/math>/gi, (match) => {
    const isDisplay = /display=[\"\']block[\"\']/i.test(match);
    let tex = "";
    const annotMatch = match.match(
      /<annotation\s+encoding=[\"\']application\/x-tex[\"\']>([\s\S]*?)<\/annotation>/i
    );
    if (annotMatch) {
      tex = annotMatch[1];
    } else {
      const altMatch = match.match(/alttext=[\"\']([\s\S]*?)[\"\']/i);
      if (altMatch) tex = altMatch[1];
    }
    tex = tex
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (!tex) return "";
    tex = tex.replace(/^\$+|\$+$/g, "").trim();
    return isDisplay ? ` $$${tex}$$ ` : ` $${tex}$ `;
  });

  return processed
    .replace(/<figcaption[^>]*>/gi, "")
    .replace(/<\/figcaption>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/([(\[{])\s+\$/g, "$1$")
    .replace(/\$\s+([)\]}])/g, "$$$1")
    .replace(/\s+([,.:;?!])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a figure caption into one of the three intuitive scientific categories.
 * Strict fail-closed: if not clearly in one of these categories, returns null (do not show).
 */
export function classifyScientificFigure(caption) {
  if (!caption || typeof caption !== "string") return null;
  if (NEGATIVE_KEYWORDS.test(caption)) return null;

  for (const criterion of SCIENTIFIC_FIGURE_CRITERIA) {
    if (criterion.pattern.test(caption)) {
      return {
        type: criterion.type,
        badge: criterion.badge,
        score: criterion.baseScore,
      };
    }
  }

  // Not distinctly intuitive or prominent; reject to avoid misleading reader
  return null;
}

/**
 * Build a model-driven figure selector function using the AI analysis model.
 */
export function buildModelFigureSelector({ modelCall, model, baseUrl, apiKey } = {}) {
  return async ({ candidates, arxivId, title, abstract }) => {
    if (!modelCall || !Array.isArray(candidates) || candidates.length === 0) return [];
    const prompt = `You are a rigorous peer reviewer in high-energy astrophysics. From the candidate figures of this paper, select the figures with the highest physical insight and scientific value (up to 2 figures).

[Paper Information]
- arXiv ID: ${arxivId}
- Title: ${title || "Not provided"}
- Abstract: ${abstract || "Not provided"}

[Priority Selection Criteria]
1. theoretical (Physical model schematic / geometry / theoretical evolution curves) -> categoryBadge: "Physical Model Schematic" or "Physical Evolution"
2. observational (Multi-wavelength light curves / broadband SED / key observational comparison) -> categoryBadge: "Observational Light Curve / SED" or "Key Observational Evidence"
3. fitting (Model vs observational data comparison / residuals / posterior parameter constraints) -> categoryBadge: "Model vs Data Fitting"

[Strictly Exclude]
- Pure software flowcharts / pipeline diagrams / code architectures
- Instrument calibration / detector efficiency curves
- Plain data tables converted to images / survey sky tiling grids

[Candidate Figures]
${candidates.map((c) => `[Figure ${c.index}] Label: ${c.label}\nCaption: ${c.caption}`).join("\n\n")}

Return a strict JSON array (empty [] if no figure meets criteria), in this format:
[
  {
    "index": 0,
    "category": "theoretical",
    "categoryBadge": "Physical Model Schematic",
    "physical_core": "Explain in concise English the physical core, mechanism, or key observational feature shown in this figure (strictly grounded in paper)",
    "reason": "Brief selection reason in English"
  }
]`;

    try {
      const raw = await modelCall({
        stage: "figure_selection",
        prompt,
        model,
        baseUrl,
        apiKey,
      });
      const parsed = safeParseJson(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
}

/**
 * Extract intuitive, high-value scientific figures for an arXiv paper.
 * Reads arXiv's public HTML5 presentation and extracts high-res web images.
 * Prioritizes model evaluation if options.modelSelector is supplied; falls back to heuristic rules.
 */
export async function extractPaperFigures(arxivId, revision = 1, options = {}) {
  const { maxFigures = 2, fetchImpl = fetch, modelSelector, figuresDir = FIGURES_DIR } = options;
  const cleanId = String(arxivId)
    .replace(/^arXiv:/i, "")
    .trim();
  const htmlUrl = `https://arxiv.org/html/${cleanId}v${revision}`;

  try {
    const res = await fetchImpl(htmlUrl, {
      headers: { "User-Agent": "AstroLineage-FigureExtractor/1.0 (academic research robot)" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      if (res.status === 404) {
        console.warn(`[arxiv-figures] arXiv HTML5 暂不可用 (404): ${htmlUrl}`);
      }
      return [];
    }

    const html = await res.text();
    const figureMatches = [...html.matchAll(/<figure[\s\S]*?<\/figure>/gi)];
    if (figureMatches.length === 0) return [];

    const candidates = [];
    let figureIndex = 0;
    for (const match of figureMatches) {
      const block = match[0];
      const imgMatch = block.match(/<img[^>]+src="([^">]+)"/i);
      if (!imgMatch) continue;
      const rawSrc = imgMatch[1];

      const capMatch = block.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
      const caption = cleanCaption(capMatch ? capMatch[1] : "");

      const labelMatch = caption.match(/^(?:Figure|Fig\.?)\s*(\d+[a-z]?)/i);
      const label = labelMatch ? `Fig. ${labelMatch[1]}` : `Fig. ${figureIndex + 1}`;

      candidates.push({
        index: figureIndex,
        rawSrc,
        caption,
        label,
      });
      figureIndex += 1;
    }

    if (candidates.length === 0) return [];

    // Filter out candidates with negative keywords (e.g. software flowcharts)
    const validCandidates = candidates.filter((c) => !NEGATIVE_KEYWORDS.test(c.caption));
    if (validCandidates.length === 0) return [];

    let selected = [];
    if (typeof modelSelector === "function") {
      try {
        const modelPicks = await modelSelector({
          candidates: validCandidates,
          arxivId: cleanId,
          title: options.paperTitle,
          abstract: options.paperAbstract,
        });

        if (Array.isArray(modelPicks) && modelPicks.length > 0) {
          for (const pick of modelPicks.slice(0, maxFigures)) {
            const matched =
              (typeof pick.index === "number" &&
                validCandidates.find((c) => c.index === pick.index)) ||
              (pick.label && validCandidates.find((c) => c.label === pick.label));
            if (matched && !NEGATIVE_KEYWORDS.test(matched.caption)) {
              const category = pick.category || "theoretical";
              selected.push({
                ...matched,
                category,
                categoryBadge: pick.categoryBadge || defaultCategoryBadge(category),
                physical_core: pick.physical_core || pick.physicalCore || "",
                isSchematic: category === "theoretical",
                score: 100,
              });
            }
          }
        }
      } catch (err) {
        // Fall back to rule-based classification
      }
    }

    if (selected.length === 0) {
      const classified = [];
      for (const item of validCandidates) {
        const classification = classifyScientificFigure(item.caption);
        if (!classification) continue;

        classified.push({
          ...item,
          category: classification.type,
          categoryBadge: classification.badge,
          isSchematic: classification.type === "theoretical",
          score: classification.score,
        });
      }

      if (classified.length === 0) return [];

      classified.sort((a, b) => b.score - a.score);
      selected = classified.slice(0, maxFigures);
    }

    const outDir = join(figuresDir, cleanId);
    await mkdir(outDir, { recursive: true });

    const results = [];
    for (const item of selected) {
      // Resolve image URL
      let imgUrl = item.rawSrc;
      if (!/^https?:\/\//i.test(imgUrl)) {
        const cleanSrc = item.rawSrc.replace(/^\/+/, "");
        if (cleanSrc.startsWith(`${cleanId}v`)) {
          imgUrl = `https://arxiv.org/html/${cleanSrc}`;
        } else {
          imgUrl = `https://arxiv.org/html/${cleanId}v${revision}/${cleanSrc}`;
        }
      }

      const rawBase = basename(item.rawSrc);
      const fileName = rawBase.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const destPath = join(outDir, fileName);
      const metaPath = join(outDir, `.${fileName}.provenance.json`);
      const publicUrl = `/arxiv-figures/${cleanId}/${fileName}`;

      let fileBytes = null;
      let cachedProvenance = null;
      if (existsSync(destPath) && existsSync(metaPath)) {
        try {
          cachedProvenance = JSON.parse(await readFile(metaPath, "utf8"));
        } catch {
          cachedProvenance = null;
        }
      }

      const isCacheValidForRevision =
        cachedProvenance &&
        cachedProvenance.revision === Number(revision) &&
        cachedProvenance.source_version === `arXiv:${cleanId}v${revision}`;

      if (!isCacheValidForRevision) {
        const imgRes = await fetchImpl(imgUrl, {
          headers: { "User-Agent": "AstroLineage-FigureExtractor/1.0 (academic research robot)" },
          signal: AbortSignal.timeout(45_000),
        });
        if (imgRes.ok) {
          fileBytes = Buffer.from(await imgRes.arrayBuffer());
          await writeFile(destPath, fileBytes);
          const sha = hashBytes(fileBytes);
          await writeFile(
            metaPath,
            JSON.stringify({
              revision: Number(revision),
              source_version: `arXiv:${cleanId}v${revision}`,
              asset_sha256: sha,
            })
          );
        }
      } else {
        try {
          fileBytes = await readFile(destPath);
        } catch {
          fileBytes = null;
        }
      }

      if (existsSync(destPath)) {
        if (!fileBytes) {
          try {
            fileBytes = await readFile(destPath);
          } catch {
            fileBytes = null;
          }
        }
        const assetSha256 = fileBytes ? hashBytes(fileBytes) : null;
        // Only assign revision and source_version when cache provenance matches current revision
        const hasVerifiedProvenance =
          fileBytes &&
          (isCacheValidForRevision ||
            (cachedProvenance && cachedProvenance.revision === Number(revision)));
        results.push({
          url: publicUrl,
          caption: item.caption,
          label: item.label,
          category: item.category,
          category_badge: item.categoryBadge,
          physical_core: item.physical_core || "",
          is_schematic: item.isSchematic,
          ...(hasVerifiedProvenance || !existsSync(metaPath)
            ? {
                revision: Number(revision),
                source_version: `arXiv:${cleanId}v${revision}`,
                ...(assetSha256 ? { asset_sha256: assetSha256 } : {}),
              }
            : {}),
        });
      }
    }

    return results;
  } catch (err) {
    console.warn(`[arxiv-figures] 提取插图异常 (arXiv:${cleanId}): ${err.message}`);
    return [];
  }
}
