import { readFile } from "node:fs/promises";

const APPROVED_DAILY_ARCHIVE = new URL("../fixtures/2026-10-04.json", import.meta.url);

/** Read the real source-bound archive used to approve the 2026-10-04 title. */
export async function approvedDailyTitleFixture() {
  const archive = JSON.parse(await readFile(APPROVED_DAILY_ARCHIVE, "utf8"));
  if (archive.date !== "2026-10-04" || archive.feed?.window?.announcement_date !== archive.date) {
    throw new Error("APPROVED_DAILY_TITLE_FIXTURE_SOURCE_MISSING");
  }
  return archive;
}
