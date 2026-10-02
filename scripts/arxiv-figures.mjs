import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIGURES_DIR = resolve(ROOT, "public/arxiv-figures");

const SCHEMATIC_KEYWORDS = /\b(schematic|cartoon|illustration|geometry|scenario|diagram|sketch|setup|model\s+overview|system\s+geometry|configuration|concept|framework)\b/i;

/**
 * Clean HTML tags from caption
 */
function cleanCaption(text) {
  if (!text) return "";
  return text
    .replace(/<figcaption[^>]*>/gi, "")
    .replace(/<\/figcaption>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract schematic or core physical illustration figures for an arXiv paper.
 * Reads arXiv's public HTML5 presentation and extracts high-res web images.
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

      const labelMatch = caption.match(/^(?:Figure|Fig\.?)\s*(\d+[a-z]?)/i);
      const label = labelMatch ? `Fig. ${labelMatch[1]}` : "示意图";

      const isSchematic = SCHEMATIC_KEYWORDS.test(caption);
      const score = isSchematic ? 10 : (labelMatch && labelMatch[1] === "1" ? 5 : 1);

      candidates.push({
        rawSrc,
        caption,
        label,
        isSchematic,
        score,
      });
    }

    if (candidates.length === 0) return [];

    // Sort by schematic score descending, then by original order
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
