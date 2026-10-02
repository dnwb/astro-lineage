import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { buildDailyRadarModel, sourceFingerprint, validateDailyRadarPayload, normalizeArxivId } from "../scripts/daily-radar.mjs";
import { parseCliArgs, runAiAnalyzer, parseMarkdownSections, DeepxivCircuitBreaker, validateScientificOutput, sortQueueItems, checkedBodyChunk } from "../scripts/arxiv-ai-analyzer.mjs";
import { syncArxivArchives } from "../scripts/arxiv-archive.mjs";
import { runWeeklySummary } from "../scripts/arxiv-weekly-summary.mjs";

function entry(arxiv_id, day, abstract = "This paper studies dense environments and radio transients.") {
  return {
    arxiv_id,
    revision: 1,
    title: `A study of ${arxiv_id}`,
    abstract,
    published: `${day}T12:00:00Z`,
    updated: `${day}T12:00:00Z`,
    authors: ["Fixture Author"],
    url: `https://arxiv.org/abs/${arxiv_id}v1`,
  };
}

function feed(entries, day = "2026-09-07") {
  return {
    generated_at: `${day}T18:00:00Z`,
    query: "cat:astro-ph.HE",
    source_url: "https://export.arxiv.org/api/query",
    window: { kind: "announcement_batch", batch_id: `announcement-${day}`, announcement_date: day },
    entries,
  };
}

function emptyRadar() {
  return { edition: {}, analyses: [], knowledge_points: [], opening_brief: { status: "unavailable", reason: "fixture" } };
}

function abstractSkip() {
  return {
    priority: "skip",
    reason: "The topic is unrelated to the group's transient-astrophysics interests.",
    result: "The paper reports a measured clustering bias for ordinary galaxies.",
    problem: "unknown",
    method: "unknown",
    reading_entry: "unknown",
    research_progress: "unknown",
    assumptions: [],
    limits: [],
    evidence: [{
      section: "Abstract",
      quote: "This paper studies galaxy clustering and reports a measured bias in large scale structure.",
      supports: ["reason", "result"],
    }],
  };
}

function abstractWorthKnowing() {
  return { priority: "worth_knowing", reason: "This may constrain the group's environment models." };
}

const BODY_TEX = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
This study asks how dense surroundings shape radio transients.
\section{Model assumptions}
We assume a spherical uniform ambient medium.
\section{Methods}
We solve radiation hydrodynamics with a numerical transport model.
\section{Results}
The model produces a measurable radio transient.
\section{Discussion and conclusion}
The inferred density remains uncertain.
\end{document}`;

function fullBodyOutput(priority = "must_read") {
  return {
    priority,
    reason: "The body links the environment model to a testable transient signal.",
    result: "The model produces a measurable radio transient.",
    problem: "The study asks how dense surroundings shape radio transients.",
    method: "The authors solve radiation hydrodynamics with numerical transport.",
    reading_entry: "Results",
    assumptions: [],
    limits: [],
    research_progress: "The model yields a measurable radio transient.",
    inspected_sections: ["Introduction", "Model assumptions", "Methods", "Results", "Discussion and conclusion"],
    evidence: [
      { section: "Introduction", quote: "This study asks how dense surroundings shape radio transients.", supports: ["reason", "problem"] },
      { section: "Methods", quote: "We solve radiation hydrodynamics with a numerical transport model.", supports: ["method"] },
      { section: "Results", quote: "The model produces a measurable radio transient.", supports: ["result", "research_progress"] },
    ],
  };
}

function worthBodyOutput() {
  return {
    priority: "worth_knowing",
    reason: "The results may inform the group's environment models.",
    result: "The model produces a measurable radio transient.",
    problem: "unknown",
    method: "unknown",
    reading_entry: "Results",
    assumptions: [],
    limits: [],
    research_progress: "The model produces a measurable radio transient.",
    inspected_sections: ["Results"],
    evidence: [{ section: "Results", quote: "The model produces a measurable radio transient.", supports: ["reason", "result", "research_progress"] }],
  };
}

async function setup(t, { withRadar = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "arxiv-ai-analyzer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = {
    directory,
    feed: join(directory, "feed.json"),
    radar: join(directory, "radar.json"),
    archiveRoot: join(directory, "archives"),
    artifactRoot: join(directory, "artifacts"),
    statePath: join(directory, "screening-queue.json"),
  };
  await writeFile(paths.feed, `${JSON.stringify(feed([]), null, 2)}\n`);
  if (withRadar) await writeFile(paths.radar, `${JSON.stringify(emptyRadar(), null, 2)}\n`);
  return paths;
}

async function writeFeed(paths, value) {
  await writeFile(paths.feed, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeArchive(paths, item, date) {
  const daily = join(paths.archiveRoot, "daily");
  await mkdir(daily, { recursive: true });
  const archivedFeed = feed([item], date);
  const archive = {
    schema_version: "astrolineage-daily-archive-v1",
    date,
    batch_id: archivedFeed.window.batch_id,
    feed: archivedFeed,
    radar: {
      analyses: [],
      historical_analyses: [],
      opening_brief: { status: "unavailable", reason: "fixture" },
    },
  };
  await writeFile(join(daily, `${date}.json`), `${JSON.stringify(archive, null, 2)}\n`);
}

function sourceFor(item) {
  return {
    url: `https://export.arxiv.org/src/${item.arxiv_id}v${item.revision}`,
    bytes: Buffer.from(BODY_TEX),
  };
}

function tarOctal(header, offset, length, value) {
  header.write(String(value.toString(8).padStart(length - 1, "0")), offset, length - 1, "ascii");
  header[offset + length - 1] = 0;
}

function tarArchive(files) {
  const chunks = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    tarOctal(header, 100, 8, 0o644);
    tarOctal(header, 108, 8, 0);
    tarOctal(header, 116, 8, 0);
    tarOctal(header, 124, 12, body.length);
    tarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

test("abstract skips need no body source and bootstrap a missing radar safely", async (t) => {
  const paths = await setup(t, { withRadar: false });
  const item = entry("2609.90001", "2026-09-07", "This paper studies galaxy clustering and reports a measured bias in large scale structure.");
  await writeFeed(paths, feed([item]));
  let sourceCalls = 0;

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage }) => {
      assert.equal(stage, "abstract");
      return abstractSkip();
    },
    sourceLoader: async () => {
      sourceCalls += 1;
      throw new Error("skip should not fetch body");
    },
  });

  assert.equal(sourceCalls, 0);
  const publishedRadar = JSON.parse(await readFile(paths.radar, "utf8"));
  assert.equal(buildDailyRadarModel(feed([item]), publishedRadar).groups.skip.length, 1);
  assert.equal(publishedRadar.analyses[0].coverage.level, "abstract_only");
  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items[0].reading_status, "not_required");
});

