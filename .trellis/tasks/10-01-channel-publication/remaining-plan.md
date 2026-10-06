# Sequential remaining-work plan — 2026-10-03

User requested an ordered closeout of unfinished work. Live files and acceptance evidence override stale task labels. Preserve other sessions' changes; no canonical mutation, extra deletion, ingestion/model rerun, timer cadence change, service restart or commit is authorized by this closeout.

## 1. Channel reader and event chart — active

- [x] Rename seven existing sections to intuitive Chinese labels without replacing IDs.
- [x] Update current daily/weekly reading layout and maintain one website-bound Top 5 event chart; normal reentry creates/edits nothing.
- [x] Sweep historical paper formatting: 193 edited, 10 already current, 152 unresolved placements, zero new paper posts or publication errors.
- [x] Rebuild against concurrently changed archive/weekly sources. First brief backfill correctly stopped with `CHANNEL_SOURCE_BUILD_MISMATCH` before any write; never reuse the stale receipt or revert the other session's prose. New build `1790990471293460575-3015526` succeeded.
- [x] Publish 19 validated historical daily opening briefs, update the current owned weekly report to the rebuilt source, refresh the chart from that same build. Brief sweep: 18 created, one existing brief updated; subsequent brief/current delivery is unchanged. Weekly/chart updated their existing IDs.
- [x] Independently read back sections, all changed bodies, retained original IDs and chart ordering/scores; complete paper/brief/current-target no-op reentry. Final 224/224 owned bodies passed; terminal inventory has 229 posts (203 papers + 19 briefs + chart + six retained reports, with current owned weekly counted in those six). Full paper reentry: zero created/edited, 203 unchanged, 152 pending. Brief reentry: 19 unchanged. Chart reentry: one unchanged.
- [x] Record final counts and pending placement list. Do not force the 152 scientifically unresolved papers into a topic or mark the entire channel task complete. Runtime evidence is under `/tmp/astrolineage-channel-reader.T1hmPB/`; original IDs remain intact.

## 2. Annual NotebookLM delivery — after matching website export

Read `.trellis/tasks/09-30-notebooklm-annual-sync/implement.md` and the NotebookLM skill. Reuse the existing annual library and HTTP adapter. Initial 13-source upload and zero-upload reentry were already verified; do not repeat initial provisioning or reauthenticate without evidence. Verify the newly changed export through existing synchronization, source content/hash confirmation and zero-upload reentry; independently record channel/website/notebook outcomes. Remote predecessor cleanup is not authorized: retain it and record quota/ownership work separately. Actual unattended cron execution requires later environmental observation, not a mock pass.

Active revision trial: build `1790992201804671631-3092575` exports 23 reports as 12 current bundles; all 12 differ from the previous export. One former local partition (`daily-2026-09-p09`) is absent from the current packing and remains retained, not silently deleted. Use the existing bounded sync/manifest reconciliation and report partial progress honestly if a timeout occurs. HTTP adapter's 13 offline tests pass.

- [x] Revision synchronization: all 12 current bundles uploaded and content-verified; zero errors. Integrated delivery recorded website/weekly/events success, daily partial (seven unresolved placements), and QQ waiting_permission independently.
- [x] Normal annual reentry: success, zero uploads at `2026-10-03T02:03:46.610Z`.
- [x] Independent remote inventory: 26 retained sources total; each of the 12 expected current titles appears exactly once and is ready, zero missing/duplicate current sources. Old versions and the unverified trial remain preserved, not counted as current successful revisions.
- [ ] Later maintenance: ownership/quota policy for retained old revisions and the obsolete partition; no deletion authorized here.
- [ ] Unattended observation: next configured cron run is Monday 2026-10-05 10:00 Asia/Shanghai, not this Saturday. Do not trigger another ingestion/model run to manufacture timer acceptance.

## 3. QQ memory and scheduled delivery — verification before changes

Read `.trellis/tasks/09-29-qq-seven-day-memory/` and inspect the live service/retention tests. Determine whether the old deployment-pending note is stale before doing any restart. Verify seven-day persistence/isolation and timer configuration/results read-only. Proactive QQ permission remains a distinct external blocker; do not send tests or weaken authorization, and do not let it block website/channel/NotebookLM.

Verification completed read-only: the real `astrolineage-qq-bot.service` is active after memory deployment, two persistent records have valid seven-day timestamps and mode 0600, and 11 QQ tests pass. The earlier deployment-pending note was corrected; no restart/send was needed. Existing cron is weekdays 10:00 Asia/Shanghai. The last unattended run used the old NotebookLM transport and failed authentication; it does not prove the new HTTP/chart path has run unattended. Observe the next actual scheduled run separately.

## 4. Older ingestion/body tickets — evidence audit, not another backfill

Read the active `09-23-arxiv-recall-reliability` and `09-25-arxiv-body-reading-publication` tickets and their latest receipts. Reconcile acceptance with completed regressions/live recovery already present, then identify the exact genuinely missing gates. Run bounded offline checks first; seek a specific decision if closing a gate needs new ingestion/model calls, broad backfill, canonical approval or operational changes. Bootstrap guideline housekeeping is not permission to redesign the project.

