import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  ANNOUNCEMENT_LOCAL_TIME,
  ANNOUNCEMENT_WEEKDAYS,
  DEFAULT_ARTIFACT_ROOT,
  DEFAULT_OUTPUT,
  DEFAULT_TIME_ZONE,
  readArxivRunState,
  refreshArxivFeed,
} from "./arxiv-daily.mjs";

const ANNOUNCEMENT_HOUR = Number(ANNOUNCEMENT_LOCAL_TIME.slice(0, 2));

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
  return Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

function dateText(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addCalendarDay(dateOnly, amount) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function weekdayForDate(dateOnly, timeZone) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function isScheduledDate(dateOnly, timeZone) {
  return ANNOUNCEMENT_WEEKDAYS.includes(weekdayForDate(dateOnly, timeZone));
}

function previousScheduledDate(dateOnly, timeZone) {
  let candidate = addCalendarDay(dateOnly, -1);
  while (!isScheduledDate(candidate, timeZone)) candidate = addCalendarDay(candidate, -1);
  return candidate;
}

export function latestCompletedAnnouncementDate({ now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new Error("scheduler now must be a valid Date");
  const parts = localParts(now, timeZone);
  const date = dateText(parts);
  const weekday = weekdayForDate(date, timeZone);
  if (ANNOUNCEMENT_WEEKDAYS.includes(weekday) && parts.hour >= ANNOUNCEMENT_HOUR) return date;
  return previousScheduledDate(date, timeZone);
}

export function isAnnouncementDate({ announcementDate, timeZone = DEFAULT_TIME_ZONE } = {}) {
  return isScheduledDate(announcementDate, timeZone);
}

function lastSuccessDate(state) {
  const windowDate = state?.last_success?.window?.announcement_date;
  if (typeof windowDate === "string") return windowDate;
  const match = state?.last_success?.window?.batch_id?.match(/^announcement-(\d{4}-\d{2}-\d{2})$/u);
  return match?.[1] ?? null;
}

async function stateForOutput({ output, artifactRoot }) {
  const target = resolve(output ?? DEFAULT_OUTPUT);
  const root = artifactRoot === undefined
    ? (target === resolve(DEFAULT_OUTPUT) ? DEFAULT_ARTIFACT_ROOT : null)
    : artifactRoot;
  return root === null ? null : readArxivRunState({ artifactRoot: root });
}

export async function runScheduledArxivRefresh({
  now = new Date(),
  announcementDate,
  timeZone = DEFAULT_TIME_ZONE,
  artifactRoot,
  ...refreshOptions
} = {}) {
  const explicitDate = announcementDate !== undefined;
  const selectedDate = explicitDate
    ? announcementDate
    : latestCompletedAnnouncementDate({ now, timeZone });
  const state = await stateForOutput({ output: refreshOptions.output, artifactRoot });
  if (!explicitDate && state?.status === "success" && lastSuccessDate(state) >= selectedDate) {
    return {
      status: "skipped",
      reason: "already-processed",
      announcement_date: selectedDate,
      time_zone: timeZone,
    };
  }
  const payload = await refreshArxivFeed({
    ...refreshOptions,
    ...(artifactRoot === undefined ? {} : { artifactRoot }),
    announcementDate: selectedDate,
    now,
    timeZone,
  });
  return { status: "refreshed", payload };
}

function cliOutput(args) {
  const value = args.find((argument) => argument.startsWith("--output="));
  return value ? value.slice("--output=".length) : DEFAULT_OUTPUT;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = await runScheduledArxivRefresh({ output: cliOutput(process.argv.slice(2)) });
  if (result.status === "skipped") {
    console.log(`skipped arXiv refresh for ${result.announcement_date}: batch already processed`);
  } else {
    console.log(`wrote ${result.payload.entries.length} arXiv entries for ${result.payload.window.batch_id}`);
  }
}
