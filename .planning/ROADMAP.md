# High-Energy Transient Reading Radar — V0.1 Roadmap

> Status: authority migration complete; Phase 2 execution underway, with
> Tickets 01–08 complete; Ticket 09 next
> (2026-09-05)
>
> This is the high-level delivery map derived from `PROJECT_CONTEXT.md`,
> `CONTEXT.md`, the ADR set, and `V0.1_EXECUTION_SPEC.md`. It is not a
> detailed implementation plan. Detailed execution follows the approved local
> ticket frontier established after authority migration.

## Outcome and completion gates

V0.1 is a five-Work vertical slice that validates the domain model and the
end-to-end reader architecture. The fixture set is selected for structural-risk
coverage:

- Arnett 1982;
- Bromberg et al. 2011;
- Zhu et al. 2021;
- Liu et al. 2025 / TransFit;
- Long & Yu 2026.

Every major domain structure must satisfy:

```text
Stored + Validated + Rendered
```

The V0.1 completion proof is:

```text
coverage matrix complete
+ local npm run verify = 0
+ real clean-environment remote CI run = PASS
```

The remote CI requirement is verification only; external site deployment is
deferred.

## Requirement-family map

| Family | Normative scope | Primary phases |
| --- | --- | --- |
| Authority and traceability | Document precedence, legacy reconciliation, requirement classification, and migration gate | 0 |
| Repository and canonical boundary | Independent Git boundary, Astro/TypeScript/YAML/Markdown stack, closed-world `content/`, manifest, immutable IDs, canonicalization, generated-artifact boundary | 1, 5 |
| Scientific domain model | Work–Version ownership, 16 Physics axes and assessment states, Method Taxonomy, Statements, Physical Account DAG, Scientific Edges, Publication Graph | 2, 3 |
| Provenance and curation governance | Version-bound Evidence, bibliographic sources, field provenance, discrepancies, Actor Registry, capabilities, review gates, controlled-term lifecycle | 2, 3 |
| Editorial and release model | Reading Roles, Research Line memberships and anchor, Learning Paths and transitions, reader lifecycle, Visibility Profile, approvals and digests | 2, 3, 4 |
| Validation and test isolation | Structural/referential/semantic passes, stable diagnostics, quarantine, synthetic fixtures, cross-record invariants, offline validation | 3, 5 |
| Reader projections | Generated reverse indexes, canonical Work/Line/Path routes, Reader View, Provenance Detail, Validation Report, hidden-record exclusion | 4 |
| Verification and delivery boundary | Frozen npm commands, coverage acceptance, local verification, clean remote CI, no implicit network refresh or deployment | 5 |

## Phase 0 — Authority migration

**Status:** complete

**Goal:** establish a single traceable planning baseline before any repository
or content implementation begins.

**Scope:**

1. Reconcile `spec_mvp_v0.1.md` against the authority hierarchy:
   `PROJECT_CONTEXT → CONTEXT → ADR → V0.1 Execution Spec → .planning →
   investigation evidence`.
2. Classify every legacy item as one of:
   - decided but not yet migrated;
   - superseded by a later decision;
   - genuinely new decision.
3. Migrate valid requirements and their traceability into the authoritative
   documents and `.planning/` artifacts.
4. Mark the legacy spec Superseded and link it to the execution spec.
5. Preserve `paper_graph_investigation_v0.1.md` as non-normative evidence.
6. Verify cross-document consistency.

