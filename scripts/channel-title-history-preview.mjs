import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { capturePublishedSourceBinding, hashBody, readDailyArchive, routePaper } from "./channel-publication.mjs";
import { deriveTitleDecision } from "./channel-title-policy.mjs";
import { generateDailyMarkdown, generateWeeklyMarkdown, matchesManagedBody, paperMarkdown, renderEventRankingPost } from "./tencent-channel-publisher.mjs";

function firstLine(body) { return String(body).split(/\r?\n/u).find(line => line.trim()) || ""; }
function feedOf(value) { return value?.feed ?? value?.feed_info ?? value; }
function bodyOf(feed) { return feed?.markdown_content ?? feed?.markdownContent ?? feed?.content?.markdown_content ?? feed?.content?.text ?? (typeof feed?.content === "string" ? feed.content : undefined); }
function mediaOf(feed) {
  for (const key of ["image_paths", "images", "media"]) if (Array.isArray(feed?.[key])) return feed[key];
  return null;
}

export function snapshotFeed(value) {
  const feed = feedOf(value);
  const body = bodyOf(feed);
  const media = mediaOf(feed);
  if (!feed || !feed.feed_id || !(feed.create_time_raw ?? feed.create_time) || !feed.channel_id ||
      typeof feed.title !== "string" || typeof body !== "string" || media === null) return null;
  return { feed_id: String(feed.feed_id), create_time: String(feed.create_time_raw ?? feed.create_time),
    channel_id: String(feed.channel_id), title: feed.title, markdown_content: body,
    media: structuredClone(media), media_field: ["image_paths", "images", "media"].find(key => Array.isArray(feed[key])) };
}

export async function buildBoundTitleSources({ sourceBinding, currentBinding,
  archiveRoot = "src/data/arxiv-archives/daily", distRoot = "dist", weeklyPath = "src/data/arxiv-weekly.json",
  eventSnapshot, eventsPath = join(distRoot, "api/v1/events.json") } = {}) {
  if (!sourceBinding?.id || currentBinding?.id !== sourceBinding.id) throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
  const sources = {};
  for (const [date, expectedHash] of Object.entries(sourceBinding.archives || {})) {
    let archive;
    let model;
    let evidence;
    try {
      const path = join(archiveRoot, `${date}.json`);
      const bytes = await readFile(path);
      if (hashBody(bytes) !== expectedHash) throw new Error("archive_hash_mismatch");
      archive = JSON.parse(bytes);
      model = await readDailyArchive(path, date, distRoot, bytes);
      evidence = `archive:${date}:${expectedHash}`;
    } catch (error) {
      sources[`daily-summary:${date}`] = { error: `source_unavailable:${error.message}` };
      continue;
    }
    try {
      const daily = await generateDailyMarkdown({ feed: archive.feed, radar: archive.radar });
      const decision = deriveTitleDecision({ kind: "daily", date, highlights: daily.highlights, brief: model.opening_brief });
      if (!decision.title || decision.title !== daily.postTitle) throw new Error(decision.reason || "CHANNEL_TITLE_SOURCE_MISMATCH");
      sources[`daily-summary:${date}`] = { title: daily.postTitle, firstLine: firstLine(daily.md), evidence,
        ...(decision.diagnostics.length ? { diagnostics: decision.diagnostics } : {}) };
    } catch (error) {
      sources[`daily-summary:${date}`] = { error: `title_unavailable:${error.message}`, evidence };
    }
    for (const item of [...model.groups.must_read, ...model.groups.worth_knowing]) {
      const identity = `daily:${item.arxiv_id}v${item.revision}`;
      try {
        const decision = deriveTitleDecision({ kind: "paper", item });
        if (!decision.title) throw new Error(decision.reason);
        const candidate = { title: decision.title, firstLine: firstLine(paperMarkdown(item, date, routePaper(item))), evidence,
          ...(decision.diagnostics.length ? { diagnostics: decision.diagnostics } : {}) };
        if (sources[identity] && sources[identity].title !== candidate.title) sources[identity] = { error: "source_ambiguous", evidence };
        else if (!sources[identity]) sources[identity] = candidate;
      } catch (error) { sources[identity] = { error: `title_unavailable:${error.message}`, evidence }; }
    }
  }
  let weeklyIdentity = "weekly:source";
  try {
    const bytes = await readFile(weeklyPath);
    if (hashBody(bytes) !== sourceBinding.weekly?.hash) throw new Error("weekly_hash_mismatch");
    const weekly = JSON.parse(bytes);
    if (/^\d{4}-W\d{2}$/u.test(weekly.week_id || "")) weeklyIdentity = `weekly:${weekly.week_id}`;
    const generated = await generateWeeklyMarkdown({ weekly });
    const decision = deriveTitleDecision({ kind: "weekly", weekId: weekly.week_id, weekly });
    if (!decision.title || decision.title !== generated.postTitle) throw new Error(decision.reason || "CHANNEL_TITLE_SOURCE_MISMATCH");
    sources[weeklyIdentity] = { title: generated.postTitle, firstLine: firstLine(generated.md), evidence: `weekly:${sourceBinding.weekly.hash}`,
      ...(decision.diagnostics.length ? { diagnostics: decision.diagnostics } : {}) };
  } catch (error) { sources[weeklyIdentity] = { error: `source_unavailable:${error.message}` }; }
  try {
    if (eventSnapshot?.error) throw new Error(eventSnapshot.error);
    if (!/^[a-f0-9]{64}$/u.test(eventSnapshot?.hash || "") || !eventSnapshot.generated_at) throw new Error("event_snapshot_missing");
    const bytes = await readFile(eventsPath);
    if (hashBody(bytes) !== eventSnapshot.hash) throw new Error("event_snapshot_mismatch");
    const events = JSON.parse(bytes);
    if (events.generated_at !== eventSnapshot.generated_at) throw new Error("event_snapshot_mismatch");
    const generated = renderEventRankingPost(events);
    sources["events:top5"] = { title: generated.title, firstLine: firstLine(generated.body), evidence: `events:${eventSnapshot.hash}` };
  } catch (error) { sources["events:top5"] = { error: `source_unavailable:${error.message}` }; }
  return sources;
}

