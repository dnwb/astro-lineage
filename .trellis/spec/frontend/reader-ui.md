# Reader UI & High-Density Academic Experience

> Guidelines for the AstroLineage reading interface, AI-HOT date navigation, Caveman data density, and scriptless UI architecture.

---

## 1. AI-HOT Date Switching & Route Decoupling Pattern

### Rules
1. **Latest First by Default**: The root `/arxiv-daily/` route always defaults to the latest published monitoring batch.
2. **Independent Date Routes**: Historical daily editions live at `/arxiv-daily/[date]/`. Each edition is a self-contained static HTML document.
3. **Decoupled Capsule Switcher**: Use `DailyDateSwitcher.astro` to allow researchers to jump between recent dates and the historical archive without leaving the reader context.
4. **Strict Ban on In-Page DOM Stacking (Anti-Pattern)**:
   - **Forbidden**: Stacking past days' papers or nested `<details>` accordions at the bottom of the current day's page.
   - **Rationale**: DOM bloat, high memory footprint, confusing anchor targets, and search engine dilution.

---

## 2. Caveman High-Density Data Principle

### Rules
1. **Pure Data, Metrics, and Direct Links**: Present physics hypotheses, observational evidence, formulas, tables, and direct links (`arXiv:XXXX.XXXXX ↗`, `📄 PDF ↗`, `ADS ↗`).
2. **Strict Ban on Meta-Engineering & Navigational Jargon**:
   - **Forbidden Phrases**: `免跳转`, `平滑跳转`, `对齐原则`, `一一对齐`, `工程实现`, `底层逻辑`.
   - **Action-Oriented Copy**: Use concise, functional labels (e.g. `🔬 深度精读 ↗`, `进入当日日报 →`, `📅 2026-10-01 精读 →`).
   - Do not describe UI implementation mechanics to the reader. Deliver the science directly.
3. **Automated Hygiene Guardrail**:
   - Every commit must pass `npm run test:hygiene` (`tests/copy-hygiene.test.mjs`), which scans all `.astro` components and reader pages for forbidden jargon.

---

## 3. Zero Client-Script UI Contract

### Rules
1. **Semantic HTML & Native CSS Interactivity**:
   - Popover dialogs use native browser `popover="auto"` and `popovertarget="..."`.
   - Menus, dropdowns, and citations use native `<details>` and `<summary>`.
   - Date navigation uses standard semantic anchor `<a>` links.
2. **Strict Ban on Client Scripts in Reader Pages**:
   - Reader templates MUST NOT leak `<script>` tags into generated HTML.
   - Enforced by `tests/copy-hygiene.test.mjs` and `tests/arxiv-daily.test.mjs`.

---

## 4. Weekly Component Modularization & Copy Precision

All weekly synthesis pages (`src/pages/arxiv-weekly/index.astro` and `src/pages/arxiv-weekly/[week].astro`) MUST delegate to modular components under `src/components/weekly/`:
- `WeeklyDomainMatrix.astro`: Unified 2-column matrix: Left column displays physical domain; right column directly heads with a dedicated scientific debate banner (`🎯 核心科学争论 / 关键未决问题`), followed by 1-to-1 answering paper cardlets and physical mechanism takeaways.
- `WeeklyDailyTable.astro`: High-density directory table linking to daily monitoring editions.
- `WeeklyTopPicks.astro`: Curated paper cards, BibTeX/citation toggle, and popover deep-dive dialogs.
- `src/styles/weekly.css`: Shared layout, print stylesheet, and responsive media queries.

Both weekly page routes MUST stay under 600 lines of code.

### Executive Summary Subject Precision Rule
In `executive_summary`, every scientific breakthrough bullet MUST use specific papers or first authors as the grammatical subject (e.g., `Author et al. (arXiv:xxxx.xxxxx) 提出/约束...` or `arXiv:xxxx.xxxxx (Author et al.) 论证...`). Impersonal, passive, and subjectless formulations are strictly forbidden.
