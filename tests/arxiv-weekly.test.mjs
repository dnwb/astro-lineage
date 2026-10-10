import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const weeklyJsonUrl = new URL("../src/data/arxiv-weekly.json", import.meta.url);
const distWeeklyHtmlUrl = new URL("../dist/arxiv-weekly/index.html", import.meta.url);

function ensureWeeklyDist() {
  if (!existsSync(fileURLToPath(distWeeklyHtmlUrl))) {
    const build = spawnSync("npm", ["run", "build"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
  }
}

test("arXiv weekly data file conforms to weekly summary schema", async () => {
  const content = await readFile(weeklyJsonUrl, "utf8");
  const data = JSON.parse(content);

  assert.equal(data.schema_version, "astrolineage-weekly-summary-v1");
  assert.ok(
    typeof data.week_id === "string" && /^\d{4}-W\d{2}$/u.test(data.week_id),
    "week_id must match YYYY-Www"
  );
  assert.ok(
    typeof data.executive_summary === "string" && data.executive_summary.length > 50,
    "executive summary must be substantial"
  );
  assert.ok(
    Array.isArray(data.thematic_highlights),
    "thematic_highlights must be an array (can be empty when no group-relevant work passes eligibility)"
  );
  assert.ok(
    Array.isArray(data.top_picks),
    "top_picks must be an array (can be empty when no group-relevant work passes eligibility)"
  );
  assert.ok(Array.isArray(data.papers) && data.papers.length > 0, "must have reviewed papers");

  // Verify top picks structure
  for (const pick of data.top_picks) {
    assert.ok(pick.arxiv_id, "top pick must have arxiv_id");
    assert.ok(pick.title, "top pick must have title");
    assert.ok(
      ["must_read", "worth_knowing"].includes(pick.priority),
      "top pick must be must_read or worth_knowing"
    );
    assert.ok(pick.recommendation_reason, "top pick must have recommendation reason");
    assert.ok(pick.core_insight, "top pick must have core insight");
    assert.ok(pick.reading_guide, "top pick must have reading guide");
  }

  // Verify thematic highlights structure
  for (const theme of data.thematic_highlights) {
    assert.ok(theme.theme_name, "theme must have theme_name");
    assert.ok(theme.summary, "theme must have summary");
    assert.ok(Array.isArray(theme.paper_ids), "theme must have paper_ids array");
  }
});

test("arXiv weekly HTML is properly generated with expected content and links", async () => {
  ensureWeeklyDist();
  assert.ok(
    existsSync(fileURLToPath(distWeeklyHtmlUrl)),
    "dist/arxiv-weekly/index.html must exist"
  );
  const html = await readFile(distWeeklyHtmlUrl, "utf8");

  assert.match(html, /每周总结/u);
  assert.match(html, /本周综述|宏观学术脉络综述/u);
  assert.match(html, /前沿专题动态与物理突破/u);
  assert.match(html, /本周必读解读|本周精选重点论文解读/u);
  const weeklyData = JSON.parse(await readFile(weeklyJsonUrl, "utf8"));
  if (weeklyData.papers?.[0]) {
    assert.match(html, new RegExp(weeklyData.papers[0].arxiv_id.replace(".", "\\.")));
  }
  assert.match(html, /href="\/arxiv-daily\/"/u);
});

test("arXiv weekly HTML renders math formulas via KaTeX and MathML without raw LaTeX leaks", async () => {
  assert.ok(
    existsSync(fileURLToPath(distWeeklyHtmlUrl)),
    "dist/arxiv-weekly/index.html must exist"
  );
  const html = await readFile(distWeeklyHtmlUrl, "utf8");
  // Exclude raw markdown export block which intentionally contains unparsed markdown source
  const renderedHtml = html.replace(
    /<details\b[^>]*class=["'][^"']*weekly-markdown-export[^"']*["'][\s\S]*?<\/details>/giu,
    ""
  );

  // Must have rendered KaTeX MathML markup when mathematical formulas are present
  if (renderedHtml.includes('class="katex"') || renderedHtml.includes("<math")) {
    assert.match(
      renderedHtml,
      /<span\b[^>]*class=["'][^"']*katex[^"']*["']/u,
      "must render KaTeX container"
    );
    assert.match(renderedHtml, /<math\b/u, "must render MathML node");
  }
  // Must NOT leak raw math delimiters for known formulas
  assert.doesNotMatch(renderedHtml, /\$10\^\{-3\}\$/u, "must not leak unparsed $10^{-3}$ formula");
  assert.doesNotMatch(
    renderedHtml,
    /\$f_\{?\\text\{?agn\}?\}?\$/u,
    "must not leak unparsed f_agn formula"
  );
});

test("arXiv weekly HTML includes NASA ADS links, citation/BibTeX block, and Markdown export", async () => {
  assert.ok(
    existsSync(fileURLToPath(distWeeklyHtmlUrl)),
    "dist/arxiv-weekly/index.html must exist"
  );
  const html = await readFile(distWeeklyHtmlUrl, "utf8");

  // NASA ADS links
  const weeklyContent = JSON.parse(await readFile(weeklyJsonUrl, "utf8"));
  for (const pick of weeklyContent.top_picks || []) {
    const escaped = pick.arxiv_id.replace(".", "\\.");
    assert.match(
      html,
      new RegExp(`https://ui\\.adsabs\\.harvard\\.edu/abs/arXiv:${escaped}`),
      `must link to NASA ADS for top pick ${pick.arxiv_id}`
    );
  }

  // BibTeX & citation tools (rendered for top_picks)
  if (weeklyContent.top_picks && weeklyContent.top_picks.length > 0) {
    assert.match(html, /@article\{/u, "must provide BibTeX record");
    assert.match(html, /archivePrefix\s*=\s*\{arXiv\}/u, "BibTeX must specify arXiv archivePrefix");
    if (weeklyContent.top_picks?.[0]) {
      const pickId = weeklyContent.top_picks[0].arxiv_id.replace(".", "\\.");
      assert.match(
        html,
        new RegExp(`eprint\\s*=\\s*\\{${pickId}\\}`),
        "BibTeX must contain eprint identifier"
      );
    }
  }

  // Export Weekly Markdown
  assert.match(
    html,
    /导出\s*\/?\s*复制周报\s*Markdown/u,
    "must contain Weekly Markdown export action"
  );
  assert.match(
    html,
    /#\s*高能天体物理\s*arXiv\s*每周学术脉络/u,
    "export content must contain Markdown heading"
  );
});

test("arXiv weekly CSS guarantees responsive layout and print optimization", async () => {
  assert.ok(
    existsSync(fileURLToPath(distWeeklyHtmlUrl)),
    "dist/arxiv-weekly/index.html must exist"
  );
  const html = await readFile(distWeeklyHtmlUrl, "utf8");

  // Read linked stylesheets referenced by the weekly HTML
  const cssMatches = [...html.matchAll(/href="(\/_astro\/[^"]+\.css)"/gu)].map((m) => m[1]);
  assert.ok(cssMatches.length > 0, "weekly page must link to compiled stylesheets");

  const cssContents = await Promise.all(
    cssMatches.map((href) => readFile(new URL(`../dist${href}`, import.meta.url), "utf8"))
  );
  const fullCss = cssContents.join("\n");

  // Responsive grid must use min(100%, ...) rather than fixed >=380px without fluid guard
  assert.match(
    fullCss,
    /minmax\(min\(100%,\s*[^)]+\),\s*1fr\)/u,
    "thematic grid must be fluid and responsive"
  );
  assert.match(
    fullCss,
    /overflow-wrap:\s*anywhere/u,
    "must specify overflow-wrap: anywhere to prevent narrow-screen blowout"
  );

  // Print stylesheet
  assert.match(fullCss, /@media\s+print/u, "must contain print media query");
  assert.match(
    fullCss,
    /\.site-nav[^}]*display:\s*none/u,
    "print styles must hide site navigation"
  );
});
