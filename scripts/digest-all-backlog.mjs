#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
  process.loadEnvFile();
}

const QUEUE_PATH = resolve(".cache/arxiv-daily/screening-queue.json");
const ANALYZER_PATH = resolve(fileURLToPath(new URL("./arxiv-ai-analyzer.mjs", import.meta.url)));
const ARCHIVE_PATH = resolve(fileURLToPath(new URL("./arxiv-archive.mjs", import.meta.url)));

function getPendingDates() {
  if (!existsSync(QUEUE_PATH)) return [];
  const queue = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
  const pendingByDate = new Map();

  for (const item of queue.items) {
    if (item.state === "complete") continue;
    const dates = new Set();
    if (item.entry?.published) dates.add(item.entry.published.slice(0, 10));
    if (Array.isArray(item.editions)) {
      for (const ed of item.editions) {
        if (ed.date) dates.add(ed.date);
      }
    }
    for (const d of dates) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        pendingByDate.set(d, (pendingByDate.get(d) || 0) + 1);
      }
    }
  }

  // Sort dates: latest dates first (W39 -> W38 -> W37)
  return [...pendingByDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, count]) => ({ date, count }));
}

function runDate(date, concurrency = 3) {
  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`\n==================================================`);
    console.log(`[Backlog Runner] 开始消化日期: ${date} (并发: ${concurrency})...`);
    console.log(`==================================================`);
    
    const child = spawn(process.execPath, [
      ANALYZER_PATH,
      `--date=${date}`,
      `--concurrency=${concurrency}`,
      `--limit=0`
    ], {
      stdio: "inherit",
      env: process.env
    });

    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Analyzer exited with code ${code} on date ${date}`));
    });
    child.on("error", rejectPromise);
  });
}

function syncArchives() {
  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`[Backlog Runner] 触发归档与清单同步...`);
    const child = spawn(process.execPath, [ARCHIVE_PATH], {
      stdio: "inherit",
      env: process.env
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Archive sync exited with code ${code}`));
    });
    child.on("error", rejectPromise);
  });
}

async function main() {
  const dates = getPendingDates();
  console.log(`[Backlog Runner] 检测到 ${dates.length} 个历史批次待消化，共 ${dates.reduce((s, d) => s + d.count, 0)} 篇待办:`);
  for (const { date, count } of dates) {
    console.log(`  - ${date}: ${count} 篇`);
  }

  for (const { date, count } of dates) {
    try {
      await runDate(date, 4);
      await syncArchives();
      console.log(`[Backlog Runner] ✓ 日期 ${date} (${count} 篇) 消化与归档完成。`);
    } catch (err) {
      console.error(`[Backlog Runner] ⚠️ 日期 ${date} 执行中断:`, err.message);
      // 继续下一个日期，不因单日阻塞整体进度
    }
  }

  console.log(`\n[Backlog Runner] 所有指定历史批次处理循环完毕。`);
}

main().catch((err) => {
  console.error("[Backlog Runner] 异常退出:", err);
  process.exit(1);
});
