# Topic-based channel publication, historical backfill and duplicate cleanup

## Goal

User approved `.scratch/tencent-channel-publication/review.md` and its two exact clone deletions. Implement R1–R7 single-paper daily channel publication, unchanged weekly organization, idempotency and bounded historical backfill of already published guides.

## Requirements

- Read published generations and validated historical archives; preserve eligibility, exact revision, reading scope, assumptions, limits and links. Unclassified/invalid items stay pending.
- Daily: one paper per post, one primary R1–R7 section; other related topics in text. Weekly keeps current renderer and section, editing an identified original rather than generating clones; preserve comments.
- One channel delivery attempt per kind per runner invocation; persistent publication identities and per-item checkpoints protect reentry, changed content and ambiguous remote outcomes.
- Bind delivery to this build/export; export failure cannot masquerade as success via old state or block an independent valid channel attempt. No proactive QQ broadcasts while permission is pending.
- Backfill local published 2026-09-07..2026-10-01 guides (baseline 105 MR + 247 WK unique versions), MR first, serialized bounded batches. No new arXiv/model ingestion.
- Delete only the daily clone created 2026-10-02 10:35:42 Beijing and W40 clone 10:35:43; retain originals 10:35:38/39. Recheck identical bodies and zero interactions, back up content, verify deletion. Preserve older distinct W40 and commented W39.
- Preserve other sessions' edits and canonical schema/prose/approvals/digests. No cron cadence changes, service restart or commit authorized.

## Acceptance Criteria

- [ ] Offline source/version, routing, scoped ledger, no-op/edit, unknown-outcome reconciliation, concurrency, corrupt-state, repeated pagination and failure-isolation regressions pass.
- [ ] Seven sections reused/created; one real eligible paper publishes and unchanged reentry does not duplicate.
- [ ] Exactly two approved clones removed, original and commented historical posts remain.
- [ ] Bounded historical batches have verifiable published/updated/pending/remaining counts; environment limits recorded honestly.
- [ ] Weekly format preserved; exact task diff independently reviewed; no unrelated edits or canonical digest changes.

## Notes

- Implementation and live acceptance remain distinct. Passing mocks does not establish platform acceptance. Final handoff includes actual live counts and pending items.
- 2026-10-02 live checkpoint: seven sections and two same-ID original updates/reentries verified; fresh publication/backfill remains blocked by incomplete remote inventory. See `closeout.md` and `issues/01-channel-inventory.md`; task is not complete.
