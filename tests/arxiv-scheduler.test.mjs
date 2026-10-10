import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_QUERY } from "../scripts/arxiv-daily.mjs";
import {
  latestCompletedAnnouncementDate,
  runScheduledArxivRefresh,
  assertContinuousBatchIntervals,
  reconcilePreviousEdition,
} from "../scripts/arxiv-daily-scheduler.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function atomEntry({
  id = "2609.00001v1",
  title = "A test paper",
  published,
  category = "astro-ph.HE",
}) {
  return `<entry><id>https://arxiv.org/abs/${id}</id><title>${title}</title><summary>A deterministic test abstract.</summary><published>${published}</published><updated>${published}</updated><author><name>Test Author</name></author><category term="${category}"/><arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="${category}"/></entry>`;
}

function atomFeed(entry) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1"><title>arXiv Query</title><opensearch:totalResults>1</opensearch:totalResults><opensearch:startIndex>0</opensearch:startIndex><opensearch:itemsPerPage>1</opensearch:itemsPerPage>${entry}</feed>`;
}

function fakePayload(date) {
  return {
    window: {
      announcement_date: date,
      announcement_weekday: "Sun",
      batch_id: `announcement-${date}`,
    },
    entries: [{ arxiv_id: "2609.00001", revision: 1, title: "Fixture", abstract: "Abstract" }],
  };
}

