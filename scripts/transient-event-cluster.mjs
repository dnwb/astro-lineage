/**
 * scripts/transient-event-cluster.mjs
 *
 * Scientific Transient Event Clustering & Heat Tracking Engine.
 * Automatically identifies observational transient targets (GRBs, SNe, FRBs, GWs, ATs)
 * across preprints, clusters papers by event, resolves full titles and authorship,
 * and synthesizes multi-paper event narratives with exponential heat decay scores.
 */

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  extractTransientIdentifiers,
  matchScientificTags,
  normalizeStructuredClaim,
  deriveFigurePhysicalCore,
} from "../src/domain/academic-domain.mjs";
import {
  formatCanonicalT0Badge,
  formatRedshiftBadge,
  formatAliasList,
  formatMultiMessengerBadges,
} from "../src/domain/gcn-domain.mjs";

const DEFAULT_ARCHIVE_DIR = "src/data/arxiv-archives/daily";
const DEFAULT_RADAR_PATH = "src/data/daily-radar.json";
const DEFAULT_DAILY_FEED_PATH = "src/data/arxiv-daily.json";
const DEFAULT_WEEKLY_PATH = "src/data/arxiv-weekly.json";
const DEFAULT_GCN_INDEX_PATH = "src/data/gcn-events/index.json";
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
 * Synthesize pre-formatted display labels for .astro templates (delegating to domain SSOT).
 */
export function formatClusterDisplayLabels({
  canonical_t0 = null,
  best_redshift = null,
  has_redshift_conflict = false,
  multi_messenger = [],
  gcn_aliases = [],
} = {}) {
  const gcn_aliases_label = formatAliasList(gcn_aliases) || null;
  const canonical_t0_label = formatCanonicalT0Badge(canonical_t0) || null;
  const best_redshift_label = formatRedshiftBadge(best_redshift, has_redshift_conflict) || null;
  const multi_messenger_badges = formatMultiMessengerBadges(multi_messenger);

  return {
    gcn_aliases_label,
    canonical_t0_label,
    best_redshift_label,
    multi_messenger_badges,
  };
}

/**
 * Determine event category from event identifier.
 */
export function classifyEventType(eventId) {
  const upper = eventId.toUpperCase();
  if (upper.startsWith("GRB")) return "GRB";
  if (upper.startsWith("EP")) return "EP";
  if (upper.startsWith("SN")) return "SN";
  if (upper.startsWith("FRB")) return "FRB";
  if (upper.startsWith("GW")) return "GW";
  if (upper.startsWith("SGR")) return "SGR";
  if (upper.startsWith("AT")) return "AT";
  return "OTHER";
}

/**
 * Build a unified metadata map (title, authors, summary) from available feeds and archives.
 */
export async function buildMetadataIndex({
  dailyFeedPath = DEFAULT_DAILY_FEED_PATH,
  archiveDir = DEFAULT_ARCHIVE_DIR,
  weeklyPath = DEFAULT_WEEKLY_PATH,
} = {}) {
  const metadataMap = new Map();

  // 1. Ingest daily feed entries
  try {
    const raw = JSON.parse(await readFile(dailyFeedPath, "utf8"));
    const entries = Array.isArray(raw.entries)
      ? raw.entries
      : Array.isArray(raw.feed?.entries)
        ? raw.feed.entries
        : [];
    for (const e of entries) {
      if (e.arxiv_id && e.title) {
        metadataMap.set(e.arxiv_id, {
          title: String(e.title).trim(),
          authors: Array.isArray(e.authors) ? e.authors : [],
          summary: e.summary || "",
        });
      }
    }
  } catch {}

  // 2. Ingest archive feeds and highlights
  try {
    const files = await readdir(archiveDir);
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try {
        const archive = JSON.parse(await readFile(join(archiveDir, file), "utf8"));
        const entries = archive.feed?.entries || [];
        for (const e of entries) {
          if (e.arxiv_id && e.title && !metadataMap.has(e.arxiv_id)) {
            metadataMap.set(e.arxiv_id, {
              title: String(e.title).trim(),
              authors: Array.isArray(e.authors) ? e.authors : [],
              summary: e.summary || "",
            });
          }
        }
        const highlights = archive.highlights || [];
        for (const h of highlights) {
          if (h.arxiv_id && h.title && !metadataMap.has(h.arxiv_id)) {
            metadataMap.set(h.arxiv_id, {
              title: String(h.title).trim(),
              authors: Array.isArray(h.authors) ? h.authors : [],
              summary: h.summary || "",
            });
          }
        }
      } catch {}
    }
  } catch {}

  // 3. Ingest weekly top picks and papers
  try {
    const weekly = JSON.parse(await readFile(weeklyPath, "utf8"));
    const papers = [...(weekly.papers || []), ...(weekly.top_picks || [])];
    for (const p of papers) {
      if (p.arxiv_id && p.title && !metadataMap.has(p.arxiv_id)) {
        metadataMap.set(p.arxiv_id, {
          title: String(p.title).trim(),
          authors: Array.isArray(p.authors) ? p.authors : [],
          summary: p.summary || "",
        });
      }
    }
  } catch {}

  return metadataMap;
}

