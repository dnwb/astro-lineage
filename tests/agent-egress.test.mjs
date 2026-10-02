import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("agent-egress: public files exist and conform to standards", async () => {
  const llmsTxt = await readFile("public/llms.txt", "utf8");
  assert.ok(llmsTxt.includes("# AstroLineage"));
  assert.ok(llmsTxt.includes("/api/v1/daily.json"));
  assert.ok(llmsTxt.includes("/api/v1/events.json"));
  assert.ok(llmsTxt.includes("Fast Radio Bursts"));

  const llmsFull = await readFile("public/llms-full.txt", "utf8");
  assert.ok(llmsFull.includes("AstroLineage Intelligence Knowledge Base"));
  assert.ok(llmsFull.includes("must_read"));

  const openapi = await readFile("public/openapi.yaml", "utf8");
  assert.ok(openapi.includes("openapi: 3.1.0"));
  assert.ok(openapi.includes("/daily.json"));
  assert.ok(openapi.includes("/events.json"));
});

test("agent-egress: generated scientific events file exists and is valid JSON", async () => {
  const content = await readFile("src/data/scientific-events.json", "utf8");
  const data = JSON.parse(content);
  assert.ok(data.total_events > 0);
  assert.ok(Array.isArray(data.events));
  assert.ok(data.events[0].event_id);
  assert.ok(data.events[0].heat_score !== undefined);
});
