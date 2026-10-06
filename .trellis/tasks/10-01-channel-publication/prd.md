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

- [x] Offline source/version, routing, scoped ledger, no-op/edit, unknown-outcome reconciliation, concurrency, corrupt-state, repeated pagination and failure-isolation regressions pass.
- [x] Seven sections reused/created; one real eligible paper publishes and unchanged reentry does not duplicate.
- [x] Exactly two approved clones removed, original and commented historical posts remain.
- [x] Bounded historical batches have verifiable published/updated/pending/remaining counts; environment limits recorded honestly.
- [x] Weekly format preserved; exact task diff independently reviewed; no unrelated edits or canonical digest changes.

## Notes

## Reader-facing extension — user requested 2026-10-03

- Use Chinese theme names for channel sections and posts; keep R1–R7 internal. Reuse and rename existing section identities rather than creating duplicates.
- Align the daily channel brief with the existing website hierarchy: Must Read papers keep one-sentence introductions; Worth Knowing/关注 papers appear as a bibliography list only. Do not add a reading priority or a separate recommendation block. Keep Skim handling and individual-paper post content unchanged. Reuse validated prose without making stronger reading claims.
- Publish daily briefs in the daily section and the current weekly summary in the weekly section; keep single-paper topical distribution and owned-post idempotency. Preserve older distinct reports and comments; no extra deletion.
- Maintain one persistent Top 5 event-heat post from the same successfully built event snapshot used by the website. Update that identity rather than creating a new chart post per run. Display as literature attention, not physical significance or a new explosion alert. No new ranking algorithm or data provider.
- Software acceptance: readable labels, unchanged eligibility/routes, summary/source bounds, stale event-build rejection, same-ID updates/reentry and independent publication results. Live acceptance: seven existing sections renamed in place; current brief/weekly/chart and historical paper updates read back; reentry creates/edits nothing. Historical unresolved placements remain pending.

- Implementation and live acceptance remain distinct. Passing mocks does not establish platform acceptance. Final handoff includes actual live counts and pending items.
- Latest 2026-10-02 live checkpoint: inventory blocker resolved; 203 historical paper posts verified, six legacy reports preserved, 152 versions explicitly pending placement. Full reentry created/edited nothing. The bounded-publication acceptance above passed; unresolved scientific placements keep the broader task open. See `closeout.md` and resolved `issues/01-channel-inventory.md` for exact evidence and earlier checkpoints.

## Short-title correction — explicitly authorized follow-up

- Superseding user feedback: paper/daily titles must communicate the object and a complete physical question, not just topic labels. Aim for 20–35 Unicode characters; allow up to 60 including the date when necessary to retain conditions or technical names. Weekly titles remain compact. Only explicitly separate follow-up questions may move to the body; never hard-truncate a claim or delete uncertainty.
- Preserve complete problems, conclusions, numbers, qualifiers, exact original titles and version-bound links in the body. Do not hard-clip technical names, promote tentative conclusions, or infer an object class from a broad category alias.
- Reuse the current canonical/published projection; no new model requests, schema fields, hand-maintained paper lists or taxonomy changes. Unknown subjects fall back to their exact arXiv identity.
- Update known originals in place with prior-body verification and title/body read-back; no create/move/delete, service restart or interference with the other session's interface/processes. Unchanged short titles stay unchanged.
- Acceptance: short-title regressions pass offline, the complete current paper/brief title audit satisfies the cap, live changed originals retain their IDs, and normal reentry creates/edits nothing. An unrelated chart snapshot failure remains independently pending, not permission to bypass its build gate.
