import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";
import {
  startTrace,
  queryTraces,
  PIPELINE_STAGES,
  TRACE_STATUSES,
  MemorySinkAdapter,
  AppendOnlyJsonlAdapter,
  defaultTelemetrySink,
} from "../scripts/pipeline-telemetry.mjs";

test("startTrace records lifecycle events conforming to PipelineTraceEvent schema in memory adapter", async () => {
  const memoryAdapter = new MemorySinkAdapter();
  const trace = startTrace({
    paperId: "2609.99991v1",
    date: "2026-10-06",
    sinkAdapter: memoryAdapter,
  });

  trace.recordStage(PIPELINE_STAGES.TRIAGE, {
    status: TRACE_STATUSES.STARTED,
    model: "gpt-6-luna",
  });

  trace.recordStage(PIPELINE_STAGES.TRIAGE, {
    status: TRACE_STATUSES.COMPLETED,
    model: "gpt-6-luna",
    durationMs: 450,
    details: { priority: "must_read" },
  });

  trace.recordFallback("gemini-3.8-flash-high", "gpt-6.1-sol", "HTTP 429 quota exhausted");

  trace.recordEvidence({
    verdict: "ACCEPTED",
    verifiedQuotesCount: 3,
    coverage: "full_body",
  });

  trace.finish(TRACE_STATUSES.COMPLETED, { recommendation: "must_read" });

  const events = memoryAdapter.getEvents();
  assert.equal(events.length, 5);
  assert.equal(events[0].trace_id, trace.traceId);
  assert.equal(events[0].paper_id, "2609.99991v1");
  assert.equal(events[0].stage, PIPELINE_STAGES.TRIAGE);
  assert.equal(events[0].status, TRACE_STATUSES.STARTED);

  const fallbackEvent = events.find((e) => e.status === TRACE_STATUSES.FALLBACK);
  assert.ok(fallbackEvent);
  assert.equal(fallbackEvent.details.from_model, "gemini-3.8-flash-high");
  assert.equal(fallbackEvent.details.to_model, "gpt-6.1-sol");
  assert.equal(fallbackEvent.details.reason, "HTTP 429 quota exhausted");

  const evidenceEvent = events.find((e) => e.stage === PIPELINE_STAGES.EVIDENCE_GATE);
  assert.ok(evidenceEvent);
  assert.equal(evidenceEvent.details.verified_quotes_count, 3);
});

test("AppendOnlyJsonlAdapter persists events to disk and queryTraces retrieves by paperId and stage", async (t) => {
  const ws = await createTemporaryWorkspace("astro-lineage-test-telemetry-", t);
  const testDir = ws.path;
  const fileAdapter = new AppendOnlyJsonlAdapter({ telemetryDir: testDir });
  const trace1 = startTrace({
    paperId: "2609.11111v1",
    date: "2026-10-06",
    sinkAdapter: fileAdapter,
  });
  trace1.recordStage(PIPELINE_STAGES.ACQUISITION, {
    status: TRACE_STATUSES.COMPLETED,
    details: { source_kind: "deepxiv" },
  });
  trace1.finish(TRACE_STATUSES.COMPLETED);

  const trace2 = startTrace({
    paperId: "2609.22222v1",
    date: "2026-10-06",
    sinkAdapter: fileAdapter,
  });
  trace2.recordStage(PIPELINE_STAGES.ACQUISITION, {
    status: TRACE_STATUSES.FAILED,
    details: { error: "timeout" },
  });
  trace2.finish(TRACE_STATUSES.FAILED);

  // Allow async writes to settle
  await fileAdapter.flush();

  // Query all for date
  const allEvents = await queryTraces({ date: "2026-10-06", telemetryDir: testDir });
  assert.equal(allEvents.length, 4);

  // Query filtered by paperId
  const paper1Events = await queryTraces({
    date: "2026-10-06",
    paperId: "2609.11111v1",
    telemetryDir: testDir,
  });
  assert.equal(paper1Events.length, 2);
  assert.equal(paper1Events[0].paper_id, "2609.11111v1");

  // Query filtered by stage
  const acqEvents = await queryTraces({
    date: "2026-10-06",
    stage: PIPELINE_STAGES.ACQUISITION,
    telemetryDir: testDir,
  });
  assert.equal(acqEvents.length, 2);
});