test("a Chinese abstract locator normalizes to Abstract only for abstract-level Skim", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.90009", "2026-09-07", "This paper studies galaxy clustering and reports a measured bias in large scale structure.");
  await writeFeed(paths, feed([item]));
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async () => {
      const output = abstractSkip();
      output.evidence[0].section = "摘要";
      return output;
    },
    sourceLoader: async () => { throw new Error("Skim must not fetch body"); },
  });
  const model = buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8")));
  assert.equal(model.groups.skip.length, 1);
  assert.equal(model.groups.skip[0].analysis.analysis.citation_leads[0].startsWith("Abstract:"), true);
});

test("a figure-heavy source package reads the complete TeX without passing binary figures to the model", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.93540", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const source = gzipSync(tarArchive({
    "main.tex": BODY_TEX,
    "figure.png": randomBytes(9 * 1024 * 1024),
  }));
  const observedPrompts = [];
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      observedPrompts.push(prompt);
      return { ...fullBodyOutput(), result: "模型产生可测的射电瞬变。环境密度仍不确定。" };
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: source }),
  });
  const model = buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8")));
  assert.equal(model.groups.must_read.length, 1);
  assert.equal(model.opening_brief.status, "ready");
  assert.equal(model.opening_brief.must_read[0].text, "模型产生可测的射电瞬变。");
  assert.equal(observedPrompts.length, 1);
  assert.doesNotMatch(observedPrompts[0], /figure\.png/u);
});

test("an unresolved include or expanded source over the package cap remains pending", async (t) => {
  const paths = await setup(t);
  const missing = entry("2609.93541", "2026-09-07");
  const expanded = entry("2609.93542", "2026-09-07");
  await writeFeed(paths, feed([missing, expanded]));
  const oversizedGzip = gzipSync(Buffer.alloc(129 * 1024 * 1024, 65));
  let bodyCalls = 0;
  await runAiAnalyzer({
    ...paths,
    limit: 2,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      bodyCalls += 1;
      return fullBodyOutput();
    },
    sourceLoader: async (candidate) => ({
      url: `https://export.arxiv.org/src/${candidate.arxiv_id}v1`,
      bytes: candidate.arxiv_id === missing.arxiv_id
        ? Buffer.from(BODY_TEX.replace("\\section{Methods}", "\\input{missing-section}\n\\section{Methods}"))
        : oversizedGzip,
    }),
  });
  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(bodyCalls, 0);
  assert.ok(queue.items.every((item) => item.state === "awaiting_body" && item.analysis.status === "failed"));
  assert.match(queue.items.find((item) => item.entry.arxiv_id === missing.arxiv_id).last_error, /unresolved TeX include/u);
  assert.match(queue.items.find((item) => item.entry.arxiv_id === expanded.arxiv_id).last_error, /larger than|exceeds|too large/iu);
});

test("a macro-expanded missing include cannot publish a full-body recommendation", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.93543", "2026-09-07");
  const expectedFeed = feed([item]);
  await writeFeed(paths, expectedFeed);
  const source = BODY_TEX.replace(
    "\\section{Methods}",
    String.raw`\newcommand{\missingfile}{missing.tex}
\input\missingfile
\section{Methods}`,
  );
  let bodyCalls = 0;

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      bodyCalls += 1;
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(source) }),
  });

  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  const publishedRadar = JSON.parse(await readFile(paths.radar, "utf8"));
  const reader = buildDailyRadarModel(expectedFeed, publishedRadar);
  assert.equal(bodyCalls, 0);
  assert.equal(queue.items[0].state, "awaiting_body");
  assert.match(queue.items[0].last_error, /unresolved|unsupported|dynamic.*include/iu);
  assert.equal(reader.groups.must_read.length, 0);
});

test("literal braced and unbraced includes remain readable while commented includes are ignored", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.93544", "2026-09-07");
  const expectedFeed = feed([item]);
  await writeFeed(paths, expectedFeed);
  const main = BODY_TEX.replace(
    "\\section{Methods}",
    String.raw`\input{first}
\include second.tex
% \input{missing.tex}
\section{Methods}`,
  );
  const source = gzipSync(tarArchive({
    "main.tex": main,
    "first.tex": "Additional physical context from a complete source file.",
    "second.tex": "Further complete source material.",
  }));

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage }) => stage === "abstract" ? abstractWorthKnowing() : fullBodyOutput(),
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: source }),
  });

  const publishedRadar = JSON.parse(await readFile(paths.radar, "utf8"));
  const reader = buildDailyRadarModel(expectedFeed, publishedRadar);
  assert.equal(reader.groups.must_read.length, 1);
  assert.equal(publishedRadar.analyses[0].coverage.level, "full_body");
});

test("a long body resumes bounded portion reading and publishes only after every portion succeeds", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91230", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const longTex = BODY_TEX.replace("We solve radiation", `${"Physical detail about transport and cooling. ".repeat(2600)}\nWe solve radiation`);
  const stages = [];
  let failOnce = true;
  const run = () => runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      stages.push({ stage, length: prompt.length });
      if (stage === "abstract") return abstractWorthKnowing();
      if (stage === "body_chunk") {
        if (failOnce && stages.filter((call) => call.stage === "body_chunk").length === 3) {
          failOnce = false;
          throw new Error("temporary chunk outage");
        }
        const chunk = prompt.split("SOURCE TEXT:\n")[1];
        return { summary: "Text discusses transport and cooling or adjacent sections.", quote: chunk.match(/[A-Za-z][A-Za-z ]{20,}/u)?.[0]?.slice(0, 40) };
      }
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(longTex) }),
  });

  await run();
  let queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items[0].state, "awaiting_body");
  assert.equal(queue.items[0].reading_progress.completed.length, 2);
  const completedBeforeRetry = queue.items[0].reading_progress.completed.length;
  const chunkCallsBeforeRetry = stages.filter((call) => call.stage === "body_chunk").length;
  await run();
  queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items[0].state, "complete");
  assert.ok(queue.items[0].reading_progress.completed.length > completedBeforeRetry);
  assert.equal(stages.filter((call) => call.stage === "abstract").length, 1);
  assert.equal(stages.filter((call) => call.stage === "body_chunk").length, queue.items[0].reading_progress.total_chunks + 1);
  assert.ok(stages.filter((call) => call.stage === "body_chunk").every((call) => call.length < 20_000));
  assert.equal(chunkCallsBeforeRetry, 3);
  assert.equal(buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8"))).groups.must_read.length, 1);
});

test("resumed body progress rechecks source completeness before any further chunk", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91239", "2026-09-07");
  const expectedFeed = feed([item]);
  await writeFeed(paths, expectedFeed);
  let sourceText = BODY_TEX.replace("We solve radiation", `${"Physical detail about transport and cooling. ".repeat(2600)}\nWe solve radiation`);
  let chunkCalls = 0;
  const run = () => runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      if (stage === "body_chunk") {
        chunkCalls += 1;
        if (chunkCalls === 2) throw new Error("interrupted body read");
        const chunk = prompt.split("SOURCE TEXT:\n")[1];
        return { summary: "The source discusses transport.", quote: chunk.match(/[A-Za-z][A-Za-z ]{20,}/u)?.[0]?.slice(0, 40) };
      }
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(sourceText) }),
  });

  await run();
  let queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items[0].reading_progress.completed.length, 1);
  sourceText = sourceText.replace("\\section{Methods}", String.raw`\newcommand{\missingfile}{missing.tex}
\input\missingfile
\section{Methods}`);
  await run();
  queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(chunkCalls, 2);
  assert.equal(queue.items[0].state, "awaiting_body");
  assert.match(queue.items[0].last_error, /unsupported dynamic TeX include/u);
  assert.equal(buildDailyRadarModel(expectedFeed, JSON.parse(await readFile(paths.radar, "utf8"))).groups.must_read.length, 0);
});

