# Resolve channel inventory termination before fresh backfill

Status: needs-info
Priority: P1

## Evidence

Installed CLI is 1.0.10. `feed.get-channel-timeline-feeds` supports guild/channel/count/cursor, not `get-type`. R1 was created during this task. Its empty first page returned a cursor `pageNum=2&top=` and `has_more:true`; page two remained empty with `pageNum=3&top=` and `has_more:true`. After the bound GRB moved into R1, its first page returned that post but still `has_more:true`. Weekly first page returned three known posts, also with `has_more:true`. Skill/help provide no empty-page terminal guarantee; the installed implementation is a platform binary.

The first fresh eligible backfill item remains pending with `CHANNEL_PAGINATION_INCOMPLETE`; no new post was created. The two-page no-progress cap limits requests while keeping `complete:false`.

## Required decision / work

Establish authoritative inventory termination from official provider/CLI evidence, an upstream fix, or separately approved manual inventory receipts bound to the exact sections and bootstrap scope. Preserve unknown-write reconciliation; do not weaken absence checks or delete historical posts. No new provider/dependency or automatic scientific analysis is authorized by this ticket.

## Continued live audit — 2026-10-02

- Installed CLI remains 1.0.10; official skill HEAD reports skill 1.1.5 and CLI 1.0.6. No newer skill was advertised; nothing was upgraded.
- Four read-only timeline requests reproduced the blocker using the installed schema's flags and exact returned cursors: R1 pages 1/2 each returned the same single remote post, `has_more: true`, and advancing `pageNum=2/3` cursors. R2 pages 1/2 returned no feeds, `has_more: true`, and advancing `pageNum=2/3` cursors. No remote write was attempted.
- Official skill/feed reference and installed schema do not establish that these empty/repeated pages terminate the inventory. Additional upstream documentation retrieval was inconclusive: the attempted raw GitHub reference returned HTTP 404 and the repository contents endpoint returned HTTP 403. These failures are not evidence of a provider guarantee.
- Targeted publisher, runner and NotebookLM delivery tests reran successfully: 40 passed, 0 failed. The private ledger still contains two published original identities and backfill cursor 1. No full-repository success is claimed.
- Next gate remains an authoritative pagination contract/fix or an explicitly approved human inventory receipt for the exact topic sections. Do not convert this observation into verified absence or restart the historical sweep blindly.

## Software-verifiable acceptance

- Regression using the actual response shape; schema-compatible flags and bounded cursor/no-progress handling.
- Unverified/incomplete inventory causes pending, never fresh creation.
- Known positive same-ID original updates/reentry still work.
- Concurrent publishers, ambiguous remote writes and stale build sources remain fail-closed.

## Environment-dependent acceptance

- Establish and retain the actual terminal/independent inventory receipt for each relevant section.
- Publish one genuinely new eligible paper, verify remote version/body/section and saved ledger identity; unchanged reentry creates/edits nothing.
- Resume approved 2026-09-07..2026-10-01 scope in batches <=50, recording real published/updated/unchanged/pending/remaining totals. Unclassified items remain explicit pending; this ticket does not authorize forced scientific placement.
