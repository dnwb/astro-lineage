import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  acquireRefreshLock,
  publishAnalyzedArxivEdition,
  releaseRefreshLock,
} from "../scripts/arxiv-daily.mjs";
import {
  getNaturalWeekBounds as getArchiveWeekBounds,
  syncArxivArchives,
} from "../scripts/arxiv-archive.mjs";
import {
  executeChatCompletion,
  getNaturalWeekBounds as getWeeklyWeekBounds,
  runWeeklySummary,
} from "../scripts/arxiv-weekly-summary.mjs";
import {
  editionFingerprint,
  sourceFingerprint,
  validateDailyRadarPayload,
} from "../scripts/daily-radar.mjs";

const teacherIds = ["2609.24240", "2609.13540", "2609.12308", "2609.11031", "2609.09285"];

function entry(arxiv_id, revision = 1) {
  return {
    arxiv_id,
    revision,
    title: `Synthetic accounting fixture ${arxiv_id}`,
    abstract: "Synthetic test text only; this is not paper metadata or evidence.",
    published: "2026-09-14T00:00:00Z",
    updated: "2026-09-14T00:00:00Z",
    authors: ["Synthetic Fixture"],
    url: `https://arxiv.org/abs/${arxiv_id}v${revision}`,
  };
}

function analysisFor(source, priority = "skip", level = "abstract_only", overrides = {}) {
  const body = level !== "abstract_only";
  const revision = overrides.revision ?? source.revision;
  return {
    arxiv_id: source.arxiv_id,
    revision,
    status: "ready",
    source_fingerprint: overrides.source_fingerprint ?? sourceFingerprint(source),
    priority,
    coverage: {
      level,
      label: body ? "Synthetic body fixture" : "Synthetic abstract fixture",
      inspected_sections: body
        ? level === "full_body"
          ? [
              "Abstract",
              "Introduction",
              "Assumptions",
              "Methods",
              "Results",
              "Discussion",
              "Conclusions",
            ]
          : ["Introduction"]
        : ["Abstract"],
      source_version: `arXiv:${source.arxiv_id}v${revision}`,
      source_references: [
        {
          kind: body ? "arxiv_source_package" : "arxiv_abstract",
          url: body ? `https://arxiv.org/src/${source.arxiv_id}v${revision}` : source.url,
          locator: body
            ? level === "full_body"
              ? "full body sections"
              : "Introduction"
            : "Abstract",
          ...(body ? { sha256: "a".repeat(64) } : {}),
        },
      ],
      ...(level === "full_body"
        ? {
            section_coverage: {
              problem: true,
              assumptions: true,
              method: true,
              results: true,
              limitations: true,
              appendices: "not_needed",
            },
          }
        : {}),
    },
    analysis: {
      origin: "synthetic-test-fixture",
      analyzed_at: "2026-09-20T00:00:00Z",
      reason: "Synthetic test accounting only.",
      result: "Synthetic result text; it makes no claim about a paper.",
      reading_entry: "Synthetic fixture.",
      problem: "Synthetic fixture.",
      method: "Synthetic fixture.",
      assumptions: ["Synthetic fixture."],
      limits: ["No scientific evidence is represented."],
      citation_leads: ["Synthetic fixture."],
      research_progress: "Synthetic fixture only.",
      unresolved_checks: ["No paper was read."],
      potential_lineage: { status: "no_match", reason: "Synthetic fixture.", candidates: [] },
      prerequisite_works: [],
    },
  };
}

function exactPick(arxiv_id, priority, date, overrides = {}) {
  const source = entry(arxiv_id);
  return {
    arxiv_id,
    revision: overrides.revision ?? 1,
    historical_edition: overrides.historical_edition ?? `announcement-${date}`,
    source_fingerprint: overrides.source_fingerprint ?? sourceFingerprint(source),
    priority,
  };
}

