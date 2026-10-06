# Original-post title and compact-reader synchronization

Status: requested migration live-verified; broader scientific/media and delivery work remains open.

## Build gate

User explicitly authorized the offline build. The first attempt was interrupted by the tool's 60-second timeout; no successful receipt was inferred from it. The subsequent `bash scripts/cron-runner.sh build` generated 84 pages and recorded successful build `1791079930337203255-2`.

Publication source binding: `2dfc3c46e9718666630e1245607408844bc2be2f3d4f1093b9479e2cfa516c74`. Current sources and the successful receipt were checked before each batch and each remote edit. Canonical validation passed for 41 Works with unchanged digest `d28121346d7298481ef6cc14e5d74a45b127639fdf2b1c26bbc913655839ee3a`.

The runner subsequently exited 1 because its local NotebookLM browser export returned `NOTEBOOKLM_BROWSER_FAILED`. Static website build success and that downstream export failure are separate outcomes. No current NotebookLM export/sync success is claimed.

## Live result

- Eight bounded paper batches: 203 updated originals; 152 unresolved versions remain pending placement.
- Daily opening briefs: all 19 updated originals use a leading scientific development rather than a report/section prefix.
- Current W40 weekly and persistent Top 5 chart: one same-ID update each; chart bytes match the successful website event snapshot.
- Total: 224 updates; zero new posts, moves, deletes or errors. Each changed title and full marked body was read back and matched exactly. All original feed IDs, creation identities and section IDs were retained.
- Independent terminal inventory: three pages, 229 unique posts, all 224 owned originals present, five other historical posts retained.
- Complete normal reentry: 224 unchanged, zero updates/new posts/errors; 152 unresolved placements still pending. Both historical cursors end at zero; no intent/unknown-outcome records remain.

Example verified daily title: `SN 2024ggi：ATClean在所有测试高斯核宽下均未发现显著爆前前兆｜09-28`.

## Recovery and checks

Recoverable baseline and per-original prior title/body records: `.cache/channel-publication/backups/title-sync-1791079930337203255-2/`. This includes 224 remote original-body backups, pre/post ledgers and website receipts, migration results and zero-write reentry results. An earlier temporary recursive `dist` copy overlapped the first build attempt and is not certified as a coherent rollback artifact.

The temporary operational runner used existing publisher functions with a CLI guard permitting only reads and edits of the baseline originals; create/move/delete/provision commands were forbidden. Every batch was previewed before writes. No build/source checks were bypassed, and the operational script was not added to production code.

Focused tests: `node --test --test-reporter=tap tests/tencent-channel-publisher.test.mjs tests/qq-publication-notify.test.mjs tests/notebooklm-sync.test.mjs` — 92 passed, zero failed. Tencent skill update check found the installed skill current; configured CLI authentication and connectivity passed.

No new ingestion/analysis, canonical edits, remote notebook upload, QQ group send, service restart, timer change, deletion or commit. Existing source-unbound media, local NotebookLM export recovery, proactive QQ acceptance and unresolved scientific placement remain separate pending items.
