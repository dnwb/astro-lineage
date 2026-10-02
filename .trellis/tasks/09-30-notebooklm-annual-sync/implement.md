# Execution

- [x] Preserve exact runner/package/publisher baseline; inspect live cron and NotebookLM authentication.
- [x] Implement bounded offline HTML export, annual synchronization and per-target delivery status.
- [x] Add deterministic offline regression checks; integrate after successful build.
- [x] Run build and sync-only attempt without rerunning ingestion or sending duplicate channel posts.
- [x] Record actual notebook and authentication blocker.
- [ ] Finish real upload/replacement/reentry acceptance after server authentication.

## HTTP migration — 2026-10-02

User explicitly requested the updated `$notebooklm` skill and synchronization on every update. Keep the existing runner cadence and yearly combined library. The maintained HTTP CLI's passive authentication succeeds; remote inventory confirms the existing 2026 notebook has zero sources. Replace the live browser transport, retain the offline exporter/build binding and private ledger, run injected HTTP regressions, then upload existing built reports and verify unchanged reentry. Preserve unrelated working-tree changes, channel/QQ behavior and canonical bytes. Recoverable pre-migration source baseline: `/tmp/notebooklm-http-baseline.SfI2Ir4T/`. No ingestion/model rerun or service restart is part of this migration.

## Verified HTTP migration — 2026-10-02

- Reused `AstroLineage｜2026 精读日报与周报`, notebook ID `862f49b9-9262-4111-88c1-da374e875333`; did not create another annual library.
- Successful live recovery at `2026-10-02T16:12:35.055Z`: four remaining source confirmations, zero errors, 13 verified monthly bundles covering 19 daily reports (`2026-09-07` through `2026-10-01`) and four weekly reports (`2026-W37` through `2026-W40`). Each source was verified against original text/hash before recording success.
- Unchanged reentry at `2026-10-02T16:13:03.395Z`: success, **zero uploads**. Independent remote inventory subsequently confirmed all 13 expected titles are ready, no missing/duplicate expected source, and no export/manifest hash mismatch.
- Remote inventory has 14 sources: the 13 verified bundles plus one retained, explicitly renamed `AL-import-format-unverified-...` first trial. This trial is not counted as synchronized; no remote content was deleted. Recovery receipt is `.cache/notebooklm/import-recovery-20261002.json`.
- Native sandbox attempts repeatedly timed out on the read-only notebook inventory; equivalent HTTP queries worked in the network-enabled environment. The authorized host-network runner completed recovery without changing timeouts or weakening content checks. This was an execution-environment boundary, not evidence of invalid credentials.
- `python3 tests/notebooklm-http.test.py`: 13 checks passed. `node --test tests/notebooklm-sync.test.mjs tests/cron-runner.test.mjs tests/tencent-channel-publisher.test.mjs`: 43 checks passed. Runner syntax and narrow diff whitespace checks passed; no full-repository green claim.
- Latest offline build/export: build ID `1790956434447057079-2`, 84 pages, 23 reports, 13 bundles. The current-page SHA guard rejects stale exports before Google calls. Recoverable baseline remains `/tmp/notebooklm-http-baseline.SfI2Ir4T/`.
- Live cron remains weekdays 10:00 `Asia/Shanghai`, `cron-runner.sh auto`; its build/delivery path already invokes HTTP NotebookLM synchronization independently of channel outcome. No new schedule, ingestion/model rerun, channel publication, QQ send, service restart or canonical edit was performed for this migration.

Pending acceptance: observe the next actual cron execution; validate a real changed-bundle revision before claiming unattended revision acceptance. Ownership-verified old-version cleanup/replacement is not implemented by this HTTP migration; changed bundles currently retain predecessors and can consume quota. Keep this broader task `in_progress`. `status.json` is the current NotebookLM-only result; `delivery.json` remains the historical multi-target run until the next complete delivery, not a fresh channel/QQ result.

## Verified 2026-09-30

- `npm run build`: success, 81 pages, 21 archive reports exported as six sources. Existing nonfatal KaTeX macro warnings remain.
- `node --test --test-isolation=none tests/notebooklm-sync.test.mjs tests/tencent-channel-publisher.test.mjs`: nine checks passed.
- `bash -n scripts/cron-runner.sh` and `git diff --check`: passed. Exact baseline diff reviewed; canonical files not edited by this task.
- Live crontab: weekdays 10:00 Asia/Shanghai, `cron-runner.sh auto`. Existing cron retained; no new schedule or proactive QQ messages.
- Created and named annual notebook in the authenticated user browser: `https://notebook.google.com/notebook/862f49b9-9262-4111-88c1-da374e875333`. Currently **zero sources**. URL bound in ignored local manifest.
- Sync-only attempt returns `NOTEBOOKLM_AUTH_REQUIRED`, zero uploads. User-browser login is not server login; legacy skill state also proved expired during initial probe. Browser adapter source upload/removal remains environment-unverified.
- Next action: `npm run notebooklm:login` in a visible server desktop; then `bash scripts/cron-runner.sh notebook` twice. Confirm first upload is readable and second uploads zero; exercise one bounded revision before claiming unattended sync live.

Rollback: restore only this task's runner/package hunks from `.scratch/notebooklm-annual-baseline/`; new scripts can be left unused. Never roll back unrelated dirty files. No canonical changes, full backfill, new timer or QQ proactive sends.
