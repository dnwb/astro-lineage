# Tencent Channel publication

`scripts/tencent-channel-publisher.mjs` requires a published daily generation pointer, a matching source binding in `.cache/notebooklm/website.json`, and a built page. The runner captures daily generation, weekly source, and archive hashes before build, then verifies them after build. Historical backfill reads only matching, validated `src/data/arxiv-archives/daily/*.json` and their built `dist/arxiv-daily/<date>/index.html` pages. It does not fetch arXiv or run analysis.

## Offline plan

```sh
node scripts/tencent-channel-publisher.mjs --backfill --dry-run --limit 20
```

Live entry points are `provision`, `daily`, `weekly`, and `--backfill --limit N` (1–50). Backfill starts with Must Read, then Worth Knowing. Its cursor and per-paper checkpoints live in ignored `.cache/channel-publication/guild-<id>.json`; calls are serialized by `publisher.lock`. A bounded batch reports `published`, `updated`, `unchanged`, `pending`, and `remaining`. Re-run to resume. At the end of a sweep the cursor resets so pending records can be revisited. Keep this ledger when redeploying; losing it requires reconciliation before publication.

`provision` renames the existing seven section IDs to Chinese reader labels. Normal `daily` also publishes one validated website-aligned opening brief under `daily-summary:<date>` in the original daily section; `--backfill --briefs --limit N` backfills those briefs with its separate cursor. Original English paper titles and reading limits remain in each paper body; Chinese headlines summarize research questions, not translated titles.

`events` maintains one `events:top5` post in the daily section from `dist/api/v1/events.json`. The successful website receipt binds its exact hash and timestamp after the build; stale/malformed snapshots stay pending. The normal runner delivery also attempts this target independently once, without changing cron cadence. Losing the chart/brief ledger requires a complete inventory and exactly one valid same-identity marker before editing the original. Duplicate markers or external body changes remain pending, not overwritten or deleted. Historical weekly archive backfill is not implemented; the current owned week is updated and older distinct reports remain intact.

Daily posts have one primary R1–R7 section and retain related lines in the body. Section titles come from `PROJECT_CONTEXT.md`; an unclassified paper stays pending. The existing weekly section and Markdown renderer remain in use; an identified weekly original is edited, preserving its comments. Existing combined daily posts are untouched. Ambiguous CLI results or incomplete pagination stay pending. Newly provisioned sections are trusted for fresh keys only after an empty inventory is verified and saved in the ledger; an unknown prior intent still requires positive remote reconciliation. A confirmed rate-limit response stops the batch with its cursor at the affected paper.

The section timeline can repeat entries or return nonterminal empty pages. After its bounded scan fails to terminate, the publisher can use the official guild-wide latest timeline as an independent fallback. It must explicitly terminate, map every entry to a uniquely named known section, include the target section in that mapping snapshot, and agree with positive section observations. The fallback is cached only within one batch. A complete empty inventory still cannot clear an unknown publication intent; reconcile the exact marker/body and remote identity first.

To adopt known legacy posts, store a private map at `.cache/channel-publication/legacy-bindings.json` or pass `--legacy-bindings <private-json-path>`. A daily key is `daily:<arxiv-id>v<revision>`; a weekly key is `weekly:<week-id>`. Each value contains `guild_id`, `feed_id`, `create_time`, `channel_id`, `title`, full original `content`, and `owner_verified: true`; weekly values also have `week_id`. The publisher re-reads the exact original body and title, then edits that same post. A daily original may first move to its R1–R7 section. Unbound same-week posts remain pending so an older distinct report cannot be mistaken for the original. Keep the map private. Do not put old combined daily reports in it.

## Live preflight and task record

Before live use, run `bash scripts/cron-runner.sh build` to capture and verify the source binding without ingestion, remote synchronization, or service restart. Check the installed CLI schemas for `manage.create-channel`, `feed.get-channel-timeline-feeds`, `feed.get-feed-detail`, `feed.publish-feed`, and `feed.alter-feed`.

Before any remote write, run `tencent-channel-cli manage get-user-info -j` without IDs as an authentication preflight. The installed CLI schema marks this command as a read query and documents the no-argument form as the current user's global profile. A successful result confirms read authentication and connectivity; it does not prove permission to publish or edit. The response contains profile data, so discard it and record only the exit status and error class. Any error blocks remote writes; offline plans and tests may continue. The `doctor` command checks environment/connectivity and is not an authentication gate.

For each live attempt, record the session ID, exact command without secrets, source binding/build receipt, target scope, backup path, published/updated/unchanged/pending/error counts, reentry result, checks, and unresolved gates in the owning task. Link to the platform session log when available; do not copy full transcripts or credentials into the repository. A local test pass cannot prove remote section permissions, pagination completeness, or edit behavior.
