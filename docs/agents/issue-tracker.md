# Issue tracker: GitHub Issues

Issues and specs for this repo live in GitHub Issues.

## Conventions

- Issues are accessed via the `gh` CLI.
- The repository is inferred from `git remote` (or set via `GH_REPO`).
- Triage state is recorded as issue labels matching the triage label vocabulary in `docs/agents/triage-labels.md`.
- Comments and conversation history are posted as GitHub issue comments using `gh issue comment`.

## When a skill says "publish to the issue tracker"

Create an issue using `gh issue create --title "<title>" --body "<body>" --label "<label>"`.

## When a skill says "fetch the relevant ticket"

Read the issue using `gh issue view <issue-number> --comments`.

## Pull requests as a request surface

PRs as a request surface: off