export async function previewTitleHistory({ ledger, sourceBinding, currentBinding, sources,
  listInventory, getDetail } = {}) {
  if (!sourceBinding?.id || sourceBinding.id !== currentBinding?.id) throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
  const inventory = await listInventory().catch(error => ({
    complete: false,
    feeds: [],
    error: inventoryFailureCode(error),
  }));
  const visible = new Set((inventory.feeds || []).map(feed => String(feed.feed_id)));
  const rows = [];
  for (const [identity, record] of Object.entries(ledger.items || {})) {
    const source = sources[identity] || (identity.startsWith("weekly:") ? sources["weekly:source"] : null);
    const paperIdentity = identity.match(/^daily:(\d{4}\.\d{4,5})v(\d+)$/u);
    const summaryIdentity = identity.match(/^daily-summary:(\d{4}-\d\d-\d\d)$/u);
    const weeklyIdentity = identity.match(/^weekly:(\d{4}-W\d\d)$/u);
    const row = { identity, kind: identity.split(":")[0], source: source?.evidence || null,
      ...(paperIdentity ? { arxiv_id: paperIdentity[1], revision: Number(paperIdentity[2]) } : {}),
      ...(summaryIdentity ? { date: summaryIdentity[1] } : {}),
      ...(weeklyIdentity ? { week_id: weeklyIdentity[1] } : {}),
      feed_id: record.feed_id || null, original_title: null, candidate_title: source?.title || null,
      body_first_before: null, body_first_after: source?.firstLine || null,
      body_sha256_before: null, media_before: null, media_sha256_before: null, media_after: null,
      changes: { title: null, body_first_line: null, media: null },
      risk_flags: source?.diagnostics?.includes("CHANNEL_TITLE_HUMAN_REVIEW_RECOMMENDED")
        ? ["title_human_review_recommended"] : [],
      status: "pending", classification: "pending", reason: null };
    if (!record.feed_id || !record.channel_id || !record.create_time) {
      row.reason = "ledger_identity_missing";
      row.classification = "identity_missing";
    }
    else {
      try {
        const detail = feedOf(await getDetail(record));
        const snapshot = snapshotFeed(detail);
        if (!snapshot) { row.reason = "remote_detail_unverifiable"; row.classification = "remote_unverifiable"; }
        else if (snapshot.feed_id !== String(record.feed_id) || snapshot.channel_id !== String(record.channel_id) || snapshot.create_time !== String(record.create_time)) {
          row.reason = "remote_identity_drift";
          row.classification = "remote_drift";
        }
        else {
          row.original_title = snapshot.title;
          row.body_first_before = firstLine(snapshot.markdown_content);
          row.body_sha256_before = hashBody(snapshot.markdown_content);
          row.media_before = snapshot.media;
          row.media_sha256_before = hashBody(JSON.stringify(snapshot.media));
          row.media_after = structuredClone(snapshot.media);
          const ledgerBodyMatches = record.status === "published" && matchesManagedBody(snapshot.markdown_content, identity, record.hash);
          if (record.status === "published" && !ledgerBodyMatches) {
            row.reason = "remote_body_drift";
            row.classification = "remote_drift";
            row.risk_flags.push("remote_body_differs_from_ledger");
          }
          else if (record.status !== "published") { row.reason = "ledger_intent"; row.classification = "intent_unresolved"; }
          else if (!source || source.error || !source.title) {
            row.reason = source?.error || "source_missing";
            row.classification = source?.error?.includes("title_unavailable") ? "scientific_title_needs_manual_review" : "source_missing";
            if (source?.error) row.risk_flags.push("source_or_title_generation_failed");
          }
          else if (inventory.complete && !visible.has(String(record.feed_id))) {
            row.reason = "remote_not_in_complete_inventory";
            row.classification = "remote_not_visible";
          }
          else if (!visible.has(String(record.feed_id))) {
            row.reason = inventory.error ? `inventory_error:${inventory.error}` : "inventory_incomplete";
            row.classification = "inventory_incomplete";
          }
          else {
            row.changes = { title: snapshot.title !== source.title,
              body_first_line: row.body_first_before !== row.body_first_after, media: false };
            if (row.changes.title || row.changes.body_first_line) {
              row.status = "review";
              row.classification = row.changes.body_first_line ? "body_review" : "title_review";
              row.risk_flags.push("human_approval_required");
              if (row.changes.body_first_line) row.risk_flags.push("body_change_outside_title_only_scope");
            } else {
              row.status = "unchanged";
              row.classification = "unchanged";
            }
          }
        }
      } catch (error) {
        row.reason = "remote_unavailable";
        row.classification = "remote_unavailable";
        row.remote_error_code = inventoryFailureCode(error);
      }
    }
    rows.push(row);
  }
  const counts = {};
  const classificationCounts = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] || 0) + 1;
    classificationCounts[row.classification] = (classificationCounts[row.classification] || 0) + 1;
  }
  return { source_binding_id: sourceBinding.id, inventory_complete: inventory.complete === true,
    inventory_error: inventory.error || null,
    total: rows.length, counts, classification_counts: classificationCounts, rows };
}