test("AppendOnlyJsonlAdapter handles concurrent multi-trace writes safely", async (t) => {
  const ws = await createTemporaryWorkspace("astro-lineage-test-telemetry-concurrent-", t);
  const testDir = ws.path;
  const fileAdapter = new AppendOnlyJsonlAdapter({ telemetryDir: testDir });
  const promises = [];

  for (let i = 0; i < 20; i++) {
    promises.push(
      (async () => {
        const trace = startTrace({
          paperId: `2609.${String(i).padStart(5, "0")}v1`,
          date: "2026-10-06",
          sinkAdapter: fileAdapter,
        });
        trace.recordStage(PIPELINE_STAGES.TRIAGE, { status: TRACE_STATUSES.STARTED });
        trace.recordStage(PIPELINE_STAGES.SYNTHESIS, { status: TRACE_STATUSES.COMPLETED });
        trace.finish(TRACE_STATUSES.COMPLETED);
      })()
    );
  }

  await Promise.all(promises);
  await fileAdapter.flush();

  const events = await queryTraces({ date: "2026-10-06", telemetryDir: testDir });
  assert.equal(events.length, 60);

  // Verify all JSON records are valid without corruption
  const filePath = join(testDir, "traces-2026-10-06.jsonl");
  const raw = await readFile(filePath, "utf8");
  const lines = raw.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 60);
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
});

test("runAiAnalyzer generates structured telemetry events for processed paper", async (t) => {
  const ws = await createTemporaryWorkspace("astro-lineage-test-analyzer-telemetry-", t);
  const testDir = ws.path;
  const feedPath = join(testDir, "arxiv-daily.json");
  const radarPath = join(testDir, "daily-radar.json");
  const statePath = join(testDir, "screening-queue.json");

  const testItem = {
    arxiv_id: "2609.88888",
    revision: 1,
    title: "A test telemetry paper",
    abstract: "This paper studies galaxy clustering.",
    published: "2026-10-06T12:00:00Z",
    updated: "2026-10-06T12:00:00Z",
    authors: ["Test Author"],
    url: "https://arxiv.org/abs/2609.88888v1",
  };
  const testFeed = {
    generated_at: "2026-10-06T18:00:00Z",
    query: "cat:astro-ph.HE",
    source_url: "https://export.arxiv.org/api/query",
    window: {
      kind: "announcement_batch",
      batch_id: "announcement-2026-10-06",
      announcement_date: "2026-10-06",
    },
    entries: [testItem],
  };
  const testRadar = {
    edition: {},
    analyses: [],
    knowledge_points: [],
    opening_brief: { status: "unavailable", reason: "fixture" },
  };

  await writeFile(feedPath, `${JSON.stringify(testFeed, null, 2)}\n`);
  await writeFile(radarPath, `${JSON.stringify(testRadar, null, 2)}\n`);

  const { runAiAnalyzer } = await import("../scripts/arxiv-ai-analyzer.mjs");
  await runAiAnalyzer({
    feed: feedPath,
    radar: radarPath,
    statePath,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async () => ({
      priority: "skip",
      reason: "Unrelated topic.",
      result: "Reports test result.",
      problem: "unknown",
      method: "unknown",
      reading_entry: "unknown",
      research_progress: "unknown",
      assumptions: [],
      limits: [],
      evidence: [
        {
          section: "Abstract",
          quote: "This paper studies galaxy clustering.",
          supports: ["reason", "result"],
        },
      ],
    }),
    sourceLoader: async () => {
      throw new Error("skip should not load body");
    },
  });

  await defaultTelemetrySink.flush();

  const events = await queryTraces({
    date: "2026-10-06",
    paperId: "2609.88888v1",
  });

  assert.ok(events.length >= 1, "Should have recorded telemetry events for 2609.88888v1");
  const triageEvent = events.find((e) => e.stage === PIPELINE_STAGES.TRIAGE);
  assert.ok(triageEvent, "Should have recorded TRIAGE stage event");
  assert.equal(triageEvent.paper_id, "2609.88888v1");
});