test("assembled body prompts remain bounded even when source text is below the chunk threshold", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91232", "2026-09-07", `Dense-environment transients. ${"A".repeat(3000)}`);
  await writeFeed(paths, feed([item]));
  const longTex = BODY_TEX.replace("We solve radiation", `${"Physical detail about transport and cooling. ".repeat(1700)}\nWe solve radiation`);
  const promptLengths = [];

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      promptLengths.push(prompt.length);
      if (prompt.length > 80_000) throw new Error("assembled model prompt exceeds the accepted 80000-character bound");
      if (stage === "abstract") return abstractWorthKnowing();
      if (stage === "body_chunk") {
        const chunk = prompt.split("SOURCE TEXT:\n")[1];
        return { summary: "Transport and cooling in the source text.", quote: chunk.match(/[A-Za-z][A-Za-z ]{20,}/u)?.[0]?.slice(0, 40) };
      }
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(longTex) }),
  });

  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items[0].state, "complete");
  assert.ok(promptLengths.every((length) => length <= 80_000));
});

test("a real-model JSON escape pattern keeps LaTeX slashes intact in a body chunk", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91234", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const longTex = BODY_TEX.replace("We solve radiation", `${"Physical detail about transport and cooling. ".repeat(2100)}\nWe solve radiation`);
  // Redacted minimal form of the captured seventh-chunk response: an invalid \( escape
  // precedes an already-valid \\Pi escape. Scientific prose is intentionally omitted.
  const capturedPattern = String.raw`{"summary":"\( and \\Pi","quote":"This study asks how dense surroundings shape radio transients."}`;
  let chunkCalls = 0;

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      if (stage === "body_chunk") {
        chunkCalls += 1;
        if (chunkCalls === 1) return capturedPattern;
        const chunk = prompt.split("SOURCE TEXT:\n")[1];
        return { summary: "Transport and cooling in the source text.", quote: chunk.match(/[A-Za-z][A-Za-z ]{20,}/u)?.[0]?.slice(0, 40) };
      }
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(longTex) }),
  });

  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items[0].state, "complete");
  assert.equal(queue.items[0].reading_progress.completed[0].summary, String.raw`\( and \Pi`);
  assert.ok(chunkCalls > 1);
});

test("an ambiguous TeX JSON escape cannot publish a corrupted body summary", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91235", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const longTex = BODY_TEX.replace("We solve radiation", `${"Physical detail about transport and cooling. ".repeat(2100)}\nWe solve radiation`);
  const ambiguous = String.raw`{"summary":"\( and \rm and \\Pi","quote":"This study asks how dense surroundings shape radio transients."}`;
  let chunkCalls = 0;

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      if (stage === "body_chunk") {
        chunkCalls += 1;
        assert.ok(chunkCalls <= 2, `unexpected further chunk after two ambiguous responses: ${prompt.length}`);
        return ambiguous;
      }
      assert.fail(`unexpected ${stage} model call after ambiguous chunk`);
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(longTex) }),
  });

  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  const model = buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8")));
  assert.equal(queue.items[0].state, "awaiting_body");
  assert.equal(chunkCalls, 2);
  assert.match(queue.items[0].last_error, /ambiguous JSON escape/u);
  assert.equal(model.groups.must_read.length, 0);
  assert.equal(model.groups.worth_knowing.length, 0);
});

test("an ambiguous seventh-style body chunk gets one JSON-escaping correction before publication", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91236", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const longTex = BODY_TEX.replace("We solve radiation", `${"Physical detail about transport and cooling. ".repeat(2100)}\nWe solve radiation`);
  const ambiguous = String.raw`{"summary":"\( and \rm and \\Pi","quote":"This study asks how dense surroundings shape radio transients."}`;
  let firstChunkCalls = 0;

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      if (stage === "body_chunk") {
        if (prompt.includes("This study asks how dense surroundings shape radio transients.")) {
          firstChunkCalls += 1;
          if (firstChunkCalls === 1) return ambiguous;
          assert.match(prompt, /JSON-escaped TeX backslashes/u);
          return { summary: String.raw`\( and \rm and \Pi`, quote: "This study asks how dense surroundings shape radio transients." };
        }
        const chunk = prompt.split("SOURCE TEXT:\n")[1];
        return { summary: "Transport and cooling in the source text.", quote: chunk.match(/[A-Za-z][A-Za-z ]{20,}/u)?.[0]?.slice(0, 40) };
      }
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(longTex) }),
  });

  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(firstChunkCalls, 2);
  assert.equal(queue.items[0].state, "complete");
  assert.equal(queue.items[0].reading_progress.completed[0].summary, String.raw`\( and \rm and \Pi`);
});

test("the analyzer CLI rejects a process-argument API key without echoing it", () => {
  const secret = "fixture-secret-do-not-log";
  assert.throws(() => parseCliArgs([`--api-key=${secret}`]), (error) => {
    assert.match(error.message, /API key.*environment|environment.*API key/iu);
    assert.doesNotMatch(error.message, new RegExp(secret, "u"));
    return true;
  });
  assert.throws(() => parseCliArgs(["--only-ids="]), /only-ids requires at least one arXiv ID/u);
});

test("an oversized model response leaves screening pending without promoting a recommendation", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91233", "2026-09-07");
  await writeFeed(paths, feed([item]));
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response('{"choices":[]}', { headers: { "content-length": String(2 * 1024 * 1024 + 1) } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    apiKey: "fixture-key",
    sourceLoader: async () => assert.fail("abstract screening must not fetch source"),
  });

  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(requests, 3);
  assert.equal(queue.items[0].state, "queued");
  assert.match(queue.items[0].last_error, /Model response exceeds the byte limit/u);
  const model = buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8")));
  assert.equal(model.groups.must_read.length, 0);
  assert.equal(model.groups.worth_knowing.length, 0);
});

test("a changed source package cannot reuse previously read body portions", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91231", "2026-09-07");
  await writeFeed(paths, feed([item]));
  let sourceText = BODY_TEX.replace("We solve radiation", `${"Physical detail about transport and cooling. ".repeat(2600)}\nWe solve radiation`);
  let chunkCalls = 0;
  const run = () => runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      if (stage === "body_chunk") {
        chunkCalls += 1;
        if (chunkCalls === 2) throw new Error("first package interrupted");
        const chunk = prompt.split("SOURCE TEXT:\n")[1];
        return { summary: "This portion contains source text.", quote: chunk.match(/[A-Za-z][A-Za-z ]{20,}/u)?.[0]?.slice(0, 40) };
      }
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(sourceText) }),
  });

  await run();
  const first = JSON.parse(await readFile(paths.statePath, "utf8")).items[0].reading_progress;
  assert.equal(first.completed.length, 1);
  sourceText = sourceText.replace("Physical detail", "Physical change");
  await run();
  const second = JSON.parse(await readFile(paths.statePath, "utf8")).items[0].reading_progress;
  assert.notEqual(second.source_sha256, first.source_sha256);
  assert.equal(chunkCalls, second.total_chunks + 2);
});