function inventoryFailureCode(error) {
  const candidates = [error?.code, error?.message];
  for (const candidate of candidates) {
    const code = String(candidate || "").split(/[:\s]/u, 1)[0];
    if (/^[A-Z][A-Z0-9_]{1,63}$/u.test(code)) return code;
  }
  return "read_failed";
}

export async function previewCurrentTitleHistory({ ledgerPath, websitePath, listInventory, getDetail,
  archiveRoot, distRoot, weeklyPath } = {}) {
  const [ledger, website, currentBinding] = await Promise.all([
    readFile(ledgerPath, "utf8").then(JSON.parse), readFile(websitePath, "utf8").then(JSON.parse), capturePublishedSourceBinding({ archiveRoot, weeklyPath })]);
  if (website.status !== "success") throw new Error("CHANNEL_SOURCE_BUILD_REQUIRED");
  const sources = await buildBoundTitleSources({ sourceBinding: website.source_binding, currentBinding,
    archiveRoot, distRoot, weeklyPath, eventSnapshot: website.events });
  return previewTitleHistory({ ledger, sourceBinding: website.source_binding, currentBinding, sources, listInventory, getDetail });
}

function cliPayload(response) {
  if (typeof response?.stdout === "string") response = JSON.parse(response.stdout);
  if (response?.success === false || response?.error || response?.retCode !== undefined && Number(response.retCode) !== 0) {
    const retCode = String(response?.retCode ?? "");
    if (/^\d{1,12}$/u.test(retCode) && Number(retCode) !== 0) throw new Error(`CHANNEL_READ_FAILED_${retCode}`);
    const errorCode = [response?.error?.code, response?.code, response?.error]
      .map(value => String(value || "").split(/[:\s]/u, 1)[0])
      .find(value => /^[A-Z][A-Z0-9_]{1,63}$/u.test(value));
    throw new Error(errorCode || "CHANNEL_READ_FAILED");
  }
  return response?.data ?? response;
}

