import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_TELEMETRY_DIR = resolve(
  fileURLToPath(new URL("../.cache/telemetry", import.meta.url))
);

export const PIPELINE_STAGES = {
  TRIAGE: "TRIAGE",
  ACQUISITION: "ACQUISITION",
  EVIDENCE_GATE: "EVIDENCE_GATE",
  SYNTHESIS: "SYNTHESIS",
  EGRESS: "EGRESS",
};

export const TRACE_STATUSES = {
  STARTED: "STARTED",
  COMPLETED: "COMPLETED",
  FALLBACK: "FALLBACK",
  FAILED: "FAILED",
  REJECTED: "REJECTED",
};

export class MemorySinkAdapter {
  constructor() {
    this.events = [];
  }
  async emit(event) {
    this.events.push(event);
  }
  getEvents() {
    return [...this.events];
  }
  async flush() {
    return Promise.resolve();
  }
}

export class AppendOnlyJsonlAdapter {
  constructor({ telemetryDir = DEFAULT_TELEMETRY_DIR } = {}) {
    this.telemetryDir = telemetryDir;
    this.writeQueue = Promise.resolve();
  }

  async emit(event) {
    const rawDate = event.date || new Date().toISOString();
    const date = String(rawDate).slice(0, 10);
    const line = `${JSON.stringify(event)}\n`;
    const targetFile = join(this.telemetryDir, `traces-${date}.jsonl`);

    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(this.telemetryDir, { recursive: true });
        await appendFile(targetFile, line, "utf8");
      })
      .catch((err) => {
        console.warn(`[PipelineTelemetry] Failed to append trace event: ${err.message}`);
      });

    return this.writeQueue;
  }

  async flush() {
    await this.writeQueue;
  }
}

export const defaultTelemetrySink = new AppendOnlyJsonlAdapter();

export class PipelineTrace {
  constructor({
    paperId,
    date = new Date().toISOString().slice(0, 10),
    traceId = `trace-${Date.now()}-${randomUUID().slice(0, 8)}`,
    sinkAdapter = defaultTelemetrySink,
  } = {}) {
    this.traceId = traceId;
    this.paperId = paperId;
    this.date = date;
    this.sinkAdapter = sinkAdapter;
    this.startTime = Date.now();
  }

  emit(event) {
    const payload = {
      trace_id: this.traceId,
      paper_id: this.paperId,
      date: this.date,
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.sinkAdapter.emit(payload).catch(() => {});
    return payload;
  }

  recordStage(stage, { status = TRACE_STATUSES.COMPLETED, model, durationMs, details = {} } = {}) {
    this.currentStage = stage;
    return this.emit({
      stage,
      status,
      model,
      duration_ms: durationMs,
      details,
    });
  }

  recordFallback(fromModel, toModel, reason, details = {}) {
    const stage = details.stage || this.currentStage || PIPELINE_STAGES.TRIAGE;
    return this.emit({
      stage,
      status: TRACE_STATUSES.FALLBACK,
      model: toModel,
      details: {
        from_model: fromModel,
        to_model: toModel,
        reason,
        ...details,
      },
    });
  }

  recordEvidence(gateResult) {
    return this.emit({
      stage: PIPELINE_STAGES.EVIDENCE_GATE,
      status:
        gateResult.verdict === "ACCEPTED" ? TRACE_STATUSES.COMPLETED : TRACE_STATUSES.REJECTED,
      details: {
        verdict: gateResult.verdict,
        verified_quotes_count:
          gateResult.verifiedQuotesCount ?? gateResult.verified_quotes_count ?? 0,
        coverage: gateResult.coverage,
        rejection_reason: gateResult.reason || gateResult.rejection_reason,
      },
    });
  }

  finish(status = TRACE_STATUSES.COMPLETED, details = {}) {
    return this.emit({
      stage: PIPELINE_STAGES.SYNTHESIS,
      status,
      duration_ms: Date.now() - this.startTime,
      details,
    });
  }
}

export function startTrace(context = {}) {
  return new PipelineTrace(context);
}

export async function queryTraces({
  date = new Date().toISOString().slice(0, 10),
  paperId,
  stage,
  telemetryDir = DEFAULT_TELEMETRY_DIR,
} = {}) {
  const queryDate = String(date || new Date().toISOString()).slice(0, 10);
  const filePath = join(telemetryDir, `traces-${queryDate}.jsonl`);
  if (!existsSync(filePath)) return [];

  try {
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const events = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (paperId && parsed.paper_id !== paperId) continue;
        if (stage && parsed.stage !== stage) continue;
        events.push(parsed);
      } catch {}
    }
    return events;
  } catch {
    return [];
  }
}
