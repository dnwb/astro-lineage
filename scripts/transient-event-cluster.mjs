/**
 * scripts/transient-event-cluster.mjs
 * 
 * Scientific Transient Event Clustering & Heat Tracking Engine.
 * Automatically identifies observational transient targets (GRBs, SNe, FRBs, GWs, ATs)
 * across preprints, clusters papers by event, and computes heat decay scores.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractTransientIdentifiers, matchScientificTags } from "../src/domain/academic-domain.mjs";

const DEFAULT_ARCHIVE_DIR = "src/data/arxiv-archives/daily";
const DEFAULT_RADAR_PATH = "src/data/daily-radar.json";
const DEFAULT_OUTPUT_PATH = "src/data/scientific-events.json";

/**
 * Calculate event heat score using exponential time decay.
 * Half-life is set to 7 days (astronomical transient alert cycle).
 */
export function calculateHeatScore(papers, lastUpdatedDate, referenceDate = new Date()) {
  if (!papers || papers.length === 0) return 0;
  
  // Base score: Must Read papers get 25 points, Worth Knowing gets 15, Skim/other gets 5
  let baseScore = 0;
  for (const paper of papers) {
    if (paper.priority === "must_read") baseScore += 25;
    else if (paper.priority === "worth_knowing") baseScore += 15;
    else baseScore += 5;
  }

  const updateTime = new Date(lastUpdatedDate).getTime();
  const refTime = new Date(referenceDate).getTime();
  const diffDays = Math.max(0, (refTime - updateTime) / (1000 * 60 * 60 * 24));

  // 7-day half-life decay formula
  const decay = Math.pow(0.5, diffDays / 7.0);
  return Math.round(baseScore * decay * 10) / 10;
}

/**
 * Determine event category from event identifier.
 */
export function classifyEventType(eventId) {
  const upper = eventId.toUpperCase();
  if (upper.startsWith("GRB")) return "GRB";
  if (upper.startsWith("SN")) return "SN";
  if (upper.startsWith("FRB")) return "FRB";
  if (upper.startsWith("GW")) return "GW";
  if (upper.startsWith("SGR")) return "SGR";
  if (upper.startsWith("AT")) return "AT";
  return "OTHER";
}

/**
 * Cluster papers into transient scientific events.
 */
export async function buildScientificEventClusters({
  archiveDir = DEFAULT_ARCHIVE_DIR,
  radarPath = DEFAULT_RADAR_PATH,
  now = new Date(),
} = {}) {
  const paperMap = new Map(); // arxiv_id -> paper details

  // 1. Ingest Daily Radar (latest)
  try {
    const rawRadar = JSON.parse(await readFile(radarPath, "utf8"));
    const analyses = Array.isArray(rawRadar.analyses) ? rawRadar.analyses : [];
    const date = rawRadar.edition?.window?.announcement_date || now.toISOString().slice(0, 10);

    for (const item of analyses) {
      if (!item.arxiv_id) continue;
      paperMap.set(item.arxiv_id, {
        arxiv_id: item.arxiv_id,
        revision: item.revision || 1,
        title: item.title || "",
        date,
        priority: item.priority || "skip",
        analysis: item.analysis || {},
      });
    }
  } catch (err) {
    // If radar missing, proceed with archives
  }

  // 2. Ingest Archives
  try {
    const files = await readdir(archiveDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

    for (const file of jsonFiles) {
      const filePath = join(archiveDir, file);
      try {
        const archive = JSON.parse(await readFile(filePath, "utf8"));
        const date = archive.date || file.replace(".json", "");
        const analyses = archive.radar?.analyses || archive.analyses || [];
        for (const item of analyses) {
          if (!item.arxiv_id || paperMap.has(item.arxiv_id)) continue;
          paperMap.set(item.arxiv_id, {
            arxiv_id: item.arxiv_id,
            revision: item.revision || 1,
            title: item.title || "",
            date,
            priority: item.priority || "skip",
            analysis: item.analysis || {},
          });
        }
      } catch (err) {
        // Skip unreadable files
      }
    }
  } catch (err) {
    // Archive dir not found
  }

  // 3. Extract transient events & cluster
  const clusters = new Map(); // eventId -> cluster object

  for (const paper of paperMap.values()) {
    const combinedText = [
      paper.title,
      paper.analysis?.problem || "",
      paper.analysis?.result || "",
      paper.analysis?.reason || "",
    ].join(" ");

    const identifiers = extractTransientIdentifiers(combinedText);
    const tags = matchScientificTags(paper);

    for (const eventId of identifiers) {
      if (!clusters.has(eventId)) {
        clusters.set(eventId, {
          event_id: eventId,
          event_type: classifyEventType(eventId),
          tags: new Set(),
          papers: [],
          first_seen: paper.date,
          last_updated: paper.date,
        });
      }

      const cluster = clusters.get(eventId);
      tags.forEach((t) => cluster.tags.add(t));
      
      // Update dates
      if (paper.date < cluster.first_seen) cluster.first_seen = paper.date;
      if (paper.date > cluster.last_updated) cluster.last_updated = paper.date;

      // Add paper summary if not already added
      if (!cluster.papers.some((p) => p.arxiv_id === paper.arxiv_id)) {
        cluster.papers.push({
          arxiv_id: paper.arxiv_id,
          title: paper.title,
          date: paper.date,
          priority: paper.priority,
          bluf_result: paper.analysis?.result || "未记录",
          bluf_problem: paper.analysis?.problem || "未记录",
        });
      }
    }
  }

  // 4. Format, compute heat, and sort
  const resultList = [];
  for (const cluster of clusters.values()) {
    // Sort papers within cluster by date descending
    cluster.papers.sort((a, b) => b.date.localeCompare(a.date));

    const heat = calculateHeatScore(cluster.papers, cluster.last_updated, now);
    resultList.push({
      event_id: cluster.event_id,
      event_type: cluster.event_type,
      tags: Array.from(cluster.tags),
      heat_score: heat,
      paper_count: cluster.papers.length,
      first_seen: cluster.first_seen,
      last_updated: cluster.last_updated,
      papers: cluster.papers,
    });
  }

  // Sort clusters by heat score descending, then paper count descending
  resultList.sort((a, b) => b.heat_score - a.heat_score || b.paper_count - a.paper_count);

  return {
    generated_at: now.toISOString(),
    total_events: resultList.length,
    events: resultList,
  };
}

/**
 * CLI execution entrypoint to generate src/data/scientific-events.json
 */
export async function writeScientificEventsFile(outputPath = DEFAULT_OUTPUT_PATH) {
  const result = await buildScientificEventClusters();
  await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`[Event Cluster] ✓ Successfully generated ${result.total_events} transient events to ${outputPath}`);
  return result;
}

if (process.argv[1]?.endsWith("transient-event-cluster.mjs")) {
  writeScientificEventsFile().catch((err) => {
    console.error("[Event Cluster] Error:", err);
    process.exit(1);
  });
}