The authoritative `.scratch/` trackers show all four recall tickets and all five body-reading/publication tickets resolved, including bounded live recovery. Their Trellis labels are stale, not evidence that another ingestion run is required. Current recall/analyzer/radar tests pass 81/81 offline. Do not reopen the resolved scientific/live trial work merely to make task labels look uniform. Bootstrap guideline scaffolding remains separate documentation housekeeping.

## 5. Content-first channel titles — approved follow-up

- [x] Wire existing content-title helpers into daily and weekly publication. Titles omit brand, report-type and section prefixes; reports select at most two distinct topics, with a short date/week suffix. Full daily date remains in the body.
- [x] Use subject/problem titles for individual papers without clipping technical names. Reading reasons are excluded from topic extraction so references to related research cannot relabel the paper. Preserve the original title and scientific prose in the body. Persistent chart title is `瞬变源 Top 5`.
- [x] Offline publisher regression suite: 49/49 pass; publisher plus delivery integration: 69/69 pass. Checks include content titles, identity/reentry, source gates and chart preservation; syntax and whitespace checks pass. Recoverable pre-change copies: `/tmp/astrolineage-channel-titles.5JrTKh/`.
- [x] Original source/build mismatch resolved by the user's later explicit offline-build authorization. Existing titles were migrated in place behind the matching build gate; no source injection or ledger reset. See `live-title-sync.md`.
- [x] Separate user request: globally pin the existing `events:top5` chart (`top-feed`, action 1, top type 1). Matched its ledger identity and full prior body hash before the operation; platform returned success. Independent detail read-back confirmed original ID/body unchanged. Homepage inventory does not expose pin-state metadata, so client placement remains an environment observation; no title/content publication or build was triggered.

## 6. Compact paper cards and group completion summaries — approved execution

User approved a one-paper reader sample, then asked for daily/weekly completion summaries in the QQ group. Keep the original Research Line routing; this is not approval for taxonomy migration. Own only channel/notification rendering, delivery hooks, their tests and this task's records. Do not edit agy's reader, analyzer, figure extractor, archives, build outputs or running processes.

- [x] Fixed compact channel text template implemented and offline checked: short title, priority, scientific question, source-preserving results/numerical context, group relationship, important limitations and one final reading-link block. Worth Knowing is shorter; Skim remains summary-only. Channel has no verified custom accordion capability; real folding belongs to the website owner.
- [x] User confirmed single-paper opening must not repeat its assigned group. Current compact renderer already omits both header group labels and standalone related-topic classification lines; a new regression confirms changing routing metadata cannot change the rendered post, with source/routing inputs preserved. Publisher suite: 52/52 pass. The visible older live template still contains the group line; migration remains behind the unmatched build gate below.
- [ ] Figures/formulas must not be invented or treated as visually reviewed. Use only available source-bound assets; unversioned/unhashed image records remain pending. Do not silently include or upload them.
- [x] Prepare one real Must Read sample without a broad live sweep: `samples/paper-2609.13540.md`. Daily/weekly group previews are also saved under `samples/`; all are explicitly unsent previews.
- [x] Live same-ID sample edit and complete original-post migration passed after the authorized build. The `2609.13540v1` sample and all 203 owned paper posts were edited and independently read back; original IDs and section placement were preserved. See `live-title-sync.md`.
- [x] Group summaries implemented: original-paper links beside each highlighted paper; channel discussion link and website full-reader link in separate purpose-labelled blocks. No redundant counts, arbitrary sentence truncation, private-message fallback, or claim that failed delivery targets succeeded.
- [x] Reuse the existing scheduled delivery hook after independent channel/NotebookLM outcomes. QQ notifications have independent per-kind status, explicit group target/permission gating, duplicate protection and conservative unknown-outcome handling. Offline tests inject senders; no live proactive send or service restart occurred.
- [ ] Live QQ group acceptance: requires platform proactive permission plus explicit `QQ_GROUP_NOTIFY_ENABLED=true` and `QQ_NOTIFY_GROUP_OPENID`; neither permission nor a successful real send is established by offline tests.
- [x] Focused offline checks: 96/96 pass, syntax/whitespace pass. Exact recoverable-baseline review and follow-up review approved after regression fixes for changing-warning duplicate risk, effective archive identity, masked source errors and incomplete weekly opening text. Software approval only; live gates above remain pending. Baseline: `/tmp/astrolineage-channel-cards.BzvOiX/`.

## 7. News-style daily titles — user-authorized code change