**Exit gate: satisfied.** `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, and
`STATE.md` are derived from the authoritative sources; the legacy spec is
explicitly Superseded; the migration ledger covers legacy §§0–18 with no
genuinely new decision; and the independent consistency audit found no
unexplained conflict.

After this gate, execution proceeds from the approved local ticket frontier:

```text
.scratch/v0.1-vertical-slice/issues/
```

The frontier begins with Ticket 01 and advances through the lowest-numbered
open, unblocked ticket. Tickets may decompose accepted requirements but may not
extend the closed domain model.

## Phase 1 — Repository and canonical content foundation

**Depends on:** Phase 0

**Goal:** establish the independent project boundary and the smallest
reproducible content/loader foundation.

**Covers:**

- `/home/long/axvdaily` as the project Git boundary, separately from remote
  creation;
- the frozen Astro + TypeScript + YAML + Markdown stack;
- the closed-world `content/` layout and global manifest;
- immutable, namespaced, domain-opaque IDs;
- canonicalization and semantic SHA-256 digest rules;
- Work-local concern bundles, global one-Edge-per-file records, and explicit
  ownership checks;
- ignored, reproducible `generated/` and validation report outputs;
- offline loaders and the boundary that keeps synthetic fixtures out of
  production discovery.

**Exit evidence:** canonical files can be discovered deterministically and
loaded without scanning generated or synthetic roots; the empty snapshot passes
the structural, reporting, digest, and reader-shell checks in Ticket 02.

## Phase 2 — Domain records and five-Work vertical slice

**Depends on:** Phase 1

**Goal:** store the complete V0.1 model for the five structural-risk fixture
Works, with evidence and review provenance explicit at every required
boundary.

**Covers:**

- Work–Version records, Preferred Version, external identifiers, ordered
  authors, and precise release dates;
- reusable Version-local Evidence and bibliographic sources, field-level
  provenance, publication relations, and discrepancy history;
- all 16 Physics Ontology axis assessments and active technique-level Method
  Annotations;
- Work-local Scientific Statements and Physical Account causal links;
- the seven frozen Scientific Edge relations, explicit/inferred assertions,
  and real Version-specific evidence;
- Research Lines, Learning Paths, Reading Roles, memberships, anchors, and
  pedagogical transitions;
- Actors, capabilities, Controlled Terms, and entity-specific review state.

**Exit evidence:** all five Works and their related records are represented in
canonical concern files; at least one real reviewed explicit Edge and one real
reviewed inferred Edge meet their evidence and Human-review requirements.

## Phase 3 — Validation and governance gates

**Depends on:** Phase 2

**Goal:** make correctness, provenance, review, and visibility release gates
  executable and diagnosable.

**Covers:**

- structural, referential, and semantic validation as separate layers;
- stable structured diagnostics, accumulated reliable errors, invalid-record
  quarantine, and pass status reporting;
- controlled-term lifecycle and activation review;
- actor capability authorization and Human-only gates;
- Evidence, Annotation, Statement, Causal Link, Scientific Edge, Publication
  Relation, and editorial review/reset policies;
- the immutable named Visibility Profile, Work/Line/Path visibility clauses,
  snapshot-based cross-entity checks, append-only approvals, and direct
  canonical-content Visibility Digests;
- valid and invalid isolated fixtures, including exact diagnostic-code
  assertions and loader isolation.

**Exit evidence:** a failing invariant blocks the build, emits both validation
reports, and does not create cascading false diagnostics; a valid snapshot
passes all release and governance gates.

## Phase 4 — Generated projections and reader surfaces

**Depends on:** Phase 3

**Goal:** consume validated canonical records in the V0.1 reader experience
  while preserving the scientific/editorial/provenance boundaries.

**Covers:**

- reproducible reverse indexes under `generated/`;
- `/`, `/papers`, `/papers/[work-id]`, `/research-lines/[id]`, and
  `/learning-paths/[id]`;
- Reader View for scientific content and editorial structures;
- on-demand Provenance Detail for reasons, Evidence, locators, and review
  context;
- Validation Report output for governance state, diagnostics, and statistics;
- exclusion of draft or unreviewed records from every reader-facing layer;
- fixture-based Stored + Validated + Rendered checks for every major domain
  structure.

**Exit evidence:** each coverage-matrix row is rendered from canonical data,
and generated indexes can be deleted and reproduced without editing.

## Phase 5 — V0.1 verification and CI acceptance

**Depends on:** Phases 1–4

**Goal:** prove the complete vertical slice locally and in an independent clean
  environment.

**Covers:**

- the frozen commands `npm run validate`, `npm run test`, `npm run check`,
  `npm run build`, and `npm run verify`;
- validation-gated production builds and ignored JSON/Markdown reports;
- fully offline production validation, tests, build, and CI;
- local `npm run verify = 0`;
- a real clean-environment remote CI pass;
- explicit reporting of valid zero production counts for absent relation types;
- confirmation that CI verification does not deploy the site.

**Exit gate:** coverage matrix complete, local `npm run verify` exits 0, and
the real remote CI verification run passes.

## Deferred beyond V0.1

V0.2 is a 10–15 Work reproducibility validation stage. It may add Pagefind,
source refresh/audit workflows, and broader editorial/content coverage only by
explicit later decision. V1 targets 35 Works and launch-quality curated
content. Automatic arXiv ingestion, recommendations, personalization,
database/CMS infrastructure, and external hosting remain outside this V0.1
roadmap.
