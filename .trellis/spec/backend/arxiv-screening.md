# arXiv screening and publication contract

## 1. Scope / trigger

Changes crossing discovery -> screening -> body reading -> daily/weekly reader. Scientific eligibility is owned by `scripts/daily-radar.mjs`, not each publisher.

## 2. Signatures

```js
runScheduledArxivRefresh({ fromDate, throughDate, maxBatchesPerRun, analyzeImpl, analysisLimit })
runAiAnalyzer({ feed, radar, archiveRoot, artifactRoot, limit, modelRunner, sourceLoader })
publishAnalyzedArxivEdition({ output, radarOutput, artifactRoot, expectedFeed, expectedRadar, radar })
```

## 3. Contracts

- Discovery success belongs to an individual announcement date and exact query scope; include Sunday. Reusing a narrower query's completion loses recall. Persist failed dates and rotate attempts within the run bound; return `pending_dates` and `failed_dates` arrays, including empty arrays for explicit-date runs.
- Queue identity binds arXiv ID, revision and source fingerprint. Run limits, errors and edition rollover must not discard queued work. Order reading retries by enqueue/last-attempt time, not lowest attempt count: continuous new arrivals must not starve failed reads.
- A model's abstract priority is a reading request, not permission to publish Must Read or Worth Knowing. Body records retain source URL/hash, inspected sections and bounded evidence. Raw TeX reading does not prove figures were visually inspected or claims independently verified.
- Historical results additionally bind `historical_edition`; never join across dates by base ID alone.
- Model credentials come from environment/configuration, never literal keys in source or diagnostic logs. No provider/network access during production verification.
- QQ/Channel assistants read `readPublishedArxivEdition` and `buildDailyRadarModel`; missing or invalid guides remain pending, never a negative scientific judgement. Canonical booklists use validated `projectVisibleSnapshot`; project direction labels come from `PROJECT_CONTEXT.md`, not hand-written duplicates. Bot `--doctor` is offline unless `--live` is explicit. Model endpoints require HTTPS, no redirects, bounded requests/responses and timeouts. Native Node WebSocket avoids an undeclared `ws` runtime dependency.
- Channel delivery binds immutable daily generation and weekly/archive hashes to a source capture taken before and checked after the successful build. File/page existence alone cannot authorize publishing a changed source. Persist per-version/week remote identities and intents; known originals are edited or moved, while unknown write outcomes and incomplete remote pagination remain pending. Use the installed CLI schema: section inventory uses `get-channel-timeline-feeds`, and `get-feed-detail` has no `create-time` parameter. A channel target failure must not block unrelated delivery targets or trigger unauthorized QQ proactive sends.
- The persistent event chart consumes only the exact built events hash/timestamp recorded after a successful build. Chart/brief recovery after ledger loss requires complete inventory and exactly one self-consistent identity marker; invalid or duplicate markers stay pending. Before updating a known original, verify the prior body hash so human corrections cannot be overwritten.
- Automatic QQ completion summaries are group-only and run after independent publication outcomes. Require explicit permission enablement and group target; bind deduplication to recipient, report kind and the verified source actually rendered (dated archive hash when used, otherwise daily/weekly hash), not changing delivery-warning text. Never send without stable source identity. Persist intent before sending; an unknown outcome blocks reentry. A source/preparation failure remains `blocked` even when sending permission is disabled. Keep original-paper links beside highlights and channel/web entry points in separate labelled blocks.

## 4. Validation and errors

| Condition | Required behavior |
| --- | --- |
| Empty scheduler fetch | `ARXIV_EMPTY_BATCH`; retryable, last-good unchanged |
| Feed/radar changed while model ran | `ARXIV_ANALYSIS_STALE`; keep queued result for retry |
| Invalid radar publication | `ARXIV_RADAR_INVALID`; no pointer replacement |
| Live writer lock | Refuse concurrent write; no lost update |
| Missing/truncated/wrong-revision body | Pending reading, not eligible MR/WK |
| Malformed persisted queue | `ARXIV_ANALYZER_STATE_INVALID`; validate identity/fingerprint and eligible completed analysis, preserve bytes |
| Date-named archive without `feed.entries` | `ARXIV_ARCHIVE_INVALID`; never silently omit backlog |

## 5. Good / base / bad cases

Good: Sunday gap recovered into isolated history, matching result joins the correct weekly edition.

Base: abstract-only Skim needs no body retrieval.

Bad: ten unavailable oldest sources consume every run forever; fair retry ordering must prevent this.

## 6. Required tests

Assert immutable source generations and last-good pointers; stale expected feed/radar rejection; empty first-run bootstrap; query migration and Sunday catch-up; bounded queue/rollover/failure fairness; body input and evidence gates; exact weekly joins and archive preservation. Five-paper synthetic model fixtures do not establish live scientific recall.

## 7. Wrong vs correct

Wrong: rewrite an existing generation's radar file and update its hash; mark every date before last_success as complete.

Correct: acquire the existing writer lock, compare both expected inputs, validate, publish a new immutable generation; record only individually verified dates. Reuse `acquireRefreshLock`, `releaseRefreshLock` and `writeJsonAtomically` instead of introducing another persistence framework.
