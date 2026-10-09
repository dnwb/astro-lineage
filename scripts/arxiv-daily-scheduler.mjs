import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
  process.loadEnvFile();
}
import {
  ANNOUNCEMENT_LOCAL_TIME,
  ANNOUNCEMENT_WEEKDAYS,
  DEFAULT_ARTIFACT_ROOT,
  DEFAULT_OUTPUT,
  DEFAULT_QUERY,
  DEFAULT_RADAR_OUTPUT,
  DEFAULT_TIME_ZONE,
  acquireRefreshLock,
  releaseRefreshLock,
  readArxivRunState,
  refreshArxivFeed,
  writeJsonAtomically,
} from "./arxiv-daily.mjs";

const ANNOUNCEMENT_HOUR = Number(ANNOUNCEMENT_LOCAL_TIME.slice(0, 2));
const LEDGER_SCHEMA = "arxiv-daily-scheduler-ledger-v1";
const DEFAULT_BATCH_LIMIT = 5;

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)])
  );
}

function dateText(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function assertDateOnly(value, name = "date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${name} must be a valid YYYY-MM-DD date`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${name} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function addCalendarDay(dateOnly, amount) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return dateText({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function weekdayForDate(dateOnly, timeZone) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    new Date(Date.UTC(year, month - 1, day, 12))
  );
}

function isScheduledDate(dateOnly, timeZone) {
  return ANNOUNCEMENT_WEEKDAYS.includes(weekdayForDate(dateOnly, timeZone));
}

function nextScheduledDate(dateOnly, timeZone) {
  let candidate = addCalendarDay(dateOnly, 1);
  while (!isScheduledDate(candidate, timeZone)) candidate = addCalendarDay(candidate, 1);
  return candidate;
}

function scheduledDatesBetween(startDate, throughDate, timeZone) {
  const dates = [];
  for (let date = startDate; date <= throughDate; date = addCalendarDay(date, 1)) {
    if (isScheduledDate(date, timeZone)) dates.push(date);
  }
  return dates;
}

export function latestCompletedAnnouncementDate({
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf()))
    throw new Error("scheduler now must be a valid Date");
  const parts = localParts(now, timeZone);
  const date = dateText(parts);
  if (isScheduledDate(date, timeZone) && parts.hour >= ANNOUNCEMENT_HOUR) return date;
  let candidate = addCalendarDay(date, -1);
  while (!isScheduledDate(candidate, timeZone)) candidate = addCalendarDay(candidate, -1);
  return candidate;
}

export function isAnnouncementDate({ announcementDate, timeZone = DEFAULT_TIME_ZONE } = {}) {
  assertDateOnly(announcementDate, "announcementDate");
  return isScheduledDate(announcementDate, timeZone);
}

function lastSuccessDate(state) {
  const windowDate = state?.last_success?.window?.announcement_date;
  if (typeof windowDate === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(windowDate)) return windowDate;
  const match = state?.last_success?.window?.batch_id?.match(/^announcement-(\d{4}-\d{2}-\d{2})$/u);
  return match?.[1] ?? null;
}

function artifactRootFor({ output, artifactRoot }) {
  if (artifactRoot !== undefined) return resolve(artifactRoot);
  const target = resolve(output ?? DEFAULT_OUTPUT);
  return target === resolve(DEFAULT_OUTPUT)
    ? resolve(DEFAULT_ARTIFACT_ROOT)
    : join(dirname(target), ".arxiv-daily-artifacts");
}

function radarPathFor(output, radarOutput) {
  if (radarOutput !== undefined) return resolve(radarOutput);
  const target = resolve(output);
  return target === resolve(DEFAULT_OUTPUT)
    ? resolve(DEFAULT_RADAR_OUTPUT)
    : `${target}.radar.json`;
}