test("an unverifiable body portion gets one correction before it is counted as read", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91237", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const longTex = BODY_TEX.replace("We solve radiation", `${"Physical detail about transport and cooling. ".repeat(2600)}\nWe solve radiation`);
  let chunkCalls = 0;
  const prompts = [];
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      if (stage === "body_chunk") {
        chunkCalls += 1;
        prompts.push(prompt);
        if (chunkCalls === 1) return { summary: "The text describes transport.", quote: "This is absent from the source." };
        const chunk = prompt.split("SOURCE TEXT:\n")[1].split("\n\n上一次")[0];
        return { summary: "The text describes transport.", quote: chunk.match(/[A-Za-z][A-Za-z ]{20,}/u)?.[0]?.slice(0, 40) };
      }
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(longTex) }),
  });
  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items[0].state, "complete");
  assert.equal(chunkCalls, queue.items[0].reading_progress.total_chunks + 1);
  assert.match(prompts[1], /This is absent from the source/u);
});

test("a macro-named body section remains an identifiable reading locator", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91232", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const sourceText = BODY_TEX.replace("\\section{Methods}", "\\subsection{\\CASTRO}\nThe radiation code is described here.\n\\subsection{Transport in \\CCSM\\ Interaction}\nThe surrounding medium is described here.\n\\section{Methods}");
  let sectionNames;
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, source }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      sectionNames = source.sections.map(({ title }) => title);
      return worthBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(sourceText) }),
  });
  assert.ok(sectionNames.includes("CASTRO"));
  assert.ok(sectionNames.includes("Transport in CCSM Interaction"));
});

test("an unverifiable first body quote is repaired before publication", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91233", "2026-09-07");
  await writeFeed(paths, feed([item]));
  let bodyCalls = 0;
  const prompts = [];
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      prompts.push(prompt);
      bodyCalls += 1;
      if (bodyCalls === 1) {
        const bad = fullBodyOutput();
        bad.evidence[0].quote = "This sentence does not appear in the source manuscript.";
        return bad;
      }
      return fullBodyOutput();
    },
    sourceLoader: async () => sourceFor(item),
  });
  const model = buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8")));
  assert.equal(bodyCalls, 2);
  assert.equal(model.groups.must_read.length, 1);
  assert.match(prompts[1], /verifiable|可核验|逐字/u);
  assert.match(prompts[1], /This sentence does not appear/u);
});

test("an abstract quote cannot support a body section and repair identifies its real locator", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91238", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const sourceText = BODY_TEX.replace("\\begin{document}", String.raw`\begin{document}
\begin{abstract}
Here we argue that dispersion changes can trace the photoionized surroundings.
\end{abstract}`);
  const prompts = [];
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      prompts.push(prompt);
      if (prompts.length === 1) {
        const output = fullBodyOutput();
        output.evidence[0].quote = "Here we argue that dispersion changes can trace the photoionized surroundings.";
        return output;
      }
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(sourceText) }),
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /摘录实际位于 Abstract/u);
  assert.match(prompts[1], /Here we argue that dispersion changes/u);
  const model = buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8")));
  assert.equal(model.groups.must_read.length, 1);
  assert.ok(model.groups.must_read[0].analysis.analysis.citation_leads.every((lead) => !lead.includes("Here we argue")));
});

test("long-body synthesis does not offer the discovery abstract as body evidence", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91239", "2026-09-07", "Discovery abstract only: this sentence is not in the source body.");
  await writeFeed(paths, feed([item]));
  const longTex = BODY_TEX.replace("We solve radiation", `${"Physical detail about transport and cooling. ".repeat(2600)}\nWe solve radiation`);
  let synthesisPrompt = "";
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage, prompt }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      if (stage === "body_chunk") {
        const chunk = prompt.split("SOURCE TEXT:\n")[1];
        return { summary: "This portion describes source physics.", quote: chunk.match(/[A-Za-z][A-Za-z ]{20,}/u)?.[0]?.slice(0, 40) };
      }
      synthesisPrompt = prompt;
      return fullBodyOutput();
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(longTex) }),
  });
  assert.doesNotMatch(synthesisPrompt, /Discovery abstract only: this sentence is not in the source body/u);
  assert.doesNotMatch(synthesisPrompt, /实际标题或 Abstract/u);
  assert.equal(buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8"))).groups.must_read.length, 1);
});

test("a parent section supports a verbatim quote from its named subsection", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91234", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const sourceText = BODY_TEX.replace("\\section{Methods}", "\\section{Methods}\n\\subsection{Transport code}");
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      const output = fullBodyOutput();
      output.inspected_sections.splice(3, 0, "Transport code");
      return output;
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(sourceText) }),
  });
  const model = buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8")));
  assert.equal(model.groups.must_read.length, 1);
});

test("a fully read review can be Must Read without a Methods-titled section", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91235", "2026-09-07");
  await writeFeed(paths, feed([item]));
  const sourceText = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
This review surveys electromagnetic probes of stellar explosions.
\section{Observations}
Radio and optical measurements constrain the explosion engine.
\section{Summary}
Joint observations provide complementary constraints on the engine.
\end{document}`;
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage }) => stage === "abstract" ? abstractWorthKnowing() : {
      priority: "must_read",
      reason: "This review surveys electromagnetic probes of stellar explosions.",
      result: "Joint observations provide complementary constraints on the engine.",
      problem: "This review surveys electromagnetic probes of stellar explosions.",
      method: "unknown",
      reading_entry: "Summary",
      research_progress: "Joint observations provide complementary constraints on the engine.",
      assumptions: [], limits: [],
      inspected_sections: ["Introduction", "Observations", "Summary"],
      evidence: [
        { section: "Introduction", quote: "This review surveys electromagnetic probes of stellar explosions.", supports: ["reason", "problem"] },
        { section: "Summary", quote: "Joint observations provide complementary constraints on the engine.", supports: ["result", "research_progress"] },
      ],
    },
    sourceLoader: async () => ({ url: `https://export.arxiv.org/src/${item.arxiv_id}v1`, bytes: Buffer.from(sourceText) }),
  });
  const model = buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8")));
  assert.equal(model.groups.must_read.length, 1);
  assert.deepEqual(model.groups.must_read[0].analysis.coverage.source_sections, ["Introduction", "Observations", "Summary"]);
});

