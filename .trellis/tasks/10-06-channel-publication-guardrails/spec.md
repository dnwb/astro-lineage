# Spec: Channel Publication Integrity, Routing Boundaries & Ledger Reconciliation

## Problem Statement

During frontier intelligence publication to Tencent Channel community, automated pipelines encountered three critical failure modes:

1. Title syntax degradation: Truncation logic naively cut long scientific titles at comma delimiters, producing meaningless subordinate clauses (e.g. "若该解释成立") and dangling lead-in phrases (e.g. "作者提出", "给定正文摘要报告"), causing information loss and comprehension failure for researchers.
2. Channel responsibility boundary leakage: Single paper cards (following `{Entity} {Assertion}` format) lacking strict research line classification (R1–R7) silently defaulted to the Daily Briefing channel (`742956201`), contaminating the daily summary timeline with single-paper entries lacking calendar date prefixes.
3. Ledger blindness and unmanaged orphan feeds: The publication ledger only recorded active writes without bidirectional synchronization against remote channel timelines, leaving legacy unmanaged posts and duplicated test feeds invisible to automated maintenance runs.

## Solution

A multi-tiered publication guardrail and boundary enforcement system based on Matt Pocock's philosophy (type completeness, parse don't validate, contract-first):

1. Structured Title Parser & Fallback Ladder: Replace naive blacklist truncation with structured proposition parsing. Reject dependent clauses and lead-ins while enforcing a deterministic 3-tier fallback ladder that guarantees titles are complete, grammatically sound assertions within $\le 35$ characters.
2. Type-Enforced Channel Routing Boundaries: Make invalid routing unrepresentable via discriminated union contracts. Single paper payloads are statically restricted to Topic channels or General Frontier Discussion (`742956184`), making dispatch to the Daily Briefing channel (`742956201`) impossible.
3. Read-Only Ledger Reconciliation & Audit: Establish local ledger as the single source of truth. The reconciliation CLI operates in read-only audit mode by default, computing a Diff Report against remote timeline inventory. Destructive actions require explicit, manual confirmation.
4. Bounded In-Memory Archive Indexing: Decouple synchronization from disk iteration using a scoped in-memory archive index with first-class npm CLI scripts.

## User Stories

1. As a research astronomer, I want channel post titles to always present a complete scientific proposition or targeted physical question, so that I understand the core finding without parsing fragmented conditional clauses.
2. As a community member browsing the Daily Briefing channel, I want to see only dated summary editions (`「MM-DD」...`), so that my reading flow is not interrupted by unclassified single-paper cards.
3. As an astrophysics reader, I want papers with LaTeX formulas in their titles to render clean Unicode or plain text representations, so that mathematical symbols do not contain broken or unclosed delimiter syntax.
4. As a researcher interested in general or interdisciplinary astrophysics papers outside R1–R7, I want those papers routed to the General Discussion channel, so that they remain accessible without polluting specialized topic sections.
5. As an intelligence curator, I want the system to reject titles consisting solely of reporting lead-ins such as "作者提出" or "计算显示", so that posts deliver informative physical conclusions rather than metadata statements.
6. As a platform administrator, I want an automated orphan feed audit tool that operates in dry-run mode by default, so that unmanaged duplicate posts or legacy drafts are safely reviewed before any modification.
7. As an automation engineer, I want the publication ledger to detect remote timeline drift without triggering recursive republish loops, so that manual edits or removals by guild administrators are preserved.
8. As a developer running bulk channel synchronizations, I want scoped in-memory archive indexing, so that 200+ paper lookups execute in milliseconds without risking unbounded memory growth.
9. As a mobile channel reader, I want title character lengths strictly capped at 35 characters without dangling trailing conjunctions, so that mobile UI headers do not truncate physical keywords.
10. As a research line subscriber, I want papers routed strictly according to physical causality and domain taxonomy, so that specialized topic channels maintain rigorous subject cohesion.
11. As a CI operator, I want automated pure-function contract and fuzz tests to catch title syntax regressions before deployment, so that defective titles never reach production.
12. As a maintainer, I want standardized CLI npm scripts (`npm run channel:reconcile` and `npm run channel:sync`), so that routine operations do not rely on ad-hoc scripts.

