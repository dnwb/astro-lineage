import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { readFile as readProjectFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runScheduledArxivRefresh } from "../scripts/arxiv-daily-scheduler.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function emptyAtomFeed() {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><title>arXiv Query</title><opensearch:totalResults>0</opensearch:totalResults><opensearch:startIndex>0</opensearch:startIndex><opensearch:itemsPerPage>0</opensearch:itemsPerPage></feed>`;
}

test("the scheduler derives the completed announcement batch in America/New_York and runs the shared refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-"));
  const output = join(directory, "arxiv-daily.json");
  const calls = [];
  try {
    const result = await runScheduledArxivRefresh({
      output,
      now: new Date("2026-09-08T00:30:00Z"),
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(emptyAtomFeed(), { status: 200, headers: { "content-type": "application/atom+xml" } });
      },
    });
    assert.equal(result.status, "refreshed");
    assert.equal(result.payload.window.announcement_date, "2026-09-07");
    assert.equal(result.payload.window.time_zone, "America/New_York");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /submittedDate%3A%5B202609041800\+TO\+202609071800%5D/u);
    assert.match(await readFile(output, "utf8"), /"page_count": 1/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the scheduler on Friday catches up the latest completed Thursday batch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-"));
  const output = join(directory, "arxiv-daily.json");
  const calls = [];
  try {
    const result = await runScheduledArxivRefresh({
      output,
      now: new Date("2026-09-12T01:00:00Z"),
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(emptyAtomFeed(), { status: 200, headers: { "content-type": "application/atom+xml" } });
      },
    });
    assert.equal(result.status, "refreshed");
    assert.equal(result.payload.window.announcement_date, "2026-09-10");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /submittedDate%3A%5B202609091800\+TO\+202609101800%5D/u);
    assert.match(await readFile(output, "utf8"), /"announcement_date": "2026-09-10"/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the scheduler on Monday morning catches up Sunday and does not select Monday early", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-"));
  const output = join(directory, "arxiv-daily.json");
  const calls = [];
  try {
    const result = await runScheduledArxivRefresh({
      output,
      now: new Date("2026-09-07T13:00:00Z"),
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async (url) => {
        calls.push(url);
        return new Response(emptyAtomFeed(), { status: 200, headers: { "content-type": "application/atom+xml" } });
      },
    });
    assert.equal(result.status, "refreshed");
    assert.equal(result.payload.window.announcement_date, "2026-09-06");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /submittedDate%3A%5B202609031800\+TO\+202609041800%5D/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a successful batch is not fetched again when a persistent timer is replayed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-scheduler-"));
  const output = join(directory, "arxiv-daily.json");
  const artifactRoot = join(directory, "artifacts");
  let calls = 0;
  try {
    const options = {
      output,
      artifactRoot,
      now: new Date("2026-09-12T01:00:00Z"),
      minRequestIntervalMs: 0,
      maxAttempts: 1,
      fetchImpl: async () => {
        calls += 1;
        return new Response(emptyAtomFeed(), { status: 200, headers: { "content-type": "application/atom+xml" } });
      },
    };
    assert.equal((await runScheduledArxivRefresh(options)).status, "refreshed");
    const second = await runScheduledArxivRefresh({
      ...options,
      fetchImpl: async () => { throw new Error("already-processed batch must not fetch"); },
    });
    assert.equal(second.status, "skipped");
    assert.equal(second.reason, "already-processed");
    assert.equal(second.announcement_date, "2026-09-10");
    assert.equal(calls, 1);
    assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".lock")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the systemd user units schedule the shared offline-safe runner after announcement time", async () => {
  const service = await readProjectFile(join(projectRoot, "deploy/systemd/astrolineage-arxiv-daily.service"), "utf8");
  const timer = await readProjectFile(join(projectRoot, "deploy/systemd/astrolineage-arxiv-daily.timer"), "utf8");
  assert.match(service, /Type=oneshot/u);
  assert.match(service, /ExecStart=.*scripts\/arxiv-daily-scheduler\.mjs/u);
  assert.doesNotMatch(service, /(?:astro build|npm run build)/u);
  assert.match(timer, /OnCalendar=Sun \*-\*-\* 20:30:00 America\/New_York/u);
  assert.match(timer, /OnCalendar=Mon\.\.Thu \*-\*-\* 20:30:00 America\/New_York/u);
  assert.match(timer, /Persistent=true/u);
  assert.match(timer, /RandomizedDelaySec=15m/u);
});
