# Domain Docs

## Before exploring, read these

- Root `CONTEXT.md`
- Relevant accepted ADRs under `docs/adr/`
- The authoritative source hierarchy declared by this repository

If a referenced domain document is absent, proceed silently.

## Layout

This is a single-context repository:

```
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Vocabulary

Use canonical concepts exactly as defined in `CONTEXT.md`. Do not drift to avoided synonyms.

If a required concept is absent, reconsider whether it is implementation language or a genuine domain gap. Genuine gaps must follow the repository’s decision-frontier policy.

## ADR conflicts

Surface any contradiction with an accepted ADR explicitly; never override it silently.
