# Tencent Channel publication

`scripts/tencent-channel-publisher.mjs` requires a published daily generation pointer, a matching source binding in `.cache/notebooklm/website.json`, and a built page. The runner captures daily generation, weekly source, and archive hashes before build, then verifies them after build. Historical backfill reads only matching, validated `src/data/arxiv-archives/daily/*.json` and their built `dist/arxiv-daily/<date>/index.html` pages. It does not fetch arXiv or run analysis.

## Offline plan

```sh
node scripts/tencent-channel-publisher.mjs --backfill --dry-run --limit 20
```

Live entry points are `provision`, `daily`, `weekly`, and `--backfill --limit N` (1–50). Backfill starts with Must Read, then Worth Knowing. Its cursor and per-paper checkpoints live in ignored `.cache/channel-publication/guild-<id>.json`; calls are serialized by `publisher.lock`. A bounded batch reports `published`, `updated`, `unchanged`, `pending`, and `remaining`. Re-run to resume. At the end of a sweep the cursor resets so pending records can be revisited. Keep this ledger when redeploying; losing it requires reconciliation before publication.

Daily posts have one primary R1–R7 section and retain related lines in the body. Section titles come from `PROJECT_CONTEXT.md`; an unclassified paper stays pending. The existing weekly section and Markdown renderer remain in use; an identified weekly original is edited, preserving its comments. Existing combined daily posts are untouched. Ambiguous CLI results or incomplete pagination stay pending. Newly provisioned sections are trusted for fresh keys only after an empty inventory is verified and saved in the ledger; an unknown prior intent still requires positive remote reconciliation. A confirmed rate-limit response stops the batch with its cursor at the affected paper.

To adopt known legacy posts, store a private map at `.cache/channel-publication/legacy-bindings.json` or pass `--legacy-bindings <private-json-path>`. A daily key is `daily:<arxiv-id>v<revision>`; a weekly key is `weekly:<week-id>`. Each value contains `guild_id`, `feed_id`, `create_time`, `channel_id`, `title`, full original `content`, and `owner_verified: true`; weekly values also have `week_id`. The publisher re-reads the exact original body and title, then edits that same post. A daily original may first move to its R1–R7 section. Unbound same-week posts remain pending so an older distinct report cannot be mistaken for the original. Keep the map private. Do not put old combined daily reports in it.

Before live use, run `bash scripts/cron-runner.sh build` to capture and verify the source binding without ingestion, remote synchronization, or service restart. Check the installed CLI schemas for `manage.create-channel`, `feed.get-channel-timeline-feeds`, `feed.get-feed-detail`, `feed.publish-feed`, and `feed.alter-feed`, then run one daily publication and an unchanged reentry. A local test pass cannot prove remote section permissions, pagination completeness, or edit behavior.
