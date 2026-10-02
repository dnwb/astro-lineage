# Execution

- [x] Preserve exact runner/package/publisher baseline; inspect live cron and NotebookLM authentication.
- [x] Implement bounded offline HTML export, annual synchronization and per-target delivery status.
- [x] Add deterministic offline regression checks; integrate after successful build.
- [x] Run build and sync-only attempt without rerunning ingestion or sending duplicate channel posts.
- [x] Record actual notebook and authentication blocker.
- [ ] Finish real upload/replacement/reentry acceptance after server authentication.

## Verified 2026-09-30

- `npm run build`: success, 81 pages, 21 archive reports exported as six sources. Existing nonfatal KaTeX macro warnings remain.
- `node --test --test-isolation=none tests/notebooklm-sync.test.mjs tests/tencent-channel-publisher.test.mjs`: nine checks passed.
- `bash -n scripts/cron-runner.sh` and `git diff --check`: passed. Exact baseline diff reviewed; canonical files not edited by this task.
- Live crontab: weekdays 10:00 Asia/Shanghai, `cron-runner.sh auto`. Existing cron retained; no new schedule or proactive QQ messages.
- Created and named annual notebook in the authenticated user browser: `https://notebook.google.com/notebook/862f49b9-9262-4111-88c1-da374e875333`. Currently **zero sources**. URL bound in ignored local manifest.
- Sync-only attempt returns `NOTEBOOKLM_AUTH_REQUIRED`, zero uploads. User-browser login is not server login; legacy skill state also proved expired during initial probe. Browser adapter source upload/removal remains environment-unverified.
- Next action: `npm run notebooklm:login` in a visible server desktop; then `bash scripts/cron-runner.sh notebook` twice. Confirm first upload is readable and second uploads zero; exercise one bounded revision before claiming unattended sync live.

Rollback: restore only this task's runner/package hunks from `.scratch/notebooklm-annual-baseline/`; new scripts can be left unused. Never roll back unrelated dirty files. No canonical changes, full backfill, new timer or QQ proactive sends.