test("unsupported optional limitations are omitted from an otherwise evidenced recommendation", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.91236", "2026-09-07");
  await writeFeed(paths, feed([item]));
  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      const output = fullBodyOutput();
      output.limits = ["The inferred density remains uncertain.", "Unsupported unrelated limitation."];
      output.evidence.push({ section: "Discussion and conclusion", quote: "The inferred density remains uncertain.", supports: ["limits[0]"] });
      return output;
    },
    sourceLoader: async () => sourceFor(item),
  });
  const model = buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8")));
  assert.equal(model.groups.must_read.length, 1);
  assert.deepEqual(model.groups.must_read[0].analysis.analysis.limits, ["The inferred density remains uncertain."]);
});

test("the bounded queue resumes body retries, drains archive rollover, and does not let an older failure starve new work", async (t) => {
  const paths = await setup(t);
  const first = entry("2609.90002", "2026-09-01");
  const archived = entry("2609.90003", "2026-09-02");
  await writeFeed(paths, feed([first]));
  await writeArchive(paths, archived, "2026-09-02");
  const bodyPrompts = [];
  let failFirstBody = true;
  const modelRunner = async ({ stage, entry: _candidate, prompt }) => {
    if (stage === "abstract") return abstractWorthKnowing();
    bodyPrompts.push(prompt);
    return fullBodyOutput();
  };
  const sourceLoader = async (candidate) => {
    if (candidate.arxiv_id === first.arxiv_id && failFirstBody) {
      failFirstBody = false;
      throw new Error("temporary source outage");
    }
    return sourceFor(candidate);
  };
  const run = () => runAiAnalyzer({ ...paths, limit: 1, concurrency: 1, syncArchives: false, modelRunner, sourceLoader });

  await run();
  let queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  const firstItem = queue.items.find(({ entry: candidate }) => candidate.arxiv_id === first.arxiv_id);
  const archivedItem = queue.items.find(({ entry: candidate }) => candidate.arxiv_id === archived.arxiv_id);
  assert.equal(firstItem.state, "awaiting_body");
  assert.equal(firstItem.attempts, 1);
  assert.equal(firstItem.reading_attempts, 1);
  assert.equal(archivedItem.attempts, 0, "the run limit leaves unselected archive candidates durable");

  await run();
  queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items.find(({ entry: candidate }) => candidate.arxiv_id === archived.arxiv_id).state, "complete");
  assert.equal(queue.items.find(({ entry: candidate }) => candidate.arxiv_id === first.arxiv_id).state, "awaiting_body");
  assert.match(bodyPrompts[0], /The model produces a measurable radio transient\./u, "the body prompt includes actual source text");
  assert.match(bodyPrompts[0], /不表示图像、图表、附加数据或二进制文件已被视觉检查/u);

  await run();
  queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.ok(queue.items.every((item) => item.state === "complete"));
  const currentRadar = JSON.parse(await readFile(paths.radar, "utf8"));
  assert.equal(currentRadar.analyses[0].arxiv_id, first.arxiv_id);
  assert.equal(currentRadar.analyses[0].coverage.level, "full_body");
  const historical = currentRadar.historical_analyses.find((item) => item.arxiv_id === archived.arxiv_id);
  assert.equal(historical.historical_edition, "announcement-2026-09-02");
  assert.equal(historical.historical_edition_fingerprint, queue.items.find(({ entry: candidate }) => candidate.arxiv_id === archived.arxiv_id).editions[0].historical_edition_fingerprint);
  assert.equal(historical.source_fingerprint, sourceFingerprint(archived));
});

test("FIFO retries and age prevent failed reads or teacher priorities from starving arrivals", async (t) => {
  const paths = await setup(t);
  const first = entry("2609.90020", "2026-09-01");
  const arrivals = [
    entry("2609.90021", "2026-09-02"),
    entry("2609.90022", "2026-09-03"),
    entry("2609.90023", "2026-09-04"),
    entry("2609.90024", "2026-09-05"),
    entry("2609.90025", "2026-09-06"),
    entry("2609.90026", "2026-09-07"),
  ];
  const priorityIds = [arrivals[1].arxiv_id, arrivals[3].arxiv_id, arrivals[4].arxiv_id, arrivals[5].arxiv_id];
  const screened = [];
  const sourceAttempts = [];
  let clock = Date.now();
  const now = () => new Date(clock += 1000);
  const analyze = () => runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    priorityIds,
    syncArchives: false,
    now,
    modelRunner: async ({ stage, entry: candidate }) => {
      if (stage === "abstract") {
        screened.push(candidate.arxiv_id);
        return abstractWorthKnowing();
      }
      return worthBodyOutput();
    },
    sourceLoader: async (candidate) => {
      sourceAttempts.push(candidate.arxiv_id);
      if (candidate.arxiv_id === first.arxiv_id) throw new Error("temporary source outage");
      return sourceFor(candidate);
    },
  });

  const observed = [first];
  for (let run = 0; run < 7; run += 1) {
    if (run > 0) {
      observed.push(arrivals[run - 1]);
      await rm(join(paths.artifactRoot, "current-generation.json"), { force: true });
      await rm(join(paths.artifactRoot, "generations"), { recursive: true, force: true });
    }
    await writeFeed(paths, feed(observed));
    await analyze();
  }

  assert.deepEqual(screened, [first.arxiv_id, arrivals[0].arxiv_id, arrivals[1].arxiv_id, arrivals[2].arxiv_id]);
  assert.equal(sourceAttempts.filter((arxiv_id) => arxiv_id === first.arxiv_id).length, 4, "the failed body's retry is not permanently pushed behind later arrivals");
  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  for (const candidate of [arrivals[0], arrivals[1], arrivals[2]]) {
    assert.equal(queue.items.find(({ entry: queued }) => queued.arxiv_id === candidate.arxiv_id).state, "complete");
  }
});

test("corrupt queue identities, states, and completed records fail closed without rewriting state", async (t) => {
  const corruptions = [
    ["unknown state", (item) => { item.state = "finished"; }],
    ["mismatched key", (item) => { item.key = "2609.90030@v2#wrong"; }],
    ["invalid identity", (item) => { item.entry.arxiv_id = "not-an-arxiv-id"; }],
    ["changed fingerprint", (item) => { item.source_fingerprint = "0".repeat(64); }],
    ["missing completed analysis", (item) => { item.state = "complete"; item.reading_status = "read"; }],
  ];

  for (const [label, corrupt] of corruptions) {
    const paths = await setup(t);
    const candidate = entry("2609.90030", "2026-09-08");
    await writeFeed(paths, feed([candidate]));
    const fingerprint = sourceFingerprint(candidate);
    const item = {
      key: `${candidate.arxiv_id}@v${candidate.revision}#${fingerprint}`,
      entry: candidate,
      source_fingerprint: fingerprint,
      state: "queued",
    };
    corrupt(item);
    const rawQueue = `${JSON.stringify({ schema_version: "arxiv-ai-screening-queue-v1", updated_at: "fixture", items: [item] }, null, 2)}\n`;
    await writeFile(paths.statePath, rawQueue);
    const rawRadar = await readFile(paths.radar, "utf8");

    await assert.rejects(runAiAnalyzer({ ...paths, syncArchives: false, modelRunner: async () => assert.fail("corrupt state must fail before model work") }), (error) => {
      assert.equal(error.code, "ARXIV_ANALYZER_STATE_INVALID", label);
      return true;
    });
    assert.equal(await readFile(paths.statePath, "utf8"), rawQueue, `${label} queue bytes are preserved`);
    assert.equal(await readFile(paths.radar, "utf8"), rawRadar, `${label} Radar bytes are preserved`);
  }
});

