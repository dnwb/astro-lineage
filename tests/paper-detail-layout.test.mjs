import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("paper-detail-layout: global.css provides two-column grid, 68ch measure, breakout rules, and sticky sidebar", async () => {
  const css = await readFile(join(projectRoot, "src", "styles", "global.css"), "utf8");

  // Grid container
  assert.match(css, /\.paper-detail-grid\s*\{/u);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/u);

  // Desktop 2-column breakpoint
  assert.match(css, /@media\s*\([^)]*min-width:\s*(?:900|960|1024)px[^)]*\)\s*\{[\s\S]*?\.paper-detail-grid\s*\{[\s\S]*?grid-template-columns:/u);

  // 68ch measure for paper main content
  assert.match(css, /\.paper-main-content[\s\S]*?68ch/u);

  // Breakout container and overflow containment
  assert.match(css, /\.paper-main-content\s+\.breakout[\s\S]*?overflow-x:\s*auto/u);

  // Sticky sidebar
  assert.match(css, /\.sidebar-sticky-wrapper\s*\{[\s\S]*?position:\s*sticky/u);
});

test("paper-detail-layout: papers/[workId].astro includes two-column grid, sticky TOC, BibTeX button, and external links", async () => {
  const astroCode = await readFile(join(projectRoot, "src", "pages", "papers", "[workId].astro"), "utf8");

  // Two-column layout container and columns
  assert.match(astroCode, /class=["'][^"']*paper-detail-grid[^"']*["']/u);
  assert.match(astroCode, /class=["'][^"']*paper-main-content[^"']*["']/u);
  assert.match(astroCode, /class=["'][^"']*paper-sticky-sidebar[^"']*["']/u);

  // Table of Contents navigation
  assert.match(astroCode, /class=["'][^"']*paper-toc[^"']*["']/u);
  assert.match(astroCode, /href="#why-heading"/u);
  assert.match(astroCode, /href="#problem-heading"/u);
  assert.match(astroCode, /href="#takeaway-heading"/u);
  assert.match(astroCode, /href="#assumptions-heading"/u);
  assert.match(astroCode, /href="#delta-heading"/u);
  assert.match(astroCode, /href="#connections-heading"/u);
  assert.match(astroCode, /href="#research-context-heading"/u);

  // Action tray with BibTeX copy button and external links
  assert.match(astroCode, /class=["'][^"']*paper-action-tray[^"']*["']/u);
  assert.match(astroCode, /class=["'][^"']*btn-copy-bibtex[^"']*["']/u);
  assert.match(astroCode, /data-bibtex=\{formatWorkBibTeX\(work,\s*preferredVersion\)\}/u);

  // External links
  assert.match(astroCode, /class=["'][^"']*paper-external-links[^"']*["']/u);
});
