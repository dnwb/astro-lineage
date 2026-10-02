import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, chmodSync, lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_MESSAGES = 10;
const MAX_CONTENT = 8192;
const MAX_BYTES = 512 * 1024;

// ponytail: one bot process owns this directory; use a transactional store before running replicas.
export function createSessionMemory(root, now = Date.now) {
  const pathFor = (key) => join(root, createHash("sha256").update(key).digest("hex") + ".json");
  function prepare() {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error("Invalid memory directory");
    chmodSync(root, 0o700);
  }
  function load(path) {
    let stat;
    try { stat = lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error("Invalid memory file");
    let record;
    try { record = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Invalid memory JSON"); }
    if (record?.version !== 1 || !Number.isSafeInteger(record.lastUserAt) || record.lastUserAt < 0 ||
        !Array.isArray(record.history) || record.history.length > MAX_MESSAGES ||
        record.history.some(m => !m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > MAX_CONTENT)) {
      throw new Error("Invalid memory record");
    }
    if (now() - record.lastUserAt >= SESSION_TTL_MS) { unlinkSync(path); return null; }
    return record;
  }
  return {
    get(key) { return load(pathFor(key))?.history ?? []; },
    append(key, role, content) {
      if (!["user", "assistant"].includes(role) || typeof content !== "string" || content.length > MAX_CONTENT) throw new Error("Invalid memory message");
      prepare();
      const path = pathFor(key);
      let record = load(path);
      if (!record && role === "assistant") return;
      if (!record && readdirSync(root).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length >= 1000) {
        throw new Error("Memory session capacity reached");
      }
      record ??= { version: 1, lastUserAt: now(), history: [] };
      if (role === "user") record.lastUserAt = now();
      record.history = [...record.history, { role, content }].slice(-MAX_MESSAGES);
      const temp = path + "." + randomUUID() + ".tmp";
      try {
        writeFileSync(temp, JSON.stringify(record), { mode: 0o600, flag: "wx" });
        renameSync(temp, path);
      } finally {
        try { unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    },
    sweep() {
      prepare();
      let invalid = 0;
      for (const name of readdirSync(root)) {
        if (/^[a-f0-9]{64}\.json$/.test(name)) {
          try { load(join(root, name)); } catch { invalid++; }
        } else if (/^[a-f0-9]{64}\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) {
          const path = join(root, name);
          if (now() - lstatSync(path).mtimeMs >= SESSION_TTL_MS) unlinkSync(path);
        }
      }
      if (invalid) throw new Error("Invalid memory files found; valid sessions were still swept");
    },
  };
}
