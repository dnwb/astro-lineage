import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

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
    badge: "物理模型示意图",
    pattern: /\b(schematic|cartoon|illustration|geometry|scenario|sketch|setup|model\s+overview|system\s+geometry|configuration|concept|framework|analytic\s+model|physical\s+picture|jet\s+structure|binary\s+orbit)\b/i,
    baseScore: 30,
  },
  {
    type: "observational",
    badge: "观测总体曲线/能谱",
    pattern: /\b(light\s*curve|multi-wavelength|broadband|photometric\s+evolution|full\s+spectrum|spectral\s+energy\s+distribution|sed|sky\s*map|waterfall|flux\s+density|dynamic\s+spectrum|polarization\s+evolution)\b/i,
    baseScore: 25,
  },
  {
    type: "fitting",
    badge: "数据拟合与模型对比",
    pattern: /\b(best-fit|model\s+fit|fitting\s+comparison|model\s+vs\s+data|comparison\s+between\s+data\s+and\s+model|residuals|posterior\s+distribution|mcmc\s+corner|parameter\s+constraints)\b/i,
    baseScore: 20,
  },
];

const NEGATIVE_KEYWORDS = /\b(flowchart|pipeline\s+diagram|software|architecture\s+of\s+the\s+code|training\s+loss|loss\s+curve|confusion\s+matrix|detector\s+efficiency|camera\s+response|calibration\s+curve|instrumental\s+setup|table\s+as\s+image)\b/i;

/**
 * Clean HTML tags from caption
 */
export function cleanCaption(text) {
  if (!text) return "";
  return text
    .replace(/<figcaption[^>]*>/gi, "")
    .replace(/<\/figcaption>/gi, "")
    .replace(/<[^>]+>/g, " ")
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
 * Extract intuitive, high-value scientific figures for an arXiv paper.
 * Reads arXiv's public HTML5 presentation and extracts high-res web images.
 * Strict fail-closed: only figures strictly matching Theoretical, Observational,
 * or Fitting categories are extracted. Random or unclear figures are dropped.
 */
export async function extractPaperFigures(arxivId, revision = 1, options = {}) {
  const { maxFigures = 2, fetchImpl = fetch } = options;
  const cleanId = String(arxivId).replace(/^arXiv:/i, "").trim();
  const htmlUrl = `https://arxiv.org/html/${cleanId}v${revision}`;

  try {
    const res = await fetchImpl(htmlUrl, {
      headers: { "User-Agent": "AstroLineage-FigureExtractor/1.0 (academic research robot)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const figureMatches = [...html.matchAll(/<figure[\s\S]*?<\/figure>/gi)];
    if (figureMatches.length === 0) return [];

    const candidates = [];
    for (const match of figureMatches) {
      const block = match[0];
      const imgMatch = block.match(/<img[^>]+src="([^">]+)"/i);
      if (!imgMatch) continue;

      const rawSrc = imgMatch[1];
      const capMatch = block.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
      const caption = cleanCaption(capMatch ? capMatch[1] : "");

      const classification = classifyScientificFigure(caption);
      // Fail-closed: only accept distinct, intuitive figures matching one of the 3 classes
      if (!classification) continue;

      const labelMatch = caption.match(/^(?:Figure|Fig\.?)\s*(\d+[a-z]?)/i);
      const label = labelMatch ? `Fig. ${labelMatch[1]}` : classification.badge;

      candidates.push({
        rawSrc,
        caption,
        label,
        category: classification.type,
        categoryBadge: classification.badge,
        isSchematic: classification.type === "theoretical",
        score: classification.score,
      });
    }

    if (candidates.length === 0) return [];

    // Sort by scientific score descending
    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates.slice(0, maxFigures);

    const outDir = join(FIGURES_DIR, cleanId);
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
      const publicUrl = `/arxiv-figures/${cleanId}/${fileName}`;

      if (!existsSync(destPath)) {
        const imgRes = await fetchImpl(imgUrl, { signal: AbortSignal.timeout(20_000) });
        if (imgRes.ok) {
          const buf = Buffer.from(await imgRes.arrayBuffer());
          await writeFile(destPath, buf);
        }
      }

      if (existsSync(destPath)) {
        results.push({
          url: publicUrl,
          caption: item.caption,
          label: item.label,
          category: item.category,
          category_badge: item.categoryBadge,
          is_schematic: item.isSchematic,
        });
      }
    }

    return results;
  } catch (err) {
    // Fail gracefully without breaking parent analysis
    return [];
  }
}
