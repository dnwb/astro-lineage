import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireRefreshLock, releaseRefreshLock, writeJsonAtomically, readPublishedArxivEdition, DEFAULT_OUTPUT, DEFAULT_RADAR_OUTPUT } from "./arxiv-daily.mjs";
import { validateDailyRadarPayload } from "./daily-radar.mjs";

export async function readChannelShareUrl({ url = process.env.ASTRO_CHANNEL_URL,
  cachePath = fileURLToPath(new URL("../.cache/channel-publication/channel-link.json", import.meta.url)) } = {}) {
  try {
    if (!url) {
      if ((await stat(cachePath)).size > 20_000) return null;
      url = JSON.parse(await readFile(cachePath, "utf8")).url;
    }
    if (typeof url !== "string" || url.length > 2048) return null;
    const address = new URL(url);
    return address.protocol === "https:" && address.hostname === "pd.qq.com" && !address.username && !address.password && !address.port ? url : null;
  } catch { return null; }
}

const directionText = readFileSync(fileURLToPath(new URL("../PROJECT_CONTEXT.md", import.meta.url)), "utf8");
const directionTitles = new Map([...directionText.matchAll(/^## (R[1-7])\. (.+)$/gmu)].map((match) => [match[1], match[2]]));
if (directionTitles.size !== 7) throw new Error("CHANNEL_DIRECTIONS_INVALID");
// Presentation labels only; the scientific definitions and routing IDs stay above.
export const TOPIC_LABELS = {
  R1: "中央引擎与能量注入",
  R2: "伽马射线暴与相对论喷流",
  R3: "超新星与星周介质作用",
  R4: "脉冲星风与高能双星",
  R5: "磁星爆发与快速射电暴",
  R6: "致密环境与多信使暂现源",
  R7: "X射线时变、能谱与致密双星",
};
export const TOPICS = [
  ["R1", /(?:central engine|magnetar spin.down|energy injection|mergernova|engine.powered|pulsar wind nebula|\bPWN\b|中央引擎|磁星自转|能量注入|脉冲星风云)/iu],
  ["R2", /(?:\bGRB\b|gamma.ray burst|relativistic jet|afterglow|cocoon|collapsar|伽马暴|喷流|余辉)/iu],
  ["R3", /(?:supernova|\bCSM\b|circumstellar|shock breakout|shock cooling|前身星|超新星|星周介质|爆前|冲击波突破)/iu],
  ["R4", /(?:pulsar wind binar|intrabinary shock|spider pulsar|high.energy binar|companion environment|脉冲星风双星|双星内激波|蜘蛛脉冲星)/iu],
  ["R5", /(?:\bFRB\b|fast radio burst|magnetar burst|magnetar magnetospheres?|magneto.ionic|galactic magnetars?.{0,100}burst catalog|plasma lens|magnetothermal|Joule heating|Ohmic dissipation|法拉第|快速射电暴|等离子体透镜|磁星爆发|磁热演化|焦耳加热|磁场耗散)/iu],
  ["R6", /(?:neutrino|multi.messenger|kilonova|tidal disruption|\bTDE\b|AGN disk|gravitational.wave counterpart|gravitational.wave follow.up|neutron.star merger universality|post.merger gravitational.wave|neutron stars? with third.generation gravitational.wave detectors?|中微子|千新星|潮汐瓦解|多信使|致密环境)/iu],
  ["R7", /(?:X.ray pulsar|accretion column|accreting neutron star|accreting magnetar|X.ray binar|X.ray spectral (?:analysis|evolution)|X.ray reverberation|\bNS binary system\b|\bUCXB\b|IXPE.{0,60}magnetar|magnetar.{0,60}IXPE|\bQPO\b|\bCRSF\b|\bXRISM\b|\bNICER\b|\bNuSTAR\b|\bHXMT\b|吸积柱|X射线脉冲星|X射线双星|回旋吸收线)/iu],
].map(([id, pattern]) => [id, directionTitles.get(id), pattern]);

export function routePaper(item) {
  const a = item.analysis?.analysis || {};
  const title = item.title || "";
  const matches = TOPICS.map(([id, , pattern]) => ({ id, score: (pattern.test(title) ? 3 : 0) + (pattern.test(a.problem || "") ? 2 : 0) }))
    .filter(({ score }) => score > 0).sort((left, right) => right.score - left.score);
  if (/spin.down.{0,40}accreting magnetar/iu.test(title)) {
    return { primary: "R7", related: ["R1", ...matches.filter(({ id }) => id !== "R1" && id !== "R7").map(({ id }) => id)] };
  }
  if (/(?:month.long|long.lived|central) engine|energy injection|长时标引擎|中央引擎|能量注入/iu.test(title)) {
    return { primary: "R1", related: matches.filter(({ id }) => id !== "R1").map(({ id }) => id) };
  }
  return { primary: matches[0]?.id || null, related: matches.slice(1).map(({ id }) => id) };
}

export const DAILY_BRIEF_CHANNEL_ID = "742956201";
export const GENERAL_CHANNEL_ID = "742956184";

export function resolvePublicationTarget(item, { channelIds = {}, fallbackChannelId = GENERAL_CHANNEL_ID } = {}) {
  const isDailyBrief = item?.payloadType === "daily_brief" ||
    item?.identity?.startsWith("daily-summary:") ||
    item?.topic?.primary === "daily" ||
    item?.kind === "brief";

  if (isDailyBrief) {
    const target = channelIds.daily || DAILY_BRIEF_CHANNEL_ID;
    return { kind: "daily_brief", target: String(target) };
  }

  // Single paper routing
  const topic = item?.topic || routePaper(item || {});
  let target;
  if (topic.primary && channelIds[topic.primary]) {
    target = channelIds[topic.primary];
  } else if (fallbackChannelId) {
    target = channelIds[fallbackChannelId] || fallbackChannelId;
  } else {
    target = channelIds[GENERAL_CHANNEL_ID] || channelIds.general || GENERAL_CHANNEL_ID;
  }

  const dailyBriefId = String(channelIds.daily || DAILY_BRIEF_CHANNEL_ID);
  if (String(target) === dailyBriefId) {
    throw new Error(`CHANNEL_ROUTING_VIOLATION: Single paper cards cannot be published to Daily Briefing channel (${DAILY_BRIEF_CHANNEL_ID})`);
  }

  return { kind: "single_paper", target: String(target) };
}

export function hashBody(body) { return createHash("sha256").update(body).digest("hex"); }
export function markerFor(identity, hash) { return `<!-- astrolineage-channel:${identity}:${hash} -->`; }

export async function capturePublishedSourceBinding({
  feedPath = DEFAULT_OUTPUT,
  radarPath = DEFAULT_RADAR_OUTPUT,
  artifactRoot,
  weeklyPath = fileURLToPath(new URL("../src/data/arxiv-weekly.json", import.meta.url)),
  archiveRoot = fileURLToPath(new URL("../src/data/arxiv-archives/daily", import.meta.url)),
} = {}) {
  const edition = await readPublishedArxivEdition({ output: feedPath, radarOutput: radarPath, artifactRoot });
  if (!edition.generation_id || !edition.pointer) throw new Error("CHANNEL_SOURCE_UNPUBLISHED");
  const daily = { generation_id: edition.generation_id, hash: hashBody(JSON.stringify({ feed: edition.feed, radar: edition.radar })) };
  if ((await stat(weeklyPath)).size > 20_000_000) throw new Error("CHANNEL_WEEKLY_INVALID");
  const weekly = { hash: hashBody(await readFile(weeklyPath)) };
  const archives = {};
  for (const name of (await readdir(archiveRoot)).filter((file) => /^\d{4}-\d\d-\d\d\.json$/u.test(file)).sort()) {
    const path = join(archiveRoot, name);
    if ((await stat(path)).size > 20_000_000) throw new Error("CHANNEL_ARCHIVE_TOO_LARGE");
    archives[name.slice(0, 10)] = hashBody(await readFile(path));
  }
  const binding = { daily, weekly, archives };
  return { ...binding, id: hashBody(JSON.stringify(binding)) };
}

export async function readDailyArchive(path, expectedDate, distRoot, contents) {
  if (contents === undefined) contents = await readFile(path);
  if (Buffer.byteLength(contents) > 20_000_000) throw new Error("CHANNEL_ARCHIVE_TOO_LARGE");
  const archive = JSON.parse(contents);
  if (archive.schema_version !== "astrolineage-daily-archive-v1" || archive.date !== expectedDate ||
      archive.feed?.window?.announcement_date !== expectedDate || !archive.opening_brief) throw new Error("CHANNEL_ARCHIVE_INVALID");
  const checked = validateDailyRadarPayload(archive.feed, archive.radar);
  if (!checked.valid || !checked.model.opening_brief) throw new Error(`CHANNEL_ARCHIVE_INVALID:${checked.diagnostics.join(",")}`);
  await stat(join(distRoot, "arxiv-daily", expectedDate, "index.html"));
  return checked.model;
}

export async function listDailyArchives(archiveRoot, from = "2026-09-07", through = "2026-10-01") {
  const names = (await readdir(archiveRoot)).filter((name) => /^\d{4}-\d\d-\d\d\.json$/u.test(name));
  return names.filter((name) => name.slice(0, 10) >= from && name.slice(0, 10) <= through).sort();
}

export async function withPublicationLedger(cacheRoot, guildId, work) {
  const root = resolve(cacheRoot);
  const lock = join(root, "publisher.lock");
  await acquireRefreshLock(lock);
  try {
    const path = join(root, `guild-${guildId}.json`);
    let ledger;
    try { ledger = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if (error?.code !== "ENOENT") throw new Error("CHANNEL_LEDGER_CORRUPT"); ledger = { version: 1, guild_id: String(guildId), items: {} }; }
    if (ledger?.version !== 1 || ledger.guild_id !== String(guildId) || !ledger.items || Array.isArray(ledger.items)) throw new Error("CHANNEL_LEDGER_CORRUPT");
    const save = async () => writeJsonAtomically(path, ledger);
    return await work(ledger.items, save, ledger);
  } finally { await releaseRefreshLock(lock); }
}
