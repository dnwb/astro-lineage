import { open, unlink, stat, rename, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const DEFAULT_RADAR_PATH = resolve(fileURLToPath(new URL("../src/data/daily-radar.json", import.meta.url)));
const DEFAULT_DIRTY_WEEKS_PATH = resolve(fileURLToPath(new URL("../.cache/dirty-weeks.json", import.meta.url)));
const LOCK_STALE_AFTER_MS = 120_000;

export async function isStaleLock(lockPath, staleAfterMs = LOCK_STALE_AFTER_MS) {
  let lockStats;
  try {
    lockStats = await stat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  try {
    const content = await readFile(lockPath, "utf8");
    const { pid } = JSON.parse(content);
    if (typeof pid === "number" && pid > 0) {
      try {
        process.kill(pid, 0); // Check if process is still alive
        // Process is still alive; only stale if it exceeded timeout
        return Date.now() - lockStats.mtimeMs > staleAfterMs;
      } catch (err) {
        if (err?.code === "ESRCH") {
          return true; // Process definitely dead
        }
      }
    }
  } catch {
    // If parse fails, fall back to timestamp check
  }
  return Date.now() - lockStats.mtimeMs > staleAfterMs;
}

export async function acquireLedgerLock(lockPath, { staleAfterMs = LOCK_STALE_AFTER_MS, retryAttempts = 5, retryDelayMs = 200 } = {}) {
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }), "utf8");
      await handle.close();
      return;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error?.code !== "EEXIST") throw error;

      if (await isStaleLock(lockPath, staleAfterMs)) {
        await unlink(lockPath).catch((unlinkError) => {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        });
        continue;
      }

      if (attempt < retryAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw new Error(`Failed to acquire lock at ${lockPath} after ${retryAttempts} attempts`);
}

export async function releaseLedgerLock(lockPath) {
  await unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

export async function writeJsonAtomically(target, data, renameImpl = rename) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = resolve(dirname(target), `.${basename(target)}.tmp-${process.pid}-${randomUUID()}`);
  const contents = `${JSON.stringify(data, null, 2)}\n`;
  let handle;
  try {
    handle = await open(temporary, "wx");
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameImpl(temporary, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function readDailyEdition(dateString, { radarPath = DEFAULT_RADAR_PATH } = {}) {
  try {
    if (!existsSync(radarPath)) return null;
    const raw = await readFile(radarPath, "utf8");
    const parsed = JSON.parse(raw);
    if (dateString && parsed.target_date !== dateString && parsed.announcement_date !== dateString) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Commits a paper analysis or update transactionally using optimistic functional mutators.
 * @param {string} dateString
 * @param {string} paperId
 * @param {Function|Object} mutatorOrData
 * @param {Object} [options]
 */
export async function commitDailyPaper(dateString, paperId, mutatorOrData, {
  radarPath = DEFAULT_RADAR_PATH,
  lockTimeoutMs = LOCK_STALE_AFTER_MS
} = {}) {
  const lockPath = `${radarPath}.lock`;
  await acquireLedgerLock(lockPath, { staleAfterMs: lockTimeoutMs });

  try {
    let edition = await readDailyEdition(dateString, { radarPath });
    if (!edition) {
      edition = {
        version: 1,
        target_date: dateString,
        announcement_date: dateString,
        papers: []
      };
    }
    if (!Array.isArray(edition.papers)) {
      edition.papers = [];
    }

    const existingIdx = edition.papers.findIndex((p) => p.arxiv_id === paperId);
    const prevPaper = existingIdx >= 0 ? edition.papers[existingIdx] : null;

    let nextPaper;
    if (typeof mutatorOrData === "function") {
      nextPaper = mutatorOrData(prevPaper);
    } else {
      nextPaper = { ...prevPaper, ...mutatorOrData };
    }

    if (!nextPaper || !nextPaper.arxiv_id) {
      throw new Error(`commitDailyPaper mutator returned invalid paper object without arxiv_id for ${paperId}`);
    }

    if (existingIdx >= 0) {
      edition.papers[existingIdx] = nextPaper;
    } else {
      edition.papers.push(nextPaper);
    }

    await writeJsonAtomically(radarPath, edition);
    return { success: true, data: nextPaper };
  } finally {
    await releaseLedgerLock(lockPath);
  }
}

export async function getDirtyWeeks({ dirtyWeeksPath = DEFAULT_DIRTY_WEEKS_PATH } = {}) {
  try {
    if (!existsSync(dirtyWeeksPath)) return [];
    const data = JSON.parse(await readFile(dirtyWeeksPath, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function markWeekDirty(weekId, { dirtyWeeksPath = DEFAULT_DIRTY_WEEKS_PATH } = {}) {
  if (!weekId) return;
  const lock = `${dirtyWeeksPath}.lock`;
  await acquireLedgerLock(lock);
  try {
    const current = await getDirtyWeeks({ dirtyWeeksPath });
    if (!current.includes(weekId)) {
      current.push(weekId);
      current.sort();
      await writeJsonAtomically(dirtyWeeksPath, current);
      console.log(`[Archive] Marked natural week ${weekId} as dirty in ${dirtyWeeksPath}`);
    }
  } finally {
    await releaseLedgerLock(lock);
  }
}

export async function clearDirtyWeek(weekId, { dirtyWeeksPath = DEFAULT_DIRTY_WEEKS_PATH } = {}) {
  if (!weekId) return;
  const lock = `${dirtyWeeksPath}.lock`;
  await acquireLedgerLock(lock);
  try {
    const current = await getDirtyWeeks({ dirtyWeeksPath });
    const next = current.filter((w) => w !== weekId);
    if (next.length !== current.length) {
      await writeJsonAtomically(dirtyWeeksPath, next);
    }
  } finally {
    await releaseLedgerLock(lock);
  }
}

export async function clearAllDirtyWeeks({ dirtyWeeksPath = DEFAULT_DIRTY_WEEKS_PATH } = {}) {
  const lock = `${dirtyWeeksPath}.lock`;
  await acquireLedgerLock(lock);
  try {
    await writeJsonAtomically(dirtyWeeksPath, []);
  } finally {
    await releaseLedgerLock(lock);
  }
}
