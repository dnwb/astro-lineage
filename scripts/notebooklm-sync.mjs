import { readFile, mkdir, chmod, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { acquireRefreshLock, releaseRefreshLock, writeJsonAtomically } from "./arxiv-daily.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CACHE = resolve(ROOT, ".cache/notebooklm");
const EXPORTER = resolve(ROOT, "scripts/notebooklm-browser.py");
const ADAPTER = resolve(ROOT, "scripts/notebooklm-http.py");
const SKILL = process.env.NOTEBOOKLM_SKILL_ROOT || "/home/long/.agents/skills/notebooklm";
// Default account/storage selection belongs to the maintained skill wrapper.
const AUTH = process.env.NOTEBOOKLM_AUTH_STATE;
const SAFE_NOTEBOOKLM_CODES = new Set(["NOTEBOOKLM_AUTH_REQUIRED", "NOTEBOOKLM_BROWSER_FAILED", "NOTEBOOKLM_CLI_FAILED", "NOTEBOOKLM_SOURCE_MISMATCH", "NOTEBOOKLM_UNKNOWN_OUTCOME", "NOTEBOOKLM_DUPLICATE_ANNUAL_NOTEBOOKS", "NOTEBOOKLM_EMPTY_PAGE", "NOTEBOOKLM_INVALID_URL", "NOTEBOOKLM_INVENTORY_INCOMPLETE", "NOTEBOOKLM_PAGE_TOO_LARGE", "NOTEBOOKLM_REPORT_TOO_LARGE", "NOTEBOOKLM_TITLE_MISMATCH", "NOTEBOOKLM_INVALID_RESPONSE", "NOTEBOOKLM_OUTPUT_LIMIT", "NOTEBOOKLM_RUNTIME_UNAVAILABLE", "NOTEBOOKLM_SYNC_INCOMPLETE", "NOTEBOOKLM_TIMEOUT", "NOTEBOOKLM_EXPORT_INVALID", "NOTEBOOKLM_EXPORT_STALE", "NOTEBOOKLM_BUILD_REQUIRED", "NOTEBOOKLM_BUILD_ID_INVALID", "NOTEBOOKLM_BUILD_CAPTURE_REQUIRED", "NOTEBOOKLM_SOURCE_CHANGED", "NOTEBOOKLM_MANIFEST_INVALID", "NOTEBOOKLM_ARGUMENT_INVALID"]);
const SAFE_CHANNEL_CODES = new Set([
  "CHANNEL_ARCHIVE_INVALID", "CHANNEL_ARCHIVE_TOO_LARGE", "CHANNEL_CONTENT_LIMIT",
  "CHANNEL_CREATE_IDENTITY_MISSING", "CHANNEL_DIRECTIONS_INVALID", "CHANNEL_LEDGER_CORRUPT",
  "CHANNEL_FAILED", "CHANNEL_LEGACY_BINDINGS_INVALID", "CHANNEL_LEGACY_MISMATCH", "CHANNEL_LIMIT_INVALID", "CHANNEL_MOVE_UNVERIFIED",
  "CHANNEL_OUTPUT_LIMIT", "CHANNEL_PAGINATION_INCOMPLETE", "CHANNEL_PAGINATION_INVALID", "CHANNEL_RATE_LIMIT",
  "CHANNEL_REMOTE_MISMATCH", "CHANNEL_REMOTE_REJECTED", "CHANNEL_RESPONSE_INVALID", "CHANNEL_RUNTIME_UNAVAILABLE",
  "CHANNEL_SECTION_AMBIGUOUS", "CHANNEL_SECTION_CREATE_INVALID", "CHANNEL_SECTION_LIST_INVALID",
  "CHANNEL_SECTION_MISSING", "CHANNEL_SOURCE_BUILD_MISMATCH", "CHANNEL_SOURCE_BUILD_REQUIRED",
  "CHANNEL_SOURCE_DATE_INVALID", "CHANNEL_SOURCE_INVALID", "CHANNEL_SOURCE_UNBOUND", "CHANNEL_SOURCE_UNPUBLISHED",
  "CHANNEL_TIMEOUT", "CHANNEL_TOPIC_UNRESOLVED", "CHANNEL_UNKNOWN_OUTCOME", "CHANNEL_WEEKLY_AMBIGUOUS", "CHANNEL_WEEKLY_INVALID",
  "CHANNEL_BRIEF_UNAVAILABLE", "CHANNEL_EVENTS_INVALID", "CHANNEL_EVENTS_BUILD_REQUIRED", "CHANNEL_EVENTS_BUILD_MISMATCH",
]);

function safeChannelCode(error) {
  const value = typeof error === "string" ? error : error?.code || error?.message;
  const code = typeof value === "string" ? value.split(":", 1)[0] : "";
  if (SAFE_CHANNEL_CODES.has(code)) return code;
  if (/^CHANNEL_CLI_EXIT_(?:\d{1,3}|null)$/u.test(code)) return "CHANNEL_CLI_EXIT";
  return "CHANNEL_DELIVERY_FAILED";
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

// Child diagnostics can contain private browser data. Return only our JSON events.
export function runAdapter(args, { input, timeoutMs = 360_000, python = "python3" } = {}) {
  return new Promise((done, reject) => {
    const child = spawn(python, args, { cwd: ROOT, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let output = "", bytes = 0, failure, killTimer;
    const stop = () => {
      try {
        // Allow the HTTP adapter to stop its scoped CLI subprocesses first.
        if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM");
        killTimer ||= setTimeout(() => {
          try { if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {}
        }, 2000);
      } catch {}
    };
    const timer = setTimeout(() => { failure = "NOTEBOOKLM_TIMEOUT"; stop(); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 64_000_000) { failure = "NOTEBOOKLM_OUTPUT_LIMIT"; stop(); }
      else output += chunk;
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new Error("NOTEBOOKLM_RUNTIME_UNAVAILABLE")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      const events = output.split("\n").filter((line) => line.startsWith("{")).map((line) => {
        try { return JSON.parse(line); } catch { return { event: "error", code: "NOTEBOOKLM_INVALID_RESPONSE" }; }
      });
      done({ events, code: failure || (code === 0 ? null : events.find((e) => e.event === "error")?.code || "NOTEBOOKLM_BROWSER_FAILED") });
    });
    child.stdin.end(input ? JSON.stringify(input) : undefined);
  });
}

function validBuildId(buildId) { return typeof buildId === "string" && /^[a-zA-Z0-9-]{10,80}$/u.test(buildId); }

async function captureSources() {
  const { capturePublishedSourceBinding } = await import("./channel-publication.mjs");
  return capturePublishedSourceBinding();
}

export async function captureBuildSources({ cache = CACHE, buildId, capture = captureSources } = {}) {
  if (!validBuildId(buildId)) throw new Error("NOTEBOOKLM_BUILD_ID_INVALID");
  const source_binding = await capture();
  if (!/^[a-f0-9]{64}$/u.test(source_binding?.id || "")) throw new Error("NOTEBOOKLM_BUILD_CAPTURE_REQUIRED");
  await writeJsonAtomically(resolve(cache, "build-capture.json"), { build_id: buildId, source_binding });
  return { build_id: buildId, source_binding };
}

export async function recordWebsiteBuild({ cache = CACHE, buildId, capture = captureSources, eventsPath = resolve(ROOT, "dist/api/v1/events.json") } = {}) {
  if (!validBuildId(buildId)) throw new Error("NOTEBOOKLM_BUILD_ID_INVALID");
  const before = await readJson(resolve(cache, "build-capture.json"), null);
  if (before?.build_id !== buildId || !/^[a-f0-9]{64}$/u.test(before.source_binding?.id || "")) throw new Error("NOTEBOOKLM_BUILD_CAPTURE_REQUIRED");
  if (!isDeepStrictEqual(before.source_binding, await capture())) throw new Error("NOTEBOOKLM_SOURCE_CHANGED");
  const website = { status: "success", built_at: new Date().toISOString(), build_id: buildId, source_binding: before.source_binding };
  // Event heat is generated during build, so bind the actual built artifact afterwards.
  if (eventsPath !== null) {
    try {
      if ((await stat(eventsPath)).size > 20_000_000) throw new Error("CHANNEL_EVENTS_INVALID");
      const bytes = await readFile(eventsPath);
      const events = JSON.parse(bytes);
      if (!Array.isArray(events.events) || !Number.isFinite(Date.parse(events.generated_at))) throw new Error("CHANNEL_EVENTS_INVALID");
      website.events = { hash: createHash("sha256").update(bytes).digest("hex"), generated_at: events.generated_at };
    } catch { website.events = { error: "CHANNEL_EVENTS_INVALID" }; }
  }
  await writeJsonAtomically(resolve(cache, "website.json"), website);
  return website;
}

export async function exportNotebookPages({ dist = resolve(ROOT, "dist"), cache = CACHE, adapter = runAdapter, buildId } = {}) {
  if (buildId !== undefined && (!validBuildId(buildId) || (await readJson(resolve(cache, "website.json"), null))?.build_id !== buildId)) {
    throw new Error("NOTEBOOKLM_BUILD_REQUIRED");
  }
  const result = await adapter([EXPORTER, "--export", dist], { timeoutMs: 60_000 });
  const snapshot = result.events[0];
  if (result.code || snapshot?.schema_version !== 1 || !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.reports)) {
    throw new Error(result.code || "NOTEBOOKLM_EXPORT_INVALID");
  }
  if (!buildId) {
    buildId = randomUUID();
    await writeJsonAtomically(resolve(cache, "website.json"), { status: "success", built_at: new Date().toISOString(), build_id: buildId });
  }
  snapshot.built_at = new Date().toISOString();
  snapshot.build_id = buildId;
  await writeJsonAtomically(resolve(cache, "export.json"), snapshot);
  return snapshot;
}

export async function syncAnnualNotebooks({ cache = CACHE, dist = resolve(ROOT, "dist"), adapter = runAdapter, dryRun = false, expectedBuildId } = {}) {
  const snapshot = await readJson(resolve(cache, "export.json"), null);
  if (snapshot?.schema_version !== 1 || !Array.isArray(snapshot.sources)) throw new Error("NOTEBOOKLM_BUILD_REQUIRED");
  const website = await readJson(resolve(cache, "website.json"), null);
  const capture = await readJson(resolve(cache, "build-capture.json"), null);
  if (!snapshot.build_id || website?.build_id !== snapshot.build_id || (capture && capture.build_id !== snapshot.build_id)
    || (expectedBuildId && snapshot.build_id !== expectedBuildId)) throw new Error("NOTEBOOKLM_EXPORT_STALE");
  if (!Array.isArray(snapshot.reports)) throw new Error("NOTEBOOKLM_EXPORT_INVALID");
  for (const report of snapshot.reports) {
    const route = report?.kind === "daily" ? "arxiv-daily" : report?.kind === "weekly" ? "arxiv-weekly" : null;
    const pattern = report?.kind === "daily" ? /^\d{4}-\d{2}-\d{2}$/u : /^\d{4}-W\d{2}$/u;
    if (!route || !pattern.test(report.id) || report.route !== `/${route}/${report.id}/` || !/^[a-f0-9]{64}$/u.test(report.page_sha256)) throw new Error("NOTEBOOKLM_EXPORT_INVALID");
    let page;
    try { page = await readFile(resolve(dist, route, report.id, "index.html")); }
    catch { throw new Error("NOTEBOOKLM_EXPORT_STALE"); }
    if (createHash("sha256").update(page).digest("hex") !== report.page_sha256) throw new Error("NOTEBOOKLM_EXPORT_STALE");
  }
  const manifestPath = resolve(cache, "manifest.json");
  const manifest = await readJson(manifestPath, { schema_version: 1, notebooks: {} });
  if (manifest.schema_version !== 1 || !manifest.notebooks || typeof manifest.notebooks !== "object") {
    throw new Error("NOTEBOOKLM_MANIFEST_INVALID");
  }
  const sources = snapshot.sources;
  for (const source of sources) {
    const marker = `ASTROLINEAGE_SOURCE_SHA256_${source.sha256}\n`;
    if (!Number.isInteger(source.year) || !/^(daily|weekly)-\d{4}-\d{2}-p\d{2}$/u.test(source.key)
      || Number(source.key.split("-")[1]) !== source.year || Number(source.key.split("-")[2]) < 1 || Number(source.key.split("-")[2]) > 12
      || !/^[a-f0-9]{64}$/u.test(source.sha256) || source.title !== `AL-${source.key}-${source.sha256}.txt`
      || typeof source.text !== "string" || Buffer.byteLength(source.text) > 1_001_000 || !source.text.startsWith(marker)
      || createHash("sha256").update(source.text.slice(marker.length)).digest("hex") !== source.sha256) {
      throw new Error("NOTEBOOKLM_EXPORT_INVALID");
    }
  }
  const pending = sources.filter((source) => manifest.notebooks[source.year]?.sources?.[source.key]?.sha256 !== source.sha256);
  if (dryRun) return { status: "dry_run", reports: snapshot.reports.length, pending: pending.map(({ year, key }) => ({ year, key })) };
  const lock = resolve(cache, "sync.lock");
  await acquireRefreshLock(lock);
  try {
    // Re-read inside the lock: a second caller may have completed while we waited.
    const current = await readJson(manifestPath, manifest);
    for (const notebook of Object.values(current.notebooks || {})) {
      if (!notebook || !notebook.sources || typeof notebook.sources !== "object" || Array.isArray(notebook.sources)) throw new Error("NOTEBOOKLM_MANIFEST_INVALID");
    }
    const errors = [];
    let uploaded = 0;
    for (const year of [...new Set(sources.map((source) => source.year))]) {
      const notebook = current.notebooks[year] ||= { sources: {} };
      const changed = sources.filter((source) => source.year === year && notebook.sources[source.key]?.sha256 !== source.sha256);
      if (!changed.length) continue;
      let result;
      try {
        result = await adapter([ADAPTER, "--skill-root", SKILL, ...(AUTH ? ["--state", AUTH] : [])], {
          input: { year, notebook_url: notebook.url, sources: changed },
        });
      } catch (error) { result = { events: [], code: error.message }; }
      for (const event of result.events) {
        if (event.event === "notebook" && event.year === year
          && /^https:\/\/(notebook|notebooklm)\.google\.com\/notebook\/[a-f0-9-]{36}$/u.test(event.url)) notebook.url = event.url;
        if (event.event === "source" && event.year === year) {
          const source = changed.find((item) => item.key === event.key && item.sha256 === event.sha256 && item.title === event.title);
          if (source) {
            notebook.sources[source.key] = { sha256: source.sha256, title: source.title, synced_at: new Date().toISOString() };
            uploaded++;
          }
        }
      }
      await writeJsonAtomically(manifestPath, current);
      if (result.code || changed.some((source) => notebook.sources[source.key]?.sha256 !== source.sha256)) {
        errors.push({ year, code: SAFE_NOTEBOOKLM_CODES.has(result.code) ? result.code : "NOTEBOOKLM_SYNC_INCOMPLETE" });
      }
    }
    const status = { status: errors.length ? "blocked" : "success", checked_at: new Date().toISOString(),
      built_at: snapshot.built_at, uploaded, errors,
      notebooks: Object.fromEntries(Object.entries(current.notebooks).map(([year, notebook]) => [year, { url: notebook.url, sources: Object.keys(notebook.sources).length }])) };
    await writeJsonAtomically(resolve(cache, "status.json"), status);
    return status;
  } finally { await releaseRefreshLock(lock); }
}

export async function deliverPublication({ kinds = ["daily"], cache = CACHE, buildId, channel, includeEvents = channel === undefined, notebookSync = syncAnnualNotebooks } = {}) {
  if (!validBuildId(buildId) || !Array.isArray(kinds) || !kinds.length || kinds.some((kind) => !["daily", "weekly"].includes(kind)) || new Set(kinds).size !== kinds.length) throw new Error("INVALID_DELIVERY_MODE");
  const website = await readJson(resolve(cache, "website.json"), null);
  if (website?.status !== "success" || website.build_id !== buildId) throw new Error("NOTEBOOKLM_BUILD_REQUIRED");
  const capture = await readJson(resolve(cache, "build-capture.json"), null);
  if (capture && capture.build_id !== buildId) throw new Error("NOTEBOOKLM_BUILD_REQUIRED");
  const status = { checked_at: new Date().toISOString(), website, channel: {},
    qq: { status: "waiting_permission", reason: "proactive messaging not authorized by QQ platform" } };
  const targets = includeEvents ? [...kinds, "events"] : kinds;
  if (!channel) {
    channel = async (kind, { sourceBinding }) => {
      if (!sourceBinding) throw new Error("CHANNEL_SOURCE_UNBOUND");
      const publisher = await import("./tencent-channel-publisher.mjs");
      if (kind === "events") return publisher.publishEventRanking({ sourceBinding, eventSnapshot: website.events });
      return kind === "weekly" ? publisher.publishWeeklyFeed({ sourceBinding }) : publisher.publishDailyFeed({ sourceBinding, includeBrief: true });
    };
  }
  // Targets fail independently, but failure is recorded rather than swallowed.
  for (const kind of targets) {
    try {
      const result = await channel(kind, { sourceBinding: website.source_binding });
      if (result === null && kind === "daily") status.channel[kind] = { status: "skipped", reason: "no highlights" };
      else {
        const response = typeof result === "string" ? JSON.parse(result) : result;
        if (typeof response?.success !== "boolean") throw new Error("CHANNEL_REJECTED");
        const counts = ["published", "updated", "unchanged", "pending", "remaining"];
        const incomplete = !response.success || response.pending > 0 || response.remaining > 0
          || counts.some((key) => response[key] !== undefined && (!Number.isSafeInteger(response[key]) || response[key] < 0));
        status.channel[kind] = { status: incomplete ? "failed" : "success" };
        for (const key of counts) {
          if (Number.isSafeInteger(response[key]) && response[key] >= 0) status.channel[kind][key] = response[key];
        }
        if (incomplete) {
          status.channel[kind].code = "CHANNEL_DELIVERY_INCOMPLETE";
          status.channel[kind].errors = (Array.isArray(response.errors) ? response.errors : []).slice(0, 20).map(safeChannelCode);
        }
      }
    } catch (error) { status.channel[kind] = { status: "failed", code: safeChannelCode(error) }; }
  }
  let snapshot;
  try { snapshot = await readJson(resolve(cache, "export.json"), null); }
  catch { status.notebooklm = { status: "blocked", code: "NOTEBOOKLM_EXPORT_INVALID" }; }
  if (!status.notebooklm && snapshot?.build_id !== buildId) status.notebooklm = { status: "blocked", code: "NOTEBOOKLM_EXPORT_STALE" };
  if (!status.notebooklm) {
    try { status.notebooklm = await notebookSync({ cache, expectedBuildId: buildId }); }
    catch (error) { status.notebooklm = { status: "blocked", code: SAFE_NOTEBOOKLM_CODES.has(error.message) ? error.message : "NOTEBOOKLM_DELIVERY_FAILED" }; }
  }
  await writeJsonAtomically(resolve(cache, "delivery.json"), status);
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let result;
    if (args[0] === "--capture-build" && args.length === 2) result = await captureBuildSources({ buildId: args[1] });
    else if (args[0] === "--built" && args.length === 2) result = await recordWebsiteBuild({ buildId: args[1] });
    else if (args[0] === "--export" && args.length <= 2) result = await exportNotebookPages({ buildId: args[1] });
    else if (args[0] === "--login" && args.length === 1) {
      if (AUTH) {
        await mkdir(dirname(AUTH), { recursive: true, mode: 0o700 });
        await chmod(dirname(AUTH), 0o700);
      }
      result = await runAdapter([resolve(SKILL, "scripts/run.py"), "notebooklm", ...(AUTH ? ["--storage", AUTH] : []), "login", "--browser", "chrome"], { timeoutMs: 330_000 });
      if (result.code) throw new Error(result.code);
    } else if (args[0] === "--deliver" && args.length === 3) {
      const mode = args[1];
      if (!["daily", "weekly", "both"].includes(mode)) throw new Error("INVALID_DELIVERY_MODE");
      result = await deliverPublication({ kinds: mode === "both" ? ["daily", "weekly"] : [mode], buildId: args[2] });
    } else if (args.length === 0 || (args.length === 1 && args[0] === "--dry-run")) result = await syncAnnualNotebooks({ dryRun: args[0] === "--dry-run" });
    else throw new Error("NOTEBOOKLM_ARGUMENT_INVALID");
    // Export text/credentials never belong in operational logs.
    const logged = args[0] === "--export" ? { status: "exported", reports: result.reports.length, sources: result.sources.length }
      : args[0] === "--capture-build" || args[0] === "--built"
        ? { status: args[0] === "--built" ? "success" : "captured", build_id: result.build_id, source_id: result.source_binding.id }
        : result;
    console.log(JSON.stringify(logged));
    if (result.status === "blocked" || result.notebooklm?.status === "blocked" || Object.values(result.channel || {}).some((target) => target.status === "failed")) process.exitCode = 1;
  } catch (error) { console.error(JSON.stringify({ status: "blocked", code: SAFE_NOTEBOOKLM_CODES.has(error.message) || SAFE_CHANNEL_CODES.has(error.message) || error.message === "INVALID_DELIVERY_MODE" ? error.message : "NOTEBOOKLM_FAILED" })); process.exitCode = 1; }
}
