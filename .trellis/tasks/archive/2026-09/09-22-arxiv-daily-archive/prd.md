# PRD: arXiv Daily Hierarchical Archival & Standalone Routing

## Goal

Transition arXiv daily archive from single-page unbounded accordion nesting into a **hierarchical hot/cold routing architecture**:
1. **Hot Horizon (`/arxiv-daily/`)**: Render the latest daily edition in full. Retain lightweight collapsible details ONLY for editions within the current week (`week_id === currentWeekId`).
2. **Cold Permanent Archive (`/arxiv-daily/[date]/`)**: Dynamically generate dedicated, lightweight, standalone static pages for every daily edition in the archive manifest.
3. **Structured Timeline & Navigator**: Keep the top weekly archive navigator lightweight and clean, directing readers to either the in-page fold (current week) or the permanent standalone page (historical weeks).

## Requirements

1. **Astro Route `src/pages/arxiv-daily/[date].astro`**:
   - `getStaticPaths()` iterates over all daily archives in `src/data/arxiv-archives/daily/*.json`.
   - Renders a complete, dedicated reading guide page for each historical date:
     - Header badge indicating historical batch date, weekday, and week ID.
     - Dual-action links: "返回今日最新导读 (`/arxiv-daily/`)" and "查看所属周学术脉络 (`/arxiv-weekly/`)".
     - Standalone `DailyRadarBrief`, `DailyRadarPrioritySection` (must_read, worth_knowing, skim), and sources/pending disclosures.
     - Strict adherence to Tufte Data-Ink design system (warm paper, carbon ink, cinnabar accents, hairline borders, no client scripts).
2. **Prune `/arxiv-daily/index.astro` DOM Burden**:
   - Separate past archives into `currentWeekArchives` (rendered as lightweight `<details>` accordion on the page) and `pastWeeksArchives` (listed in the weekly navigator with links to their independent pages).
   - Greatly reduces DOM node count and HTML payload as archives scale.
3. **Update Navigator & Cross-Links**:
   - Weekly archive navigator on `/arxiv-daily/` links past-week days directly to `/arxiv-daily/${d.date}/`.
   - In `arxiv-weekly/index.astro`, daily batch cards link directly to `/arxiv-daily/${day.date}/`.
   - Maintain compatibility anchors `#archive-${d.date}` where appropriate.
4. **Offline & Contract Preservation**:
   - Zero client-side scripts.
   - All tests pass: `node --test tests/arxiv-archive.test.mjs`, `node --test tests/home-navigation.test.mjs`, and full `npm test`.
   - `npm run check` passes with 0 diagnostics.
   - `npm run build` generates all static routes cleanly.

## Acceptance Criteria

- [ ] `src/pages/arxiv-daily/[date].astro` builds clean static pages (e.g. `/arxiv-daily/2026-09-15/index.html`, `/arxiv-daily/2026-09-16/index.html`).
- [ ] `/arxiv-daily/` renders only current week past editions in accordions, avoiding unbounded payload growth.
- [ ] Weekly archive navigator correctly points past-week editions to `/arxiv-daily/[date]/`.
- [ ] `npm run check` emits 0 errors/warnings.
- [ ] `npm run build` succeeds and passes offline verification.
- [ ] All test suites pass.
