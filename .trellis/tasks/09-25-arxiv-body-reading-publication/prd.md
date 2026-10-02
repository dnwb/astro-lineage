# Real arXiv body reading and Daily Radar publication

## Goal

Make revision-matched arXiv body reading produce trustworthy Daily Radar recommendations and a useful introductory brief. The local Markdown [spec](../../../.scratch/arxiv-body-reading-publication/spec.md) is the authoritative requirements source.

## Requirements

- Preserve bounded, safe source acquisition while extracting TeX from image-bearing packages.
- Read long bodies in resumable, verifiable portions. Must Read requires complete body text coverage; Worth Knowing requires supporting body sections; Skim may rely on the abstract.
- Keep exact source revision, feed fingerprint, package hash and evidence binding. A failed read stays pending while other candidates progress.
- Publish eligible results through the existing immutable writer and show a concise, edition-bound opening brief on the existing reader.
- Keep canonical content, approvals, digests, providers, dependencies, timers and external channel publication out of scope.

## Acceptance Criteria

- [ ] Offline tests at analyzer → validated publisher → reader projection prove extraction, bounded long-body resume, evidence gates, independent progress and current-edition brief.
- [ ] Affected offline tests and build/verify pass, or remaining failures are reported with precise causes.
- [ ] Five teacher-selected real papers are assessed without forcing priorities; actual source and publication outcomes are logged separately from fixtures.
- [ ] One bounded announcement day is assessed after the five-paper trial demonstrates viable reading.

## Notes

Live working tree was dirty before this task; preserve unrelated edits and do not commit or switch branches over them.
