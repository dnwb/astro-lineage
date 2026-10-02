# arXiv discovery operations

The scheduler queries `astro-ph.HE`, `astro-ph.GA`, and `astro-ph.SR`; arXiv cross-lists are retained. Discovery is limited to those categories and the announcement date windows built by `scripts/arxiv-daily.mjs`. It does not claim universal arXiv recall. The Sunday batch is included. An offline regression uses the official title, identifier, category, and announcement-window date for 2609.12308; its abstract and analysis are test fixtures.

`npm run arxiv:schedule` resumes from the per-date success ledger under `.cache/arxiv-daily/`. Successful dates are recorded independently and bound to the exact query. A query change invalidates those completion marks. Older missed ranges can be selected explicitly:

```sh
npm run arxiv:schedule -- --from=2026-09-06 --through=2026-09-17
```

Each run processes at most five missing announcement dates by default. Dates enter a persistent FIFO queue in chronological order; each attempted date moves to the tail so retries and continuing arrivals both progress. `--limit=N` sets both the discovery batch bound and the analyzer item bound; `--analysis-limit=N` sets only the analyzer bound. Failed and empty fetches remain retryable without blocking all newer dates; inspect `pending_dates` and `failed_dates` rather than assuming success means complete coverage. Historical batches use isolated feed, radar, and cache paths, are archived before later dates run, and do not replace the primary edition. The newest eligible batch is the only catch-up date published to the primary feed.

When a primary feed exists and analysis is enabled, the analyzer runs once after each scheduler invocation, including when discovery is already complete, and resumes its durable queue from archived batches. A historical-only first run archives discoveries but defers analysis until a primary feed exists. Its default pass limit is 10 papers while batches commonly contain 50–100, so one daily pass cannot drain a large backlog. Use repeated bounded passes such as `npm run arxiv:schedule -- --analysis-limit=10` and monitor the analyzer's `pending candidates` log; do not treat a completed scheduler invocation as proof that screening is complete. Reading retries use enqueue/last-attempt time so continuous arrivals do not starve older failed reads. Invalid persisted queues or malformed daily archives fail visibly and must be repaired, not deleted to hide pending work.

The existing cron runner is unchanged. `--auto-weekly` waits for Sunday's announcement so its natural week includes Sunday. A manually generated Friday report is provisional; rerun it after Sunday's batch for a complete week.
