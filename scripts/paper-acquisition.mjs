import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeArxivId } from "./daily-radar.mjs";

export function sourceUrlIdentity(value) {
  try {
    const url = new URL(value);
    if (!["arxiv.org", "export.arxiv.org"].includes(url.hostname.toLowerCase())) return null;
    const match = decodeURIComponent(url.pathname).match(/^\/src\/(.+)v([1-9]\d*)$/iu);
    return match ? { arxiv_id: normalizeArxivId(match[1]), revision: Number(match[2]) } : null;
  } catch {
    return null;
  }
}

export const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
export const MAX_TEX_BYTES = 16 * 1024 * 1024;
export const MAX_TAR_MEMBERS = 512;
export const MAX_BODY_CHARS = 600_000;
export const SOURCE_TIMEOUT_MS = 30_000;

export const ACQUISITION_ERROR_CODES = {
  RATE_LIMIT: "RATE_LIMIT",
  NOT_FOUND: "NOT_FOUND",
  PARSING_FAILED: "PARSING_FAILED",
  TIMEOUT: "TIMEOUT",
  UNKNOWN: "UNKNOWN",
};

export class DeepxivCircuitBreaker {
  constructor({ cooldownMs = 3600_000 } = {}) {
    this.cooldownMs = cooldownMs;
    this.trippedUntil = 0;
  }
  isAvailable() {
    return Date.now() >= this.trippedUntil;
  }
  trip(reason = "") {
    this.trippedUntil = Date.now() + this.cooldownMs;
    console.warn(`[PaperAcquisition] deepxiv circuit breaker TRIPPED for ${Math.round(this.cooldownMs / 60000)}m (${reason || "quota/error"}). Tripped until ${new Date(this.trippedUntil).toISOString()}`);
  }
  reset() {
    this.trippedUntil = 0;
  }
}

export const defaultDeepxivBreaker = new DeepxivCircuitBreaker();

export function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function cleanHeading(value) {
  return String(value ?? "")
    .replace(/\\label\{[^}]*\}/gu, "")
    .replace(/\\(?:texorpdfstring|emph|textbf|textit)\s*\{([^{}]*)\}(?:\s*\{[^{}]*\})?/gu, "$1")
    .replaceAll("\\&", "&")
    .replace(/\\\s/gu, " ")
    .replace(/\\([a-zA-Z]+)\*?/gu, "$1")
    .replace(/[{}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseOctal(field) {
  const value = field.toString("ascii").replace(/\0.*$/u, "").trim();
  if (!value) return 0;
  if (!/^[0-7]+$/u.test(value)) throw new Error("Unsupported source package tar size field");
  return Number.parseInt(value, 8);
}

export function stripLatexComments(text) {
  return String(text).split("\n").map((line) => {
    for (let index = 0; index < line.length; index++) {
      if (line[index] !== "%") continue;
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor--) backslashes++;
      if (backslashes % 2 === 0) return line.slice(0, index);
    }
    return line;
  }).join("\n");
}

export function isTarArchive(buffer) {
  if (buffer.length < 512) return false;
  if (buffer.subarray(257, 262).toString("ascii") === "ustar") return true;
  try {
    const expected = parseOctal(buffer.subarray(148, 156));
    const actual = buffer.subarray(0, 512).reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    return expected === actual && expected > 0;
  } catch {
    return false;
  }
}

export function parseTarTexFiles(buffer) {
  const files = [];
  let offset = 0;
  let ended = false;
  let members = 0;
  let texBytes = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      ended = true;
      break;
    }
    if (++members > MAX_TAR_MEMBERS) throw new Error("Source package has too many members");
    const expectedChecksum = parseOctal(header.subarray(148, 156));
    const actualChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (expectedChecksum !== actualChecksum) throw new Error("Source package tar checksum mismatch");
    const size = parseOctal(header.subarray(124, 136));
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/u, "");
    const path = prefix ? `${prefix}/${name}` : name;
    const type = header[156];
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > buffer.length || !Number.isSafeInteger(size)) throw new Error("Source package tar is truncated");
    if ((type === 0 || type === 48) && /\.(?:tex|ltx)$/iu.test(path)) {
      texBytes += size;
      if (texBytes > MAX_TEX_BYTES) throw new Error("Source package TeX exceeds the byte limit");
      const rawBuf = buffer.subarray(bodyStart, bodyEnd);
      let text = rawBuf.toString("utf8");
      if (text.includes("\uFFFD")) {
        try {
          text = new TextDecoder("latin1", { fatal: false }).decode(rawBuf);
        } catch {}
      }
      files.push({ name: path, text });
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  if (!ended || files.length === 0) throw new Error("Unsupported or incomplete arXiv source tar");
  return files;
}