export function readOnlyTitleInventory(cli, guildId) {
  return {
    async listInventory() {
      const channelData = cliPayload(await cli(["manage", "get-guild-channel-list", "--guild-id", String(guildId), "--json"]));
      const channels = Array.isArray(channelData) ? channelData : channelData?.channels ?? channelData?.channel_list;
      if (!Array.isArray(channels) || channels.length === 0) return { complete: false, feeds: [] };
      const feeds = [];
      const seen = new Map();
      for (const channel of channels) {
        const channelId = String(channel?.channel_id ?? channel?.id ?? "");
        if (!channelId) return { complete: false, feeds };
        let cursor = "";
        const seenCursors = new Set();
        let sectionComplete = false;
        let emptyPages = 0;
        for (let page = 0; page < 30; page += 1) {
          const args = ["feed", "get-channel-timeline-feeds", "--guild-id", String(guildId), "--channel-id", channelId, "--count", "50", "--json"];
          if (cursor) args.push("--feed-attach-info", cursor);
          const data = cliPayload(await cli(args));
          const batch = Array.isArray(data) ? data : data?.feeds ?? data?.feed_list ?? data?.list;
          if (!Array.isArray(batch)) return { complete: false, feeds };
          let added = 0;
          for (const feed of batch) {
            const id = String(feed?.feed_id ?? feed?.feedId ?? feed?.id ?? "");
            const feedChannelId = String(feed?.channel_id ?? feed?.channelId ?? channelId);
            if (!id || feedChannelId !== channelId) return { complete: false, feeds };
            if (seen.has(id) && seen.get(id) !== channelId) return { complete: false, feeds };
            if (!seen.has(id)) { seen.set(id, channelId); feeds.push({ ...feed, channel_id: channelId }); added += 1; }
          }
          const next = String(data?.feed_attch_info ?? data?.feed_attach_info ?? "");
          if (data?.has_more === false || (!data?.has_more && !next)) { sectionComplete = true; break; }
          emptyPages = added ? 0 : emptyPages + 1;
          if (emptyPages >= 2) break;
          if (!next || next === cursor || seenCursors.has(next)) break;
          seenCursors.add(next);
          cursor = next;
        }
        if (!sectionComplete) return { complete: false, feeds };
      }
      return { complete: true, feeds };
    },
    async getDetail(record) {
      return cliPayload(await cli(["feed", "get-feed-detail", "--guild-id", String(guildId),
        "--channel-id", String(record.channel_id), "--feed-id", String(record.feed_id), "--json"]));
    },
  };
}
