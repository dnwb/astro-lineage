import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getAgentEgressBaseUrl,
  generateLlmsTxt,
  generateLlmsFullTxt,
  generateOpenApiYaml,
} from "../src/domain/agent-egress.mjs";

test("agent-egress: base URL resolution follows intranet default and env override", () => {
  // 1. Intranet default when no environment variable is provided
  assert.equal(getAgentEgressBaseUrl({}), "http://10.131.43.83:4321");

  // 2. Public build override via PUBLIC_SITE_URL
  assert.equal(
    getAgentEgressBaseUrl({ PUBLIC_SITE_URL: "https://astro-lineage.pages.dev" }),
    "https://astro-lineage.pages.dev"
  );

  // 3. Cloudflare Pages build detection (CF_PAGES=1)
  assert.equal(getAgentEgressBaseUrl({ CF_PAGES: "1" }), "https://astro-lineage.pages.dev");
  assert.equal(getAgentEgressBaseUrl({ CF_PAGES: "true" }), "https://astro-lineage.pages.dev");

  // 4. Intranet override via LOCAL_SITE_URL
  assert.equal(
    getAgentEgressBaseUrl({ LOCAL_SITE_URL: "http://10.131.43.99:8080" }),
    "http://10.131.43.99:8080"
  );

  // 5. Trailing slashes and loopback sanitization
  assert.equal(
    getAgentEgressBaseUrl({ PUBLIC_SITE_URL: "https://astro-lineage.pages.dev/" }),
    "https://astro-lineage.pages.dev"
  );
  assert.equal(
    getAgentEgressBaseUrl({ LOCAL_SITE_URL: "http://localhost:4321" }),
    "http://10.131.43.83:4321"
  );
});

test("agent-egress: llms.txt generation respects public and intranet base URL", () => {
  const publicContent = generateLlmsTxt({ baseUrl: "https://astro-lineage.pages.dev" });
  assert.ok(publicContent.includes("Base Server: https://astro-lineage.pages.dev"));
  assert.ok(publicContent.includes("https://astro-lineage.pages.dev/api/v1/daily.json"));
  assert.ok(publicContent.includes("https://astro-lineage.pages.dev/openapi.yaml"));
  assert.ok(!publicContent.includes("10.131.43.83"), "Public llms.txt must not leak intranet IP");

  const localContent = generateLlmsTxt({ baseUrl: "http://10.131.43.83:4321" });
  assert.ok(localContent.includes("Base Server: http://10.131.43.83:4321"));
  assert.ok(localContent.includes("http://10.131.43.83:4321/api/v1/daily.json"));
  assert.ok(!localContent.includes("localhost"), "Intranet llms.txt must not contain localhost");
});

test("agent-egress: openapi.yaml generation configures correct servers for public and intranet", () => {
  const publicYaml = generateOpenApiYaml({ baseUrl: "https://astro-lineage.pages.dev" });
  assert.ok(publicYaml.includes("url: https://astro-lineage.pages.dev/api/v1"));
  assert.ok(publicYaml.includes("url: /api/v1"));
  assert.ok(!publicYaml.includes("10.131.43.83"), "Public openapi.yaml must not leak intranet IP");

  const localYaml = generateOpenApiYaml({ baseUrl: "http://10.131.43.83:4321" });
  assert.ok(localYaml.includes("url: http://10.131.43.83:4321/api/v1"));
  assert.ok(localYaml.includes("url: /api/v1"));
  assert.ok(!localYaml.includes("localhost"), "Intranet openapi.yaml must not contain localhost");
});

test("agent-egress: llms-full.txt generation respects base URL", () => {
  const publicFull = generateLlmsFullTxt({ baseUrl: "https://astro-lineage.pages.dev" });
  assert.ok(publicFull.includes("Base Server: https://astro-lineage.pages.dev"));
  assert.ok(publicFull.includes("https://astro-lineage.pages.dev/api/v1/daily.json"));
  assert.ok(!publicFull.includes("10.131.43.83"), "Public llms-full.txt must not leak intranet IP");

  const localFull = generateLlmsFullTxt({ baseUrl: "http://10.131.43.83:4321" });
  assert.ok(localFull.includes("Base Server: http://10.131.43.83:4321"));
  assert.ok(localFull.includes("http://10.131.43.83:4321/api/v1/daily.json"));
});

test("agent-egress: Astro endpoint routes produce valid Response payloads", async () => {
  const { GET: getLlmsTxt } = await import("../src/pages/llms.txt.ts");
  const res1 = await getLlmsTxt();
  assert.equal(res1.status, 200);
  assert.equal(res1.headers.get("content-type"), "text/plain; charset=utf-8");
  const text1 = await res1.text();
  assert.ok(text1.includes("# AstroLineage"));

  const { GET: getLlmsFull } = await import("../src/pages/llms-full.txt.ts");
  const res2 = await getLlmsFull();
  assert.equal(res2.status, 200);
  const text2 = await res2.text();
  assert.ok(text2.includes("AstroLineage Intelligence Knowledge Base"));

  const { GET: getOpenApi } = await import("../src/pages/openapi.yaml.ts");
  const res3 = await getOpenApi();
  assert.equal(res3.status, 200);
  assert.equal(res3.headers.get("content-type"), "application/yaml; charset=utf-8");
  const text3 = await res3.text();
  assert.ok(text3.includes("openapi: 3.1.0"));
});

test("agent-egress: generated scientific events file exists and is valid JSON", async () => {
  const content = await readFile("src/data/scientific-events.json", "utf8");
  const data = JSON.parse(content);
  assert.ok(data.total_events > 0);
  assert.ok(Array.isArray(data.events));
  assert.ok(data.events[0].event_id);
  assert.ok(data.events[0].heat_score !== undefined);
});