function makeEdition(date, specs = [], batchId = `announcement-${date}`) {
  const entries = specs.map(({ id, revision = 1 }) => entry(id, revision));
  const feed = {
    generated_at: `${date}T12:00:00Z`,
    query: "synthetic test fixture",
    source_url: "https://export.arxiv.org/api/query",
    window: { kind: "announcement_day", announcement_date: date, batch_id: batchId },
    entries,
  };
  const analyses = specs
    .filter((spec) => spec.include !== false)
    .map(
      (spec, index) =>
        spec.analysis ??
        analysisFor(
          entries[index],
          spec.priority ?? "skip",
          spec.level ?? "abstract_only",
          spec.overrides
        )
    );
  return {
    feed,
    radar: {
      edition: { window: feed.window },
      analyses,
      opening_brief: { status: "unavailable", reason: "Synthetic fixture." },
    },
  };
}

async function writeJson(path, value) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("natural weekly bounds include the announcement Sunday", () => {
  for (const bounds of [getWeeklyWeekBounds("2026-W38"), getArchiveWeekBounds("2026-W38")]) {
    assert.equal(bounds.monday, "2026-09-14");
    assert.equal(bounds.sunday, "2026-09-20");
    assert.equal(bounds.announcementDates.length, 7);
    assert.deepEqual(bounds.announcementDates.slice(-1), ["2026-09-20"]);
    assert.equal(bounds.dateRange, "2026-09-14 ~ 2026-09-20");
  }
});

