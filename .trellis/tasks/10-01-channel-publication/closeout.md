# Channel publication — partial live closeout

Status: code implemented and reviewed; live backfill is **not complete**. New-post publication is blocked by unverified remote inventory. Task remains `in_progress`. No commit, cron cadence change, ingestion, model analysis or service restart was performed.

## Delivered

- Runner uses one delivery path per daily/weekly target. Build sources are captured before build, checked after, and bound to channel publication. Export failure cannot reuse a stale NotebookLM snapshot or prevent an independent channel attempt. QQ proactive sends remain disabled pending platform permission.
- Daily publication is one exact arXiv version per post, one primary R1–R7 section, related directions in text. Section titles derive from `PROJECT_CONTEXT.md`; uncertain placement remains pending. Weekly renderer and section are unchanged.
- Operational ledger/lock, intent reconciliation, same-ID move/edit, owned legacy bindings, bounded archive/body/CLI gates and actionable sanitized delivery errors are implemented. CLI parameters match installed schemas; escaped section names are reused. Two no-progress pages return incomplete, never verified empty.

## Real platform results

- Exactly seven topic sections exist once each; original daily/weekly sections remain. R1 was reused after the interrupted first provisioning attempt, not duplicated.
- Exactly the two user-approved identical clones were deleted; originals and older distinct/commented reports were preserved. Private pre-deletion body backups cannot restore the deleted remote identity.
- GRB 2609.22426v1: original moved to R1 and edited, then unchanged on reentry. W40: explicitly bound original edited, then unchanged on reentry. Final detail reads confirmed same remote IDs, correct sections, markers and exact body hashes.
- No new single-paper post was created. The 2026-09-21 scoped batch updated that GRB and left 22 pending: 14 incomplete inventories, 8 unresolved topics. Reentry updated/published none and reused the GRB.
- First fresh global item, arXiv:2609.06201v1: `published=0`, `pending=1`, `CHANNEL_PAGINATION_INCOMPLETE`; cursor reports `remaining=354`. This is not successful publication or a complete sweep.
- Archive scope 2026-09-07..2026-10-01: 19 validated editions, 355 unique eligible versions (105 Must Read, 250 Worth Knowing). Routing: R1=5, R2=50, R3=47, R4=2, R5=20, R6=46, R7=19; 166 unclassified. One existing daily original updated; the other 354 versions have not been published as new per-paper posts.

## Verification

- Final affected Node tests: 40 passed, 0 failed across publisher, delivery and runner. JS/shell syntax checks pass. Independent exact-baseline review and narrow post-live CLI/pagination review approved the code changes.
- `bash scripts/cron-runner.sh build`: passed, 84 pages built; matching pre/post source binding, 23 reports/12 sources exported locally. It did not sync remote notebooks or restart services.
- `npm run verify`: failed in the wider dirty worktree, 34/48 test files passed and 14 failed. It stopped before its check/build stages; do not call this whole-repository verification green. Current publisher tests pass separately after concurrent fixes. A bounded rerun of `arxiv-validator-issues.test.mjs` reproduces an unrelated evidence/LaTeX verbatim assertion; remaining wider failures have not been attributed or repaired in this task.
- Canonical bytes stayed unchanged during resumed execution: 332 files, SHA256 `0c08433c3113bb4c304515ff79c2c2762eeaac8499caf668805cea61888aa5c8`. Successful build validation reported canonical digest `d28121346d7298481ef6cc14e5d74a45b127639fdf2b1c26bbc913655839ee3a`. This does not claim the pre-existing canonical worktree matches HEAD. Existing KaTeX macro warnings are not repaired here.

## Review baseline / changed surface

Recoverable source baseline: `/tmp/astrolineage-channel-review.MfveQ0/`, HEAD `364020d3fd10b9a014c16923f5658ae8ef8f683a`. Source files were already untracked, so ordinary `git diff HEAD` is insufficient; review uses exact no-index comparisons.

Implementation surface: `scripts/tencent-channel-publisher.mjs`, `scripts/channel-publication.mjs`, `scripts/cron-runner.sh`, `scripts/notebooklm-sync.mjs`, their three test files, two runbooks, and the channel paragraph in the backend publication contract. Task artifacts record the approved scope. Other sessions' changes were preserved.

## Runtime evidence / recovery

Ignored private runtime: `.cache/channel-publication/guild-<guild>.json`, `legacy-bindings.json`, `section-map.json`, and `backups/` containing approved-clone, cleanup-result, legacy-GRB and updated-original receipts. Keep the ledger and bindings; losing them must not authorize blind recreation. Notebook build/source binding is in `.cache/notebooklm/website.json` and `build-capture.json`.

## Pending next steps

1. Resolve the remote inventory contract before fresh posts: empty pages advance `pageNum` and retain `has_more:true`. Known occupied sections do return their posts, so this is not proof of an empty or complete inventory. Require documented terminal semantics/upstream repair or a separately approved, scoped human inventory receipt; do not reinterpret empty pages as complete merely to publish.
2. After that gate, one fresh paper + exact remote detail + unchanged reentry, then serialized bounded historical batches. Stop/reconcile unknown outcomes; confirmed rate limit gets one bounded delayed retry, not repeated writes.
3. Review the 166 unresolved placements without expanding canonical content or running new scientific analysis. They remain pending rather than being discarded or forced into a topic.
4. Diagnose wider-worktree verification failures separately. QQ permissions and NotebookLM remote-auth/sync acceptance remain independent; this run made no claim that either was fixed.

See `issues/01-channel-inventory.md` for the immediate blocking ticket.

## Continued audit — 2026-10-02

Four read-only live timeline requests reproduced repeated R1 posts and empty R2 pages with advancing cursors and `has_more: true`. Installed schema/official local reference still provide no terminal-empty guarantee; additional upstream GitHub documentation retrieval returned 404/403. Targeted publisher/runner/NotebookLM delivery tests remain 40/40 passing. No fresh post, deletion, ledger edit, cron change, ingestion, analysis or service restart occurred in this audit. Historical backfill remains incomplete pending the inventory decision recorded in the blocking ticket.
