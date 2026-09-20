# arXiv Discovery Fallback Runbook

The refresh chain is bounded and metadata-only:

1. official arXiv API;
2. an explicitly configured official RSS/Atom URL (`rssUrl`);
3. an explicitly supplied normalized manual snapshot (`manualSnapshot`).

API retries remain governed by the existing attempt, request-interval, and
whole-run timeout settings. RSS fallback is one request and is filtered to the
announcement window before publication. A failed or incomplete provider never
replaces the last-good generation.

Every published feed contains `provenance.source_type`, `source_url`,
`retrieved_at`, provider attempts, and
`evidence_scope: discovery_metadata_only`. This records retrieval provenance;
it is not evidence that a paper was read, checked in full text, or approved.

## Offline checks

Run `npm test -- --test-name-pattern='RSS fallback|manual snapshots'` for the
deterministic provider fixtures. `npm run verify` and `npm run build` are
expected to work without network access.

## Network/operator checks

Network checks are separate from offline verification. When an operator needs
to exercise the real fallback, provide an official RSS/Atom URL explicitly and
retain the resulting run id and `runs/<id>/manifest.json`. Inspect the source
type and provider attempts before using the generated feed. Do not enable a
timer or change proxy/network configuration as part of this code path.

## Manual snapshot

Use manual input only for an intentional, reviewable recovery. The value must
contain a normalized `entries` array with complete discovery fields and dates
inside the selected announcement window. It must remain labeled `manual` in
provenance and must not be promoted into canonical Work content automatically.