async function writeFakeEdition(path, date) {
  const payload = fakePayload(date);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload)}\n`);
  return payload;
}

test("Sunday catch-up discovers real 2609.12308 metadata through the default query", async () => {
  assert.match(DEFAULT_QUERY, /cat:astro-ph\.SR/u);
  assert.equal(
    latestCompletedAnnouncementDate({ now: new Date("2026-09-14T01:00:00Z") }),
    "2026-09-13"
  );

  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-sunday-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const calls = [];
  const realMetadata = atomEntry({
    id: "2609.12308v1",
    title: "Electromagnetic Probes of the Supernova Engine",
    published: "2026-09-11T00:23:30Z",
  });
  try {
    const result = await runScheduledArxivRefresh({
      output,
      artifactRoot,
      now: new Date("2026-09-14T01:00:00Z"),
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async (url) => {
        const search = new URL(url).searchParams.get("search_query");
        calls.push(search);
        return new Response(atomFeed(realMetadata), {
          status: 200,
          headers: { "content-type": "application/atom+xml" },
        });
      },
      archiveImpl: async () => {},
      analyzeImpl: async () => ({ pending_count: 0 }),
    });
    assert.equal(result.status, "refreshed");
    assert.deepEqual(result.refreshed_dates, ["2026-09-13"]);
    assert.match(calls[0], /cat:astro-ph\.HE OR cat:astro-ph\.GA OR cat:astro-ph\.SR/u);
    assert.match(calls[0], /submittedDate:\[202609101800 TO 202609111800\]/u);
    assert.deepEqual(
      result.payload.entries.map(({ arxiv_id, revision, primary_category }) => [
        arxiv_id,
        revision,
        primary_category,
      ]),
      [["2609.12308", 1, "astro-ph.HE"]]
    );
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith(".lock")),
      []
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an explicit announcement-date refresh returns an empty failed_dates list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-explicit-date-"));
  const output = join(directory, "arxiv-daily.json");
  try {
    const result = await runScheduledArxivRefresh({
      announcementDate: "2026-09-13",
      output,
      artifactRoot: join(directory, "artifacts"),
      refreshImpl: async ({ announcementDate: date, output: target }) =>
        writeFakeEdition(target, date),
      archiveImpl: async () => {},
    });
    assert.equal(result.status, "refreshed");
    assert.deepEqual(result.refreshed_dates, ["2026-09-13"]);
    assert.deepEqual(result.pending_dates, []);
    assert.deepEqual(result.failed_dates, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("catch-up continues after a failed Sunday gap and keeps it retryable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-gaps-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const refreshCalls = [];
  const archivedFeeds = [];
  const analyzedFeeds = [];
  let failSundayOnce = true;
  const refreshImpl = async (options) => {
    refreshCalls.push({
      date: options.announcementDate,
      output: options.output,
      rejectEmpty: options.rejectEmpty,
    });
    assert.equal(options.rejectEmpty, true);
    if (options.announcementDate === "2026-09-06" && failSundayOnce) {
      failSundayOnce = false;
      throw new Error("temporary API failure");
    }
    return writeFakeEdition(options.output, options.announcementDate);
  };
  const options = {
    output,
    artifactRoot,
    now: new Date("2026-09-08T01:00:00Z"),
    fromDate: "2026-09-06",
    maxBatchesPerRun: 2,
    refreshImpl,
    archiveImpl: async ({ currentFeedPath }) => archivedFeeds.push(currentFeedPath),
    analyzeImpl: async ({ feed, archiveRoot, limit }) => {
      analyzedFeeds.push({ feed, archiveRoot, limit });
      return { pending_count: 0 };
    },
    archiveRoot: join(directory, "archives"),
    analysisLimit: 2,
  };
  try {
    const partial = await runScheduledArxivRefresh(options);
    assert.deepEqual(
      refreshCalls.map(({ date }) => date),
      ["2026-09-06", "2026-09-07"]
    );
    assert.deepEqual(partial.refreshed_dates, ["2026-09-07"]);
    assert.deepEqual(partial.pending_dates, ["2026-09-06"]);
    assert.deepEqual(partial.failed_dates, ["2026-09-06"]);
    assert.equal(partial.status, "refreshed");
    assert.deepEqual(
      JSON.parse(await readFile(join(artifactRoot, "scheduler-ledger.json"), "utf8"))
        .successful_dates,
      ["2026-09-07"]
    );

    const recovered = await runScheduledArxivRefresh(options);
    assert.equal(recovered.status, "skipped");
    assert.deepEqual(
      refreshCalls.map(({ date }) => date),
      ["2026-09-06", "2026-09-07", "2026-09-06"]
    );
    assert.notEqual(refreshCalls[0].output, output);
    assert.equal(refreshCalls[1].output, output);
    assert.notEqual(refreshCalls[2].output, output);
    assert.deepEqual(recovered.refreshed_dates, ["2026-09-06"]);
    assert.deepEqual(recovered.pending_dates, []);
    assert.deepEqual(recovered.failed_dates, []);
    assert.deepEqual(
      JSON.parse(await readFile(join(artifactRoot, "scheduler-ledger.json"), "utf8"))
        .successful_dates,
      ["2026-09-06", "2026-09-07"]
    );
    assert.deepEqual(archivedFeeds.slice(-2), [output, refreshCalls[2].output]);
    assert.deepEqual(
      JSON.parse(await readFile(output, "utf8")).window.announcement_date,
      "2026-09-07"
    );

    const replay = await runScheduledArxivRefresh({
      ...options,
      refreshImpl: async () => {
        throw new Error("completed dates must not be fetched again");
      },
    });
    assert.equal(replay.status, "skipped");
    assert.equal(replay.reason, "already-processed");
    assert.equal(analyzedFeeds.length, 3);
    assert.deepEqual(
      analyzedFeeds.map(({ feed }) => feed),
      [output, output, output]
    );
    assert.deepEqual(
      analyzedFeeds.map(({ limit }) => limit),
      [2, 2, 2]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repeated date failures rotate fairly instead of monopolizing bounded runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-rotation-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const calls = [];
  let analyzeCalls = 0;
  const options = {
    output,
    artifactRoot,
    now: new Date("2026-09-11T02:00:00Z"),
    fromDate: "2026-09-06",
    throughDate: "2026-09-10",
    maxBatchesPerRun: 1,
    refreshImpl: async ({ announcementDate }) => {
      calls.push(announcementDate);
      throw new Error("temporary API failure");
    },
    analyzeImpl: async () => {
      analyzeCalls += 1;
    },
    archiveImpl: async () => {},
  };
  try {
    const runs = [];
    for (let attempt = 0; attempt < 3; attempt += 1)
      runs.push(await runScheduledArxivRefresh(options));
    assert.deepEqual(calls, ["2026-09-06", "2026-09-07", "2026-09-08"]);
    assert.deepEqual(
      runs.map(({ failed_dates }) => failed_dates),
      [["2026-09-06"], ["2026-09-06", "2026-09-07"], ["2026-09-06", "2026-09-07", "2026-09-08"]]
    );
    assert.deepEqual(runs[2].pending_dates, [
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
    ]);
    assert.equal(
      analyzeCalls,
      0,
      "a first-run bounded catch-up without a primary feed must not invoke the analyzer"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("moving catch-up bounds interleave retries with newly arriving dates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-moving-bound-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const calls = [];
  const throughDates = [
    "2026-09-06",
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
    "2026-09-13",
  ];
  try {
    for (const throughDate of throughDates) {
      await runScheduledArxivRefresh({
        output,
        artifactRoot,
        now: new Date("2026-09-14T01:00:00Z"),
        fromDate: "2026-09-06",
        throughDate,
        maxBatchesPerRun: 1,
        refreshImpl: async ({ announcementDate }) => {
          calls.push(announcementDate);
          throw new Error("temporary API failure");
        },
        archiveImpl: async () => {},
      });
    }
    assert.deepEqual(calls, [
      "2026-09-06",
      "2026-09-06",
      "2026-09-07",
      "2026-09-06",
      "2026-09-08",
      "2026-09-07",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("historical-only first catch-up preserves its archive edition without analyzing a missing primary feed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-historical-only-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const archivedFeeds = [];
  let analyzeCalls = 0;
  try {
    const result = await runScheduledArxivRefresh({
      output,
      artifactRoot,
      archiveRoot: join(directory, "archives"),
      now: new Date("2026-09-11T02:00:00Z"),
      fromDate: "2026-09-06",
      throughDate: "2026-09-10",
      maxBatchesPerRun: 1,
      refreshImpl: async (options) => writeFakeEdition(options.output, options.announcementDate),
      archiveImpl: async ({ currentFeedPath }) => archivedFeeds.push(currentFeedPath),
      analyzeImpl: async () => {
        analyzeCalls += 1;
      },
    });
    assert.deepEqual(result.refreshed_dates, ["2026-09-06"]);
    assert.deepEqual(result.pending_dates, [
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
    ]);
    assert.equal(result.payload, null);
    assert.equal(result.active_is_current, false);
    assert.equal(analyzeCalls, 0);
    assert.deepEqual(archivedFeeds, [
      join(artifactRoot, "catch-up", "2026-09-06", "arxiv-daily.json"),
    ]);
    assert.equal(
      await readFile(join(artifactRoot, "catch-up", "2026-09-06", "arxiv-daily.json"), "utf8").then(
        () => true
      ),
      true
    );
    await assert.rejects(readFile(output, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an empty result is not recorded as success and leaves the active edition untouched", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-empty-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const lastGood = `{"window":{"announcement_date":"2026-09-06"},"entries":[{"arxiv_id":"old"}]}\n`;
  try {
    await writeFile(output, lastGood);
    const result = await runScheduledArxivRefresh({
      output,
      artifactRoot,
      now: new Date("2026-09-08T01:00:00Z"),
      refreshImpl: async ({ rejectEmpty }) => {
        assert.equal(rejectEmpty, true);
        return { window: { announcement_date: "2026-09-07" }, entries: [] };
      },
      archiveImpl: async () => {},
    });
    assert.deepEqual(result.refreshed_dates, []);
    assert.deepEqual(result.pending_dates, ["2026-09-07"]);
    assert.deepEqual(result.failed_dates, ["2026-09-07"]);
    assert.equal(await readFile(output, "utf8"), lastGood);
    assert.deepEqual(
      JSON.parse(await readFile(join(artifactRoot, "scheduler-ledger.json"), "utf8"))
        .successful_dates,
      []
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("catch-up validates explicit bounds and refuses future dates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-bounds-"));
  const options = {
    output: join(directory, "feed.json"),
    artifactRoot: join(directory, "artifacts"),
    now: new Date("2026-09-14T01:00:00Z"),
  };
  try {
    await assert.rejects(
      runScheduledArxivRefresh({ ...options, fromDate: "2026-09-08", throughDate: "2026-09-07" }),
      /on or before/u
    );
    await assert.rejects(
      runScheduledArxivRefresh({ ...options, fromDate: "2026-02-30" }),
      /valid YYYY-MM-DD/u
    );
    await assert.rejects(
      runScheduledArxivRefresh({ ...options, throughDate: "2026-09-14" }),
      /later than the latest completed/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a query-scope change reopens dates completed under the older category set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-scope-"));
  const output = join(directory, "feed.json");
  const artifactRoot = join(directory, "artifacts");
  const queries = [];
  const base = {
    output,
    artifactRoot,
    now: new Date("2026-09-14T01:00:00Z"),
    fromDate: "2026-09-13",
    archiveImpl: async () => {},
    refreshImpl: async (options) => {
      queries.push(options.query);
      return writeFakeEdition(options.output, options.announcementDate);
    },
  };
  try {
    await runScheduledArxivRefresh({ ...base, query: "cat:astro-ph.HE OR cat:astro-ph.GA" });
    await runScheduledArxivRefresh({
      ...base,
      query: "cat:astro-ph.HE OR cat:astro-ph.GA OR cat:astro-ph.SR",
    });
    assert.deepEqual(queries, [
      "cat:astro-ph.HE OR cat:astro-ph.GA",
      "cat:astro-ph.HE OR cat:astro-ph.GA OR cat:astro-ph.SR",
    ]);
    const ledger = JSON.parse(await readFile(join(artifactRoot, "scheduler-ledger.json"), "utf8"));
    assert.equal(ledger.scope, "cat:astro-ph.HE OR cat:astro-ph.GA OR cat:astro-ph.SR");
    assert.deepEqual(ledger.successful_dates, ["2026-09-13"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy run state is retried from its last successful date after query scope expands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-legacy-"));
  const output = join(directory, "feed.json");
  const artifactRoot = join(directory, "artifacts");
  const refreshCalls = [];
  try {
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(
      join(artifactRoot, "run-state.json"),
      JSON.stringify({
        schema_version: "arxiv-daily-run-state-v1",
        status: "success",
        last_success: {
          query: "cat:astro-ph.HE OR cat:astro-ph.GA",
          window: { announcement_date: "2026-09-10", batch_id: "announcement-2026-09-10" },
        },
      })
    );
    const result = await runScheduledArxivRefresh({
      output,
      artifactRoot,
      query: DEFAULT_QUERY,
      now: new Date("2026-09-14T01:00:00Z"),
      refreshImpl: async (options) => {
        refreshCalls.push({ date: options.announcementDate, query: options.query });
        return writeFakeEdition(options.output, options.announcementDate);
      },
      archiveImpl: async () => {},
    });
    assert.deepEqual(
      refreshCalls.map(({ date }) => date),
      ["2026-09-10", "2026-09-13"]
    );
    assert.deepEqual(
      refreshCalls.map(({ query }) => query),
      [DEFAULT_QUERY, DEFAULT_QUERY]
    );
    assert.deepEqual(result.pending_dates, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("systemd runs the shared scheduler after the Sunday-through-Thursday announcement time", async () => {
  const service = await readFile(
    join(projectRoot, "deploy/systemd/astrolineage-arxiv-daily.service"),
    "utf8"
  );
  const timer = await readFile(
    join(projectRoot, "deploy/systemd/astrolineage-arxiv-daily.timer"),
    "utf8"
  );
  assert.match(service, /Type=oneshot/u);
  assert.match(service, /ExecStart=.*scripts\/arxiv-daily-scheduler\.mjs/u);
  assert.doesNotMatch(service, /(?:astro build|npm run build)/u);
  assert.match(timer, /OnCalendar=Sun \*-\*-\* 20:30:00 America\/New_York/u);
  assert.match(timer, /OnCalendar=Mon\.\.Thu \*-\*-\* 20:30:00 America\/New_York/u);
  assert.match(timer, /Persistent=true/u);
  assert.match(timer, /RandomizedDelaySec=15m/u);
});

test("assertContinuousBatchIntervals verifies interval continuity and rejects gaps", () => {
  const previousFeed = {
    window: { submitted_date_range: { from: "202610071800", to: "202610081800" } },
    entries: [{ arxiv_id: "2610.00001", published: "2026-10-07T19:00:00Z" }],
  };
  const continuousFeed = {
    window: { submitted_date_range: { from: "202610081800", to: "202610091800" } },
    entries: [{ arxiv_id: "2610.12359", published: "2026-10-08T19:00:00Z" }],
  };
  assert.doesNotThrow(() => assertContinuousBatchIntervals(continuousFeed, previousFeed));

  const gappedFeed = {
    window: { submitted_date_range: { from: "202610082000", to: "202610091800" } },
    entries: [{ arxiv_id: "2610.12359", published: "2026-10-08T21:00:00Z" }],
  };
  assert.throws(
    () => assertContinuousBatchIntervals(gappedFeed, previousFeed),
    /BATCH_TIME_GAP_DETECTED/u
  );
});

test("reconcilePreviousEdition detects new upstream entries and updates feed and ledger", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-reconcile-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const archiveRoot = join(directory, "archives");
  const date = "2026-10-08";

  await mkdir(archiveRoot, { recursive: true });
  await writeFakeEdition(output, date);
  await writeFile(
    join(archiveRoot, `${date}.json`),
    JSON.stringify({ date, feed: fakePayload(date) })
  );

  try {
    const result = await reconcilePreviousEdition({
      announcementDate: date,
      output,
      artifactRoot,
      archiveRoot,
      refreshImpl: async () => ({
        window: { announcement_date: date, batch_id: `announcement-${date}` },
        entries: [
          { arxiv_id: "2609.00001", revision: 1, title: "Initial" },
          { arxiv_id: "2610.12359", revision: 1, title: "Funnel Leakage of the Wien Fireball" },
        ],
      }),
      analyzeImpl: async () => ({ pending_count: 0 }),
    });

    assert.equal(result.status, "reconciled");
    assert.equal(result.newly_added, 1);
    assert.equal(result.total_entries, 2);
    assert.equal(result.finalized, true);

    const updated = JSON.parse(await readFile(output, "utf8"));
    assert.equal(updated.entries.length, 2);
    assert.ok(updated.entries.some((e) => e.arxiv_id === "2610.12359"));

    const ledger = JSON.parse(await readFile(join(artifactRoot, "scheduler-ledger.json"), "utf8"));
    assert.deepEqual(ledger.finalized_dates, [date]);
    assert.ok(
      !ledger.provisional_dates?.includes(date),
      "Date must not remain provisional after finalization"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runScheduledArxivRefresh records provisional status before finalization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-provisional-"));
  const output = join(directory, "feed.json");
  const artifactRoot = join(directory, "artifacts");
  const date = "2026-10-08";

  try {
    await runScheduledArxivRefresh({
      announcementDate: date,
      output,
      artifactRoot,
      refreshImpl: async (options) => writeFakeEdition(options.output, options.announcementDate),
      analyzeImpl: async () => ({ pending_count: 0 }),
    });

    const ledger = JSON.parse(await readFile(join(artifactRoot, "scheduler-ledger.json"), "utf8"));
    assert.ok(
      ledger.provisional_dates?.includes(date),
      "Scheduled refresh must mark date as provisional"
    );
    assert.ok(
      !ledger.finalized_dates?.includes(date),
      "Scheduled refresh must not mark date as finalized"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
