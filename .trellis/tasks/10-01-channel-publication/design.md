# Approved design

The user confirmed the reviewed plan, including implementation and exact two-post cleanup. Specialize that plan without adding new authority.

- Reuse public publisher names and weekly renderer. One small helper can own routing, source selection, remote reconciliation and atomic operational ledger; native filesystem and existing lock/atomic-write helpers only, no new dependencies/services.
- R1–R7 definitions come from PROJECT_CONTEXT.md and existing interest rules. Short section labels are operational; routing is not a canonical scientific assertion. Uncertain records stay pending.
- One primary remote section per post. Identity is guild + arXiv ID/revision or week ID, with exact content hash, remote ID/create time and state. Movement changes placement, not identity. Mark owned posts with a bounded identity marker.
- Save intent before writes; reconcile unknown outcomes using actual identity/content, not title alone. Fail closed when absence/success cannot be established. Detect repeated cursors/IDs and report incomplete remote pagination.
- Private ignored runtime ledger, one global writer lock, atomic per-item checkpoints. Serialize requests and cap each backfill batch. Legacy single-paper adoption requires exact version and positive content evidence.
- Daily wrapper returns a success envelope with per-item counts/pending compatible with the aggregator, or null only for an empty eligible edition. Weekly uses same ledger but unchanged generated text/section; legacy weekly adoption requires actual body match.
- A shared delivery path replaces runner direct duplicate publishing. Current-build export failures invalidate only corresponding NotebookLM outcome; channel still gets an independent attempt. QQ remains waiting_permission, no proactive group-send calls.
- Capture published source identities/hashes before a build and compare after it. Store that binding with the successful build; daily, weekly and historical channel writes must match the bound source. Existing page presence alone does not prove that its version matches the post under concurrent sessions.
- Frozen recoverable baseline: /tmp/astrolineage-channel-review.MfveQ0/. Roll back task edits only. Cached deletion content does not recover original remote ID/comments.
