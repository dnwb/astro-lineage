import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ArxivFeedError,
  buildAnnouncementWindow,
  isArxivHoliday,
  isScheduledAnnouncementDate,
} from "../scripts/arxiv-daily.mjs";

test("arxiv-window: Veterans Day 2026-11-11 and Thanksgiving 2026-11-26 shift next announcement window", () => {
  assert.equal(isArxivHoliday("2026-11-11"), true);
  assert.equal(isScheduledAnnouncementDate("2026-11-11"), false);
  assert.throws(
    () => buildAnnouncementWindow({ announcementDate: "2026-11-11" }),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_WINDOW_INVALID"
  );

  const nov12 = buildAnnouncementWindow({ announcementDate: "2026-11-12" });
  assert.equal(nov12.submission_start_date, "2026-11-10");
  assert.equal(nov12.submission_end_date, "2026-11-12");
  assert.equal(nov12.api_start, "202611101900");
  assert.equal(nov12.api_end, "202611121900");

  assert.throws(
    () => buildAnnouncementWindow({ announcementDate: "2026-11-26" }),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_WINDOW_INVALID"
  );
  assert.throws(
    () => buildAnnouncementWindow({ announcementDate: "2026-11-27" }),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_WINDOW_INVALID"
  );
  const nov29 = buildAnnouncementWindow({ announcementDate: "2026-11-29" });
  assert.equal(nov29.submission_start_date, "2026-11-25");
  assert.equal(nov29.submission_end_date, "2026-11-27");
  assert.equal(nov29.api_start, "202611251900");
  assert.equal(nov29.api_end, "202611271900");
});

test("arxiv-window: 2027 holidays keep consecutive batches contiguous across DST and holidays", () => {
  const jan17 = buildAnnouncementWindow({ announcementDate: "2027-01-17" });
  assert.throws(
    () => buildAnnouncementWindow({ announcementDate: "2027-01-18" }),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_WINDOW_INVALID"
  );
  const jan19 = buildAnnouncementWindow({ announcementDate: "2027-01-19" });
  assert.equal(jan17.utc_end, jan19.utc_start);
  assert.equal(jan19.submission_start_date, "2027-01-15");
  assert.equal(jan19.submission_end_date, "2027-01-19");
});
