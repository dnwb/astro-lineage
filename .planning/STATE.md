# High-Energy Transient Reading Radar — Project State

> Updated: 2026-09-05

## Current position

- **Stage:** Phase 2 — domain records and five-Work vertical slice
- **Status:** Tickets 01–08 complete
- **Implementation:** Visible Arnett and Bromberg now exercise governed Actors,
  capability-at-action-time authorization, 16 assessed Physics axes,
  controlled vocabulary, reusable Version-bound Evidence, reviewed Method
  Annotations, Work-local Scientific Statements and causal DAGs, Human-gated
  visibility, reviewed Research Line memberships, distinct arXiv/journal
  Versions, a real reviewed `published_as` relation with Bibliographic
  Provenance, Zhu's visible multi-messenger/cross-context slice, and the visible
  TransFit method/inference slice with an independently reviewed inferred
  Method Annotation, 16 assessed Physics axes, and separate heating,
  diffusion-modulation, and expansion-work causal branches
- **Decision frontier:** closed through Q151; no open domain-model decision is
  blocking migration
- **Next execution action:** Ticket 09,
  `.scratch/v0.1-vertical-slice/issues/09-add-long-yu-arxiv-only-dynamic-model-slice.md`

The repository has completed specification, governance, and authority
migration. Ticket 01 established the independent Git boundary and bootstrap
application. Ticket 02 provides the closed-world canonical content root,
deterministic digest, structured validation reports, loader isolation tests,
and empty reader shells. Ticket 03 adds the draft Arnett 1982 Work with a real
DOI-era Version, reusable immutable bibliographic retrieval attestations,
field-level provenance, Preferred Version provenance, and strict draft
exclusion. Ticket 04 completes the governed Actor, Evidence, Ontology,
Controlled Term, Interpretive Risk, Method Annotation, Scientific Statement,
and Work-local Causal Link slice. Ticket 05 publishes Arnett and its first
Research Line atomically with separate Human approvals, canonical reader
digests, a reproducible reverse index, reader routes, and no-cascade visibility
validation. The remaining fixture Work, Learning Path, remote setup, and CI remain
later work. Ticket 06 adds the visible Bromberg Work with separately identified
arXiv v1 and journal Versions, a real source-asserted `published_as`
correspondence, strict offline Publication Graph validation,
branching/converging causal structure, and reader-visible Bibliographic
Provenance. Ticket 07 adds Zhu et al. 2021 with exact arXiv-v3 Evidence,
three distinct messenger identities, separate photon-band/observable/inference
assignments, a branching and converging Physical Account, one Editorial Anchor,
and one reviewed secondary Research Line Membership consumed through the
generated reverse index. Ticket 08 adds the fourth visible fixture Work,
TransFit, with exact arXiv-v1 Evidence, explicit Crank–Nicolson and independently
Human-reviewed inferred forward-fitting techniques, a strict Observable versus
Inference Target separation, and the approved three-branch Work-local causal
account. Its Explosive Transients anchor and Central Engines secondary context
are rendered through the generated reverse index.

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
.scratch/v0.1-vertical-slice/issues/09-add-long-yu-arxiv-only-dynamic-model-slice.md
```

The ticket may implement accepted requirements but may not extend the closed
domain model. A newly discovered semantic choice must first be classified
under the migration rule above.

## Blockers and constraints

There is no remaining authority-migration blocker. The remaining fixture Work,
Scientific Edges, Learning Path, README, remote CI, and final reader closure remain
expected Phase 2–5 work. The local repository intentionally has no remote in
Ticket 01. A genuinely new semantic choice must be escalated as a new decision
rather than hidden in `.planning` prose.

## Session continuity

Resume with Ticket 09 from the approved local frontier. Read the four `.planning`
documents first, preserve requirement IDs, and update traceability only when
ticket evidence is verified.