/**
 * Synthesize a crisp headline and multi-paper narrative progression for an event cluster.
 */
export function synthesizeEventNarrative(cluster) {
  const priorityOrder = { must_read: 3, worth_knowing: 2, skip: 1 };
  const sortedByPriority = [...cluster.papers].sort((a, b) => {
    const pA = priorityOrder[a.priority] || 0;
    const pB = priorityOrder[b.priority] || 0;
    if (pB !== pA) return pB - pA;
    return b.date.localeCompare(a.date);
  });

  const topPaper = sortedByPriority[0];
  const mustCount = cluster.papers.filter((p) => p.priority === "must_read").length;

  // Synthesize headline
  let headline = "";
  if (
    topPaper &&
    topPaper.bluf_problem &&
    !topPaper.bluf_problem.startsWith("未能从已检查材料") &&
    topPaper.bluf_problem !== "未记录"
  ) {
    const claim = normalizeStructuredClaim(topPaper.bluf_problem, "观测课题");
    headline = claim.headline;
  } else if (
    topPaper &&
    topPaper.bluf_result &&
    !topPaper.bluf_result.startsWith("未能从已检查材料") &&
    topPaper.bluf_result !== "未记录"
  ) {
    const claim = normalizeStructuredClaim(topPaper.bluf_result, "物理突破");
    headline = claim.headline;
  } else {
    const typeLabel =
      {
        GW: "引力波事件物理与致密星并合动力学",
        GRB: "伽马暴辐射机制与相对论喷流演化",
        SN: "超新星爆发物理与早期周星相互作用",
        FRB: "快速射电暴环境与磁星辐射机制",
        AT: "暂现源多波段随访与辐射特征",
      }[cluster.event_type] || "瞬变源多信使追踪研判";
    headline = `${cluster.event_id} ${typeLabel}`;
  }

  // Synthesize narrative paragraph
  const dateSpan =
    cluster.first_seen === cluster.last_updated
      ? `监测日期 ${cluster.first_seen}`
      : `活跃跨度 ${cluster.first_seen} 至 ${cluster.last_updated}`;

  const countDesc =
    mustCount > 0
      ? `共聚合 ${cluster.papers.length} 篇研读文献（含 ${mustCount} 篇必读突破）`
      : `共聚合 ${cluster.papers.length} 篇研读文献`;

  const topKeyPoint =
    topPaper && topPaper.bluf_result && !topPaper.bluf_result.startsWith("未能从已检查材料")
      ? topPaper.bluf_result
      : topPaper?.title
        ? `主要探讨《${topPaper.title}》`
        : "持续追踪其动力学特征与物理参数约束。";

  const narrative = `${cluster.event_id} 是近期重点瞬变天体事件，${dateSpan}，${countDesc}。核心突破研判：${topKeyPoint}`;

  return { headline, narrative };
}

/**
 * Extract verified figures with physical core synthesis for an academic paper item.
 */
