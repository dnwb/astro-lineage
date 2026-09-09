import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { tmpdir } from "node:os";
import {
  ArxivFeedError,
  buildAnnouncementWindow,
  feedUrl,
  parseArxivFeed,
  readArxivRunState,
  readPublishedArxivEdition,
  readPublishedFileSet,
  replayArxivSnapshot,
  refreshArxivFeed,
} from "../scripts/arxiv-daily.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("the daily arXiv feed parser preserves identifiers, dates, authors and abstracts", () => {
  const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2608.12217v1</id><title> A paper &amp; its result </title><summary> A short abstract. </summary><published>2026-08-12T00:00:00Z</published><updated>2026-08-13T00:00:00Z</updated><author><name>Wei-Cheng Long</name></author><link href="http://arxiv.org/abs/2608.12217v1" rel="alternate" type="text/html"/></entry></feed>`;
  assert.deepEqual(parseArxivFeed(feed), [{
    arxiv_id: "2608.12217",
    revision: 1,
    title: "A paper & its result",
    abstract: "A short abstract.",
    published: "2026-08-12T00:00:00Z",
    updated: "2026-08-13T00:00:00Z",
    authors: ["Wei-Cheng Long"],
    url: "https://arxiv.org/abs/2608.12217v1",
  }]);
});

test("the parser handles legacy identifiers, CDATA and the HTML alternate link", () => {
  const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>https://arxiv.org/abs/astro-ph/9901234v2</id><title><![CDATA[An older <result>]]></title><summary><![CDATA[Text with <tag> preserved as text.]]></summary><published>1999-01-02T00:00:00Z</published><updated>1999-02-03T00:00:00Z</updated><author><name>A. Researcher</name></author><link href="https://arxiv.org/pdf/astro-ph/9901234v2.pdf" rel="related" type="application/pdf"/><link href="http://arxiv.org/abs/astro-ph/9901234v2" rel="alternate" type="text/html"/><category term="astro-ph.HE"/><arxiv:primary_category term="astro-ph.HE"/></entry></feed>`;

  assert.deepEqual(parseArxivFeed(feed), [{
    arxiv_id: "astro-ph/9901234",
    revision: 2,
    title: "An older <result>",
    abstract: "Text with <tag> preserved as text.",
    published: "1999-01-02T00:00:00Z",
    updated: "1999-02-03T00:00:00Z",
    authors: ["A. Researcher"],
    url: "https://arxiv.org/abs/astro-ph/9901234v2",
    categories: ["astro-ph.HE"],
    primary_category: "astro-ph.HE",
  }]);
});

test("the parser derives a missing entry revision from one explicit versioned HTML link", () => {
  const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/0704.0001</id><title>A legacy API shape</title><summary>An abstract.</summary><published>2007-04-01T00:00:00Z</published><updated>2007-04-01T00:00:00Z</updated><author><name>A. Researcher</name></author><link href="https://arxiv.org/pdf/0704.0001v1.pdf" rel="related" type="application/pdf"/><link href="https://arxiv.org/abs/0704.0001v1" rel="alternate" type="text/html"/></entry></feed>`;

  assert.deepEqual(parseArxivFeed(feed), [{
    arxiv_id: "0704.0001",
    revision: 1,
    title: "A legacy API shape",
    abstract: "An abstract.",
    published: "2007-04-01T00:00:00Z",
    updated: "2007-04-01T00:00:00Z",
    authors: ["A. Researcher"],
    url: "https://arxiv.org/abs/0704.0001v1",
  }]);
});

test("the parser rejects conflicting explicit revisions and never publishes a PDF as the abstract URL", () => {
  const conflicting = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/0704.0002</id><title>Conflicting versions</title><summary>An abstract.</summary><published>2007-04-01T00:00:00Z</published><updated>2007-04-01T00:00:00Z</updated><author><name>A. Researcher</name></author><link href="https://arxiv.org/abs/0704.0002v1" rel="alternate" type="text/html"/><link href="https://arxiv.org/src/0704.0002v2" rel="related" type="application/x-eprint-tar"/></entry></feed>`;
  assert.throws(
    () => parseArxivFeed(conflicting),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_ENTRY_REVISION_CONFLICT",
  );

  const pdfOnly = conflicting
    .replace("0704.0002v1\" rel=\"alternate\" type=\"text/html", "0704.0002v1\" rel=\"related\" type=\"application/pdf")
    .replace("https://arxiv.org/src/0704.0002v2\" rel=\"related\" type=\"application/x-eprint-tar\"", "https://arxiv.org/pdf/0704.0002v1.pdf\" rel=\"related\" type=\"application/pdf\"");
  assert.equal(parseArxivFeed(pdfOnly)[0].url, "https://arxiv.org/abs/0704.0002v1");
});

