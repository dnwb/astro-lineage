# Design

## Goal and seam

The publisher currently owns title heuristics, body templates, remote reconciliation, and publication state. `qq-send.mjs` imports title helpers from that publisher. This couples a pure content decision to the network adapter and makes title-only migration difficult to verify.

Add one pure module under `scripts/` for title policy. Its public seam accepts a publication kind and its already-validated source record, then returns a title candidate and diagnostics. The publisher and QQ summary call the same seam. Keep existing exported helper names as thin compatibility adapters where needed.

The policy must not read files, query a model, call Tencent CLI, mutate input, or change scientific source data. The caller owns publication/build validation and handles a rejected title as pending.

## Publication composition

Keep Markdown rendering in `tencent-channel-publisher.mjs`. The platform title is an independent field. Remove the body H1 from daily, weekly, paper, and Top 5 templates. The body starts with its date or concise reading details. Keep evidence limits, source version, links, marker, and current section routing.

Do not make title-only history updates through the normal body publisher. Add a separate title-only synchronization path that:

1. Reads a frozen, explicit set of approved identities and expected titles.
2. Verifies current source build, source archive, ledger identity, target feed, section, and an explicitly approved before-snapshot (original title, body hash, and media hash).
3. Calls `alter-feed` with only the title field.
4. Reads the same feed back and verifies its identity, title, body, and media.
5. Records a recoverable before snapshot and a per-target result. Unknown outcomes remain pending.

Do not let an approval for 10/04 and W40 expand to other rows. The rest of the history audit is read-only.

The live title sync reads `.cache/channel-publication/reviews/channel-title-system/approved-title-baselines.json`. A baseline row must bind `identity`, current `source_binding_id`, exact `target_title`, `approved_at`, and the reviewed `before` values: feed ID, create time, section ID, original title, full-body SHA-256, and media SHA-256. A read-only report can provide these values, but it is not approval by itself. A person must approve the row before the baseline receives `status: "approved"`. Missing or mismatched baselines stay pending.

## Figure adapter

Resolve a figure from the validated Must Read analysis only. Require matching arXiv ID/revision, a URL below `/arxiv-figures/<id>/`, a present file below `public/`, a non-empty source caption, and a review-manifest entry matching the asset SHA-256 and source version. Return at most one attachment. If no entry passes, return no image with a diagnostic.

Do not alter the canonical schema or archive prose. Store manual visual-review records outside canonical content. For an already-published post, never append an image during this title-only migration. New publication may attach the selected image once; ledger/reentry must not upload it again. Tencent `alter-feed` retains existing images and appends new ones, so image replacement is not part of this task.

## Source and state constraints

- Use the published website/source binding and matching archive. Do not rerun arXiv retrieval or paper analysis.
- Preserve publication IDs, body marker semantics, section IDs, and current cache ledger identities.
- Historical preview is read-only. It must not overwrite an earlier preview, ledger, approval, archive, or canonical digest.
- Remote changes require the approved 10/04 and W40 candidates to match the automation output exactly and the independent review to pass.
- Remote edits are title-only for the approved sample. No new feed, body update, image upload, section move, or other date is authorized.

## Risks and decisions

- Some paper analyses may not contain a complete concise Chinese claim. The policy must diagnose and block; it must not cut qualifiers, append a guessed question mark, or fall back to a bare arXiv ID.
- Opening-brief sentences can contain several measurements. Select one complete clause only when the selected sentence remains supported by the source; otherwise return a diagnostic.
- Existing live inventory and local cache may have drifted. Use the current read-only inventory and per-feed detail as truth, not the 2026-10-05 legacy table.
- A figure can exist locally and still be the wrong revision or an unsuitable visual. The review manifest and file hash are required before attachment.

## Verification

Test through the public title policy, post composer output, figure resolver, and read-only preview interfaces. Use temporary workspaces through `tests/helpers/temporary-workspace.mjs`. Tests must not call the live Tencent CLI. Live title-only edits are verified separately by original-ID read-back.
