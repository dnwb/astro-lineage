import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  editionFingerprint,
  guideFingerprint,
  sourceFingerprint,
  radarCardAnchor,
} from "../scripts/daily-radar.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function feedEntry(arxivId, title) {
  return {
    arxiv_id: arxivId,
    revision: 1,
    title,
    abstract: `${title} abstract source.`,
    published: "2026-09-10T12:00:00Z",
    updated: "2026-09-10T12:00:00Z",
    authors: ["A. Researcher"],
    url: `https://arxiv.org/abs/${arxivId}v1`,
  };
}

function coverageFor(entry, level) {
  const body = level !== "abstract_only";
  return {
    level,
    label: body ? "已检查 Results 与 Discussion" : "仅检查 arXiv 摘要",
    inspected_sections: body ? ["Abstract", "Results", "Discussion"] : ["Abstract"],
    source_version: `arXiv:${entry.arxiv_id}v1`,
    source_references: [{
      kind: body ? "arxiv_source_package" : "arxiv_abstract",
      url: body ? `https://arxiv.org/src/${entry.arxiv_id}v1` : entry.url,
      locator: body ? "Results, Discussion" : "Abstract",
      ...(body ? { sha256: "a".repeat(64) } : {}),
    }],
    ...(level === "full_body" ? {
      section_coverage: {
        problem: true,
        assumptions: true,
        method: true,
        results: true,
        limitations: true,
        appendices: "not_needed",
      },
    } : {}),
  };
}

function analysisFor(entry, priority, level) {
  return {
    arxiv_id: entry.arxiv_id,
    revision: entry.revision,
    status: "ready",
    source_fingerprint: sourceFingerprint(entry),
    priority,
    coverage: coverageFor(entry, level),
    analysis: {
      origin: "fixture",
      analyzed_at: "2026-09-10T12:00:00Z",
      reason: `${entry.title} deserves this reading priority.`,
      result: `${entry.title} result is bounded by the recorded source.`,
      reading_entry: `Read the recorded source for ${entry.title}.`,
      problem: `${entry.title} asks a concrete research question.`,
      method: `${entry.title} uses the recorded method.`,
      assumptions: ["The fixture assumption is explicit."],
      limits: ["The fixture limit remains unresolved."],
      citation_leads: ["The recorded source supports this bounded statement."],
      research_progress: "This fixture only compares the current edition.",
      unresolved_checks: ["Independent verification remains pending."],
      potential_lineage: { status: "no_match", reason: "No supported relation is recorded.", candidates: [] },
      prerequisite_works: [],
    },
  };
}

function radarFixture() {
  const entries = [
    feedEntry("2609.90001", "Mixed Must Read"),
    feedEntry("2609.90002", "Mixed Worth Knowing"),
    feedEntry("2609.90003", "Mixed Skim"),
  ];
  const analyses = [
    analysisFor(entries[0], "must_read", "full_body"),
    analysisFor(entries[1], "worth_knowing", "body_partial"),
    analysisFor(entries[2], "skip", "abstract_only"),
  ];
  analyses[0].analysis.prerequisite_works = [{
    work_id: "work:fixture",
    reason: "先阅读这个组内 Work，再理解本条导读中的模型背景。",
  }];
  const feed = {
    generated_at: "2026-09-10T12:00:00Z",
    query: "fixture query",
    source_url: "https://export.arxiv.org/api/query",
    entries,
  };
  const openingBrief = {
    status: "ready",
    edition_fingerprint: editionFingerprint(feed),
    intro: "MIXED_INTRO：本期同时包含完整阅读、正文片段和摘要层线索。",
    worth_knowing_summary: "MIXED_WORTH_SUMMARY：正文片段补充一项限定明确的进展。",
    skim_summary: "MIXED_SKIM_SUMMARY：摘要层线索帮助决定是否继续阅读。",
    must_read: [{
      arxiv_id: entries[0].arxiv_id,
      revision: 1,
      label: entries[0].title,
      text: "MIXED_MUST_BRIEF：它给出本期最完整的可检查结果。",
      source_fingerprint: sourceFingerprint(entries[0]),
      guide_fingerprint: guideFingerprint(analyses[0]),
      anchor: radarCardAnchor(entries[0].arxiv_id, 1),
    }],
    worth_knowing: [{
      arxiv_id: entries[1].arxiv_id,
      revision: 1,
      source_fingerprint: sourceFingerprint(entries[1]),
      guide_fingerprint: guideFingerprint(analyses[1]),
    }],
    skip: [{
      arxiv_id: entries[2].arxiv_id,
      revision: 1,
      source_fingerprint: sourceFingerprint(entries[2]),
      guide_fingerprint: guideFingerprint(analyses[2]),
    }],
  };
  return {
    feed,
    visibleWorkLinks: {
      "work:fixture": { href: "/papers/work-fixture", title: "Fixture Work" },
    },
    radar: {
      edition: { kind: "cached_first_edition", coverage_kind: "recent_submission_sample" },
      analyses,
      opening_brief: openingBrief,
    },
  };
}