async function readLedger({ artifactRoot, timeZone, query }) {
  const path = join(artifactRoot, "scheduler-ledger.json");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") parsed = null;
    else throw new Error(`cannot read scheduler ledger: ${error.message}`, { cause: error });
  }
  if (parsed !== null) {
    if (parsed?.schema_version !== LEDGER_SCHEMA || !Array.isArray(parsed.successful_dates)) {
      throw new Error(
        "ARXIV_SCHEDULER_LEDGER_INVALID: scheduler-ledger.json has an unsupported shape"
      );
    }
    if (parsed.start_date !== null && parsed.start_date !== undefined)
      assertDateOnly(parsed.start_date, "scheduler ledger start_date");
    if (parsed.scope !== query) {
      return {
        schema_version: LEDGER_SCHEMA,
        scope: query,
        start_date: parsed.start_date ?? null,
        successful_dates: [],
        archived_dates: [],
        failed_dates: [],
        attempt_sequence: 0,
        date_attempts: {},
      };
    }
    for (const date of parsed.successful_dates) {
      assertDateOnly(date, "scheduler ledger date");
      if (!isScheduledDate(date, timeZone))
        throw new Error(`ARXIV_SCHEDULER_LEDGER_INVALID: ${date} is not an announcement date`);
    }
    const attemptSequence = parsed.attempt_sequence ?? 0;
    const rawDateAttempts = parsed.date_attempts ?? {};
    const rawFailedDates = parsed.failed_dates ?? [];
    if (
      !Number.isSafeInteger(attemptSequence) ||
      attemptSequence < 0 ||
      !rawDateAttempts ||
      typeof rawDateAttempts !== "object" ||
      Array.isArray(rawDateAttempts) ||
      !Array.isArray(rawFailedDates)
    ) {
      throw new Error(
        "ARXIV_SCHEDULER_LEDGER_INVALID: date-attempt tracking has an unsupported shape"
      );
    }
    for (const [date, attempt] of Object.entries(rawDateAttempts)) {
      assertDateOnly(date, "scheduler ledger attempt date");
      const validAttempts =
        attempt && Number.isSafeInteger(attempt.attempts) && attempt.attempts >= 0;
      const validQueueSequence =
        attempt &&
        Number.isSafeInteger(attempt.queue_sequence) &&
        attempt.queue_sequence > 0 &&
        attempt.queue_sequence <= attemptSequence;
      const validLastAttempt =
        attempt &&
        Number.isSafeInteger(attempt.last_attempt_sequence) &&
        attempt.last_attempt_sequence > 0 &&
        attempt.last_attempt_sequence <= attemptSequence;
      if (
        !isScheduledDate(date, timeZone) ||
        !validAttempts ||
        (attempt.attempts === 0 ? !validQueueSequence : !validLastAttempt) ||
        (attempt.queue_sequence !== undefined && !validQueueSequence)
      ) {
        throw new Error(`ARXIV_SCHEDULER_LEDGER_INVALID: attempt record for ${date} is invalid`);
      }
    }
    for (const date of rawFailedDates) {
      assertDateOnly(date, "scheduler ledger failed date");
      if (!isScheduledDate(date, timeZone))
        throw new Error(`ARXIV_SCHEDULER_LEDGER_INVALID: ${date} is not an announcement date`);
    }
    return {
      schema_version: LEDGER_SCHEMA,
      scope: query,
      start_date: parsed.start_date ?? null,
      successful_dates: [...new Set(parsed.successful_dates)].sort(),
      archived_dates: [
        ...new Set(Array.isArray(parsed.archived_dates) ? parsed.archived_dates : []),
      ].sort(),
      failed_dates: [...new Set(rawFailedDates)].sort(),
      attempt_sequence: attemptSequence,
      date_attempts: rawDateAttempts,
    };
  }
  const legacy = await readArxivRunState({ artifactRoot });
  const legacyDate = lastSuccessDate(legacy);
  return {
    schema_version: LEDGER_SCHEMA,
    scope: query,
    start_date: legacyDate ? assertDateOnly(legacyDate, "legacy success date") : null,
    successful_dates: [],
    archived_dates: [],
    failed_dates: [],
    attempt_sequence: 0,
    date_attempts: {},
  };
}