test("malformed parsed archive entries fail closed before queue or Radar publication", async (t) => {
  const paths = await setup(t);
  const candidate = entry("2609.90031", "2026-09-09");
  await writeFeed(paths, feed([candidate]));
  const rawQueue = `${JSON.stringify({ schema_version: "arxiv-ai-screening-queue-v1", updated_at: "fixture", items: [] }, null, 2)}\n`;
  await writeFile(paths.statePath, rawQueue);
  const rawRadar = await readFile(paths.radar, "utf8");
  const archivePath = join(paths.archiveRoot, "daily", "2026-09-08.json");
  await mkdir(join(paths.archiveRoot, "daily"), { recursive: true });
  await writeFile(archivePath, `${JSON.stringify({ schema_version: "astrolineage-daily-archive-v1", date: "2026-09-08", feed: { window: {} } })}\n`);

  await assert.rejects(runAiAnalyzer({ ...paths, syncArchives: false, modelRunner: async () => assert.fail("malformed archive must fail before model work") }), (error) => {
    assert.equal(error.code, "ARXIV_ARCHIVE_INVALID");
    assert.match(error.message, /2026-09-08\.json/u);
    return true;
  });
  assert.equal(await readFile(paths.statePath, "utf8"), rawQueue);
  assert.equal(await readFile(paths.radar, "utf8"), rawRadar);
});

test("Worth Knowing records supporting body sections, while incomplete Must Read inspection stays pending", async (t) => {
  const paths = await setup(t);
  const worth = entry("2609.90004", "2026-09-03");
  const incomplete = entry("2609.90005", "2026-09-04");
  await writeFeed(paths, feed([worth, incomplete]));

  const modelRunner = async ({ stage, entry: candidate }) => {
    if (stage === "abstract") return abstractWorthKnowing();
    if (candidate.arxiv_id === worth.arxiv_id) {
      return worthBodyOutput();
    }
    const output = fullBodyOutput();
    output.inspected_sections = ["Introduction", "Model assumptions", "Methods", "Results"];
    return output;
  };
  await runAiAnalyzer({
    ...paths,
    limit: 2,
    concurrency: 1,
    syncArchives: false,
    modelRunner,
    sourceLoader: async (candidate) => candidate.arxiv_id === worth.arxiv_id
      ? {
        url: `https://export.arxiv.org/src/${candidate.arxiv_id}v${candidate.revision}`,
        bytes: tarArchive({
          "main.tex": String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
This study asks how dense surroundings shape radio transients.
\\% \input{missing-file}
\input{sections/results}
\end{document}`,
          "sections/results.tex": String.raw`\section{Results}
The model produces a measurable radio transient.
The result is robust to a 10\% threshold.`,
        }),
      }
      : sourceFor(candidate),
  });

  const radar = JSON.parse(await readFile(paths.radar, "utf8"));
  const model = buildDailyRadarModel(feed([worth, incomplete]), radar);
  assert.equal(model.groups.worth_knowing.length, 1);
  assert.equal(model.groups.worth_knowing[0].analysis.coverage.level, "body_partial");
  assert.deepEqual(model.groups.worth_knowing[0].analysis.coverage.inspected_sections, ["Results"]);
  assert.equal(model.pending.some(({ arxiv_id }) => arxiv_id === incomplete.arxiv_id), true);
  assert.equal(model.groups.must_read.some(({ arxiv_id }) => arxiv_id === incomplete.arxiv_id), false);
  assert.equal(model.opening_brief.status, "ready");
  assert.equal(model.opening_brief.must_read.length, 0);
  assert.deepEqual(model.opening_brief.worth_knowing.map(({ arxiv_id }) => arxiv_id), [worth.arxiv_id]);
  assert.doesNotMatch(JSON.stringify(model.opening_brief), new RegExp(incomplete.arxiv_id, "u"));
});

test("wrong-revision and truncated source packages remain retryable and never become body recommendations", async (t) => {
  const paths = await setup(t);
  const wrongRevision = entry("2609.90006", "2026-09-05");
  const truncated = entry("2609.90007", "2026-09-06");
  await writeFeed(paths, feed([wrongRevision, truncated]));
  let bodyCalls = 0;

  await runAiAnalyzer({
    ...paths,
    limit: 2,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      bodyCalls += 1;
      return fullBodyOutput();
    },
    sourceLoader: async (candidate) => candidate.arxiv_id === wrongRevision.arxiv_id
      ? { ...sourceFor(candidate), url: `https://export.arxiv.org/src/${candidate.arxiv_id}v2` }
      : { ...sourceFor(candidate), bytes: Buffer.from(String.raw`\documentclass{article}\begin{document}\section{Results}truncated`) },
  });

  assert.equal(bodyCalls, 0);
  const radar = JSON.parse(await readFile(paths.radar, "utf8"));
  const model = buildDailyRadarModel(feed([wrongRevision, truncated]), radar);
  assert.equal(model.groups.worth_knowing.length, 0);
  assert.equal(model.pending.length, 2);
  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.ok(queue.items.every((item) => item.state === "awaiting_body" && item.reading_status === "pending"));
  assert.ok(queue.items.every((item) => item.last_error));
});

test("unbraced missing TeX input stays pending instead of publishing a full-body recommendation", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.90018", "2026-09-07");
  await writeFeed(paths, feed([item]));
  let bodyCalls = 0;

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    modelRunner: async ({ stage }) => {
      if (stage === "abstract") return abstractWorthKnowing();
      bodyCalls += 1;
      return fullBodyOutput();
    },
    sourceLoader: async (candidate) => ({
      url: `https://export.arxiv.org/src/${candidate.arxiv_id}v${candidate.revision}`,
      bytes: Buffer.from(BODY_TEX.replace("\\section{Methods}", "\\input missing.tex\n\\section{Methods}")),
    }),
  });

  const radar = JSON.parse(await readFile(paths.radar, "utf8"));
  const model = buildDailyRadarModel(feed([item]), radar);
  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(bodyCalls, 0);
  assert.equal(model.groups.must_read.length, 0);
  assert.equal(model.groups.worth_knowing.length, 0);
  assert.equal(queue.items[0].state, "awaiting_body");
  assert.match(queue.items[0].last_error, /unresolved TeX include/u);
});

