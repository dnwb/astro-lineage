import { execFile } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { writeJsonAtomically } from "./arxiv-daily.mjs";
import { capturePublishedSourceBinding, hashBody, markerFor } from "./channel-publication.mjs";
import { buildBoundTitleSources, readOnlyTitleInventory, snapshotFeed } from "./channel-title-history-preview.mjs";

export const APPROVED_TITLES = Object.freeze({
  "daily-summary:2026-10-04": "「10-04」GRB 220627A两段亮期之间静默约600秒",
  "weekly:2026-W40": "W40周报：前兆非探测收紧超新星失质量约束",
});

const DEFAULT_SNAPSHOT_DIR = resolve(fileURLToPath(new URL("../.cache/channel-publication/backups/approved-title-sync", import.meta.url)));
const DEFAULT_APPROVAL_BASELINE_PATH = resolve(fileURLToPath(new URL("../.cache/channel-publication/reviews/channel-title-system/approved-title-baselines.json", import.meta.url)));
const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_LEDGER_PATH = join(PROJECT_ROOT, `.cache/channel-publication/guild-${process.env.TENCENT_GUILD_ID || "default"}.json`);
const DEFAULT_WEBSITE_PATH = join(PROJECT_ROOT, ".cache/notebooklm/website.json");
const execFileAsync = promisify(execFile);

function matchesBody(snapshot, identity, hash) {
  if (!/^[a-f0-9]{64}$/u.test(hash || "")) return false;
  const suffix = `\n\n${markerFor(identity, hash)}`;
  return snapshot.markdown_content.endsWith(suffix) && hashBody(snapshot.markdown_content.slice(0, -suffix.length)) === hash;
}

function sameSnapshot(before, after) {
  return after && before.feed_id === after.feed_id && before.create_time === after.create_time &&
    before.channel_id === after.channel_id && before.markdown_content === after.markdown_content &&
    before.media_field === after.media_field && JSON.stringify(before.media) === JSON.stringify(after.media);
}

function approvedBaselineFailure(baseline, identity, sourceBinding, record, snapshot, approvedTitle) {
  if (!baseline) return "approved_baseline_missing";
  if (baseline.status !== "approved" || baseline.identity !== identity ||
      baseline.source_binding_id !== sourceBinding.id || baseline.target_title !== approvedTitle ||
      typeof baseline.approved_at !== "string" || !baseline.approved_at) return "approved_baseline_invalid";
  const expected = baseline.before;
  if (!expected || expected.feed_id !== String(record.feed_id) ||
      expected.create_time !== String(record.create_time) || expected.channel_id !== String(record.channel_id)) {
    return "approved_baseline_identity_mismatch";
  }
  if (snapshot.title !== expected.title) return "approved_baseline_title_mismatch";
  if (hashBody(snapshot.markdown_content) !== expected.body_sha256 ||
      hashBody(JSON.stringify(snapshot.media)) !== expected.media_sha256) return "approved_baseline_content_mismatch";
  return null;
}

async function saveBefore(snapshotDir, identity, sourceBinding, before) {
  await mkdir(snapshotDir, { recursive: true });
  const path = join(snapshotDir, `${identity.replaceAll(":", "_")}.json`);
  const snapshot = { identity, source_binding_id: sourceBinding.id, before };
  try {
    const previous = JSON.parse(await readFile(path, "utf8"));
    if (JSON.stringify(previous) !== JSON.stringify(snapshot)) throw new Error("snapshot_conflict");
    return path;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  return path;
}

function targetPaths(snapshotDir, identity) {
  const name = identity.replaceAll(":", "_");
  return { snapshot: join(snapshotDir, `${name}.json`), intent: join(snapshotDir, `${name}.intent.json`) };
}

async function readIntent(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw new Error("intent_corrupt"); }
}