test("an announcement batch uses the previous announcement cutoff and DST-aware API times", () => {
  const winter = buildAnnouncementWindow({ announcementDate: "2026-01-12" });
  assert.equal(winter.time_zone, "America/New_York");
  assert.equal(winter.kind, "announcement_batch");
  assert.equal(winter.batch_id, "announcement-2026-01-12");
  assert.equal(winter.submission_start_date, "2026-01-09");
  assert.equal(winter.submission_end_date, "2026-01-12");
  assert.equal(winter.local_start, "2026-01-09T14:00:00-05:00");
  assert.equal(winter.local_end, "2026-01-12T14:00:00-05:00");
  assert.equal(winter.utc_start, "2026-01-09T19:00:00.000Z");
  assert.equal(winter.utc_end, "2026-01-12T19:00:00.000Z");
  assert.equal(winter.api_start, "202601091900");
  assert.equal(winter.api_end, "202601121900");

  const summer = buildAnnouncementWindow({ announcementDate: "2026-09-07" });
  assert.equal(summer.submission_start_date, "2026-09-04");
  assert.equal(summer.local_start, "2026-09-04T14:00:00-04:00");
  assert.equal(summer.local_end, "2026-09-07T14:00:00-04:00");
  assert.equal(summer.api_start, "202609041800");
  assert.equal(summer.api_end, "202609071800");

  const sunday = buildAnnouncementWindow({ announcementDate: "2026-09-06" });
  assert.equal(sunday.submission_start_date, "2026-09-03");
  assert.equal(sunday.local_start, "2026-09-03T14:00:00-04:00");
  assert.equal(sunday.submission_end_date, "2026-09-04");
  assert.equal(sunday.local_end, "2026-09-04T14:00:00-04:00");
  assert.equal(sunday.api_start, "202609031800");
  assert.equal(sunday.api_end, "202609041800");

  const dstWeekend = buildAnnouncementWindow({ announcementDate: "2026-03-09" });
  assert.equal(dstWeekend.local_start, "2026-03-06T14:00:00-05:00");
  assert.equal(dstWeekend.local_end, "2026-03-09T14:00:00-04:00");
  assert.equal(dstWeekend.utc_start, "2026-03-06T19:00:00.000Z");
  assert.equal(dstWeekend.utc_end, "2026-03-09T18:00:00.000Z");

  const expectedBatches = [
    ["2026-09-06", "2026-09-03", "2026-09-04"],
    ["2026-09-07", "2026-09-04", "2026-09-07"],
    ["2026-09-08", "2026-09-07", "2026-09-08"],
    ["2026-09-09", "2026-09-08", "2026-09-09"],
    ["2026-09-10", "2026-09-09", "2026-09-10"],
  ];
  const windows = expectedBatches.map(([date]) => buildAnnouncementWindow({ announcementDate: date }));
  assert.deepEqual(windows.map(({ submission_start_date, submission_end_date }) => [submission_start_date, submission_end_date]), expectedBatches.map(([, start, end]) => [start, end]));
  for (let index = 1; index < windows.length; index += 1) {
    assert.equal(windows[index - 1].utc_end, windows[index].utc_start, "连续公告批次必须首尾相接");
  }

  const url = new URL(feedUrl({
    query: `(${"cat:astro-ph.HE OR cat:astro-ph.GA"}) AND submittedDate:[${summer.api_start} TO ${summer.api_end}]`,
    maxResults: 2000,
    start: 4000,
  }));
  assert.equal(url.searchParams.get("start"), "4000");
  assert.equal(url.searchParams.get("max_results"), "2000");
  assert.equal(url.searchParams.get("sortBy"), "submittedDate");
  assert.match(url.searchParams.get("search_query"), /submittedDate:\[202609041800 TO 202609071800\]/u);

  assert.throws(
    () => buildAnnouncementWindow({ announcementDate: "2026-09-11" }),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_WINDOW_INVALID",
  );
  assert.throws(
    () => buildAnnouncementWindow({ announcementDate: "2026-09-12" }),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_WINDOW_INVALID",
  );
});

function atomFeed(entries = "", title = "arXiv Query") {
  const entryCount = (entries.match(/<entry\b/gu) ?? []).length;
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><title>${title}</title><opensearch:totalResults>${entryCount}</opensearch:totalResults><opensearch:startIndex>0</opensearch:startIndex><opensearch:itemsPerPage>${entryCount}</opensearch:itemsPerPage>${entries}</feed>`;
}

function atomEntry(id = "2609.00001v1", published = "2026-09-07T12:00:00Z") {
  return `<entry><id>https://arxiv.org/abs/${id}</id><title>A title</title><summary>An abstract.</summary><published>${published}</published><updated>${published}</updated><author><name>A. Researcher</name></author><link href="https://arxiv.org/abs/${id}" rel="alternate" type="text/html"/></entry>`;
}

