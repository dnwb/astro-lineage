# Backend contracts

## Pre-development checklist

For arXiv discovery, screening, archives or publication, read [arxiv-screening.md](arxiv-screening.md) and the local ticket's acceptance criteria. For testing and workspace lifecycle contracts, read [test-hygiene.md](test-hygiene.md). Canonical content is outside this pipeline.

## Quality check

Run the affected arXiv tests offline; keep model/source requests injected. Run `npm run verify` serially for integrated changes. Report live provider acceptance separately from deterministic tests.