async function writeFixtureProject(root, fixture) {
  await Promise.all([
    cp(join(projectRoot, "src"), join(root, "src"), { recursive: true }),
    cp(join(projectRoot, "scripts"), join(root, "scripts"), { recursive: true }),
    cp(join(projectRoot, "content"), join(root, "content"), { recursive: true }),
    cp(join(projectRoot, "public"), join(root, "public"), { recursive: true }),
    cp(join(projectRoot, "astro.config.mjs"), join(root, "astro.config.mjs")),
    cp(join(projectRoot, "tsconfig.json"), join(root, "tsconfig.json")),
    cp(join(projectRoot, "package.json"), join(root, "package.json")),
    symlink(join(projectRoot, "node_modules"), join(root, "node_modules"), "dir"),
  ]);
  await writeFile(join(root, "src/data/arxiv-daily.json"), `${JSON.stringify(fixture.feed, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src/data/daily-radar.json"), `${JSON.stringify(fixture.radar, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src/pages/mixed-radar-fixture.astro"), `---
import DailyRadarBrief from "../components/DailyRadarBrief.astro";
import DailyRadarPrioritySection from "../components/DailyRadarPrioritySection.astro";

const brief = ${JSON.stringify(fixture.radar.opening_brief)};
const visibleWorkLinks = ${JSON.stringify(fixture.visibleWorkLinks)};
const groups = {
  must_read: [${JSON.stringify({ ...fixture.feed.entries[0], analysis: fixture.radar.analyses[0] })}],
  worth_knowing: [${JSON.stringify({ ...fixture.feed.entries[1], analysis: fixture.radar.analyses[1] })}],
  skip: [${JSON.stringify({ ...fixture.feed.entries[2], analysis: fixture.radar.analyses[2] })}],
};
---

<html lang="zh-CN"><body>
  <main class="radar-page">
    <DailyRadarBrief brief={brief} visibleWorkLinks={visibleWorkLinks} groups={groups} />
    <DailyRadarPrioritySection id="must-read" items={groups.must_read} primaryLabel="今天先读" englishLabel="Must Read" visibleWorkLinks={visibleWorkLinks} />
    <DailyRadarPrioritySection id="worth-knowing" items={groups.worth_knowing} primaryLabel="值得知道" englishLabel="Worth Knowing" visibleWorkLinks={visibleWorkLinks} />
    <details class="radar-priority-section skip-section">
      <summary>快速浏览 · Skim</summary>
      <DailyRadarPrioritySection id="skim" items={groups.skip} primaryLabel="快速浏览" englishLabel="Skim" visibleWorkLinks={visibleWorkLinks} />
    </details>
  </main>
</body></html>
`, "utf8");
  await writeFile(join(root, "src/pages/empty-radar-brief.astro"), `---
import DailyRadarBrief from "../components/DailyRadarBrief.astro";
const brief = ${JSON.stringify({
    status: "ready",
    intro: "EMPTY_INTRO",
    worth_knowing_summary: "EMPTY_WORTH_SUMMARY",
    skim_summary: "EMPTY_SKIM_SUMMARY",
    must_read: [],
  })};
const groups = { must_read: [], worth_knowing: [], skip: [{ title: "skim" }] };
---
<html lang="zh-CN"><body><DailyRadarBrief brief={brief} visibleWorkLinks={{}} groups={groups} /></body></html>
`, "utf8");
}

test("the built reader page renders mixed priority groups and keeps Skim collapsed", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "daily-radar-page-fixture-"));
  try {
    const fixture = radarFixture();
    await writeFixtureProject(root, fixture);
    const build = spawnSync("node", [join(projectRoot, "node_modules/astro/bin/astro.mjs"), "build"], {
      cwd: root,
      encoding: "utf8",
      timeout: 100_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
    const html = await readFile(join(root, "dist/mixed-radar-fixture/index.html"), "utf8");
    assert.match(html, /MIXED_INTRO/u);
    assert.match(html, /Mixed Must Read/u);
    assert.match(html, /Mixed Worth Knowing/u);
    assert.match(html, /Mixed Skim/u);
    assert.match(html, /阅读前置/u);
    assert.match(html, /Fixture Work/u);
    assert.match(html, /This entry is limited to the recorded abstract source\./u);
    assert.match(html, /Coverage and evidence/u);
    assert.match(html, /class="radar-priority-section skip-section"/u);
    assert.doesNotMatch(html, /class="radar-priority-section skip-section"[^>]*\bopen\b/u);
    assert.ok(html.indexOf("Mixed Must Read") < html.indexOf("Mixed Worth Knowing"));
    assert.ok(html.indexOf("Mixed Worth Knowing") < html.indexOf("Mixed Skim"));

    const emptyBrief = await readFile(join(root, "dist/empty-radar-brief/index.html"), "utf8");
    assert.match(emptyBrief, /EMPTY_SKIM_SUMMARY/u);
    assert.doesNotMatch(emptyBrief, /EMPTY_WORTH_SUMMARY/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
