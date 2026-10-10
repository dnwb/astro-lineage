# Implementation status

The local software work for Tickets 01–04 is present. A Sol review returned `REQUEST CHANGES`; the reported software defects have been addressed, and the revised diff still needs independent review. Do not run channel writes while the remaining source, approval, and identity gates are unresolved.

## Completed locally

1. [x] Inspect the title-system requirements and preserve the existing dirty worktree.
2. [x] Ticket 01: shared deterministic daily, paper, weekly, and QQ title policy.
3. [x] Ticket 02: remove duplicate platform-title headings from post bodies.
4. [x] Ticket 03: add the fail-closed figure resolver and publication integration. The software accepts only review records meeting its explicit visual-review contract; the current manifest does not qualify, so no image is eligible yet.
5. [x] Ticket 04: generate a read-only history preview from current source bindings.
6. [x] Fix the reviewed-figure no-op reentry regression. Figure removal keeps the AstroLineage body marker, so comparison must use the unfigured body plus that marker. The previous comparison falsely requested approval to edit.
7. [x] Address the first Sol review's software findings: compare daily titles against every same-day highlight, render Top 5 history previews from the website-bound event source, retain bounded remote detail error codes, and preserve verified figure posts during no-change reentry.
8. [x] Correct the spec-review length finding: prefer an existing complete paper-title candidate of 60 Unicode characters or fewer, then fall back to a complete candidate up to the 200-character platform limit; surface the >35-Han review diagnostic in history-preview risk flags.
9. [x] Rename the title-length diagnostic threshold for all title kinds and test bound daily/weekly diagnostics through history-preview risk flags.
10. [x] Separate source provenance from title generation in history previews: report `source_status` (`bound`, `unavailable`, `ambiguous`, `missing`, `unbound`) independently from `candidate_status` (`available`, `manual_review`, `unavailable`), and make title sync reject anything except a bound source with an available candidate.
11. [x] Make offline history audits report `remote_not_checked` instead of simulating failed detail reads; preserve source and title-review classifications independently.

## Verification

- Passed: the five scoped title/history/figure/publisher/QQ test files (178 tests, 0 failures), including the 2609.38344 compact-result regression, 60–200-character qualified title, bound daily/weekly diagnostic propagation, fail-closed source/candidate status separation, and offline `remote_not_checked` reporting.
- Passed: syntax checks for 10 scoped title, figure, publisher, and test files; scoped trailing-whitespace scan found none.
- Passed after the retained-figure fix: `node tests/tencent-channel-publisher.test.mjs` (73/73 tests). The no-op reentry case passes without editing the existing post or removing its image.
- Passed: `git diff --check` scoped to the changed publisher/QQ/test files.
- Passed: source audit against the current website binding and all 228 ledger rows: 227 sources are bound and 1 is unavailable; title candidates are 226 available, 1 manual-review, and 1 unavailable. There is no current group of 9 unreliable-source records. The only source exception is `events:top5` (`event_snapshot_mismatch`); the only separate title-review exception is `daily-summary:2026-09-22` (`CHANNEL_TITLE_DAILY_FORMULA_REQUIRES_REVIEW`).
- The `events:top5` mismatch is a stale publication binding, not missing paper provenance: `.cache/notebooklm/website.json` records the event snapshot at 08:42Z, while both current `src/data/scientific-events.json` and `dist/api/v1/events.json` are at 08:53Z. Keep it blocked until the normal website publish step refreshes the binding; never replace the bound snapshot with the newer source file during title sync.
- The saved `preview-source-diagnostics-20261006.json` is stale for the new status contract: its `source_status_counts` mixes candidate states and its 228 remote classifications are `remote_unavailable`; do not treat that file as a live remote title comparison.
- Fresh offline audit `preview-source-status-20261006-v2.json` reports `inventory_status=not_checked`; its classifications are 226 `remote_not_checked`, 1 `source_unavailable`, and 1 `scientific_title_needs_manual_review`. Source and candidate counts remain 227/1 and 226/1/1 respectively.
- The unrestricted `git diff --check` still reports trailing whitespace in unrelated dirty files (`AGENTS.md:3`, `src/domain/academic-domain.mjs:314`); those files were not changed for this task.
- `npm run verify` and `npm run build` were not run; this checkout has concurrent unrelated edits and shared build output was intentionally left untouched.
- The first Sol review returned `REQUEST CHANGES`; the reported software defects have been repaired. The second Sol review found the 60-character hard-limit/spec mismatch; it is now corrected, and fresh independent review of this revision is pending.

## Pending gates

1. [ ] Complete the fresh Sol review of the current title-system source and tests; fix any substantive findings and review changed code again.
2. [ ] Preserve a recoverable pre-change baseline and establish the exact task diff before closing Ticket 06. The title modules/tests are untracked, and shared publisher/test files include concurrent edits, so this checkout has no clean task-only diff.
3. [ ] Record a human visual comparison before treating the current paper figure as eligible. Agent review is not sufficient.
4. [ ] Restore a complete live read-only inventory before comparing existing posts. The confirmed device code expired; a fresh code request and `login status` both failed with Tencent API TLS handshake timeouts, including the bounded host-side read-only check. No remote title/body was changed. The old saved preview's 228 `remote_unavailable` results were not provenance findings; the current offline audit explicitly reports `remote_not_checked`. Original live titles and body/media baselines are still unavailable.
5. [ ] Resolve the approved-title mismatch before any live write. Fresh source-bound recomputation confirms `daily-summary:2026-10-04` is available and exactly matches its approved title `「10-04」GRB 220627A两段亮期之间静默约600秒`; `weekly:2026-W40` is available but its generated title `W40周报：等离子体透镜研究给出放大率分布与重复时延的可检验预言` does not match the approved candidate `W40周报：前兆非探测收紧超新星失质量约束`, so skip it.
6. [ ] The approved live baseline file is absent. After read-only inventory works, capture and validate the approved target's current feed identity/title/body/media as the recoverable baseline; do not infer a baseline from stale reports or hashes alone.
7. [ ] Ticket 05: only after the exact candidate, current source binding, approval, and live identity/content baselines agree, update approved title fields only and verify by same-ID read-back. Stop on mismatch or unknown outcome.
8. [ ] Re-entry and live-channel verification remain pending. No remote title or body was changed in this run.

## Safe next steps

1. Finish the pending Sol review.
2. Re-publish the website through its normal flow so the published event snapshot matches current source data; do not bypass the hash gate.
3. Fix or withdraw the W40 candidate with user approval; do not silently replace the approved title.
4. When Tencent reads work again, regenerate the full-history preview and capture the missing approved baseline from verified original posts.
5. Run Ticket 05 only for records passing every gate, then verify re-entry and read-back.
6. Run the repository-wide checks only when shared edits/build output can be used safely.

Do not run a broad arXiv update, timer, backfill, QQ send, general channel publication, or any unapproved historical title update as part of this task.