export function extractVerifiedFigures(item, metaTitle = "", publicDir = "public") {
  const rawFigures = Array.isArray(item?.figures)
    ? item.figures
    : Array.isArray(item?.analysis?.figures)
      ? item.analysis.figures
      : [];

  return rawFigures
    .filter((fig) => {
      if (!fig || typeof fig !== "object") return false;
      const src = fig.url || fig.image_url || "";
      if (!src || typeof src !== "string") return false;
      if (src.startsWith("http://") || src.startsWith("https://")) return true;
      const cleanRel = src.replace(/^\/+/u, "");
      return existsSync(join(publicDir, cleanRel));
    })
    .map((fig) => {
      const badge = fig.category_badge || fig.categoryBadge || "";
      const physicalCore =
        fig.physical_core ||
        fig.physicalCore ||
        deriveFigurePhysicalCore(fig, { title: item.title || metaTitle || "" }, { lang: "zh" }) ||
        "";

      return {
        url: fig.url || fig.image_url,
        label: fig.label || "",
        caption: fig.caption || "",
        category: fig.category || "theoretical",
        category_badge: badge,
        physical_core: physicalCore,
        is_schematic: Boolean(fig.is_schematic),
      };
    });
}

/**
 * Cluster papers into transient scientific events.
 */
export async function buildScientificEventClusters({
  archiveDir = DEFAULT_ARCHIVE_DIR,
  radarPath = DEFAULT_RADAR_PATH,
  dailyFeedPath = DEFAULT_DAILY_FEED_PATH,
  weeklyPath = DEFAULT_WEEKLY_PATH,
  gcnIndexPath = DEFAULT_GCN_INDEX_PATH,
  publicDir = "public",
  now = new Date(),
} = {}) {
  const metadataMap = await buildMetadataIndex({ archiveDir, dailyFeedPath, weeklyPath });
  const paperMap = new Map(); // arxiv_id -> paper details

  // 1. Ingest Daily Radar (latest)
  try {
    const rawRadar = JSON.parse(await readFile(radarPath, "utf8"));
    const analyses = Array.isArray(rawRadar.analyses) ? rawRadar.analyses : [];
    const date = rawRadar.edition?.window?.announcement_date || now.toISOString().slice(0, 10);

    for (const item of analyses) {
      if (!item.arxiv_id) continue;
      const meta = metadataMap.get(item.arxiv_id);
      const title = item.title || meta?.title || "";
      const figures = extractVerifiedFigures(item, title, publicDir);
      paperMap.set(item.arxiv_id, {
        arxiv_id: item.arxiv_id,
        revision: item.revision || 1,
        title,
        authors: Array.isArray(item.authors) ? item.authors : meta?.authors || [],
        date,
        priority: item.priority || "skip",
        analysis: item.analysis || {},
        figures,
        primary_figure: figures.length > 0 ? figures[0] : null,
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
          const meta = metadataMap.get(item.arxiv_id);
          const title = item.title || meta?.title || "";
          const figures = extractVerifiedFigures(item, title, publicDir);
          paperMap.set(item.arxiv_id, {
            arxiv_id: item.arxiv_id,
            revision: item.revision || 1,
            title,
            authors: Array.isArray(item.authors) ? item.authors : meta?.authors || [],
            date,
            priority: item.priority || "skip",
            analysis: item.analysis || {},
            figures,
            primary_figure: figures.length > 0 ? figures[0] : null,
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
          revision: paper.revision || 1,
          title: paper.title,
          authors: paper.authors,
          date: paper.date,
          priority: paper.priority,
          bluf_result: paper.analysis?.result || "未记录",
          bluf_problem: paper.analysis?.problem || "未记录",
          figures: paper.figures || [],
          primary_figure: paper.primary_figure || null,
        });
      }
    }
  }

  // 4. Merge first-class GCN transient surveillance events
  try {
    const rawGcn = JSON.parse(await readFile(gcnIndexPath, "utf8"));
    const gcnEvents = rawGcn.events || {};
    for (const gcnEntry of Object.values(gcnEvents)) {
      if (!gcnEntry || !gcnEntry.primary_id) continue;
      const primaryId = gcnEntry.primary_id;
      const gcnAliases = Array.isArray(gcnEntry.aliases) ? gcnEntry.aliases : [];
      const matchKeys = [primaryId, ...gcnAliases].map((id) =>
        id.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
      );

      // Check if cluster already exists matching primary_id first, then fallback to aliases
      let matchedCluster = null;
      const primaryKey = primaryId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      for (const [cid, cl] of clusters.entries()) {
        const cKey = cid.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        if (cKey === primaryKey) {
          matchedCluster = cl;
          break;
        }
      }
      if (!matchedCluster) {
        for (const [cid, cl] of clusters.entries()) {
          const cKey = cid.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
          if (matchKeys.includes(cKey)) {
            matchedCluster = cl;
            break;
          }
        }
      }

      // Read detailed ledger if available for conflict and multi-messenger info
      let hasRedshiftConflict = Boolean(gcnEntry.has_redshift_conflict);
      let multiMessenger = Array.isArray(gcnEntry.multi_messenger) ? gcnEntry.multi_messenger : [];
      if (gcnEntry.slug && (!gcnEntry.has_redshift_conflict || multiMessenger.length === 0)) {
        try {
          const detailPath = join(gcnIndexPath, "..", `${gcnEntry.slug}.json`);
          const detail = JSON.parse(await readFile(detailPath, "utf8"));
          if (detail.has_redshift_conflict !== undefined) {
            hasRedshiftConflict = Boolean(detail.has_redshift_conflict);
          }
          if (Array.isArray(detail.multi_messenger) && multiMessenger.length === 0) {
            multiMessenger = detail.multi_messenger;
          }
        } catch {}
      }

      if (matchedCluster) {
        // Enrich existing cluster
        matchedCluster.canonical_t0 = gcnEntry.canonical_t0;
        matchedCluster.best_redshift = gcnEntry.best_redshift;
        matchedCluster.has_redshift_conflict = hasRedshiftConflict;
        matchedCluster.multi_messenger = multiMessenger;
        matchedCluster.gcn_circular_count = gcnEntry.circular_count;
        matchedCluster.gcn_figure_path = gcnEntry.figure_path;
        matchedCluster.gcn_aliases = gcnAliases;
        matchedCluster.gcn_slug = gcnEntry.slug;
        matchedCluster.gcn_status = gcnEntry.status;
        matchedCluster.tags.add("Transient Surveillance");
        if (gcnEntry.has_photometry) matchedCluster.tags.add("GCN Photometry");
      } else {
        // Create first-class transient event entry even with 0 arXiv papers
        const eventType = gcnEntry.event_type || classifyEventType(primaryId);
        const eventDate = (
          gcnEntry.canonical_t0?.utc_iso ||
          gcnEntry.last_updated_utc ||
          now.toISOString()
        ).slice(0, 10);
        const lastUpdated = (gcnEntry.last_updated_utc || now.toISOString()).slice(0, 10);

        const diffDays = Math.max(
          0,
          (now.getTime() - new Date(gcnEntry.last_updated_utc || now).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        const baseGcnHeat = gcnEntry.status === "archived" ? 15 : 45;
        const gcnHeat = Math.round(baseGcnHeat * Math.pow(0.5, diffDays / 7.0) * 10) / 10;

        const labels = formatClusterDisplayLabels({
          canonical_t0: gcnEntry.canonical_t0,
          best_redshift: gcnEntry.best_redshift,
          has_redshift_conflict: hasRedshiftConflict,
          multi_messenger: multiMessenger,
          gcn_aliases: gcnAliases,
        });

        const redStr = labels.best_redshift_label || "待确定";
        const t0Str = labels.canonical_t0_label || "待校准";

        const headline = `${primaryId} 空间与地面望远镜全波段应急协同追踪`;
        const narrative = `已汇聚 NASA GCN Circulars 快速通报 ${gcnEntry.circular_count} 份。红移 ${redStr}，触发时刻 T0: ${t0Str}。多波段光变曲线与早期测光点已完成零同质化聚合。`;

        clusters.set(primaryId, {
          event_id: primaryId,
          event_type: eventType,
          tags: new Set(["Transient Surveillance", "GCN Circulars", eventType]),
          papers: [],
          first_seen: eventDate,
          last_updated: lastUpdated,
          heat_score_override: gcnHeat,
          headline_override: headline,
          narrative_override: narrative,
          canonical_t0: gcnEntry.canonical_t0,
          best_redshift: gcnEntry.best_redshift,
          has_redshift_conflict: hasRedshiftConflict,
          multi_messenger: multiMessenger,
          gcn_circular_count: gcnEntry.circular_count,
          gcn_figure_path: gcnEntry.figure_path,
          gcn_aliases: gcnAliases,
          gcn_slug: gcnEntry.slug,
          gcn_status: gcnEntry.status,
        });
      }
    }
  } catch {}

  // 5. Format, compute heat, synthesize narrative, and sort
  const resultList = [];
  for (const cluster of clusters.values()) {
    // Sort papers within cluster by date descending
    cluster.papers.sort((a, b) => b.date.localeCompare(a.date));

    const heat =
      cluster.heat_score_override !== undefined
        ? cluster.heat_score_override
        : calculateHeatScore(cluster.papers, cluster.last_updated, now);

    const { headline, narrative } = cluster.headline_override
      ? { headline: cluster.headline_override, narrative: cluster.narrative_override }
      : synthesizeEventNarrative(cluster);

    const labels = formatClusterDisplayLabels({
      canonical_t0: cluster.canonical_t0,
      best_redshift: cluster.best_redshift,
      has_redshift_conflict: cluster.has_redshift_conflict,
      multi_messenger: cluster.multi_messenger,
      gcn_aliases: cluster.gcn_aliases,
    });

    // Select lead paper figure if cluster has papers with verified figures
    const sortedByPriority = [...cluster.papers].sort((a, b) => {
      const rank = (p) => (p.priority === "must_read" ? 0 : p.priority === "worth_knowing" ? 1 : 2);
      return rank(a) - rank(b);
    });
    const leadPaperWithFigure = sortedByPriority.find((p) => p.primary_figure);
    const leadFigure = leadPaperWithFigure ? leadPaperWithFigure.primary_figure : null;

    resultList.push({
      event_id: cluster.event_id,
      event_type: cluster.event_type,
      tags: Array.from(cluster.tags),
      heat_score: heat,
      paper_count: cluster.papers.length,
      headline,
      narrative,
      first_seen: cluster.first_seen,
      last_updated: cluster.last_updated,
      papers: cluster.papers,
      lead_figure: leadFigure,
      lead_figure_arxiv_id: leadPaperWithFigure ? leadPaperWithFigure.arxiv_id : null,
      canonical_t0: cluster.canonical_t0 || null,
      best_redshift: cluster.best_redshift || null,
      has_redshift_conflict: Boolean(cluster.has_redshift_conflict),
      multi_messenger: cluster.multi_messenger || [],
      gcn_aliases_label: labels.gcn_aliases_label,
      canonical_t0_label: labels.canonical_t0_label,
      best_redshift_label: labels.best_redshift_label,
      multi_messenger_badges: labels.multi_messenger_badges,
      gcn_circular_count: cluster.gcn_circular_count || 0,
      gcn_figure_path: cluster.gcn_figure_path || null,
      gcn_aliases: cluster.gcn_aliases || [],
      gcn_slug: cluster.gcn_slug || null,
      gcn_status: cluster.gcn_status || null,
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
  console.log(
    `[Event Cluster] ✓ Successfully generated ${result.total_events} transient events to ${outputPath}`
  );
  return result;
}

if (process.argv[1]?.endsWith("transient-event-cluster.mjs")) {
  writeScientificEventsFile().catch((err) => {
    console.error("[Event Cluster] Error:", err);
    process.exit(1);
  });
}
