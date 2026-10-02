#!/usr/bin/env node
import { existsSync } from "node:fs";
import {
  DEFAULT_BASE_URL,
  DEFAULT_API_KEY,
  DEFAULT_MODEL,
  DEFAULT_FALLBACK_MODELS,
  FALLBACK_BASE_URL,
  FALLBACK_API_KEY,
  FALLBACK_MODEL,
  buildModelCandidates,
  normalizeModelName,
} from "./agent-core.mjs";

try {
  if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
    process.loadEnvFile();
  }
} catch {}

async function probeModel({ baseUrl, apiKey, model, timeoutMs = 15000 }) {
  const start = performance.now();
  const url = `${baseUrl.replace(/\/+$/u, "")}/chat/completions`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: normalizeModelName(model),
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const elapsed = Math.round(performance.now() - start);

    if (res.ok) {
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || "";
      return { ok: true, status: res.status, elapsed, reply };
    } else {
      const errText = await res.text();
      let msg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(errText);
        msg += ` (${errJson.error?.message || errJson.error?.code || "error"})`;
      } catch {
        msg += ` (${errText.slice(0, 60)})`;
      }
      return { ok: false, status: res.status, elapsed, error: msg };
    }
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    return { ok: false, status: "TIMEOUT/ERR", elapsed, error: err.message };
  }
}

async function main() {
  console.log("=========================================================");
  console.log("       AstroLineage AI 上游模型可用性探针 (Model Probe)    ");
  console.log("=========================================================\n");

  const primaryCandidates = buildModelCandidates(DEFAULT_MODEL, DEFAULT_FALLBACK_MODELS);
  console.log(`[主供应商] ${DEFAULT_BASE_URL}`);
  console.log(`默认主模型: ${DEFAULT_MODEL}`);
  console.log(`降级候选链: ${DEFAULT_FALLBACK_MODELS.join(" -> ")}\n`);

  for (const model of primaryCandidates) {
    process.stdout.write(`  • 探测模型: ${model.padEnd(20)} ... `);
    const result = await probeModel({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: DEFAULT_API_KEY,
      model,
    });

    if (result.ok) {
      console.log(`\x1b[32m[200 OK]\x1b[0m (${result.elapsed}ms) 响应: "${result.reply.slice(0, 30)}"`);
    } else {
      console.log(`\x1b[31m[${result.status}]\x1b[0m (${result.elapsed}ms) 原因: ${result.error}`);
    }
  }

  if (FALLBACK_BASE_URL && FALLBACK_API_KEY) {
    console.log(`\n[备用网关] ${FALLBACK_BASE_URL}`);
    const fbCandidates = [...new Set([FALLBACK_MODEL, "gpt-6-sol", "gpt-5.5"].filter(Boolean))];
    for (const model of fbCandidates) {
      process.stdout.write(`  • 探测模型: ${model.padEnd(20)} ... `);
      const result = await probeModel({
        baseUrl: FALLBACK_BASE_URL,
        apiKey: FALLBACK_API_KEY,
        model,
      });

      if (result.ok) {
        console.log(`\x1b[32m[200 OK]\x1b[0m (${result.elapsed}ms) 响应: "${result.reply.slice(0, 30)}"`);
      } else {
        console.log(`\x1b[31m[${result.status}]\x1b[0m (${result.elapsed}ms) 原因: ${result.error}`);
      }
    }
  }

  console.log("\n=========================================================");
  console.log("探测完成。系统将自动按首个返回 200 OK 的模型进行业务派发。");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*[\/\\]/u, ""))) {
  main().catch((err) => {
    console.error("Probe failed:", err);
    process.exit(1);
  });
}

export { probeModel };