- [x] Replace daily topic-list titles with one leading scientific development. Prefer a concrete named SN/AT/GRB event among Must Read works; otherwise use the first Must Read result, then Worth Knowing if no Must Read exists. Reuse exact version-matched opening-highlight wording, preserve uncertainty/model qualifiers, and never truncate a long claim into a stronger headline. No extra model call or canonical field is added.
- [x] Channel daily summaries and QQ daily notifications share the new title function. Weekly titles and section routing are unchanged; no section/report branding prefix is inserted. Updated the unsent preview sample.
- [x] Four title regressions failed before implementation; affected publisher/QQ notifier/delivery suites now pass 91/91, with JS syntax and whitespace checks passing. All 19 existing daily archives render successfully; longest generated title is 137 Unicode characters, below the channel's 200-character title limit. This is an offline title audit, not remote publication.
- [x] Independent bounded review approved the daily-title helper and both caller changes with zero findings; scientific uncertainty qualifiers and exact-version highlight binding are preserved. Approval does not establish live title migration.
- [x] All 19 existing daily-summary titles migrated after the user's separate synchronization and offline-build authorization. Exact title/body read-back passed; no new summaries, QQ send, service restart or timer change.

## 8. Work-specific titles inside sections — user clarification

- [x] User clarified the redundant names are individual paper-post titles inside topic sections. `paperReaderTitle` no longer substitutes category aliases such as FRB/pulsar for the paper's subject. It uses the existing scientific problem/BLUF verbatim, with the original paper title as fallback; the post title, body heading and daily-summary paper label share this function. No section prefix is added and background routing is unchanged.
- [x] Two title regressions failed before the fix; affected publisher/notifier/delivery suites pass 92/92. Same-section papers now have distinct problem-based titles; original inputs and classification remain unchanged. Updated the explicitly unsent paper preview.
- [x] Independent bounded review approved the per-paper title function and tests with zero findings; syntax/whitespace checks pass. This approval is offline, not a remote-update receipt.
- [x] All 203 existing paper posts migrated safely in place behind the matching build/source gate. Titles identify the paper's scientific problem rather than its section; body headings match, routing is unchanged, and full reentry creates/edits nothing.

## 9. Authorized offline build and original-post synchronization — live verified

- [x] Static build: 84 pages, successful website receipt `1791079930337203255-2`, matching current publication source. Canonical validation retained digest `d28121346d7298481ef6cc14e5d74a45b127639fdf2b1c26bbc913655839ee3a`.
- [x] Updated 224 originals: 203 papers, 19 daily summaries, current W40 weekly, and persistent Top 5 chart. Every changed title/body was read back. No creates, moves or deletes; original IDs and section IDs retained.
- [x] Complete independent remote inventory: 229 posts, all 224 owned originals present, five other historical posts retained. Normal reentry: 224 unchanged, zero creates/edits/errors; both cursors return to zero and no unknown intents remain.
- [ ] Local NotebookLM export returned `NOTEBOOKLM_BROWSER_FAILED` after the successful static build. The runner's nonzero overall exit is not a website-build failure or a successful current NotebookLM export. No remote NotebookLM synchronization or QQ group send was attempted.
- [ ] Existing 152 scientifically unresolved placements and source-unbound media remain pending. This migration does not close those scientific/media requirements or the broader task.

Detailed evidence and recoverable original-body backups: `live-title-sync.md`.

## 10. Readable titles after over-compression — software complete, live reconciliation pending

- [x] Replace the strict 24-character paper/daily rule with complete physical questions, normally 20–35 characters and up to 60 when scientific conditions require it. Neutral fallback remains compact; no added model calls or source edits. Tests: 99/99, syntax/whitespace passed.
- [x] Synchronize 83 originals in place (67 papers, 16 daily summaries), with prior-body verification, persistent recoverable backups and exact read-back. Paper reentry: 203 unchanged; original IDs/routing retained.
- [x] Latest independent inventory (`2026-10-04T11:56:19Z`): 228 posts, all 224 owned original IDs retained, no ID changes. Three current titles differ from generated output (`2026-09-09`, `09-15`, `09-24`); six daily-summary bodies differ from their last managed hashes (`09-09`, `09-14`, `09-15`, `09-20`, `09-24`, `10-01`).
- [ ] Five body edits remain safely blocked by `PRIOR_BODY_MISMATCH`; preserve remote prose. The `2026-09-24` full edit repeatedly received platform error `20076`; latest detail read-back shows its short old title and body remain, while homepage pagination omits it. Reason is unconfirmed. Do not recreate it or blindly retry.
- [ ] Decide whether title-only edits are acceptable for `2026-09-09` and `09-15`: they preserve bodies but leave title/body headings inconsistent. No such edit has been attempted. See `readable-title-sync.md` and `.cache/channel-publication/backups/readable-title-20261003/`.

## Reporting contract

Finish one lane before starting the next. Update this checklist and the owning task's evidence; distinguish implemented, software-verified, live-verified and externally pending. Task labels alone do not prove either completion or failure.

User boundary confirmed: agy owns its ongoing interface edits and processes; do not modify/revert its edits or restart/stop its processes. The later explicit authorization permitted this offline build and original-post synchronization only, not ingestion/model work, remote NotebookLM delivery, QQ sending or timer changes. Further builds need new authority; if a later build changes the binding, pause new publication and coordinate with that owner.