## Implementation Decisions

1. Structured Title Parser & Deterministic Fallback Ladder:
   - Transition from string-cutting validators to structural parsing: title candidates must resolve into `{ entity, claim, kind: 'question' | 'assertion' }`.
   - Strip mathematical delimiters while transforming common TeX symbols into standard Unicode approximations, ensuring no unclosed symbols persist.
   - Enforce a 3-tier fallback ladder when a candidate sentence is fragmented:
     - **Tier 1 (Core Question)**: Extract the primary physical question from the problem statement (e.g. `Cen A 超额能否源于过去的GRB 221009A类瞬变？`).
     - **Tier 2 (Headline Assertion)**: Extract the main conclusion clause following any dependent markers, ensuring subject and predicate exist.
     - **Tier 3 (Safe Entity Title)**: Fallback to `{NamedEntity} {EnglishTitle}` safely capped at 35 characters with a diagnostic flag `needs_human_review`, completely forbidding broken Chinese fragments.

2. Type-Enforced Channel Routing (Make Invalid States Unrepresentable):
   - Model publication payloads as a strict Discriminated Union:
     - `DailyBriefPayload`: Accepts only `DailySummaryEdition`, targets only `DailyBriefChannelId` (`742956201`).
     - `SinglePaperPayload`: Accepts only `SinglePaperModel`, targets `TopicChannelId` (R1–R7) or `GeneralChannelId` (`742956184`).
   - The route dispatcher interface forbids `SinglePaperPayload` from addressing `DailyBriefChannelId` at compile time and interface boundary.
   - Any paper without an R1–R7 match automatically and exclusively resolves to `GeneralChannelId` (`742956184`).

3. Read-Only Ledger Reconciliation & Audit Safeguards:
   - Local ledger (`guild-*.json`) is the definitive Source of Truth for publication intent.
   - The reconciliation tool (`channel:reconcile`) executes in **read-only mode by default**, generating an inventory diff report:
     - `Matched`: Remote feed matches ledger identity and hash.
     - `Orphan Remote`: Remote feed exists on channel timeline but is absent from ledger.
     - `Drifted / Missing Remote`: Ledger has committed record but remote feed was modified or removed.
   - **Zero Automatic Destruction**: The system will never automatically execute remote feed deletion or recursive re-publishing. Applying changes requires explicit CLI invocation (`--apply --yes`).

4. Scoped Archive Indexing & Standardized Scripts:
   - Indexing loads only dated daily archives for the active evaluation window into an in-memory Map (`arxiv_id + revision -> entry`).
   - Package CLI workflows in `package.json`:
     - `npm run channel:reconcile`: Runs read-only inventory audit.
     - `npm run channel:sync`: Runs bulk sync with rate-limit and boundary guards.

## Testing Decisions

1. Testing Philosophy:
   - Test external behavioral contracts with pure functions, completely decoupled from network transport and disk IO.
   - Zero test flakiness: CLI and adapter layers are mocked at the process transport boundary.

2. Modules Tested:
   - Title syntax linter & fallback ladder: Unit tests covering edge cases (dependent clauses, uninformative lead-ins, TeX math symbols, overlength titles).
   - Property-based fuzzing: Feed title parser with randomized LaTeX strings and punctuation permutations to verify it never throws or emits dangling delimiters.
   - Channel router contracts: Verify `SinglePaperPayload` targeting `DailyBriefChannelId` throws a contract violation, while unclassified papers correctly route to `GeneralChannelId`.
   - Ledger reconciliation: Feed mock inventory scenarios (orphans, drifts, matches) and assert correct diff report generation without side effects.

3. Prior Art:
   - Fast unit test patterns established in `tests/channel-title-policy.test.mjs` and `tests/tencent-channel-publisher.test.mjs`.

## Out of Scope

- Redesigning the underlying AI analysis prompts or extraction schemas for arXiv entries.
- Automated destructive deletion of remote user-generated community comments or replies.
- Dynamic creation or deletion of top-level guild channel categories.

## Further Notes

All publication artifacts continue to enforce the dual-link convention providing both intranet web portal URLs and Tencent Channel short links.
