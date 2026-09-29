#!/usr/bin/env node
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP_PREFIXES = [
  "astro-lineage-",
  "arxiv-",
  "axvdaily-",
  "daily-radar-page-fixture-",
];

async function cleanup() {
  const root = tmpdir();
  try {
    const entries = await readdir(root, { withFileTypes: true });
    let removedCount = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const isTarget = TMP_PREFIXES.some(prefix => entry.name.startsWith(prefix));
      if (isTarget) {
        const fullPath = join(root, entry.name);
        try {
          await rm(fullPath, { recursive: true, force: true });
          removedCount++;
        } catch {}
      }
    }
    if (removedCount > 0) {
      console.log(`[Test Cleanup] Reclaimed ${removedCount} temporary test directory workspaces.`);
    }
  } catch (err) {
    console.warn(`[Test Cleanup] Warning: could not inspect tmpdir: ${err.message}`);
  }
}

cleanup();
