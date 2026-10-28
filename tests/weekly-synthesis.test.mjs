import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { formatAuthorList } from "../src/domain/academic-domain.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("weekly synthesis typography contract: readable lead and muted secondary buttons", async () => {
  const weeklyCss = await readFile(join(projectRoot, "src/styles/weekly.css"), "utf-8");

  // 1. .executive-lead font-weight must be standard readable weight <= 450 (e.g. 400 or normal)
  const leadMatch = weeklyCss.match(/\.executive-lead\s*\{[^}]*font-weight:\s*([^;]+);/s);
  assert.ok(leadMatch, ".executive-lead must define font-weight");
  const weightStr = leadMatch[1].trim();
  const weightVal = weightStr === "normal" ? 400 : parseInt(weightStr, 10);
  assert.ok(
    weightVal <= 450,
    `.executive-lead font-weight (${weightStr}) must be readable weight <= 450`
  );

  // 2. Secondary buttons/links demoted to muted styles (background: transparent / var(--bg-surface-alt), border, var(--text-muted))
  assert.match(
    weeklyCss,
    /\.pager-btn\s*\{[^}]*background:\s*var\(--bg-surface-alt,\s*transparent\)[^}]*color:\s*var\(--text-muted/s,
    ".pager-btn must use muted secondary button styling"
  );
  assert.match(
    weeklyCss,
    /\.meta-jump-btn\s*\{[^}]*color:\s*var\(--text-muted/s,
    ".meta-jump-btn must use muted secondary button styling"
  );
  assert.match(
    weeklyCss,
    /\.tools-summary-btn\s*\{[^}]*color:\s*var\(--text-muted/s,
    ".tools-summary-btn must use muted secondary button styling"
  );
  assert.match(
    weeklyCss,
    /\.audit-summary-btn\s*\{[^}]*color:\s*var\(--text-muted/s,
    ".audit-summary-btn must use muted secondary button styling"
  );
});

test("formatAuthorList unit contract: truncate after 3 authors with 'et al.' suffix", () => {
  assert.equal(formatAuthorList([]), "Not recorded");
  assert.equal(formatAuthorList(null), "Not recorded");
  assert.equal(formatAuthorList(undefined), "Not recorded");

  assert.equal(formatAuthorList(["Albert Einstein"]), "Albert Einstein");
  assert.equal(
    formatAuthorList(["Albert Einstein", "Niels Bohr"]),
    "Albert Einstein, Niels Bohr"
  );
  assert.equal(
    formatAuthorList(["Albert Einstein", "Niels Bohr", "Max Planck"]),
    "Albert Einstein, Niels Bohr, Max Planck"
  );
  assert.equal(
    formatAuthorList(["Albert Einstein", "Niels Bohr", "Max Planck", "Marie Curie"]),
    "Albert Einstein, Niels Bohr, Max Planck et al."
  );
  assert.equal(
    formatAuthorList(["A", "B", "C", "D", "E"]),
    "A, B, C et al."
  );
});

test("weekly author list truncation across Weekly Top Picks, Catalog and modal", async () => {
  const topPicksAstro = await readFile(
    join(projectRoot, "src/components/weekly/WeeklyTopPicks.astro"),
    "utf-8"
  );
  const weeklyWeekAstro = await readFile(
    join(projectRoot, "src/pages/arxiv-weekly/[week].astro"),
    "utf-8"
  );
  const weeklyIndexAstro = await readFile(
    join(projectRoot, "src/pages/arxiv-weekly/index.astro"),
    "utf-8"
  );

  // Top Picks .pick-authors
  assert.match(
    topPicksAstro,
    /<p class="pick-authors">\s*Authors:\s*\{formatAuthorList\(/s,
    "WeeklyTopPicks.astro must format .pick-authors with formatAuthorList"
  );

  // Top Picks modal .radar-modal-authors
  assert.match(
    topPicksAstro,
    /<p class="radar-modal-authors">\s*Authors:\s*\{formatAuthorList\(/s,
    "WeeklyTopPicks.astro modal must format .radar-modal-authors with formatAuthorList"
  );

  // Weekly [week].astro .catalog-item-authors
  assert.match(
    weeklyWeekAstro,
    /<p class="catalog-item-authors">\s*Authors:\s*\{formatAuthorList\(/s,
    "[week].astro must format .catalog-item-authors with formatAuthorList"
  );

  // Weekly index.astro .catalog-item-authors
  assert.match(
    weeklyIndexAstro,
    /<p class="catalog-item-authors">\s*Authors:\s*\{formatAuthorList\(/s,
    "arxiv-weekly/index.astro must format .catalog-item-authors with formatAuthorList"
  );
});

test("mobile navigation touch ergonomics: DailyDateSwitcher date pills and stepper targets", async () => {
  const dateSwitcherAstro = await readFile(
    join(projectRoot, "src/components/DailyDateSwitcher.astro"),
    "utf-8"
  );

  // ribbon-track-wrap touch momentum and mandatory snap
  assert.match(
    dateSwitcherAstro,
    /-webkit-overflow-scrolling:\s*touch/,
    "DailyDateSwitcher must enable -webkit-overflow-scrolling: touch"
  );
  assert.match(
    dateSwitcherAstro,
    /scroll-snap-type:\s*x mandatory/,
    "DailyDateSwitcher must enable scroll-snap-type: x mandatory"
  );
  assert.match(
    dateSwitcherAstro,
    /overscroll-behavior-x:\s*contain/,
    "DailyDateSwitcher must contain overscroll-behavior-x"
  );

  // .date-pill minimum 44px height touch target
  assert.match(
    dateSwitcherAstro,
    /\.date-pill\s*\{[^}]*min-height:\s*44px/s,
    "date-pill must enforce minimum 44px height touch target on mobile"
  );

  // Stepper buttons minimum 44x44px touch targets
  assert.match(
    dateSwitcherAstro,
    /\.ribbon-step-btn\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s,
    "ribbon-step-btn must meet 44x44px minimum touch targets on mobile"
  );
});