test("an invalid abstract skip is not sticky and gets rescreened on a later run", async (t) => {
  const paths = await setup(t);
  const item = entry("2609.90008", "2026-09-07", "This paper studies galaxy clustering and reports a measured bias in large scale structure.");
  await writeFeed(paths, feed([item]));
  let abstractCalls = 0;
  const options = {
    ...paths,
    limit: 1,
    concurrency: 1,
    syncArchives: false,
    sourceLoader: async () => { throw new Error("skip should not fetch body"); },
    modelRunner: async () => {
      abstractCalls += 1;
      return abstractCalls === 1 ? { priority: "skip", reason: "unrelated" } : abstractSkip();
    },
  };

  await runAiAnalyzer(options);
  let queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items[0].state, "queued");
  assert.equal(queue.items[0].screening_attempts, 1);
  await runAiAnalyzer(options);
  queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(abstractCalls, 2);
  assert.equal(queue.items[0].state, "complete");
  assert.equal(queue.items[0].screening_attempts, 2);
  assert.equal(buildDailyRadarModel(feed([item]), JSON.parse(await readFile(paths.radar, "utf8"))).groups.skip.length, 1);
});

test("runtime teacher-priority IDs affect ordering only and are not embedded in analyzer defaults", async (t) => {
  const paths = await setup(t);
  const current = entry("2609.90009", "2026-09-08");
  const archived = entry("2609.90010", "2026-09-09", "This paper studies galaxy clustering and reports a measured bias in large scale structure.");
  await writeFeed(paths, feed([current]));
  await writeArchive(paths, archived, "2026-09-09");
  const called = [];

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    priorityIds: [archived.arxiv_id],
    syncArchives: false,
    modelRunner: async ({ stage, entry: candidate }) => {
      called.push([stage, candidate.arxiv_id]);
      return stage === "abstract" ? abstractSkip() : fullBodyOutput();
    },
    sourceLoader: async (candidate) => sourceFor(candidate),
  });

  assert.equal(called[0][1], archived.arxiv_id);
  const radar = JSON.parse(await readFile(paths.radar, "utf8"));
  assert.deepEqual(radar.analyses, [], "a priority ID changes queue order, not the current-edition membership or scientific decision");
  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  const item = queue.items.find(({ entry: candidate }) => candidate.arxiv_id === archived.arxiv_id);
  assert.equal(item.analysis.priority, "skip");
  assert.equal(item.state, "complete");
});

test("an explicit only-IDs retry leaves every other queued candidate untouched", async (t) => {
  const paths = await setup(t);
  const older = entry("2609.90021", "2026-09-01", "This paper studies galaxy clustering and reports a measured bias in large scale structure.");
  const target = entry("2609.90022", "2026-09-02", "This paper studies galaxy clustering and reports a measured bias in large scale structure.");
  await writeFeed(paths, feed([older, target]));
  const called = [];

  await runAiAnalyzer({
    ...paths,
    limit: 1,
    concurrency: 1,
    onlyIds: [`${target.arxiv_id}v1`],
    syncArchives: false,
    modelRunner: async ({ entry: candidate }) => {
      called.push(candidate.arxiv_id);
      return abstractSkip();
    },
    sourceLoader: async () => assert.fail("Skim must not fetch a source package"),
  });

  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.deepEqual(called, [target.arxiv_id]);
  assert.equal(queue.items.find(({ entry: candidate }) => candidate.arxiv_id === older.arxiv_id).attempts, 0);
  assert.equal(queue.items.find(({ entry: candidate }) => candidate.arxiv_id === target.arxiv_id).state, "complete");
});

test("five regression IDs survive bounded screening, daily archive sync, and weekly eligibility without forced picks", async (t) => {
  const paths = await setup(t);
  const samples = [
    entry("2609.24240", "2026-09-07"),
    entry("2609.13540", "2026-09-07"),
    entry("2609.12308", "2026-09-08", "This paper studies galaxy clustering and reports a measured bias in large scale structure."),
    entry("2609.11031", "2026-09-09"),
    entry("2609.09285", "2026-09-10"),
  ].map((item, index) => ({
    ...item,
    title: index === 2 ? `Skim sample ${item.arxiv_id}` : index === 1 || index === 4 ? `Worth Knowing sample ${item.arxiv_id}` : `Must Read sample ${item.arxiv_id}`,
  }));
  const currentItems = samples.slice(0, 2);
  await writeFeed(paths, feed(currentItems, "2026-09-07"));
  await writeArchive(paths, samples[2], "2026-09-08");
  await writeArchive(paths, samples[3], "2026-09-09");
  await writeArchive(paths, samples[4], "2026-09-10");
  const priorityIds = samples.map(({ arxiv_id }) => arxiv_id);
  const modelRunner = async ({ stage, entry: candidate }) => {
    if (stage === "abstract") return candidate.title.startsWith("Skim") ? abstractSkip() : abstractWorthKnowing();
    return candidate.title.startsWith("Worth Knowing") ? worthBodyOutput() : fullBodyOutput();
  };
  const analyze = () => runAiAnalyzer({
    ...paths,
    limit: 2,
    concurrency: 2,
    priorityIds,
    syncArchives: false,
    modelRunner,
    sourceLoader: async (candidate) => sourceFor(candidate),
  });

  await analyze();
  await analyze();
  await analyze();
  const queue = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(queue.items.length, 5);
  assert.ok(queue.items.every((item) => item.state === "complete"));
  assert.deepEqual(new Set(queue.items.map(({ entry: candidate }) => candidate.arxiv_id)), new Set(priorityIds));
  const currentRadar = JSON.parse(await readFile(paths.radar, "utf8"));
  assert.equal(validateDailyRadarPayload(feed(currentItems, "2026-09-07"), currentRadar).valid, true);
  assert.equal(currentRadar.analyses.length, 2);
  assert.equal(currentRadar.historical_analyses.length, 3);
  assert.equal(currentRadar.analyses.find(({ arxiv_id }) => arxiv_id === samples[0].arxiv_id).priority, "must_read");
  assert.equal(currentRadar.analyses.find(({ arxiv_id }) => arxiv_id === samples[1].arxiv_id).priority, "worth_knowing");

  const generations = join(paths.artifactRoot, "generations");
  const temporaryWeeklyCache = join(paths.directory, "weekly-cache");
  await syncArxivArchives({
    archiveRoot: paths.archiveRoot,
    currentFeedPath: paths.feed,
    currentRadarPath: paths.radar,
    currentWeeklyPath: join(paths.directory, "weekly-current.json"),
    dailyCacheDir: generations,
    weeklyCacheDir: temporaryWeeklyCache,
  });

  for (const item of samples) {
    const date = item.published.slice(0, 10);
    const daily = JSON.parse(await readFile(join(paths.archiveRoot, "daily", `${date}.json`), "utf8"));
    const validation = validateDailyRadarPayload(daily.feed, daily.radar);
    assert.equal(validation.valid, true, `${item.arxiv_id} archive edition remains source-valid (${validation.diagnostics.join(", ")})`);
    const visible = [...validation.model.groups.must_read, ...validation.model.groups.worth_knowing, ...validation.model.groups.skip];
    const included = visible.find(({ arxiv_id }) => arxiv_id === item.arxiv_id);
    assert.ok(included, `${item.arxiv_id} is represented by its exact archived edition`);
    assert.equal(included.analysis.source_fingerprint, sourceFingerprint(item));
  }

  const weekly = await runWeeklySummary({
    radar: paths.radar,
    feed: paths.feed,
    dailyArchiveDir: join(paths.archiveRoot, "daily"),
    output: join(paths.directory, "weekly.json"),
    weekId: "2026-W37",
    writeArchives: false,
    generateSummary: async ({ prompt }) => {
      for (const item of samples.filter(({ title }) => !title.startsWith("Skim"))) assert.match(prompt, new RegExp(item.arxiv_id));
      const mr = samples[0];
      const skim = samples[2];
      return JSON.stringify({
        executive_summary: "Synthetic fixture summary; no real scientific conclusion is asserted.",
        thematic_highlights: [],
        top_picks: [
          { arxiv_id: mr.arxiv_id, revision: 1, historical_edition: "announcement-2026-09-07", source_fingerprint: sourceFingerprint(mr), priority: "must_read", recommendation_reason: "fixture", core_insight: "fixture", reading_guide: "fixture" },
          { arxiv_id: skim.arxiv_id, revision: 1, historical_edition: "announcement-2026-09-08", source_fingerprint: sourceFingerprint(skim), priority: "skip", recommendation_reason: "fixture", core_insight: "fixture", reading_guide: "fixture" },
        ],
      });
    },
  });

  assert.equal(weekly.papers.length, 5);
  assert.deepEqual(new Set(weekly.papers.map(({ arxiv_id }) => arxiv_id)), new Set(priorityIds));
  assert.deepEqual(weekly.top_picks.map(({ arxiv_id }) => arxiv_id), [samples[0].arxiv_id]);
  assert.equal(weekly.papers.find(({ arxiv_id }) => arxiv_id === samples[2].arxiv_id).priority, "skip");
});

