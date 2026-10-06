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

## Verification

- Passed: `node --test tests/channel-title-policy.test.mjs tests/channel-title-history.test.mjs tests/channel-figure-policy.test.mjs tests/tencent-channel-publisher.test.mjs tests/qq-publication-notify.test.mjs` (5 files; 154 tests, 0 failures), including the 2609.38344 compact-result regression, 60–200-character qualified title, and bound daily/weekly diagnostic propagation to preview risk flags.
- Passed: syntax checks for 10 scoped title, figure, publisher, and test files; scoped trailing-whitespace scan found none.
- Passed after the retained-figure fix: `node tests/tencent-channel-publisher.test.mjs` (73/73 tests). The no-op reentry case passes without editing the existing post or removing its image.
- Passed: `git diff --check` scoped to the changed publisher/QQ/test files.
- The unrestricted `git diff --check` still reports trailing whitespace in unrelated dirty files (`AGENTS.md:3`, `src/domain/academic-domain.mjs:314`); those files were not changed for this task.
- `npm run verify` and `npm run build` were not run; this checkout has concurrent unrelated edits and shared build output was intentionally left untouched.
- The first Sol review returned `REQUEST CHANGES`; the reported software defects have been repaired. The second Sol review found the 60-character hard-limit/spec mismatch; it is now corrected, and fresh independent review of this revision is pending.

## Pending gates

1. [ ] Complete the fresh Sol review of the current title-system source and tests; fix any substantive findings and review changed code again.
2. [ ] Preserve a recoverable pre-change baseline and establish the exact task diff before closing Ticket 06. The title modules/tests are untracked, and shared publisher/test files include concurrent edits, so this checkout has no clean task-only diff.
3. [ ] Record a human visual comparison before treating the current paper figure as eligible. Agent review is not sufficient.
4. [ ] Restore a complete live read-only inventory before comparing existing posts. The latest saved preview, `.cache/channel-publication/reviews/channel-title-system/preview-offline-resume-20261005.json`, contains 228 rows, all `remote_unavailable`; original titles and body/media baselines are absent.
5. [ ] Resolve the approved-title mismatch before any live write:
   - `daily-summary:2026-10-04`: generated title matches the approved candidate `「10-04」GRB 220627A两段亮期之间静默约600秒`.
   - `weekly:2026-W40`: generated title is `W40周报：等离子体透镜研究给出放大率分布与重复时延的可检验预言`, not the approved candidate `W40周报：前兆非探测收紧超新星失质量约束`.
6. [ ] Ticket 05: only after the exact candidate, current source binding, and live identity/content baselines agree, save a recoverable title-only snapshot; update only approved title fields and verify by same-ID read-back. Stop on mismatch or unknown outcome.
7. [ ] Re-entry and live-channel verification remain pending. No remote title or body was changed in this run.

## Safe next steps

1. Finish the pending Sol review.
2. Fix or withdraw the W40 candidate with user approval; do not silently replace the approved title.
3. When the channel can be read, regenerate and review the full-history preview and identity baselines.
4. Run Ticket 05 only for records passing every gate, then verify re-entry and read-back.
5. Run the repository-wide checks only when shared edits/build output can be used safely.

Do not run a broad arXiv update, timer, backfill, QQ send, general channel publication, or any unapproved historical title update as part of this task.