export function parseSourcePackage(bytes) {
  let contents = Buffer.from(bytes);
  if (contents.length === 0 || contents.length > MAX_SOURCE_BYTES) throw new Error("Source package is empty or exceeds the byte limit");
  if (contents[0] === 0x1f && contents[1] === 0x8b) {
    contents = gunzipSync(contents, { maxOutputLength: MAX_PACKAGE_BYTES });
  }
  if (contents.length > MAX_PACKAGE_BYTES) throw new Error("Uncompressed source package exceeds the byte limit");

  let files;
  if (isTarArchive(contents)) {
    files = parseTarTexFiles(contents);
  } else {
    const text = contents.toString("utf8");
    if (contents.length > MAX_TEX_BYTES) throw new Error("Source package TeX exceeds the byte limit");
    if (!/\\documentclass\b/u.test(text)) throw new Error("Unsupported arXiv source package format");
    files = [{ name: "source.tex", text }];
  }
  if (files.some((file) => file.text.includes("\uFFFD"))) throw new Error("Source package contains invalid UTF-8 text");
  const mainFiles = files.filter(({ text }) => {
    const source = stripLatexComments(text);
    return /\\documentclass\b/u.test(source) && /\\begin\s*\{document\}/u.test(source) && /\\end\s*\{document\}/u.test(source);
  });
  if (mainFiles.length === 0) throw new Error("Source package has no complete TeX document");

  const knownFiles = new Set(files.map(({ name }) => name.replace(/\.(?:tex|ltx)$/iu, "")));
  for (const file of files) {
    const source = stripLatexComments(file.text);
    for (const command of source.matchAll(/\\(?:input|include)\b/gu)) {
      const argument = source.slice(command.index + command[0].length)
        .match(/^\s*(?:\{([^{}]+)\}|([^\s{}\\%]+))/u);
      if (!argument) throw new Error(`Source package has an unsupported dynamic TeX include: ${command[0]}`);
      const included = argument[1] ?? argument[2];
      const normalized = included.trim().replace(/\.(?:tex|ltx)$/iu, "");
      if (!knownFiles.has(normalized)) throw new Error(`Source package has an unresolved TeX include: ${included.trim()} (available: ${[...knownFiles].join(", ")})`);
    }
  }

  const sectionMap = new Map();
  const abstractText = files.flatMap(({ text }) => [...stripLatexComments(text).matchAll(/\\begin\s*\{abstract\}([\s\S]*?)\\end\s*\{abstract\}/gu)].map((match) => match[1])).join("\n");
  const sectionPattern = /\\((?:sub)*section)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}\n]+)\}/gu;
  const headings = [];
  for (const file of files) {
    const text = stripLatexComments(file.text);
    const matches = [...text.matchAll(sectionPattern)];
    const firstMatchIdx = matches.length > 0 ? matches[0].index : text.length;

    let docStart = 0;
    const maketitleMatch = text.match(/\\maketitle/u);
    const endAbstractMatch = text.match(/\\end\{abstract\}/u);
    const beginDocMatch = text.match(/\\begin\{document\}/u);
    if (maketitleMatch) {
      docStart = maketitleMatch.index + maketitleMatch[0].length;
    } else if (endAbstractMatch) {
      docStart = endAbstractMatch.index + endAbstractMatch[0].length;
    } else if (beginDocMatch) {
      docStart = beginDocMatch.index + beginDocMatch[0].length;
    }

    if (firstMatchIdx > docStart) {
      const preamble = text.slice(docStart, firstMatchIdx).trim();
      if (preamble.length > 200) {
        const title = "Introduction";
        const key = normalizeWhitespace(title);
        sectionMap.set(key, `${sectionMap.get(key) || ""}\n${preamble}`);
        if (!headings.some((item) => normalizeWhitespace(item.title) === key)) {
          headings.unshift({ title, file: file.name, level: 0 });
        }
      }
    }

    for (const [index, match] of matches.entries()) {
      const title = cleanHeading(match[2]);
      if (!title) continue;
      const level = (match[1].match(/sub/gu) || []).length;
      const next = matches.slice(index + 1).find((candidate) => (candidate[1].match(/sub/gu) || []).length <= level);
      const end = next ? next.index : text.length;
      const body = text.slice(match.index + match[0].length, end);
      const key = normalizeWhitespace(title);
      sectionMap.set(key, `${sectionMap.get(key) || ""}\n${body}`);
      if (!headings.some((item) => normalizeWhitespace(item.title) === key)) headings.push({ title, file: file.name, level });
    }
  }
  if (headings.length === 0) throw new Error("Source package contains no verifiable body section headings");
  const bodyText = files.map(({ name, text }) => `\n===== ${name} =====\n${stripLatexComments(text)}`).join("\n");
  if (bodyText.length > MAX_BODY_CHARS) throw new Error(`Complete source exceeds ${MAX_BODY_CHARS} characters; it is left pending rather than truncated`);
  return {
    bodyText,
    sections: headings,
    headings,
    sectionMap,
    abstractText,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function parseMarkdownSections(text) {
  const lines = text.split(/\r?\n/);
  const headings = [];
  const sectionMap = new Map();
  let currentTitle = null;
  let currentLines = [];

  const flush = () => {
    if (currentTitle) {
      const key = normalizeWhitespace(currentTitle);
      const content = currentLines.join("\n").trim();
      sectionMap.set(key, `${sectionMap.get(key) || ""}\n${content}`);
      if (!headings.some((h) => normalizeWhitespace(h.title) === key)) {
        headings.push({ title: currentTitle, file: "source.md" });
      }
    } else if (currentLines.join("\n").trim().length > 200) {
      const preamble = currentLines.join("\n").trim();
      const preambleTitle = "Introduction";
      const key = normalizeWhitespace(preambleTitle);
      sectionMap.set(key, preamble);
      headings.push({ title: preambleTitle, file: "source.md" });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const isFormFeed = rawLine.includes("\f");
    const line = rawLine.replace(/\f/g, "");
    const hashMatch = line.match(/^#{1,4}\s+(.+)$/);
    let matchedTitle = null;
    if (hashMatch) {
      matchedTitle = hashMatch[1].replace(/[*_#]/g, "").trim();
    } else if (i + 1 < lines.length && /^[=-]{3,}\s*$/.test(lines[i + 1]) && line.trim().length > 0 && !line.startsWith("<")) {
      matchedTitle = line.trim();
      i++;
    } else {
      const prevTrimmed = i > 0 ? lines[i - 1].trim() : "";
      const isPrevEmptyOrPage = prevTrimmed === "" || /^\d+$/u.test(prevTrimmed) || isFormFeed;
      const numMatch = line.match(/^\s*(\d+\.?\s+[A-Za-z][A-Za-z0-9\s,:-]{2,60})\s*$/);
      if (numMatch && (i === 0 || isPrevEmptyOrPage)) {
        matchedTitle = numMatch[1].trim();
      }
    }

    if (matchedTitle) {
      const cleaned = cleanHeading(matchedTitle) || matchedTitle;
      if (!/^abstract$/iu.test(cleaned)) {
        flush();
        currentTitle = cleaned;
        currentLines = [];
      }
    } else {
      currentLines.push(line);
    }
  }
  flush();
  return { headings, sectionMap };
}

export async function readLimitedResponse(response, maxBytes, label = "Source package") {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error(`${label} exceeds the byte limit`);
  if (!response.body) throw new Error(`${label} has no body`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${label} exceeds the byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function downloadSourcePackage(entry, { fetchImpl = globalThis.fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const id = normalizeArxivId(entry.arxiv_id);
  const url = `https://export.arxiv.org/src/${id}v${Number(entry.revision)}`;
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if ((response.status === 429 || response.status === 503) && attempt < 2) {
      const retrySec = Number(response.headers?.get?.("retry-after")) || (attempt + 1) * 2;
      await new Promise((r) => setTimeout(r, Math.min(10, retrySec) * 1000));
      continue;
    }
    break;
  }
  if (!response.ok) throw new Error(`arXiv source retrieval failed with HTTP ${response.status}`);
  const finalUrl = response.url || url;
  const identity = sourceUrlIdentity(finalUrl);
  if (!identity || identity.arxiv_id !== id || identity.revision !== Number(entry.revision)) {
    throw new Error("arXiv source redirect changed the requested revision");
  }
  return { url: finalUrl, bytes: await readLimitedResponse(response, MAX_SOURCE_BYTES) };
}

export async function fetchViaDeepxiv(arxivId, revision, { timeoutMs = 30000, breaker = defaultDeepxivBreaker } = {}) {
  if (!breaker.isAvailable()) return null;
  const deepxivBin = "/home/long/.local/bin/deepxiv";
  return new Promise((resolvePromise) => {
    execFile(deepxivBin, ["paper", arxivId, "--raw"], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const combined = `${error.message}\n${stderr || ""}`;
        if (/quota|exceeded|429|402|token invalid|rate limit/iu.test(combined)) {
          breaker.trip(combined.slice(0, 100));
        }
        return resolvePromise(null);
      }
      const rawText = stdout?.trim();
      if (!rawText || rawText.length < 500) return resolvePromise(null);
      const { headings, sectionMap } = parseMarkdownSections(rawText);
      if (headings.length < 2) return resolvePromise(null);
      const sha256 = createHash("sha256").update(Buffer.from(rawText)).digest("hex");
      const url = `https://export.arxiv.org/src/${normalizeArxivId(arxivId)}v${revision}`;
      resolvePromise({
        url,
        sha256,
        sections: headings,
        sectionMap,
        bodyText: rawText.slice(0, MAX_BODY_CHARS),
        abstractText: "",
        sourceKind: "deepxiv",
      });
    });
  });
}

export async function fetchViaArxivSource(entry, { fetchImpl = globalThis.fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const loaded = await downloadSourcePackage(entry, { fetchImpl, timeoutMs });
  const parsed = parseSourcePackage(Buffer.from(loaded.bytes));
  return {
    ...parsed,
    url: loaded.url,
    sourceKind: "arxiv_source_package",
  };
}

export async function fetchViaPdf(entry, { fetchImpl = globalThis.fetch, timeoutMs = SOURCE_TIMEOUT_MS } = {}) {
  const id = normalizeArxivId(entry.arxiv_id);
  const rev = Number(entry.revision);
  const pdfUrl = `https://export.arxiv.org/pdf/${id}v${rev}`;
  const response = await fetchImpl(pdfUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`PDF retrieval failed with HTTP ${response.status}`);
  const pdfBytes = await readLimitedResponse(response, MAX_PACKAGE_BYTES, "PDF document");

  return new Promise((resolvePromise, rejectPromise) => {
    const proc = execFile("/usr/bin/pdftotext", ["-layout", "-", "-"], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 }, (error, stdout) => {
      if (error) return rejectPromise(error);
      const text = stdout?.trim();
      if (!text || text.length < 500) return rejectPromise(new Error("Extracted PDF text is empty"));
      let { headings, sectionMap } = parseMarkdownSections(text);
      if (headings.length < 2) {
        const defaultTitles = ["Introduction", "Observations and Methods", "Results", "Discussion", "Conclusions"];
        headings = defaultTitles.map((title) => ({ title, file: "paper.pdf", level: 0 }));
        sectionMap = new Map();
        const partLen = Math.floor(text.length / defaultTitles.length);
        defaultTitles.forEach((title, idx) => {
          const sliceStart = idx * partLen;
          const sliceEnd = idx === defaultTitles.length - 1 ? text.length : (idx + 1) * partLen;
          sectionMap.set(normalizeWhitespace(title), text.slice(sliceStart, sliceEnd));
        });
      }
      resolvePromise({
        url: `https://export.arxiv.org/src/${id}v${rev}`,
        sha256: createHash("sha256").update(pdfBytes).digest("hex"),
        sections: headings,
        sectionMap,
        bodyText: text.slice(0, MAX_BODY_CHARS),
        abstractText: "",
        sourceKind: "pdf",
      });
    });
    proc.stdin.end(pdfBytes);
  });
}

export async function cleanupStaleWorkspaces({
  baseDir = tmpdir(),
  maxAgeMs = 3600_000,
  prefix = "axv-paper-"
} = {}) {
  let cleanedCount = 0;
  try {
    const entries = await readdir(baseDir);
    const now = Date.now();
    for (const name of entries) {
      if (name.startsWith(prefix)) {
        const fullPath = join(baseDir, name);
        try {
          const stats = await stat(fullPath);
          if (now - stats.mtimeMs > maxAgeMs) {
            await rm(fullPath, { recursive: true, force: true });
            cleanedCount++;
          }
        } catch {}
      }
    }
  } catch {}
  return cleanedCount;
}

function normalizeAdapterResult(res, paperId) {
  if (!res) return null;
  if (res.success && res.data) {
    const d = res.data;
    return {
      paperId: d.paperId || paperId,
      ...d,
      text: d.text || d.bodyText || "",
      bodyText: d.bodyText || d.text || "",
    };
  }
  if (res.sourceKind && (Array.isArray(res.sections) || Array.isArray(res.headings))) {
    return {
      paperId: res.paperId || paperId,
      ...res,
      text: res.text || res.bodyText || "",
      bodyText: res.bodyText || res.text || "",
    };
  }
  return null;
}

function classifyAcquisitionError(err) {
  const msg = err?.message || String(err || "");
  if (/quota|exceeded|429|402|rate limit/iu.test(msg)) return ACQUISITION_ERROR_CODES.RATE_LIMIT;
  if (/404|not found/iu.test(msg)) return ACQUISITION_ERROR_CODES.NOT_FOUND;
  if (/timeout|timed out/iu.test(msg)) return ACQUISITION_ERROR_CODES.TIMEOUT;
  if (/empty|parse|heading|truncate|incomplete|unresolved|unsupported/iu.test(msg)) return ACQUISITION_ERROR_CODES.PARSING_FAILED;
  return ACQUISITION_ERROR_CODES.UNKNOWN;
}

/**
 * Deep module interface: acquirePaper(entry, options) -> Promise<AcquisitionResult>
 * Result pattern: { success: true, data: PaperSnapshot } | { success: false, error: AcquisitionError }
 */
export async function acquirePaper(entry, {
  adapters,
  deepxivBreaker = defaultDeepxivBreaker,
  fetchImpl = globalThis.fetch,
  timeoutMs = SOURCE_TIMEOUT_MS,
  cleanupWorkspaces = true
} = {}) {
  const startTime = Date.now();
  const id = normalizeArxivId(entry.arxiv_id);
  const rev = Number(entry.revision) || 1;
  const paperId = `${id}v${rev}`;

  if (cleanupWorkspaces) {
    cleanupStaleWorkspaces().catch(() => {});
  }

  let lastError = null;

  // 1. Adapter: Deepxiv (Tier 1)
  const deepxivFn = adapters?.deepxiv || (async () => {
    return await fetchViaDeepxiv(id, rev, { timeoutMs: 30000, breaker: deepxivBreaker });
  });

  if (deepxivBreaker.isAvailable() || adapters?.deepxiv) {
    try {
      const res = await deepxivFn(entry);
      const norm = normalizeAdapterResult(res, paperId);
      if (norm) {
        return {
          success: true,
          data: {
            ...norm,
            durationMs: Date.now() - startTime
          }
        };
      }
      if (res?.success === false && res.error) {
        lastError = res.error;
      }
    } catch (err) {
      lastError = { code: classifyAcquisitionError(err), message: err.message };
      console.warn(`[PaperAcquisition] deepxiv tier failed for ${id}v${rev}: ${err.message}`);
    }
  }

  // 2. Adapter: arXiv TeX source (Tier 2)
  const texFn = adapters?.arxivTex || (async () => {
    return await fetchViaArxivSource(entry, { fetchImpl, timeoutMs });
  });

  try {
    const res = await texFn(entry);
    const norm = normalizeAdapterResult(res, paperId);
    if (norm) {
      return {
        success: true,
        data: {
          ...norm,
          durationMs: Date.now() - startTime
        }
      };
    }
    if (res?.success === false && res.error) {
      lastError = res.error;
    }
  } catch (err) {
    lastError = { code: classifyAcquisitionError(err), message: err.message };
    console.warn(`[PaperAcquisition] arXiv TeX tier failed for ${id}v${rev}: ${err.message}`);
  }

  // 3. Adapter: PDF fallback (Tier 3)
  const pdfFn = adapters?.pdf || (async () => {
    return await fetchViaPdf(entry, { fetchImpl, timeoutMs });
  });

  try {
    const res = await pdfFn(entry);
    const norm = normalizeAdapterResult(res, paperId);
    if (norm) {
      return {
        success: true,
        data: {
          ...norm,
          durationMs: Date.now() - startTime
        }
      };
    }
    if (res?.success === false && res.error) {
      lastError = res.error;
    }
  } catch (err) {
    lastError = { code: classifyAcquisitionError(err), message: err.message };
    console.warn(`[PaperAcquisition] PDF fallback tier failed for ${id}v${rev}: ${err.message}`);
  }

  return {
    success: false,
    error: lastError || {
      code: ACQUISITION_ERROR_CODES.PARSING_FAILED,
      message: `Unable to acquire paper body for ${id}v${rev} via deepxiv, TeX source, or PDF`
    }
  };
}

/**
 * Backward-compatible wrapper for legacy callers expecting the paper snapshot directly or throwing on error.
 */
export async function acquirePaperBody(entry, options = {}) {
  const result = await acquirePaper(entry, options);
  if (result.success && result.data) {
    return result.data;
  }
  throw new Error(result.error?.message || `Unable to acquire paper body for ${entry.arxiv_id}v${entry.revision}`);
}
