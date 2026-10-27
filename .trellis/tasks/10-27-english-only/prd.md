# PRD: English-only site and channel (Plan B)

## Decision

- The site and the Tencent channel must publish English only.
- New data must be generated in English from the cutover date.
- Historical archives (2026-09-07 .. 2026-W44) stay frozen in Chinese and carry a `legacy` label. Backfill (Plan C) is a separate later task.
- QQ bot can keep minimal Chinese where required (command aliases, user-facing replies to Chinese users). New push content from the pipeline must be English.

## Scope inventory (2026-10-27 scan)

| Layer                            | Files with CJK | Notes                                                                                       |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `src/pages`                      | 14             | bilingual `language-primary` / `language-english` spans                                     |
| `src/components`                 | 22             | same pattern; `LanguageSwitch.astro` is the toggle                                          |
| `src/lib/reader-localization.ts` | 1              | Chinese-only reader text map → delete                                                       |
| `src/domain`                     | 5              | `academic-domain.mjs` labels + regex, `paper-translation.mjs`, `scientific-claim-title.mjs` |
| `content/works/*/reading.md`     | 36 of 41       | each section already has `### English reading note`; strip `### 中文导读`                   |
| `content/works/*/work.yaml`      | ~41            | `reason:` fields in Chinese                                                                 |
| `scripts`                        | 39             | prompts, channel title policy, PDF, bot, egress                                             |
| `tests`                          | 45             | Chinese fixtures and assertions                                                             |
| `.trellis/spec`, `deploy`        | 5              | minor                                                                                       |

## Phases (one commit per step)

### P1 Generation source (new data English)

1. `arxiv-ai-analyzer.mjs`: prompt outputs English. Drop `title_zh`. Keep evidence quote rules.
2. `arxiv-weekly-summary.mjs`, `arxiv-triage.mjs`, `daily-radar.mjs`, `paper-translation.mjs`: prompts and fields English.
3. Add `LANGUAGE_CUTOVER_DATE` in `src/domain/` (SSOT). Readers use it to mark older editions `legacy`.
4. Readers must tolerate both schemas (old `*_zh` fields, new English fields).

### P2 Site UI

1. Remove `LanguageSwitch.astro` and toggle CSS in `global.css`.
2. Replace every `language-primary` span with its English sibling; remove wrapper classes.
3. `<html lang="en">` on all pages.
4. `academic-domain.mjs`: `label` = current `englishLabel`. Keep CJK alternates in the regex only while legacy archives exist.
5. Delete `reader-localization.ts`; `ReadingProse` reads English notes only.
6. Legacy editions show a one-line notice: "This edition predates the English cutover."

### P3 Content

1. Script strips `### 中文导读` blocks from `reading.md`; promote `English reading note` text to section body.
2. Translate `work.yaml` `reason:` fields; Chinese title line → English title.
3. `npm run validate` must pass.

### P4 Channel (Tencent)

1. `tencent-channel-publisher.mjs`, `channel-publication.mjs`, `notification-egress.mjs`: English templates.
2. `channel-title-policy.mjs`: rewrite for English titles (current rules are Chinese-grammar regex). Define English title contract: length limit, no list-like titles, claim form.
3. `channel-reconcile`, `sync-all-channel-posts`, `channel-pin-events`: English labels. Existing published Chinese posts are not edited.

### P5 QQ bot (minimal)

1. Push content from pipeline: English.
2. Command parser keeps Chinese aliases as input only. Replies English unless needed.

### P6 PDF, docs, specs, tests

1. `weekly-pdf.mjs`: English layout; CJK font optional (needed only for legacy re-render).
2. Update `copy-hygiene.test.mjs`: forbid CJK in `src/pages`, `src/components`, channel templates. Allow-list legacy data and QQ aliases.
3. Remove `chinese-reader.test.mjs`; update fixtures in channel/title tests.
4. Update `.trellis/spec/frontend/reader-ui.md`, `ARCHITECTURE.md` language line, `scripts/README.md`.

## Acceptance

- `npm run validate`, `npm test`, `npm run build` pass.
- Built `dist/` HTML contains no CJK outside legacy edition pages (hygiene test enforces).
- One daily run after cutover produces English archive JSON and English channel post.
- Legacy editions render with the legacy notice.

## Out of scope

- Plan C backfill of historical archives.
- Editing already-published Chinese channel posts.

## Decisions (Locked 2026-10-27)

- **Cutover Timing (Option A)**: The baseline is the first daily pipeline run post-merge (`cutover_date` defined in SSOT).
- **Historical Archives (Option A)**: Preserved in index/weekly lists, prominently tagged with `Legacy (Chinese)` banner/badge.
- **Channel Metadata (Option A)**: Channel names, sub-forum/section titles, and pinned posts/templates are transitioned to English.
- **QQ Bot**: Retains flexible Chinese command alias matching for user queries; push notifications and standard status replies transition to English.