function atomPagedFeed(entries, { totalResults, startIndex, itemsPerPage }) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><title>arXiv Query</title><opensearch:totalResults>${totalResults}</opensearch:totalResults><opensearch:startIndex>${startIndex}</opensearch:startIndex><opensearch:itemsPerPage>${itemsPerPage}</opensearch:itemsPerPage>${entries}</feed>`;
}

function atomResponse(body, status = 200, contentType = "application/atom+xml") {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

async function publishedGenerationFile(artifactRoot, target) {
  const pointer = JSON.parse(await readFile(join(artifactRoot, "current-generation.json"), "utf8"));
  const record = pointer.files.find((file) => file.target === target);
  assert.ok(record, `published generation must contain ${target}`);
  return join(artifactRoot, pointer.generation_path, record.path);
}

test("a valid empty Atom feed is publishable, while invalid responses preserve the old cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-"));
  const output = join(directory, "arxiv-daily.json");
  const oldCache = '{"generated_at":"old","entries":[{"arxiv_id":"old"}]}\n';
  await writeFile(output, oldCache, "utf8");
  try {
    await assert.rejects(
      refreshArxivFeed({ output, maxAttempts: 1, fetchImpl: async () => atomResponse("upstream error", 200, "text/html") }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_RESPONSE_NOT_XML",
    );
    assert.equal(await readFile(output, "utf8"), oldCache);

    await assert.rejects(
      refreshArxivFeed({ output, maxAttempts: 1, fetchImpl: async () => atomResponse("<feed><entry>") }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_XML_INVALID",
    );
    assert.equal(await readFile(output, "utf8"), oldCache);
    assert.deepEqual(await readdir(directory), ["arxiv-daily.json"]);

    const payload = await refreshArxivFeed({
      output,
      now: new Date("2026-09-08T00:00:00Z"),
      maxAttempts: 1,
      fetchImpl: async () => atomResponse(atomFeed()),
    });
    assert.deepEqual(payload.entries, []);
    assert.equal(payload.generated_at, "2026-09-08T00:00:00.000Z");
    assert.equal(payload.total_results, 0);
    assert.match(payload.response_sha256, /^[a-f0-9]{64}$/u);
    assert.match(await readFile(output, "utf8"), /"parser_version": "2026-09-08\.atom-v2"/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a refresh rejects a page without complete Atom pagination metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-pagination-contract-"));
  const output = join(directory, "arxiv-daily.json");
  try {
    await assert.rejects(
      refreshArxivFeed({
        output,
        maxAttempts: 1,
        minRequestIntervalMs: 0,
        fetchImpl: async () => atomResponse(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>arXiv Query</title>${atomEntry()}</feed>`),
      }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_PAGINATION_INVALID",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refresh retries temporary API failures and honors Retry-After", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-"));
  const output = join(directory, "arxiv-daily.json");
  const delays = [];
  let attempts = 0;
  try {
    const payload = await refreshArxivFeed({
      output,
      announcementDate: "2026-09-07",
      maxAttempts: 3,
      minRequestIntervalMs: 0,
      sleepImpl: async (delay) => delays.push(delay),
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? new Response("busy", { status: 429, headers: { "content-type": "application/atom+xml", "retry-after": "2" } })
          : atomResponse(atomFeed(atomEntry()));
      },
    });
    assert.equal(attempts, 2);
    assert.deepEqual(delays, [2000]);
    assert.equal(payload.entries[0].arxiv_id, "2609.00001");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("every retry request passes the shared rate gate and a long Retry-After exceeds the deadline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-"));
  const output = join(directory, "arxiv-daily.json");
  const delays = [];
  let attempts = 0;
  try {
    await assert.rejects(
      refreshArxivFeed({
        output,
        totalTimeoutMs: 10_000,
        minRequestIntervalMs: 3_000,
        maxAttempts: 2,
        sleepImpl: async (delay) => delays.push(delay),
        fetchImpl: async () => {
          attempts += 1;
          return new Response("busy", {
            status: 503,
            headers: { "content-type": "application/atom+xml", "retry-after": "120" },
          });
        },
      }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_REQUEST_TIMEOUT",
    );
    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);

    attempts = 0;
    delays.length = 0;
    const payload = await refreshArxivFeed({
      output,
      totalTimeoutMs: 10_000,
      minRequestIntervalMs: 3_000,
      maxAttempts: 2,
      sleepImpl: async (delay) => delays.push(delay),
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? new Response("busy", { status: 503, headers: { "content-type": "application/atom+xml", "retry-after": "0.5" } })
          : atomResponse(atomFeed());
      },
    });
    assert.deepEqual(payload.entries, []);
    assert.equal(attempts, 2);
    assert.ok(delays.some((delay) => delay >= 500 && delay <= 501));
    assert.ok(delays.some((delay) => delay >= 2_900));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("request timeout starts after the shared rate gate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-request-timeout-"));
  const output = join(directory, "arxiv-daily.json");
  const calls = [];
  const pages = new Map([
    ["0", atomPagedFeed(atomEntry("2609.00015v1"), { totalResults: 2, startIndex: 0, itemsPerPage: 1 })],
    ["1", atomPagedFeed(atomEntry("2609.00016v1"), { totalResults: 2, startIndex: 1, itemsPerPage: 1 })],
  ]);
  try {
    const payload = await refreshArxivFeed({
      output,
      announcementDate: "2026-09-07",
      pageSize: 1,
      timeoutMs: 5,
      totalTimeoutMs: 1_000,
      minRequestIntervalMs: 25,
      maxAttempts: 1,
      fetchImpl: async (url, { signal }) => {
        calls.push({ start: new URL(url).searchParams.get("start"), aborted: signal.aborted });
        if (signal.aborted) {
          const error = new Error("request started with an expired signal");
          error.name = "AbortError";
          throw error;
        }
        const start = new URL(url).searchParams.get("start");
        return atomResponse(pages.get(start));
      },
    });
    assert.deepEqual(calls, [
      { start: "0", aborted: false },
      { start: "1", aborted: false },
    ]);
    assert.equal(payload.entries.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a daily refresh paginates the complete announcement-day window before publishing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-"));
  const output = join(directory, "arxiv-daily.json");
  const calls = [];
  const pages = new Map([
    ["0", atomPagedFeed(`${atomEntry("2609.00010v1")}${atomEntry("2609.00011v1")}`, { totalResults: 3, startIndex: 0, itemsPerPage: 2 })],
    ["2", atomPagedFeed(atomEntry("2609.00012v1"), { totalResults: 3, startIndex: 2, itemsPerPage: 1 })],
  ]);
  try {
    const payload = await refreshArxivFeed({
      output,
      announcementDate: "2026-09-07",
      pageSize: 2,
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        calls.push(parsed.searchParams.get("start"));
        return atomResponse(pages.get(parsed.searchParams.get("start")));
      },
    });
    assert.deepEqual(calls, ["0", "2"]);
    assert.deepEqual(payload.entries.map(({ arxiv_id }) => arxiv_id), ["2609.00010", "2609.00011", "2609.00012"]);
    assert.equal(payload.total_results, 3);
    assert.equal(payload.page_count, 2);
    assert.equal(payload.window.announcement_date, "2026-09-07");
    assert.equal(payload.window.time_zone, "America/New_York");
    assert.match(payload.query, /submittedDate:\[202609041800 TO 202609071800\]/u);
    assert.equal(payload.pages.length, 2);
    assert.deepEqual(payload.pages.map(({ start, entry_count }) => [start, entry_count]), [[0, 2], [2, 1]]);
    assert.ok(payload.pages.every(({ response_sha256 }) => /^[a-f0-9]{64}$/u.test(response_sha256)));
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")).entries, payload.entries);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("announcement windows use an inclusive start and exclusive end at the public reader seam", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-half-open-"));
  const output = join(directory, "arxiv-daily.json");
  try {
    const payload = await refreshArxivFeed({
      output,
      announcementDate: "2026-09-07",
      maxAttempts: 1,
      minRequestIntervalMs: 0,
      fetchImpl: async () => atomResponse(atomFeed([
        atomEntry("2609.00015v1", "2026-09-04T18:00:00Z"),
        atomEntry("2609.00016v1", "2026-09-07T17:59:59Z"),
        atomEntry("2609.00017v1", "2026-09-07T18:00:00Z"),
      ].join(""))),
    });
    assert.deepEqual(payload.entries.map(({ arxiv_id }) => arxiv_id), ["2609.00015", "2609.00016"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a later page failure preserves the previous edition and does not publish a partial window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-"));
  const output = join(directory, "arxiv-daily.json");
  const oldCache = '{"generated_at":"old","entries":[{"arxiv_id":"old"}]}\n';
  await writeFile(output, oldCache, "utf8");
  let calls = 0;
  try {
    await assert.rejects(
      refreshArxivFeed({
        output,
        announcementDate: "2026-09-07",
        pageSize: 2,
        minRequestIntervalMs: 0,
        maxAttempts: 1,
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return atomResponse(atomPagedFeed(`${atomEntry("2609.00013v1")}${atomEntry("2609.00014v1")}`, { totalResults: 3, startIndex: 0, itemsPerPage: 2 }));
          }
          throw new Error("second page unavailable");
        },
      }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_REQUEST_FAILED",
    );
    assert.equal(calls, 2);
    assert.equal(await readFile(output, "utf8"), oldCache);
    assert.deepEqual(await readdir(directory), ["arxiv-daily.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the parser deduplicates exact versions and rejects missing revisions", () => {
  const entry = atomEntry("2609.00002v3");
  assert.equal(parseArxivFeed(atomFeed(`${entry}${entry}`)).length, 1);
  assert.throws(
    () => parseArxivFeed(atomFeed(atomEntry("2609.00003"))),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_ENTRY_REVISION_MISSING",
  );
});

test("the parser rejects non-Atom namespaces, invalid XML entities, root text and inconsistent pagination", () => {
  const valid = atomFeed(atomEntry());
  assert.throws(
    () => parseArxivFeed(valid.replace("http://www.w3.org/2005/Atom", "https://example.invalid/atom")),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_FEED_NAMESPACE_INVALID",
  );
  assert.throws(
    () => parseArxivFeed(valid.replace("A title", "A &bogus; title")),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_XML_INVALID",
  );
  assert.throws(
    () => parseArxivFeed(`unexpected text${valid}`),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_XML_INVALID",
  );
  assert.throws(
    () => parseArxivFeed(atomFeed().replace("<opensearch:totalResults>0</opensearch:totalResults>", "<opensearch:totalResults>1</opensearch:totalResults>")),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_PAGINATION_INVALID",
  );
  assert.throws(
    () => parseArxivFeed(atomFeed(atomEntry("2609.00004v1").replaceAll("https://arxiv.org/abs/2609.00004v1", "https://example.invalid/abs/2609.00004v1"))),
    (error) => error instanceof ArxivFeedError && error.code === "ARXIV_ENTRY_ID_INVALID",
  );
});

test("an atomic publish failure leaves the previous cache intact and retains incomplete evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-"));
  const output = join(directory, "arxiv-daily.json");
  const oldCache = '{"generated_at":"old","entries":[]}\n';
  await writeFile(output, oldCache, "utf8");
  try {
    await assert.rejects(
      refreshArxivFeed({
        output,
        maxAttempts: 1,
        fetchImpl: async () => atomResponse(atomFeed(atomEntry())),
        renameImpl: async () => { throw new Error("simulated publish failure"); },
      }),
      /simulated publish failure/u,
    );
    assert.equal(await readFile(output, "utf8"), oldCache);
    assert.deepEqual((await readdir(directory)).sort(), [".arxiv-daily-generations", "arxiv-daily.json"]);
    const generation = (await readdir(join(directory, ".arxiv-daily-generations")))[0];
    assert.deepEqual(await readdir(join(directory, ".arxiv-daily-generations", generation, "files")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed install with a failed rollback never deletes the only last-good cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-publish-recovery-"));
  const output = join(directory, "arxiv-daily.json");
  const oldCache = '{"generated_at":"old","entries":[]}' + "\n";
  await writeFile(output, oldCache, "utf8");
  try {
    await assert.rejects(
      refreshArxivFeed({
        output,
        maxAttempts: 1,
        fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00028v1"))),
        renameImpl: async (from, to) => {
          if (to.includes(".arxiv-daily-generations")) throw Object.assign(new Error("simulated EIO"), { code: "EIO" });
          await rename(from, to);
        },
      }),
      (error) => error?.code === "EIO",
    );
    assert.equal(await readFile(output, "utf8"), oldCache);
    assert.equal(await readdir(join(directory, ".arxiv-daily-generations")).then((names) => names.length), 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the reader follows one published generation when a legacy compatibility mirror fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-generation-reader-"));
  const output = join(directory, "arxiv-daily.json");
  const radarOutput = join(directory, "daily-radar.json");
  const artifactRoot = join(directory, "artifacts");
  const oldFeed = '{"generated_at":"old","entries":[]}' + "\n";
  const oldRadar = '{"edition":{"generated_at":"old"},"analyses":[],"knowledge_points":[]}' + "\n";
  await writeFile(output, oldFeed, "utf8");
  await writeFile(radarOutput, oldRadar, "utf8");
  try {
    const result = await refreshArxivFeed({
      output,
      radarOutput,
      artifactRoot,
      announcementDate: "2026-09-07",
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00029v1"))),
      renameImpl: async (from, to) => {
        if (to === radarOutput && from.includes(".tmp-")) {
          throw Object.assign(new Error("simulated Radar compatibility mirror failure"), { code: "EIO" });
        }
        await rename(from, to);
      },
    });
    assert.equal(result.entries[0].arxiv_id, "2609.00029");
    assert.equal(await readFile(radarOutput, "utf8"), oldRadar);

    const edition = await readPublishedArxivEdition({ output, radarOutput, artifactRoot });
    assert.equal(edition.generation_id.startsWith("generation-"), true);
    assert.equal(edition.feed.entries[0].arxiv_id, "2609.00029");
    assert.equal(edition.radar.edition.window.batch_id, "announcement-2026-09-07");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a pointer switch failure keeps the old cache and recovers the complete generation after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-pointer-recovery-"));
  const output = join(directory, "arxiv-daily.json");
  const radarOutput = join(directory, "daily-radar.json");
  const artifactRoot = join(directory, "artifacts");
  const pointerPath = join(artifactRoot, "current-generation.json");
  const oldFeed = '{"generated_at":"old","entries":[]}' + "\n";
  const oldRadar = '{"edition":{"generated_at":"old"},"analyses":[],"knowledge_points":[]}' + "\n";
  await writeFile(output, oldFeed, "utf8");
  await writeFile(radarOutput, oldRadar, "utf8");
  try {
    await assert.rejects(
      refreshArxivFeed({
        output,
        radarOutput,
        artifactRoot,
        runId: "run-pointer-recovery",
        announcementDate: "2026-09-07",
        maxAttempts: 1,
        minRequestIntervalMs: 0,
        fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00030v1"))),
        renameImpl: async (from, to) => {
          if (to === pointerPath) throw Object.assign(new Error("simulated pointer EIO"), { code: "EIO" });
          await rename(from, to);
        },
      }),
      (error) => error?.code === "EIO",
    );
    assert.equal(await readFile(output, "utf8"), oldFeed);
    assert.equal(await readFile(radarOutput, "utf8"), oldRadar);
    assert.equal(await readdir(join(artifactRoot, "generations")).then((names) => names.length), 1);

    const recovered = await readPublishedArxivEdition({ output, radarOutput, artifactRoot });
    assert.equal(recovered.feed.entries[0].arxiv_id, "2609.00030");
    assert.equal(recovered.radar.edition.window.batch_id, "announcement-2026-09-07");
    assert.equal(JSON.parse(await readFile(pointerPath, "utf8")).generation_id, recovered.generation_id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a reader recovers the previous complete generation when the pointed generation is damaged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-generation-recovery-"));
  const output = join(directory, "arxiv-daily.json");
  const radarOutput = join(directory, "daily-radar.json");
  const artifactRoot = join(directory, "artifacts");
  await writeFile(output, '{"generated_at":"old","entries":[]}\n', "utf8");
  await writeFile(radarOutput, '{"edition":{"generated_at":"old"},"analyses":[],"knowledge_points":[]}\n', "utf8");
  try {
    await refreshArxivFeed({
      output,
      radarOutput,
      artifactRoot,
      runId: "run-recovery-old",
      announcementDate: "2026-09-07",
      maxAttempts: 1,
      minRequestIntervalMs: 0,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00033v1"))),
    });
    await refreshArxivFeed({
      output,
      radarOutput,
      artifactRoot,
      runId: "run-recovery-new",
      announcementDate: "2026-09-07",
      maxAttempts: 1,
      minRequestIntervalMs: 0,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00034v1"))),
    });
    const pointerPath = join(artifactRoot, "current-generation.json");
    const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
    await writeFile(join(artifactRoot, pointer.generation_path, "generation.json"), "{\"status\":\"damaged\"}\n", "utf8");
    const recovered = await readPublishedArxivEdition({ output, radarOutput, artifactRoot });
    assert.equal(recovered.feed.entries[0].arxiv_id, "2609.00033");
    assert.notEqual(recovered.generation_id, pointer.generation_id);
    assert.notEqual(JSON.parse(await readFile(pointerPath, "utf8")).generation_id, pointer.generation_id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("readers observe either the old or the new complete generation during pointer publication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-pointer-read-"));
  const output = join(directory, "arxiv-daily.json");
  const radarOutput = join(directory, "daily-radar.json");
  const artifactRoot = join(directory, "artifacts");
  const pointerPath = join(artifactRoot, "current-generation.json");
  const oldFeed = '{"generated_at":"old","entries":[]}' + "\n";
  const oldRadar = '{"edition":{"generated_at":"old"},"analyses":[],"knowledge_points":[]}' + "\n";
  await writeFile(output, oldFeed, "utf8");
  await writeFile(radarOutput, oldRadar, "utf8");
  let beforeCommit;
  let afterCommit;
  try {
    await refreshArxivFeed({
      output,
      radarOutput,
      artifactRoot,
      announcementDate: "2026-09-07",
      maxAttempts: 1,
      minRequestIntervalMs: 0,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00031v1"))),
      renameImpl: async (from, to) => {
        if (to === pointerPath) {
          beforeCommit = await readPublishedArxivEdition({ output, radarOutput, artifactRoot });
          await rename(from, to);
          afterCommit = await readPublishedArxivEdition({ output, radarOutput, artifactRoot });
          return;
        }
        await rename(from, to);
      },
    });
    assert.deepEqual(beforeCommit.feed, JSON.parse(oldFeed));
    assert.deepEqual(beforeCommit.radar, JSON.parse(oldRadar));
    assert.equal(afterCommit.feed.entries[0].arxiv_id, "2609.00031");
    assert.equal(afterCommit.radar.edition.window.batch_id, "announcement-2026-09-07");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed Radar compatibility mirror leaves both reader inputs in one generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-radar-publish-"));
  const output = join(directory, "arxiv-daily.json");
  const radarOutput = join(directory, "daily-radar.json");
  const oldFeed = '{"generated_at":"old","entries":[]}\n';
  const oldRadar = '{"analyses":[],"knowledge_points":[]}\n';
  await writeFile(output, oldFeed, "utf8");
  await writeFile(radarOutput, oldRadar, "utf8");
  try {
    const result = await refreshArxivFeed({
      output,
      radarOutput,
      announcementDate: "2026-09-07",
      maxAttempts: 1,
      minRequestIntervalMs: 0,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00025v1"))),
      renameImpl: async (from, to) => {
        if (to === radarOutput && from.includes(".tmp-")) throw new Error("simulated Radar publish failure");
        await rename(from, to);
      },
    });
    assert.equal(result.entries[0].arxiv_id, "2609.00025");
    assert.notEqual(await readFile(output, "utf8"), oldFeed);
    assert.equal(await readFile(radarOutput, "utf8"), oldRadar);
    const edition = await readPublishedArxivEdition({ output, radarOutput, artifactRoot: null });
    assert.equal(edition.feed.entries[0].arxiv_id, "2609.00025");
    assert.equal(edition.radar.edition.window.batch_id, "announcement-2026-09-07");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed run-state compatibility mirror keeps the committed generation authoritative", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-transaction-"));
  const output = join(directory, "arxiv-daily.json");
  const radarOutput = join(directory, "daily-radar.json");
  const artifactRoot = join(directory, "artifacts");
  const runStatePath = join(artifactRoot, "run-state.json");
  const oldFeed = '{"generated_at":"old","entries":[]}\n';
  const oldRadar = '{"analyses":[],"knowledge_points":[]}\n';
  await writeFile(output, oldFeed, "utf8");
  await writeFile(radarOutput, oldRadar, "utf8");
  try {
    const result = await refreshArxivFeed({
      output,
      radarOutput,
      artifactRoot,
      runId: "run-transaction",
      announcementDate: "2026-09-07",
      maxAttempts: 1,
      minRequestIntervalMs: 0,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00026v1"))),
      renameImpl: async (from, to) => {
        if (to === runStatePath && from.includes(".tmp-")) throw new Error("simulated metadata publish failure");
        await rename(from, to);
      },
    });
    assert.equal(result.entries[0].arxiv_id, "2609.00026");
    assert.notEqual(await readFile(output, "utf8"), oldFeed);
    assert.notEqual(await readFile(radarOutput, "utf8"), oldRadar);
    const state = JSON.parse(await readFile(runStatePath, "utf8"));
    assert.equal(state.status, "success");
    assert.equal(state.last_attempt.run_id, "run-transaction");
    assert.equal(state.last_attempt.status, "published");
    assert.equal(state.last_attempt.publication_warnings[0].error.message, "simulated metadata publish failure");
    const manifest = JSON.parse(await readFile(join(artifactRoot, "runs/run-transaction/manifest.json"), "utf8"));
    assert.equal(manifest.status, "published");
    const edition = await readPublishedArxivEdition({ output, radarOutput, artifactRoot });
    assert.equal(edition.feed.entries[0].arxiv_id, "2609.00026");
    assert.equal(edition.radar.edition.window.batch_id, "announcement-2026-09-07");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the run-state reader follows the committed generation when its legacy mirror is stale", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-run-state-generation-"));
  const output = join(directory, "arxiv-daily.json");
  const radarOutput = join(directory, "daily-radar.json");
  const artifactRoot = join(directory, "artifacts");
  const runStatePath = join(artifactRoot, "run-state.json");
  await writeFile(output, "{\"entries\":[]}\n", "utf8");
  await writeFile(radarOutput, "{\"analyses\":[],\"knowledge_points\":[]}\n", "utf8");
  try {
    await refreshArxivFeed({
      output,
      radarOutput,
      artifactRoot,
      runId: "run-state-generation",
      announcementDate: "2026-09-07",
      maxAttempts: 1,
      minRequestIntervalMs: 0,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00032v1"))),
    });
    await writeFile(runStatePath, "{\"status\":\"stale-mirror\"}\n", "utf8");
    const state = await readArxivRunState({ artifactRoot });
    assert.equal(state.status, "success");
    assert.equal(state.last_success.run_id, "run-state-generation");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a refresh already in progress blocks a second publisher and preserves the cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-"));
  const output = join(directory, "arxiv-daily.json");
  const lockPath = `${output}.lock`;
  const oldCache = '{"generated_at":"old","entries":[]}\n';
  await writeFile(output, oldCache, "utf8");
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, started_at: "2026-09-08T00:00:00Z" }), "utf8");
  try {
    await assert.rejects(
      refreshArxivFeed({ output, maxAttempts: 1, fetchImpl: async () => atomResponse(atomFeed(atomEntry())) }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_REFRESH_IN_PROGRESS",
    );
    assert.equal(await readFile(output, "utf8"), oldCache);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a response body that stalls is bounded by the request timeout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-"));
  const output = join(directory, "arxiv-daily.json");
  const oldCache = '{"generated_at":"old","entries":[]}\n';
  await writeFile(output, oldCache, "utf8");
  try {
    await assert.rejects(
      refreshArxivFeed({
        output,
        timeoutMs: 5,
        totalTimeoutMs: 100,
        maxAttempts: 1,
        fetchImpl: async (_url, { signal }) => ({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/atom+xml" }),
          text: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
            const error = new Error("body timeout");
            error.name = "AbortError";
            reject(error);
          }, { once: true })),
        }),
      }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_REQUEST_TIMEOUT",
    );
    assert.equal(await readFile(output, "utf8"), oldCache);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a dead refresh lock is recovered without waiting for its stale-age threshold", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-"));
  const output = join(directory, "arxiv-daily.json");
  const lockPath = `${output}.lock`;
  try {
    await writeFile(lockPath, JSON.stringify({ pid: 999_999_999, started_at: "2026-09-08T00:00:00Z" }), "utf8");
    const payload = await refreshArxivFeed({
      output,
      announcementDate: "2026-09-07",
      maxAttempts: 1,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00005v1"))),
    });
    assert.equal(payload.entries[0].arxiv_id, "2609.00005");
    assert.deepEqual((await readdir(directory)).sort(), [".arxiv-daily-current.json", ".arxiv-daily-generations", "arxiv-daily.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a successful refresh stores an immutable raw snapshot, manifest, replay and run state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-artifacts-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const rawFeed = atomFeed(atomEntry("2609.00006v1"));
  try {
    const payload = await refreshArxivFeed({
      output,
      artifactRoot,
      runId: "run-success",
      announcementDate: "2026-09-07",
      pageSize: 20,
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      now: new Date("2026-09-08T00:00:00Z"),
      fetchImpl: async () => atomResponse(rawFeed),
    });
    assert.equal(payload.snapshot_run_id, "run-success");
    assert.equal(payload.snapshot_manifest, "runs/run-success/manifest.json");

    const manifest = JSON.parse(await readFile(join(artifactRoot, payload.snapshot_manifest), "utf8"));
    assert.equal(manifest.status, "published");
    assert.equal(manifest.run_id, "run-success");
    assert.match(manifest.output_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(manifest.page_count, 1);
    assert.equal(manifest.pages[0].status, "parsed");
    assert.match(manifest.pages[0].snapshot_path, /^runs\/run-success\/pages\/page-0000\.xml$/u);
    assert.equal(await readFile(join(artifactRoot, manifest.pages[0].snapshot_path), "utf8"), rawFeed);

    const replay = await replayArxivSnapshot({ artifactRoot, runId: "run-success" });
    assert.deepEqual(replay.entries, payload.entries);
    assert.deepEqual(replay.pages, payload.pages);

    const state = JSON.parse(await readFile(join(artifactRoot, "run-state.json"), "utf8"));
    assert.equal(state.status, "success");
    assert.equal(state.last_attempt.run_id, "run-success");
    assert.equal(state.last_attempt.status, "published");
    assert.equal(state.last_success.run_id, "run-success");
    const pointer = JSON.parse(await readFile(join(artifactRoot, "current-generation.json"), "utf8"));
    assert.equal(pointer.files.length, 3);
    const published = await readPublishedFileSet({
      pointerPath: join(artifactRoot, "current-generation.json"),
      generationRoot: join(artifactRoot, "generations"),
      targets: [output],
    });
    assert.equal(published.generation_id, pointer.generation_id);
    assert.deepEqual(JSON.parse(published.files.get(output)).entries, payload.entries);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed refresh records failure state while retaining the previous successful run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-artifacts-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  try {
    await refreshArxivFeed({
      output,
      artifactRoot,
      runId: "run-good",
      announcementDate: "2026-09-07",
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00007v1"))),
    });
    const lastGood = await readFile(output, "utf8");
    const goodPointer = JSON.parse(await readFile(join(artifactRoot, "current-generation.json"), "utf8"));
    await assert.rejects(
      refreshArxivFeed({
        output,
        artifactRoot,
        runId: "run-bad",
        announcementDate: "2026-09-07",
        pageSize: 1,
        minRequestIntervalMs: 0,
        maxAttempts: 1,
        fetchImpl: async (url) => {
          const start = new URL(url).searchParams.get("start");
          if (start === "0") return atomResponse(atomPagedFeed(atomEntry("2609.00008v1"), { totalResults: 2, startIndex: 0, itemsPerPage: 1 }));
          throw new Error("later page unavailable");
        },
      }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_REQUEST_FAILED",
    );
    const state = JSON.parse(await readFile(join(artifactRoot, "run-state.json"), "utf8"));
    assert.equal(state.status, "failed");
    assert.equal(state.last_attempt.run_id, "run-bad");
    assert.equal(state.last_attempt.status, "failed");
    assert.equal(state.last_failure.run_id, "run-bad");
    assert.equal(state.last_success.run_id, "run-good");
    const failedManifest = JSON.parse(await readFile(join(artifactRoot, "runs/run-bad/manifest.json"), "utf8"));
    assert.equal(failedManifest.status, "failed");
    assert.equal(failedManifest.pages.length, 1);
    assert.equal(await readFile(output, "utf8"), lastGood);
    const currentPublished = await readPublishedFileSet({
      pointerPath: join(artifactRoot, "current-generation.json"),
      generationRoot: join(artifactRoot, "generations"),
      targets: [output],
    });
    assert.equal(currentPublished.generation_id, goodPointer.generation_id);
    assert.equal(JSON.parse(currentPublished.files.get(output)).entries[0].arxiv_id, "2609.00007");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("snapshot retention keeps the newest successful runs and replay detects tampering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-artifacts-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  try {
    for (const [runId, arxivId] of [["run-one", "2609.00009v1"], ["run-two", "2609.00010v1"], ["run-three", "2609.00011v1"]]) {
      await refreshArxivFeed({
        output,
        artifactRoot,
        runId,
        snapshotRetention: 2,
        minRequestIntervalMs: 0,
        maxAttempts: 1,
        fetchImpl: async () => atomResponse(atomFeed(atomEntry(arxivId))),
      });
    }
    assert.deepEqual(
      (await readdir(join(artifactRoot, "runs"))).sort(),
      ["run-three", "run-two"],
    );
    const manifest = JSON.parse(await readFile(join(artifactRoot, "runs/run-three/manifest.json"), "utf8"));
    await writeFile(join(artifactRoot, manifest.pages[0].snapshot_path), "tampered", "utf8");
    await assert.rejects(
      replayArxivSnapshot({ artifactRoot, runId: "run-three" }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_SNAPSHOT_INTEGRITY",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("replay reads an older retained snapshot after a newer generation is published", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-retained-replay-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  try {
    for (const [runId, arxivId] of [["run-old", "2609.00012v1"], ["run-new", "2609.00013v1"]]) {
      await refreshArxivFeed({
        output,
        artifactRoot,
        runId,
        snapshotRetention: 2,
        announcementDate: "2026-09-07",
        minRequestIntervalMs: 0,
        maxAttempts: 1,
        fetchImpl: async () => atomResponse(atomFeed(atomEntry(arxivId))),
      });
    }
    const replay = await replayArxivSnapshot({ artifactRoot, runId: "run-old" });
    assert.equal(replay.entries[0].arxiv_id, "2609.00012");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("snapshot retention protects the cache and last-success snapshot after a failed refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-artifacts-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const now = new Date("2026-09-08T00:00:00Z");
  try {
    await refreshArxivFeed({
      output,
      artifactRoot,
      runId: "run-good",
      snapshotRetention: 1,
      announcementDate: "2026-09-07",
      pageSize: 1,
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      now,
      fetchImpl: async () => atomResponse(atomPagedFeed(atomEntry("2609.00020v1"), { totalResults: 1, startIndex: 0, itemsPerPage: 1 })),
    });
    await assert.rejects(
      refreshArxivFeed({
        output,
        artifactRoot,
        runId: "run-bad",
        snapshotRetention: 1,
        announcementDate: "2026-09-07",
        pageSize: 1,
        minRequestIntervalMs: 0,
        maxAttempts: 1,
        now,
        fetchImpl: async (url) => {
          const start = new URL(url).searchParams.get("start");
          if (start === "0") return atomResponse(atomPagedFeed(atomEntry("2609.00021v1"), { totalResults: 2, startIndex: 0, itemsPerPage: 1 }));
          throw new Error("later page unavailable");
        },
      }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_REQUEST_FAILED",
    );
    assert.deepEqual((await readdir(join(artifactRoot, "runs"))).sort(), ["run-bad", "run-good"]);
    const replay = await replayArxivSnapshot({ artifactRoot, runId: "run-good" });
    assert.equal(replay.entries[0].arxiv_id, "2609.00020");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a post-publish observer failure is recorded without revoking the committed generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-artifacts-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  try {
    const result = await refreshArxivFeed({
        output,
        artifactRoot,
        runId: "run-post-publish",
        announcementDate: "2026-09-07",
        minRequestIntervalMs: 0,
        maxAttempts: 1,
        fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00022v1"))),
        publishStageHook: async (stage) => {
          if (stage === "cache_published") throw new Error("simulated state handoff failure");
        },
      });
    assert.equal(result.entries[0].arxiv_id, "2609.00022");
    const state = JSON.parse(await readFile(join(artifactRoot, "run-state.json"), "utf8"));
    assert.equal(state.status, "success");
    assert.equal(state.last_attempt.publication_warnings[0].error.message, "simulated state handoff failure");
    assert.equal(JSON.parse(await readFile(output, "utf8")).entries[0].arxiv_id, "2609.00022");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a production refresh publishes the feed and Radar as one reconciled edition", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-radar-"));
  const output = join(directory, "arxiv-daily.json");
  const radarOutput = join(directory, "daily-radar.json");
  try {
    await writeFile(output, JSON.stringify({ entries: [] }), "utf8");
    await writeFile(radarOutput, JSON.stringify({ analyses: [], knowledge_points: [] }), "utf8");
    const payload = await refreshArxivFeed({
      output,
      radarOutput,
      announcementDate: "2026-09-07",
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00024v1"))),
    });
    const radar = JSON.parse(await readFile(radarOutput, "utf8"));
    assert.equal(radar.edition.coverage_kind, "announcement_batch");
    assert.equal(radar.edition.window.batch_id, payload.window.batch_id);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")).entries, payload.entries);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("replay validates the recorded query and page URL contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-artifacts-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  const now = new Date("2026-09-08T00:00:00Z");
  try {
    await refreshArxivFeed({
      output,
      artifactRoot,
      runId: "run-provenance",
      announcementDate: "2026-09-07",
      pageSize: 10,
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      now,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00023v1"))),
    });
    const manifestPath = await publishedGenerationFile(artifactRoot, "runs/run-provenance/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.query = "tampered query";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    await assert.rejects(
      replayArxivSnapshot({ artifactRoot, runId: "run-provenance" }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_PUBLISH_GENERATION_INTEGRITY",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("replay validates every recorded announcement window field", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-daily-window-provenance-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  try {
    await refreshArxivFeed({
      output,
      artifactRoot,
      runId: "run-window-provenance",
      announcementDate: "2026-09-07",
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async () => atomResponse(atomFeed(atomEntry("2609.00027v1"))),
    });
    const manifestPath = await publishedGenerationFile(artifactRoot, "runs/run-window-provenance/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.window.cutoff_local_time = "00:00";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    await assert.rejects(
      replayArxivSnapshot({ artifactRoot, runId: "run-window-provenance" }),
      (error) => error instanceof ArxivFeedError && error.code === "ARXIV_PUBLISH_GENERATION_INTEGRITY",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the deployed Daily Radar page is static and exposes the latest cache data", { timeout: 240_000 }, async () => {
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  assert.equal(typeof packageJson.scripts?.["arxiv:refresh"], "string");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const html = await readFile(join(projectRoot, "dist", "arxiv-daily", "index.html"), "utf8");
  assert.match(html, /Daily Radar 首期导读/u);
  assert.match(html, /arXiv/iu);
  const chineseAbstracts = [...html.matchAll(/<p class="language-primary">([\s\S]*?)<\/p>/gu)].map((match) => match[1]);
  const englishAbstracts = [...html.matchAll(/<p class="language-english" lang="en">([\s\S]*?)<\/p>/gu)].map((match) => match[1]);
  assert.ok(chineseAbstracts.some((abstract) => abstract.includes("不是完整的当日新增集合")));
  assert.match(html, /低角动量磁化吸积流中的驻立激波/u);
  assert.ok(englishAbstracts.some((abstract) => abstract.includes("X-ray flares from Sgr")));
  assert.match(html, /实际阅读范围/u);
  assert.match(html, /Daily Radar 首期导读/u);
  assert.match(html, /已分析\s*6\s*\/\s*20/u);
  assert.match(html, /Must Read/u);
  assert.match(html, /Worth Knowing/u);
  assert.match(html, /Skip/u);
  assert.match(html, /待分析/u);
  assert.match(html, /仅检查 arXiv v1 摘要/u);
  assert.match(html, /2609\.04145v1/u);
  assert.match(html, /摘要称/u);
  assert.match(html, /研究问题/u);
  assert.match(html, /核心假设/u);
  assert.match(html, /结果与边界/u);
  assert.match(html, /引用线索/u);
  assert.match(html, /研究进展（本期比较范围）/u);
  assert.match(html, /附录未检查/u);
  assert.match(html, /正文样本、统计方法和限制尚未核查/u);
  assert.match(html, /阅读前置/u);
  assert.match(html, /papers\/long-yu-2026\//u);
  assert.match(html, /不表示两篇论文存在正式科学关系/u);
  assert.match(html, /当前材料未形成候选科学关系/u);
  assert.doesNotMatch(html, /edge:[a-z0-9-]+/u);
  assert.match(html, /今日知识点/u);
  assert.match(html, /驻立激波怎样变成一个能量预算约束/u);
  assert.match(html, /论文原式\/原文/u);
  assert.match(html, /教学补充/u);
  assert.match(html, /arxiv\.org\/src\/2609\.04145v1/u);
  assert.match(html, /<math[^>]*display="block"/u);
  assert.match(html, /<mfrac>/u);
  assert.match(html, /<mo>≡<\/mo>/u);
  assert.match(html, /<details class="radar-priority-section skip-section">/u);
  assert.doesNotMatch(html, /<details class="radar-priority-section skip-section" open/u);
  assert.doesNotMatch(html, /<script/iu);
});