test("weekly output uses Sunday editions and shared eligibility with exact source joins", async () => {
  const temp = await mkdtemp(join(tmpdir(), "axvdaily-weekly-"));
  try {
    const dailyDir = join(temp, "daily");
    const oldEdition = makeEdition("2026-09-06", [
      { id: "2609.99980", priority: "must_read", level: "full_body" },
    ]);
    const sunday = makeEdition(
      "2026-09-13",
      teacherIds.slice(2).map((id) => ({ id }))
    );
    const monday = makeEdition("2026-09-14", [
      ...teacherIds.slice(0, 2).map((id) => ({ id })),
      { id: "2609.99901", priority: "must_read", level: "full_body" },
      { id: "2609.99902", priority: "worth_knowing", level: "body_partial" },
      { id: "2609.99903", priority: "must_read", level: "abstract_only" },
      { id: "2609.99904", priority: "worth_knowing", level: "abstract_only" },
      {
        id: "2609.99905",
        priority: "must_read",
        level: "full_body",
        overrides: { source_fingerprint: "0".repeat(64) },
      },
    ]);
    await writeJson(join(dailyDir, "2026-09-06.json"), { date: "2026-09-06", ...oldEdition });
    await writeJson(join(dailyDir, "2026-09-13.json"), { date: "2026-09-13", ...sunday });
    await writeJson(join(dailyDir, "2026-09-14.json"), { date: "2026-09-14", ...monday });

    const outside = makeEdition("2026-09-20", [
      { id: "2609.99999", priority: "must_read", level: "full_body" },
    ]);
    const radarPath = join(temp, "active-radar.json");
    const feedPath = join(temp, "active-feed.json");
    const outputPath = join(temp, "result", "weekly.json");
    await writeJson(radarPath, {
      ...outside.radar,
      historical_analyses: [analysisFor(entry("2609.99998"), "must_read", "full_body")],
    });
    await writeJson(feedPath, outside.feed);

    const result = await runWeeklySummary({
      radar: radarPath,
      feed: feedPath,
      output: outputPath,
      dailyArchiveDir: dailyDir,
      weekId: "2026-W38",
      generateSummary: async () =>
        JSON.stringify({
          title: "Synthetic test weekly summary",
          executive_summary: "Synthetic summary used only to verify the offline weekly join.",
          thematic_highlights: [
            {
              theme_name: "Bounded synthetic theme",
              summary: "Synthetic fixture.",
              paper_ids: ["2609.99901", "2609.99904", "2609.99980", "2609.99999", "2609.99901"],
            },
            {
              theme_name: "Outside this week",
              summary: "Synthetic fixture.",
              paper_ids: ["2609.99999"],
            },
          ],
          top_picks: [
            exactPick("2609.99901", "must_read", "2026-09-14"),
            exactPick("2609.99902", "worth_knowing", "2026-09-14"),
            exactPick("2609.99901", "must_read", "2026-09-14", { revision: 2 }),
            exactPick("2609.99902", "worth_knowing", "2026-09-14", {
              source_fingerprint: "0".repeat(64),
            }),
            exactPick("2609.99902", "worth_knowing", "2026-09-14", {
              historical_edition: "wrong-edition",
            }),
          ].map((pick) => ({
            ...pick,
            recommendation_reason: "Synthetic test fixture.",
            core_insight: "Synthetic test fixture.",
            reading_guide: "Synthetic test fixture.",
          })),
        }),
    });

    assert.equal(result.date_range, "2026-09-14 ~ 2026-09-20");
    assert.equal(result.statistics.total_analyzed, 7);
    assert.equal(result.statistics.skip_count, 5);
    assert.deepEqual(
      result.papers
        .filter((paper) => teacherIds.includes(paper.arxiv_id))
        .map((paper) => paper.arxiv_id)
        .sort(),
      [...teacherIds].sort()
    );
    assert.ok(
      result.papers.some((paper) => paper.announcement_date === "2026-09-13"),
      "Sunday archive entries must be included"
    );
    assert.deepEqual(result.top_picks.map((pick) => pick.arxiv_id).sort(), [
      "2609.99901",
      "2609.99902",
    ]);
    assert.deepEqual(
      result.thematic_highlights.map((theme) => theme.paper_ids),
      [["2609.99901"]]
    );
    for (const id of [
      "2609.99903",
      "2609.99904",
      "2609.99905",
      "2609.99980",
      "2609.99998",
      "2609.99999",
    ]) {
      assert.ok(
        !result.papers.some((paper) => paper.arxiv_id === id),
        `${id} must not join this week as an eligible paper`
      );
      assert.ok(
        !result.top_picks.some((pick) => pick.arxiv_id === id),
        `${id} must not be recommended`
      );
    }
    assert.equal(result.top_picks.find((pick) => pick.arxiv_id === "2609.99901").revision, 1);
    assert.ok(
      result.top_picks.every((pick) =>
        pick.historical_edition.startsWith("announcement-2026-09-14")
      )
    );
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).papers.length, 7);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("weekly uses the published pair when compatibility mirrors are stale", async () => {
  const temp = await mkdtemp(join(tmpdir(), "axvdaily-weekly-pointer-"));
  try {
    const feedPath = join(temp, "feed.json");
    const radarPath = join(temp, "radar.json");
    const artifactRoot = join(temp, "artifacts");
    const authoritative = makeEdition("2026-09-13", [
      { id: "2609.90203", priority: "worth_knowing", level: "body_partial" },
    ]);
    const stale = makeEdition("2026-09-13", [
      { id: "2609.90204", priority: "worth_knowing", level: "body_partial" },
    ]);
    await writeJson(feedPath, authoritative.feed);
    await writeJson(radarPath, authoritative.radar);
    await publishAnalyzedArxivEdition({
      output: feedPath,
      radarOutput: radarPath,
      artifactRoot,
      expectedFeed: authoritative.feed,
      expectedRadar: authoritative.radar,
      radar: {
        ...authoritative.radar,
        opening_brief: { status: "unavailable", reason: "Synthetic fixture" },
      },
    });
    await writeJson(feedPath, stale.feed);
    await writeJson(radarPath, stale.radar);
    const dailyDir = join(temp, "daily");
    await writeJson(join(dailyDir, "2026-09-13.json"), { date: "2026-09-13", ...stale });

    const weekly = await runWeeklySummary({
      feed: feedPath,
      radar: radarPath,
      artifactRoot,
      output: join(temp, "weekly.json"),
      dailyArchiveDir: dailyDir,
      weekId: "2026-W38",
      generateSummary: async () =>
        JSON.stringify({
          top_picks: [exactPick("2609.90203", "worth_knowing", "2026-09-13")],
          thematic_highlights: [],
        }),
    });
    assert.deepEqual(
      weekly.papers.map((paper) => paper.arxiv_id),
      ["2609.90203"]
    );
    assert.deepEqual(
      weekly.top_picks.map((pick) => pick.arxiv_id),
      ["2609.90203"]
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("archive sync keeps exact matching rich analyses and projects completed historical readings", async () => {
  const temp = await mkdtemp(join(tmpdir(), "axvdaily-archive-"));
  try {
    const archiveRoot = join(temp, "archives");
    const dailyDir = join(archiveRoot, "daily");
    const historicalBatch = "announcement-2026-09-14";
    const historical = makeEdition("2026-09-14", [{ id: "2609.90101" }], historicalBatch);
    const historicalAnalysis = analysisFor(historical.feed.entries[0], "must_read", "full_body");
    const preserved = makeEdition("2026-09-20", [
      { id: "2609.90102", priority: "worth_knowing", level: "body_partial" },
    ]);
    const preservedAnalysis = analysisFor(
      preserved.feed.entries[0],
      "worth_knowing",
      "body_partial"
    );
    assert.equal(
      validateDailyRadarPayload(preserved.feed, {
        ...preserved.radar,
        analyses: [preservedAnalysis],
      }).model.groups.worth_knowing.length,
      1
    );

    await writeJson(join(dailyDir, "2026-09-14.json"), {
      date: "2026-09-14",
      batch_id: historicalBatch,
      feed: historical.feed,
      radar: historical.radar,
    });
    await writeJson(join(dailyDir, "2026-09-20.json"), {
      date: "2026-09-20",
      batch_id: "announcement-2026-09-20",
      feed: preserved.feed,
      radar: { ...preserved.radar, analyses: [preservedAnalysis] },
    });

    const activeRadarPath = join(temp, "active-radar.json");
    const activeFeedPath = join(temp, "active-feed.json");
    const active = makeEdition("2026-09-20", [{ id: "2609.90102" }]);
    assert.equal(
      validateDailyRadarPayload(active.feed, { ...active.radar, analyses: [preservedAnalysis] })
        .model.groups.worth_knowing.length,
      1
    );
    const badFingerprint = { ...historicalAnalysis, source_fingerprint: "0".repeat(64) };
    await writeJson(activeFeedPath, active.feed);
    await writeJson(activeRadarPath, {
      ...active.radar,
      analyses: [],
      historical_analyses: [
        {
          ...historicalAnalysis,
          historical_edition: historicalBatch,
          historical_edition_fingerprint: editionFingerprint(historical.feed),
        },
        {
          ...historicalAnalysis,
          historical_edition: "wrong-edition",
          historical_edition_fingerprint: editionFingerprint(historical.feed),
        },
        {
          ...historicalAnalysis,
          historical_edition: historicalBatch,
          historical_edition_fingerprint: "0".repeat(64),
        },
        {
          ...badFingerprint,
          historical_edition: historicalBatch,
          historical_edition_fingerprint: editionFingerprint(historical.feed),
        },
      ],
    });

    await syncArxivArchives({
      archiveRoot,
      currentFeedPath: activeFeedPath,
      currentRadarPath: activeRadarPath,
      currentWeeklyPath: join(temp, "missing-weekly.json"),
      dailyCacheDir: join(temp, "missing-generations"),
      weeklyCacheDir: join(temp, "missing-weekly-cache"),
    });

    const preservedArchive = JSON.parse(await readFile(join(dailyDir, "2026-09-20.json"), "utf8"));
    const preservedModel = validateDailyRadarPayload(
      preservedArchive.feed,
      preservedArchive.radar
    ).model;
    assert.deepEqual(
      preservedModel.groups.worth_knowing.map((item) => item.arxiv_id),
      ["2609.90102"]
    );

    const historicalArchive = JSON.parse(await readFile(join(dailyDir, "2026-09-14.json"), "utf8"));
    const historicalModel = validateDailyRadarPayload(
      historicalArchive.feed,
      historicalArchive.radar
    ).model;
    assert.deepEqual(
      historicalModel.groups.must_read.map((item) => item.arxiv_id),
      ["2609.90101"]
    );
    assert.equal(historicalArchive.radar.analyses[0].historical_edition, historicalBatch);

    const weeklyPath = join(temp, "weekly.json");
    const weekly = await runWeeklySummary({
      radar: activeRadarPath,
      feed: activeFeedPath,
      output: weeklyPath,
      dailyArchiveDir: dailyDir,
      weekId: "2026-W38",
      generateSummary: async () =>
        JSON.stringify({
          executive_summary: "Synthetic summary verifies historical projection into the week.",
          top_picks: [
            {
              ...exactPick("2609.90101", "must_read", "2026-09-14"),
              recommendation_reason: "Synthetic exact-identity fixture.",
            },
          ],
        }),
    });
    const recovered = weekly.papers.find((paper) => paper.arxiv_id === "2609.90101");
    assert.equal(recovered.historical_edition, historicalBatch);
    assert.equal(recovered.source_fingerprint, sourceFingerprint(historical.feed.entries[0]));
    assert.deepEqual(
      weekly.top_picks.map((pick) => pick.arxiv_id),
      ["2609.90101"]
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("archive sync rejects a mismatched generation without rolling back a newer valid archive", async () => {
  const temp = await mkdtemp(join(tmpdir(), "axvdaily-archive-generation-"));
  try {
    const archiveRoot = join(temp, "archives");
    const dailyCacheDir = join(temp, "generations");
    const date = "2026-09-21";
    const old = makeEdition(date, [{ id: "2609.90301" }]);
    const expanded = makeEdition(date, [{ id: "2609.90301" }, { id: "2609.90302" }]);
    expanded.feed.generated_at = "2026-09-24T00:00:00Z";
    expanded.feed.query = "expanded synthetic query";
    const foreign = makeEdition("2026-09-09", [{ id: "2609.90309" }]);
    const oldGeneration = join(dailyCacheDir, "generation-1", "files");
    const badGeneration = join(dailyCacheDir, "generation-2", "files");
    await writeJson(join(oldGeneration, "0000.json"), old.feed);
    await writeJson(join(oldGeneration, "0001.json"), old.radar);
    await writeJson(join(badGeneration, "0000.json"), old.feed);
    await writeJson(join(badGeneration, "0001.json"), {
      ...old.radar,
      analyses: foreign.radar.analyses,
    });
    await writeJson(join(archiveRoot, "daily", `${date}.json`), {
      date,
      batch_id: `announcement-${date}`,
      feed: expanded.feed,
      radar: expanded.radar,
    });

    await syncArxivArchives({
      archiveRoot,
      currentFeedPath: join(temp, "missing-feed.json"),
      currentRadarPath: join(temp, "missing-radar.json"),
      currentWeeklyPath: join(temp, "missing-weekly.json"),
      dailyCacheDir,
      weeklyCacheDir: join(temp, "missing-weekly-cache"),
    });

    const archived = JSON.parse(await readFile(join(archiveRoot, "daily", `${date}.json`), "utf8"));
    assert.deepEqual(
      archived.feed.entries.map(({ arxiv_id }) => arxiv_id),
      ["2609.90301", "2609.90302"]
    );
    assert.equal(validateDailyRadarPayload(archived.feed, archived.radar).valid, true);
    assert.deepEqual(
      archived.radar.analyses.map(({ arxiv_id }) => arxiv_id),
      ["2609.90301", "2609.90302"]
    );
    assert.deepEqual(
      foreign.radar.analyses.map(({ arxiv_id }) => arxiv_id),
      ["2609.90309"]
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("archive sync prefers current analyzed radar over an older archive for the same feed", async () => {
  const temp = await mkdtemp(join(tmpdir(), "axvdaily-archive-current-"));
  try {
    const date = "2026-09-21";
    const archiveRoot = join(temp, "archives");
    const current = makeEdition(date, [
      { id: "2609.90311", priority: "worth_knowing", level: "body_partial" },
    ]);
    await writeJson(join(temp, "feed.json"), current.feed);
    await writeJson(join(temp, "radar.json"), current.radar);
    await writeJson(join(archiveRoot, "daily", `${date}.json`), {
      date,
      batch_id: `announcement-${date}`,
      feed: current.feed,
      radar: { ...current.radar, analyses: [] },
    });

    await syncArxivArchives({
      archiveRoot,
      currentFeedPath: join(temp, "feed.json"),
      currentRadarPath: join(temp, "radar.json"),
      currentWeeklyPath: join(temp, "missing-weekly.json"),
      dailyCacheDir: join(temp, "missing-generations"),
      weeklyCacheDir: join(temp, "missing-weekly-cache"),
    });

    const archived = JSON.parse(await readFile(join(archiveRoot, "daily", `${date}.json`), "utf8"));
    assert.equal(validateDailyRadarPayload(archived.feed, archived.radar).valid, true);
    assert.deepEqual(
      archived.radar.analyses.map(({ arxiv_id }) => arxiv_id),
      ["2609.90311"]
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("archive sync retains exact pending reading requests without making them eligible", async () => {
  const temp = await mkdtemp(join(tmpdir(), "axvdaily-archive-pending-"));
  try {
    const date = "2026-09-21";
    const archiveRoot = join(temp, "archives");
    const old = makeEdition(date, [{ id: "2609.90321", priority: "must_read" }]);
    const current = { feed: old.feed, radar: { ...old.radar, analyses: [] } };
    await writeJson(join(temp, "feed.json"), current.feed);
    await writeJson(join(temp, "radar.json"), current.radar);
    await writeJson(join(archiveRoot, "daily", `${date}.json`), {
      date,
      batch_id: `announcement-${date}`,
      feed: old.feed,
      radar: old.radar,
    });

    await syncArxivArchives({
      archiveRoot,
      currentFeedPath: join(temp, "feed.json"),
      currentRadarPath: join(temp, "radar.json"),
      currentWeeklyPath: join(temp, "missing-weekly.json"),
      dailyCacheDir: join(temp, "missing-generations"),
      weeklyCacheDir: join(temp, "missing-weekly-cache"),
    });

    const archived = JSON.parse(await readFile(join(archiveRoot, "daily", `${date}.json`), "utf8"));
    const validation = validateDailyRadarPayload(archived.feed, archived.radar);
    assert.equal(validation.valid, true);
    assert.deepEqual(
      archived.radar.analyses.map(({ arxiv_id }) => arxiv_id),
      ["2609.90321"]
    );
    assert.equal(validation.model.groups.must_read.length, 0);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("archive sync serializes writers with one archive-root lock", async () => {
  const temp = await mkdtemp(join(tmpdir(), "axvdaily-archive-lock-"));
  const archiveRoot = join(temp, "archives");
  const lockPath = join(archiveRoot, ".sync.lock");
  const manifestPath = join(archiveRoot, "manifest.json");
  const initialManifest = JSON.stringify({ sentinel: "last-good" });
  try {
    await mkdir(archiveRoot, { recursive: true });
    await writeFile(manifestPath, initialManifest);
    await acquireRefreshLock(lockPath);
    await assert.rejects(
      syncArxivArchives({
        archiveRoot,
        currentFeedPath: join(temp, "missing-feed.json"),
        currentRadarPath: join(temp, "missing-radar.json"),
        currentWeeklyPath: join(temp, "missing-weekly.json"),
        dailyCacheDir: join(temp, "missing-generations"),
        weeklyCacheDir: join(temp, "missing-weekly-cache"),
      }),
      /刷新已在运行/u
    );
    assert.equal(await readFile(manifestPath, "utf8"), initialManifest);
  } finally {
    await releaseRefreshLock(lockPath);
    await rm(temp, { recursive: true, force: true });
  }
});

test("archive sync reads the active edition from its published pointer, not stale mirrors", async () => {
  const temp = await mkdtemp(join(tmpdir(), "axvdaily-archive-pointer-"));
  try {
    const currentDir = join(temp, "current");
    const archiveRoot = join(temp, "archives");
    const feedPath = join(currentDir, "arxiv-daily.json");
    const radarPath = join(currentDir, "daily-radar.json");
    const published = makeEdition("2026-09-20", [{ id: "2609.90201" }]);
    const publishedRadar = {
      ...published.radar,
      opening_brief: { status: "unavailable", reason: "Synthetic pointer fixture." },
    };
    const stale = makeEdition("2026-09-21", [{ id: "2609.90202" }]);
    await writeJson(feedPath, published.feed);
    await writeJson(radarPath, publishedRadar);
    await publishAnalyzedArxivEdition({
      output: feedPath,
      radarOutput: radarPath,
      artifactRoot: null,
      expectedFeed: published.feed,
      expectedRadar: publishedRadar,
      radar: publishedRadar,
    });
    await writeJson(feedPath, stale.feed);
    await writeJson(radarPath, stale.radar);

    await syncArxivArchives({
      archiveRoot,
      currentFeedPath: feedPath,
      currentRadarPath: radarPath,
      currentWeeklyPath: join(temp, "missing-weekly.json"),
      dailyCacheDir: join(temp, "missing-generations"),
      weeklyCacheDir: join(temp, "missing-weekly-cache"),
    });

    const archived = JSON.parse(
      await readFile(join(archiveRoot, "daily", "2026-09-20.json"), "utf8")
    );
    assert.deepEqual(
      archived.feed.entries.map((item) => item.arxiv_id),
      ["2609.90201"]
    );
    assert.equal(
      await readFile(feedPath, "utf8").then((raw) => JSON.parse(raw).entries[0].arxiv_id),
      "2609.90202"
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("weekly provider calls time out and never expose raw response bodies", async () => {
  const timeoutError = await executeChatCompletion({
    prompt: "offline fixture",
    systemPrompt: "offline fixture",
    model: "test-model",
    baseUrl: "https://provider.invalid/v1",
    apiKey: "synthetic-secret",
    timeoutMs: 5,
    retries: 1,
    fetchImpl: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  }).then(
    () => null,
    (error) => error
  );
  assert.match(timeoutError.message, /timed out/u);
  assert.doesNotMatch(timeoutError.message, /synthetic-secret/u);

  const providerError = await executeChatCompletion({
    prompt: "offline fixture",
    systemPrompt: "offline fixture",
    model: "test-model",
    baseUrl: "https://provider.invalid/v1",
    apiKey: "synthetic-secret",
    retries: 1,
    fetchImpl: async () => new Response("raw response body with synthetic-secret", { status: 503 }),
  }).then(
    () => null,
    (error) => error
  );
  assert.equal(providerError.message, "Weekly summary API request failed: API returned HTTP 503.");
  assert.doesNotMatch(providerError.message, /raw response|synthetic-secret/u);
});

test("out-of-week historical analyses cannot trigger weekly generation", async () => {
  const temp = await mkdtemp(join(tmpdir(), "axvdaily-out-of-week-"));
  try {
    const dailyDir = join(temp, "daily");
    const inWeekEmpty = makeEdition("2026-09-14");
    await writeJson(join(dailyDir, "2026-09-14.json"), { date: "2026-09-14", ...inWeekEmpty });
    const outside = makeEdition("2026-09-21", [
      { id: "2609.99970", priority: "must_read", level: "full_body" },
    ]);
    const radarPath = join(temp, "active-radar.json");
    const feedPath = join(temp, "active-feed.json");
    await writeJson(feedPath, outside.feed);
    await writeJson(radarPath, {
      ...outside.radar,
      historical_analyses: [
        {
          ...analysisFor(entry("2609.99971"), "must_read", "full_body"),
          historical_edition: "announcement-2026-09-14",
          historical_edition_fingerprint: "0".repeat(64),
        },
      ],
    });
    let modelCalled = false;
    const result = await runWeeklySummary({
      radar: radarPath,
      feed: feedPath,
      output: join(temp, "weekly.json"),
      dailyArchiveDir: dailyDir,
      weekId: "2026-W38",
      generateSummary: async () => {
        modelCalled = true;
        return "{}";
      },
    });
    assert.equal(result, null);
    assert.equal(modelCalled, false);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