async function saveLedger(artifactRoot, ledger) {
  await writeJsonAtomically(join(artifactRoot, "scheduler-ledger.json"), ledger);
}

async function currentFeedDate(output) {
  try {
    const feed = JSON.parse(await readFile(output, "utf8"));
    const date = feed?.window?.announcement_date;
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : null;
  } catch {
    return null;
  }
}

async function hasPrimaryFeed(output) {
  try {
    await readFile(output, "utf8");
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isGlobalRateLimit(error) {
  return /\b(?:429|rate[ -]?(?:limit|exceeded)|too many requests)\b/iu.test(
    String(error?.message ?? error)
  );
}

function missingDateOrder(ledger, dates) {
  const order = (date) => {
    const attempt = ledger.date_attempts[date];
    return attempt?.attempts > 0 ? attempt.last_attempt_sequence : attempt?.queue_sequence;
  };
  return [...dates].sort((left, right) => order(left) - order(right) || left.localeCompare(right));
}

function enqueueMissingDates(ledger, dates) {
  for (const date of dates) {
    if (ledger.date_attempts[date]) continue;
    ledger.attempt_sequence += 1;
    ledger.date_attempts[date] = { attempts: 0, queue_sequence: ledger.attempt_sequence };
  }
}

function recordDateAttempt(ledger, date) {
  const previous = ledger.date_attempts[date] ?? { attempts: 0 };
  ledger.attempt_sequence += 1;
  ledger.date_attempts[date] = {
    attempts: previous.attempts + 1,
    ...(previous.queue_sequence === undefined ? {} : { queue_sequence: previous.queue_sequence }),
    last_attempt_sequence: ledger.attempt_sequence,
  };
}

async function defaultArchiveSync(options) {
  const { syncArxivArchives } = await import("./arxiv-archive.mjs");
  return syncArxivArchives(options);
}

async function defaultAnalyzer(options) {
  const { runAiAnalyzer } = await import("./arxiv-ai-analyzer.mjs");
  return runAiAnalyzer(options);
}

async function archiveDate({ archiveImpl, archiveRoot, feed, radar, artifactRoot, defaultOutput }) {
  if (!archiveImpl && resolve(defaultOutput) !== resolve(DEFAULT_OUTPUT)) return null;
  const sync = archiveImpl ?? defaultArchiveSync;
  return sync({
    ...(archiveRoot === undefined ? {} : { archiveRoot }),
    currentFeedPath: feed,
    currentRadarPath: radar,
    dailyCacheDir: join(artifactRoot, "generations"),
  });
}

async function analyzePrimary({
  analyzeImpl,
  output,
  radar,
  artifactRoot,
  archiveRoot,
  analysisLimit,
}) {
  if (!analyzeImpl) return null;
  let priorityIds = [];
  try {
    const feedData = JSON.parse(await readFile(output, "utf8"));
    if (Array.isArray(feedData.entries)) {
      priorityIds = feedData.entries.map((e) => e.arxiv_id).filter(Boolean);
    }
  } catch {}
  return analyzeImpl({
    feed: output,
    radar,
    artifactRoot,
    priorityIds,
    ...(archiveRoot === undefined ? {} : { archiveRoot }),
    limit: analysisLimit ?? 0,
  });
}

export async function runScheduledArxivRefresh({
  now = new Date(),
  announcementDate,
  fromDate,
  throughDate,
  timeZone = DEFAULT_TIME_ZONE,
  artifactRoot,
  output = DEFAULT_OUTPUT,
  radarOutput,
  archiveRoot,
  refreshImpl = refreshArxivFeed,
  archiveImpl,
  analyzeImpl,
  maxBatchesPerRun = DEFAULT_BATCH_LIMIT,
  analysisLimit,
  ...refreshOptions
} = {}) {
  const target = resolve(output);
  const radar = radarPathFor(target, radarOutput);
  const root = artifactRootFor({ output: target, artifactRoot });
  const archive = archiveImpl ?? (target === resolve(DEFAULT_OUTPUT) ? defaultArchiveSync : null);

  if (announcementDate !== undefined) {
    if (fromDate !== undefined || throughDate !== undefined)
      throw new Error("--date cannot be combined with --from or --through");
    assertDateOnly(announcementDate, "announcementDate");
    if (!isScheduledDate(announcementDate, timeZone))
      throw new Error(`announcementDate ${announcementDate} is not an arXiv announcement date`);
    const payload = await refreshImpl({
      ...refreshOptions,
      output: target,
      radarOutput: radar,
      artifactRoot: root,
      announcementDate,
      timeZone,
      rejectEmpty: true,
    });
    await archiveDate({
      archiveImpl: archive,
      archiveRoot,
      feed: target,
      radar,
      artifactRoot: root,
      defaultOutput: target,
    });
    await analyzePrimary({
      analyzeImpl,
      output: target,
      radar,
      artifactRoot: root,
      archiveRoot,
      analysisLimit,
    });
    return {
      status: "refreshed",
      payload,
      refreshed_dates: [announcementDate],
      pending_dates: [],
      failed_dates: [],
      time_zone: timeZone,
    };
  }

  if (!Number.isInteger(maxBatchesPerRun) || maxBatchesPerRun < 1)
    throw new Error("maxBatchesPerRun must be a positive integer");
  const latestDate = latestCompletedAnnouncementDate({ now, timeZone });
  const through = assertDateOnly(throughDate ?? latestDate, "throughDate");
  if (through > latestDate)
    throw new Error(
      `throughDate ${through} is later than the latest completed announcement ${latestDate}`
    );
  // ponytail: Serialize catch-up only for this artifact root.
  const schedulerLock = join(root, "scheduler.lock");
  await acquireRefreshLock(schedulerLock);

  try {
    const query = refreshOptions.query ?? DEFAULT_QUERY;
    const ledger = await readLedger({ artifactRoot: root, timeZone, query });
    const existingCurrentDate = await currentFeedDate(target);
    let start =
      fromDate === undefined
        ? (ledger.start_date ??
          (ledger.successful_dates.length === 0
            ? through
            : nextScheduledDate(ledger.successful_dates.at(-1), timeZone)))
        : assertDateOnly(fromDate, "fromDate");
    if (fromDate === undefined && start > through) start = through;
    if (start > through)
      throw new Error(`fromDate ${start} must be on or before throughDate ${through}`);
    if (fromDate !== undefined && (ledger.start_date === null || start < ledger.start_date))
      ledger.start_date = start;
    if (ledger.start_date === null) ledger.start_date = start;
    await saveLedger(root, ledger);

    if (existingCurrentDate !== null) {
      await archiveDate({
        archiveImpl: archive,
        archiveRoot,
        feed: target,
        radar,
        artifactRoot: root,
        defaultOutput: target,
      });
      if (archive && isScheduledDate(existingCurrentDate, timeZone)) {
        ledger.archived_dates = [
          ...new Set([...ledger.archived_dates, existingCurrentDate]),
        ].sort();
        await saveLedger(root, ledger);
      }
    }

    const dates = scheduledDatesBetween(start, through, timeZone);
    const successes = new Set(ledger.successful_dates);
    for (const date of dates) {
      if (
        !successes.has(date) ||
        ledger.archived_dates.includes(date) ||
        date === existingCurrentDate
      )
        continue;
      const editionRoot = join(root, "catch-up", date);
      const feed = join(editionRoot, "arxiv-daily.json");
      const radarPath = join(editionRoot, "daily-radar.json");
      try {
        await readFile(feed, "utf8");
      } catch {
        continue;
      }
      await archiveDate({
        archiveImpl: archive,
        archiveRoot,
        feed,
        radar: radarPath,
        artifactRoot: editionRoot,
        defaultOutput: target,
      });
      if (archive) {
        ledger.archived_dates = [...new Set([...ledger.archived_dates, date])].sort();
        await saveLedger(root, ledger);
      }
    }
    const missing = dates.filter((date) => !successes.has(date));
    const activeIsCurrent = existingCurrentDate !== null && existingCurrentDate >= through;
    const publishNewest = (date) =>
      date === latestDate && date >= (existingCurrentDate ?? "0000-00-00");
    enqueueMissingDates(ledger, missing);
    const selected = missingDateOrder(ledger, missing).slice(0, maxBatchesPerRun);
    let refreshedPrimary = null;
    const refreshedDates = [];

    for (const date of selected) {
      const publishToPrimary = publishNewest(date);
      const editionRoot = publishToPrimary ? root : join(root, "catch-up", date);
      const feed = publishToPrimary ? target : join(editionRoot, "arxiv-daily.json");
      const radarPath = publishToPrimary ? radar : join(editionRoot, "daily-radar.json");
      recordDateAttempt(ledger, date);
      await saveLedger(root, ledger);
      let payload;
      try {
        payload = await refreshImpl({
          ...refreshOptions,
          output: feed,
          radarOutput: radarPath,
          artifactRoot: editionRoot,
          announcementDate: date,
          timeZone,
          rejectEmpty: true,
        });
        if (!Array.isArray(payload?.entries) || payload.entries.length === 0) {
          throw new Error(
            `ARXIV_EMPTY_BATCH: ${date} produced no entries; the date remains retryable`
          );
        }
      } catch (error) {
        ledger.failed_dates = [...new Set([...ledger.failed_dates, date])].sort();
        await saveLedger(root, ledger);
        if (isGlobalRateLimit(error)) break;
        continue;
      }
      ledger.failed_dates = ledger.failed_dates.filter((candidate) => candidate !== date);
      ledger.successful_dates = [...new Set([...ledger.successful_dates, date])].sort();
      await saveLedger(root, ledger);
      await archiveDate({
        archiveImpl: archive,
        archiveRoot,
        feed,
        radar: radarPath,
        artifactRoot: editionRoot,
        defaultOutput: target,
      });
      if (archive) {
        ledger.archived_dates = [...new Set([...ledger.archived_dates, date])].sort();
        await saveLedger(root, ledger);
      }
      refreshedDates.push(date);
      if (publishToPrimary) refreshedPrimary = payload;
    }

    const remaining = dates.filter((date) => !ledger.successful_dates.includes(date));
    const throughAlreadyCovered =
      through >= start &&
      isScheduledDate(through, timeZone) &&
      ledger.successful_dates.includes(through);
    const currentAfterRefresh = await currentFeedDate(target);
    const shouldRestoreNewest =
      through === latestDate &&
      throughAlreadyCovered &&
      currentAfterRefresh !== through &&
      selected.length < maxBatchesPerRun;
    if (shouldRestoreNewest) {
      const payload = await refreshImpl({
        ...refreshOptions,
        output: target,
        radarOutput: radar,
        artifactRoot: root,
        announcementDate: through,
        timeZone,
        rejectEmpty: true,
      });
      if (!Array.isArray(payload?.entries) || payload.entries.length === 0) {
        throw new Error(
          `ARXIV_EMPTY_BATCH: ${through} produced no entries; the current edition remains unchanged`
        );
      }
      await archiveDate({
        archiveImpl: archive,
        archiveRoot,
        feed: target,
        radar,
        artifactRoot: root,
        defaultOutput: target,
      });
      if (archive) {
        ledger.archived_dates = [...new Set([...ledger.archived_dates, through])].sort();
        await saveLedger(root, ledger);
      }
      refreshedPrimary = payload;
      refreshedDates.push(through);
    }

    const caughtUpDates = [...new Set([...ledger.successful_dates])].filter(
      (date) => date >= start && date <= through
    );
    if (await hasPrimaryFeed(target)) {
      await analyzePrimary({
        analyzeImpl,
        output: target,
        radar,
        artifactRoot: root,
        archiveRoot,
        analysisLimit,
      });
    }

    let payload = refreshedPrimary;
    if (!payload) {
      try {
        payload = JSON.parse(await readFile(target, "utf8"));
      } catch {
        payload = null;
      }
    }
    const completed = remaining.length === 0;
    return {
      status: refreshedPrimary ? "refreshed" : "skipped",
      reason: completed ? (refreshedPrimary ? undefined : "already-processed") : "catch-up-pending",
      announcement_date: through,
      time_zone: timeZone,
      payload,
      refreshed_dates: refreshedDates,
      pending_dates: remaining,
      failed_dates: remaining.filter((date) => ledger.failed_dates.includes(date)),
      caught_up_dates: caughtUpDates,
      active_is_current:
        activeIsCurrent || currentAfterRefresh === through || refreshedPrimary !== null,
    };
  } finally {
    await releaseRefreshLock(schedulerLock);
  }
}

function cliValue(args, name) {
  const prefix = `${name}=`;
  const argument = args.find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length);
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const output = cliValue(args, "--output") ?? DEFAULT_OUTPUT;
  const announcementDate = cliValue(args, "--date");
  const fromDate = cliValue(args, "--from");
  const throughDate = cliValue(args, "--through");
  const runLimitText = cliValue(args, "--limit");
  const runLimit = runLimitText === undefined ? undefined : Number(runLimitText);
  if (runLimit !== undefined && (!Number.isInteger(runLimit) || runLimit < 1))
    throw new Error("--limit must be a positive integer");
  const analysisLimitText = cliValue(args, "--analysis-limit");
  const requestedAnalysisLimit =
    analysisLimitText === undefined ? runLimit : Number(analysisLimitText);
  if (
    requestedAnalysisLimit !== undefined &&
    (!Number.isInteger(requestedAnalysisLimit) || requestedAnalysisLimit < 1)
  ) {
    throw new Error("--analysis-limit must be a positive integer");
  }
  const hasCredentials = Boolean(
    process.env.IOA_API_KEY || process.env.WU_API_KEY || process.env.OPENAI_API_KEY
  );
  const result = await runScheduledArxivRefresh({
    output,
    announcementDate,
    fromDate,
    throughDate,
    ...(runLimit === undefined ? {} : { maxBatchesPerRun: runLimit }),
    ...(requestedAnalysisLimit === undefined ? {} : { analysisLimit: requestedAnalysisLimit }),
    analyzeImpl: !hasFlag(args, "--no-analyze") && hasCredentials ? defaultAnalyzer : undefined,
  });
  if (result.refreshed_dates.length > 0) {
    console.log(`refreshed arXiv announcement dates: ${result.refreshed_dates.join(", ")}`);
  } else {
    console.log(`skipped arXiv discovery through ${result.announcement_date}: ${result.reason}`);
  }
  if (result.pending_dates.length > 0)
    console.log(`catch-up remains pending: ${result.pending_dates.join(", ")}`);
  if (result.failed_dates.length > 0)
    console.log(`catch-up failed and remains retryable: ${result.failed_dates.join(", ")}`);
  // arXiv Thu 20:00 ET batch arrives on Friday morning BJT, which is the final daily batch of the academic week.
  const isEndOfWeekBatch = result.payload?.window?.announcement_weekday === "Thu";
  const shouldWeekly =
    result.status === "refreshed" &&
    (hasFlag(args, "--weekly") || (hasFlag(args, "--auto-weekly") && isEndOfWeekBatch)) &&
    hasCredentials;
  if (shouldWeekly) {
    console.log("[scheduler] 开始自动执行 AI 每周学术脉络总结...");
    const { runWeeklySummary } = await import("./arxiv-weekly-summary.mjs");
    await runWeeklySummary({ feed: output });
  }
}
