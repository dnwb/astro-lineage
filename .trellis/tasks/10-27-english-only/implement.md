# Implementation Plan: English-only Site and Channel

## Tickets / Phases

### [x] P0: Decisions and PRD alignment

- Locked decisions: cutover baseline A, historical archives A, channel metadata A, QQ bot flexible.

### [ ] P1: Generation Pipeline & SSOT Cutover

- Create `src/domain/language-cutover.mjs` with cutover date & helper functions (`isLegacyArchive(date)`, `getDisplayTitle(paper)`).
- Update `scripts/arxiv-ai-analyzer.mjs`:
  - Change prompt from Chinese `title_zh` to pure English output.
  - Analyzer stores English claim titles, takeaways, and methods.
- Update `scripts/arxiv-weekly-summary.mjs`:
  - English prompt for synthesis, recommendation reasons, and insights.
- Update `scripts/daily-radar.mjs` and reader logic to gracefully fall back on legacy data (`paper.title_en || paper.title_zh || paper.title`).
- Verify via `node --test tests/arxiv-ai-analyzer.test.mjs tests/arxiv-weekly.test.mjs tests/paper-reading.test.mjs`.

### [ ] P2: Site UI English Conversion & Legacy Banner

- Remove `src/components/LanguageSwitch.astro`.
- Clean up `src/styles/global.css`: delete language toggle switch rules.
- Transform `src/pages/` and `src/components/`:
  - Replace `<html lang="zh-CN">` with `<html lang="en">`.
  - Remove `.language-primary` / `.language-english` dual-span wrapper patterns, retaining clean English copy.
  - Update `src/domain/academic-domain.mjs` category labels to English ("All", "Must Read ⭐", "Followed 📌", etc.).
  - Remove `src/lib/reader-localization.ts`.
  - In daily & weekly pages, add `Legacy (Chinese)` pill/banner for archives prior to cutover.
- Run `npx astro check` and verify `npm run build`.

### [ ] P3: Core Content (reading.md & work.yaml)

- Batch-process `content/works/*/reading.md`:
  - Remove `### 中文导读` subheadings and Chinese paragraphs.
  - Promote `### English reading note` text to direct section bodies.
- Translate `reason:` fields in `content/works/*/work.yaml` to concise English.
- Run `npm run validate` to ensure academic knowledge graph remains valid.

### [ ] P4: Channel & Egress English Transition

- Rebuild `scripts/channel-title-policy.mjs`:
  - Replace Chinese-grammar regex with English scientific title grammar constraints (declarative statement, max length, no ending prepositions/punctuation, no generic buzzwords).
- Update `scripts/tencent-channel-publisher.mjs`, `scripts/channel-publication.mjs`, `scripts/notification-egress.mjs` templates to English.
- Update channel tests (`tests/channel-title-policy.test.mjs`, `tests/tencent-channel-publisher.test.mjs`).

### [ ] P5: QQ Bot Adjustment

- Update `scripts/qq-official-bot.mjs` and `scripts/bot-commands.mjs`:
  - Keep Chinese user input command aliases (`/帮助`, `/最新`, `/订阅`).
  - Update output messages and push formatting to concise English.
- Verify `tests/bot-commands.test.mjs` and `tests/qq-official-bot.test.mjs`.

### [ ] P6: Hygiene, Specs & Full Verification

- Update `tests/copy-hygiene.test.mjs`:
  - Enforce zero CJK in `src/pages/`, `src/components/`, `src/layouts/`, channel publishers.
  - Allow-list legacy archive JSONs and QQ bot input regexes.
- Delete obsolete tests (`tests/chinese-reader.test.mjs`).
- Update `ARCHITECTURE.md` and `.trellis/spec/frontend/reader-ui.md`.
- Run `npm test` and `npm run build`.