async function fileExists(path) {
  try { await readFile(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function createIntent(path, value) {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

function sameIntentTarget(intent, identity, sourceBinding, title) {
  return intent?.version === 1 && intent.identity === identity &&
    intent.source_binding_id === sourceBinding.id && intent.target_title === title &&
    intent.before && ["pending", "verified"].includes(intent.status);
}

function assertWriteAccepted(response) {
  let payload = response;
  if (typeof response?.stdout === "string") {
    try { payload = JSON.parse(response.stdout); }
    catch { throw new Error("remote_response_invalid_json"); }
  }
  if (!payload || typeof payload !== "object") throw new Error("remote_response_invalid");
  const result = payload.data ?? payload;
  if (result?.retCode !== undefined && Number(result.retCode) !== 0 ||
      result?.success === false || result?.error) throw new Error("remote_rejected");
  return result;
}

async function syncBoundApprovedTitles({ ledger, sourceBinding, currentBinding, sources = {},
  approvedBaselines = {}, getDetail, cli, snapshotDir = DEFAULT_SNAPSHOT_DIR, dryRun = true } = {}) {
  const items = {};
  const bound = sourceBinding?.id && sourceBinding.id === currentBinding?.id;
  for (const identity of Object.keys(APPROVED_TITLES)) {
    const source = sources[identity];
    const candidate = source?.title;
    const pending = reason => { items[identity] = { status: "pending", reason }; };
    const approved = APPROVED_TITLES[identity];
    if (source?.error || !candidate) { pending(source?.error || "source_title_unavailable"); continue; }
    if (!Buffer.from(String(candidate)).equals(Buffer.from(approved))) { pending("candidate_not_exactly_approved"); continue; }
    if (!bound) { pending("source_build_mismatch"); continue; }
    const record = ledger?.items?.[identity];
    if (ledger?.guild_id == null || record?.status !== "published" || !record.feed_id || !record.create_time || !record.channel_id) {
      pending("ledger_identity_or_intent"); continue;
    }
    let before;
    try { before = snapshotFeed(await getDetail(record)); }
    catch { pending("remote_unavailable"); continue; }
    if (!before) { pending("remote_detail_unverifiable"); continue; }
    if (before.feed_id !== String(record.feed_id) || before.create_time !== String(record.create_time) || before.channel_id !== String(record.channel_id)) {
      pending("remote_identity_drift"); continue;
    }
    if (!matchesBody(before, identity, record.hash)) { pending("body_marker_or_hash_drift"); continue; }
    const paths = targetPaths(snapshotDir, identity);
    let intent;
    try { intent = await readIntent(paths.intent); }
    catch (error) { pending(`intent_unavailable:${error.message}`); continue; }
    if (intent) {
      if (!sameIntentTarget(intent, identity, sourceBinding, approved)) { pending("intent_target_conflict"); continue; }
      if (!sameSnapshot(intent.before, before)) { pending("intent_body_or_media_drift"); continue; }
      if (before.title === approved) {
        const wasVerified = intent.status === "verified";
        if (!wasVerified) {
          try { await writeJsonAtomically(paths.intent, { ...intent, status: "verified", verified_at: new Date().toISOString() }); }
          catch (error) { pending(`intent_persist_failed:${error.message}`); continue; }
        }
        items[identity] = { status: wasVerified ? "unchanged" : "verified", feed_id: before.feed_id, snapshot: paths.snapshot };
        continue;
      }
      if (before.title === intent.before.title) { pending("previous_write_outcome_unresolved"); continue; }
      pending("intent_title_drift"); continue;
    }
    if (before.title === approved) { items[identity] = { status: "unchanged", feed_id: before.feed_id }; continue; }
    const baselineFailure = approvedBaselineFailure(approvedBaselines[identity], identity, sourceBinding, record, before, approved);
    if (baselineFailure) { pending(baselineFailure); continue; }
    if (dryRun) { items[identity] = { status: "dry_run", feed_id: before.feed_id, title_before: before.title, title_after: approved }; continue; }
    try {
      if (await fileExists(paths.snapshot)) { pending("snapshot_without_intent"); continue; }
    } catch (error) { pending(`snapshot_unavailable:${error.message}`); continue; }
    let snapshotPath;
    try { snapshotPath = await saveBefore(snapshotDir, identity, sourceBinding, before); }
    catch (error) { pending(`snapshot_unavailable:${error.message}`); continue; }
    const intentRecord = { version: 1, identity, source_binding_id: sourceBinding.id,
      target_title: approved, status: "pending", created_at: new Date().toISOString(), before };
    try { await createIntent(paths.intent, intentRecord); }
    catch (error) { pending(`intent_persist_failed:${error.message}`); continue; }
    const args = ["feed", "alter-feed", "--guild-id", String(ledger.guild_id),
      "--channel-id", before.channel_id, "--feed-id", before.feed_id,
      "--create-time", before.create_time, "--title", approved, "--json"];
    try {
      assertWriteAccepted(await cli(args));
      const after = snapshotFeed(await getDetail(record));
      if (!sameSnapshot(before, after) || after.title !== approved) throw new Error("readback_drift");
      await writeJsonAtomically(paths.intent, { ...intentRecord, status: "verified", verified_at: new Date().toISOString() });
      items[identity] = { status: "verified", feed_id: before.feed_id, snapshot: snapshotPath };
    } catch (error) { items[identity] = { status: "pending", reason: `unknown_outcome:${error.message}`, snapshot: snapshotPath }; }
  }
  return { dry_run: dryRun, items };
}

export async function syncCurrentApprovedTitles({ ledgerPath = DEFAULT_LEDGER_PATH, websitePath = DEFAULT_WEBSITE_PATH,
  feedPath, radarPath, artifactRoot, archiveRoot, distRoot, weeklyPath, cli,
  snapshotDir = DEFAULT_SNAPSHOT_DIR, approvalBaselinePath = DEFAULT_APPROVAL_BASELINE_PATH, dryRun = true } = {}) {
  const [ledger, website, currentBinding, baselineFile] = await Promise.all([
    readFile(ledgerPath, "utf8").then(JSON.parse), readFile(websitePath, "utf8").then(JSON.parse),
    capturePublishedSourceBinding({ feedPath, radarPath, artifactRoot, archiveRoot, weeklyPath }),
    readFile(approvalBaselinePath, "utf8").then(JSON.parse).catch(error => {
      if (error?.code === "ENOENT") return null;
      throw new Error("CHANNEL_APPROVED_BASELINE_INVALID");
    })]);
  if (website.status !== "success" || website.source_binding?.id !== currentBinding.id) throw new Error("CHANNEL_SOURCE_BUILD_MISMATCH");
  if (baselineFile && (baselineFile.version !== 1 || !baselineFile.items || typeof baselineFile.items !== "object" || Array.isArray(baselineFile.items))) {
    throw new Error("CHANNEL_APPROVED_BASELINE_INVALID");
  }
  const sources = await buildBoundTitleSources({ sourceBinding: website.source_binding, currentBinding, archiveRoot, distRoot, weeklyPath });
  const { getDetail } = readOnlyTitleInventory(cli, ledger.guild_id);
  return syncBoundApprovedTitles({ ledger, sourceBinding: website.source_binding, currentBinding, sources,
    approvedBaselines: baselineFile?.items,
    getDetail, cli, snapshotDir, dryRun });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--dry-run", "--apply"].includes(arg)) || args.includes("--dry-run") && args.includes("--apply")) {
    throw new Error("Usage: node scripts/channel-title-only-sync.mjs [--dry-run|--apply]");
  }
  const cli = async command => execFileAsync("tencent-channel-cli", command, {
    cwd: PROJECT_ROOT, timeout: 120_000, maxBuffer: 2_000_000,
  });
  const result = await syncCurrentApprovedTitles({ ledgerPath: DEFAULT_LEDGER_PATH,
    websitePath: DEFAULT_WEBSITE_PATH, archiveRoot: join(PROJECT_ROOT, "src/data/arxiv-archives/daily"),
    distRoot: join(PROJECT_ROOT, "dist"), weeklyPath: join(PROJECT_ROOT, "src/data/arxiv-weekly.json"),
    snapshotDir: DEFAULT_SNAPSHOT_DIR, cli, dryRun: !args.includes("--apply") });
  console.log(JSON.stringify(result, null, 2));
  if (Object.values(result.items).some(item => item.status === "pending")) process.exitCode = 2;
}