test("parseMarkdownSections cleanly extracts headings and sectionMap from Markdown and text", () => {
  const md = `
# 1. Introduction
This is the introduction text about relativistic jets.

## 2. Observations and Data Analysis
We observed the target with VLA and ALMA.

### 3. Numerical Modeling
The simulation shows a clear shock breakout.

4. Discussion and Conclusions
-----------------------------
We conclude that the circumstellar density is high.
`;
  const { headings, sectionMap } = parseMarkdownSections(md);
  assert.ok(headings.length >= 4);
  assert.ok(headings.some((h) => /Introduction/i.test(h.title)));
  assert.ok(headings.some((h) => /Observations/i.test(h.title)));
  assert.ok(headings.some((h) => /Modeling/i.test(h.title)));
  assert.ok(headings.some((h) => /Discussion/i.test(h.title)));
  assert.ok(sectionMap.size >= 4);
});

test("DeepxivCircuitBreaker trips upon quota error and cools down", () => {
  const breaker = new DeepxivCircuitBreaker(500);
  assert.equal(breaker.isAvailable(), true);
  breaker.trip("HTTP 429 Quota Exceeded");
  assert.equal(breaker.isAvailable(), false);
  breaker.reset();
  assert.equal(breaker.isAvailable(), true);
});

test("CLI argument parsing accepts --date, --dates, --backlog, --triage-model, and --body-model", () => {
  const parsedSingle = parseCliArgs(["--date=2026-09-23", "--limit=5", "--triage-model=gpt-6-luna", "--body-model=gpt-6.1-sol"]);
  assert.deepEqual(parsedSingle.dates, ["2026-09-23"]);
  assert.equal(parsedSingle.limit, 5);
  assert.equal(parsedSingle.backlog, false);
  assert.equal(parsedSingle.triageModel, "gpt-6-luna");
  assert.equal(parsedSingle.bodyModel, "gpt-6.1-sol");

  const parsedMulti = parseCliArgs(["--dates=2026-09-20,2026-09-21", "--backlog"]);
  assert.deepEqual(parsedMulti.dates, ["2026-09-20", "2026-09-21"]);
  assert.equal(parsedMulti.backlog, true);
});

test("validateScientificOutput refuses to fabricate evidence supports and fails closed when a required field lacks evidence", () => {
  const fakeParsed = {
    priority: "must_read",
    reason: "Valid reason for interest",
    result: "Specific numerical result from analysis",
    problem: "Specific research question being addressed",
    method: "Advanced numerical modeling with simulation", // no evidence excerpt supports method!
    reading_entry: "Results",
    assumptions: [],
    limits: [],
    research_progress: "Meaningful scientific progress",
    inspected_sections: ["Methods", "Results"],
    evidence: [
      {
        section: "Results",
        quote: "Specific numerical result from analysis",
        supports: ["result", "problem", "reason", "research_progress"], // does NOT support "method"
      },
    ],
  };

  const options = {
    entry: { arxiv_id: "2609.99999", revision: 1, abstract: "abstract text" },
    sourceSections: [{ title: "Methods" }, { title: "Results" }],
    sourceSectionMap: new Map([
      ["methods", "This section describes the numerical methods used."],
      ["results", "Specific numerical result from analysis"],
    ]),
    sourceAbstractText: "abstract text",
    abstract: false,
  };

  // It should reject with missing evidence for method, AND must NOT mutate evidence[0].supports to inject "method"
  assert.throws(
    () => validateScientificOutput(fakeParsed, options),
    /Model response has no source excerpt supporting method/
  );
  assert.ok(!fakeParsed.evidence[0].supports.includes("method"), "must not mutate or fake support for unevidenced field");
});

test("sortQueueItems does not let unattempted arrivals starve older failed reads waiting for retry", () => {
  const olderFailedRetry = {
    key: "historical-1@v1",
    entry: { arxiv_id: "2609.00001", published: "2026-09-01" },
    attempts: 1,
    created_at: "2026-09-01T10:00:00.000Z",
    last_attempt_at: "2026-09-01T10:05:00.000Z",
  };

  const newArrival = {
    key: "current-arrival@v1",
    entry: { arxiv_id: "2609.00002", published: "2026-09-05" },
    attempts: 0,
    created_at: "2026-09-05T10:00:00.000Z",
  };

  const currentFeedIds = new Set([normalizeArxivId(newArrival.entry.arxiv_id)]);
  const priorityIds = new Set();

  const sorted = sortQueueItems([newArrival, olderFailedRetry], priorityIds, currentFeedIds);
  assert.equal(sorted[0].key, olderFailedRetry.key, "older retry must not be starved by new unattempted arrival");
});

test("checkedBodyChunk accepts verbatim quotes with LaTeX math and Unicode transliteration", () => {
  const rawSourceChunk = "Here the distribution is evaluated. The median $\\chi^2_\\mathrm{red}$ is $\\sim$177, with only $\\sim$10\\% of sources achieving $\\chi^2_\\mathrm{red} < 10$. However, we note that a high value does not imply failure.";
  const modelOutput = {
    summary: "评估卡方分布及高卡方值的成因。",
    quote: "The median χ2red is ∼177, with only ∼10% of sources achieving χ2red < 10.",
  };
  const verified = checkedBodyChunk(modelOutput, rawSourceChunk);
  assert.equal(verified.summary, modelOutput.summary);
  assert.ok(verified.quote.includes("177"));
});

