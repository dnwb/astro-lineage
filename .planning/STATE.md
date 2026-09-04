# High-Energy Transient Reading Radar — Project State

> Updated: 2026-09-04

## Current position

- **Stage:** Phase 2 — domain records and five-Work vertical slice
- **Status:** Tickets 01–04 complete
- **Implementation:** Draft Arnett now exercises governed Actors,
  capability-at-action-time authorization, 16 assessed Physics axes,
  controlled vocabulary, reusable Version-bound Evidence, a reviewed Method
  Annotation, Work-local Scientific Statements, and an acyclic Physical Account
- **Decision frontier:** closed through Q151; no open domain-model decision is
  blocking migration
- **Next execution action:** Ticket 05,
  `.scratch/v0.1-vertical-slice/issues/05-publish-first-visible-work-and-research-line.md`

The repository has completed specification, governance, and authority
migration. Ticket 01 established the independent Git boundary and bootstrap
application. Ticket 02 provides the closed-world canonical content root,
deterministic digest, structured validation reports, loader isolation tests,
and empty reader shells. Ticket 03 adds the draft Arnett 1982 Work with a real
DOI-era Version, reusable immutable bibliographic retrieval attestations,
field-level provenance, Preferred Version provenance, and strict draft
exclusion. Ticket 04 completes the governed Actor, Evidence, Ontology,
Controlled Term, Interpretive Risk, Method Annotation, Scientific Statement,
and Work-local Causal Link slice. Visible reader entities, the remaining Works,
remote setup, and CI remain later work.

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

Continue the approved local ticket frontier with:

```text
.scratch/v0.1-vertical-slice/issues/05-publish-first-visible-work-and-research-line.md
```

The ticket may implement accepted requirements but may not extend the closed
domain model. A newly discovered semantic choice must first be classified
under the migration rule above.

## Blockers and constraints

There is no remaining authority-migration blocker. Canonical content, README,
remote CI, and later reader surfaces remain expected Phase 1–5 work. The local
repository intentionally has no remote in Ticket 01. A genuinely new semantic
choice must be escalated as a new decision rather than hidden in `.planning`
prose.

## Session continuity

Resume with Ticket 05 from the approved local frontier. Read the four `.planning`
documents first, preserve requirement IDs, and update traceability only when
ticket evidence is verified.
