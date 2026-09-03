# High-Energy Transient Reading Radar — Project State

> Updated: 2026-09-03

## Current position

- **Stage:** ready for Phase 1 implementation planning
- **Status:** authority migration complete
- **Implementation:** not started
- **Decision frontier:** closed through Q151; no open domain-model decision is
  blocking migration
- **Next execution-planning action after migration:** `/gsd-plan-phase 1`

The repository has completed specification, governance, and authority
migration, but implementation has not started. Repository initialization,
canonical content creation, code, remote setup, and CI setup remain future
implementation work rather than migration failures.

## Authority and migration state

The source-of-truth order is:

```text
PROJECT_CONTEXT
  → CONTEXT
  → ADRs
  → V0.1_EXECUTION_SPEC
  → .planning
  → investigation evidence
```

`spec_mvp_v0.1.md` is preserved with explicit **Superseded** status.
`paper_graph_investigation_v0.1.md` is preserved as non-normative evidence.
`docs/migrations/v0.1-authority-migration.md` records the disposition of every
legacy section.

Phase 0 completion evidence:

- the migration ledger covers all legacy sections §0–§18;
- 16 section audits contain retained requirements, 16 contain superseded
  requirements, and no section contains a genuinely new decision;
- the accepted execution spec contains the migrated V0.1 contract;
- all four required `.planning` documents exist and derive from authority;
- 51 requirement IDs map one-to-one between the register and traceability
  matrix, and every referenced ADR exists;
- an independent read-only audit found no unexplained authority conflict.

## Legacy-item classification rule

During migration, every apparent omission or conflict is classified before any
new decision is proposed:

1. **Decided but not migrated:** carry the already-approved decision into the
   authoritative requirement/spec/planning record and preserve traceability.
2. **Old requirement superseded:** record the superseding decision and reason;
   do not reintroduce the old behavior.
3. **Genuinely new decision:** stop migration at that item and reopen the
   decision frontier explicitly. Do not silently resolve it by implementation
   preference.

Only category 3 reopens the decision frontier.

## Settled V0.1 baseline

- Five real fixture Works validate structural-risk coverage.
- Work–Version, Scientific Graph, Publication Graph, Physical Account, and
  Editorial layers remain distinct.
- Evidence binds concrete Versions and typed locators; automated drafting
  cannot bypass Human review gates.
- Physics Ontology is frozen at exactly 16 schema-level axes.
- Method Annotations use their own `explicit | inferred` basis and
  Version-specific Evidence governance.
- Work, Research Line, and Learning Path visibility is checked on the final
  repository snapshot with one immutable named profile and entity-specific
  clauses.
- Canonical content is closed-world under `content/`; generated indexes are
  derived artifacts only.

## V0.1 completion proof

The final release is complete only when all three conditions hold:

```text
coverage matrix complete
+ npm run verify = 0 locally
+ real clean-environment remote CI run = PASS
```

The coverage matrix is per entity and requires real fixture-based
`Stored + Validated + Rendered` checks. Validation, tests, build, verify, and
CI remain fully offline; external deployment and source refresh are deferred.

## Next action

Begin Phase 1 implementation planning with:

```text
/gsd-plan-phase 1
```

That planning step may decompose the accepted requirements but may not extend
the closed domain model. A newly discovered semantic choice must first be
classified under the migration rule above.

## Blockers and constraints

There is no remaining authority-migration blocker. Missing repository setup,
canonical content, source code, tests, README, remote CI, and the independent
project Git boundary are expected Phase 1–5 work. A genuinely new semantic
choice must be escalated as a new decision rather than hidden in `.planning`
prose.

## Session continuity

Resume with `/gsd-plan-phase 1`. Read the four `.planning` documents first,
preserve requirement IDs, and update traceability only when phase evidence is
verified.
