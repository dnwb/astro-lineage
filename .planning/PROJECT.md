# High-Energy Transient Reading Radar — V0.1 Project Charter

Status: **Pending implementation**  
Planning basis: `PROJECT_CONTEXT.md`, `CONTEXT.md`, accepted `docs/adr/*.md`, and `V0.1_EXECUTION_SPEC.md`.

## Product purpose

Build an internal scientific reading and knowledge-navigation site for a high-energy transient astrophysics group. The site organizes literature around physical causality and research lineage, helping readers understand why a Work matters, what problem and assumptions it addresses, what changed relative to earlier work, and what to read next. It is not an arXiv mirror, ADS/Zotero replacement, publication list, news site, AI-summary site, or general paper search engine.

## V0.1 outcome

V0.1 is a five-Work end-to-end vertical slice that validates the domain model and its reader-facing architecture. The fixture Works are Arnett 1982, Bromberg et al. 2011, Zhu et al. 2021, Liu et al. 2025 / TransFit, and Long & Yu 2026. Selection is for structural-risk coverage, not convenience, prominence, or Research Line balance. V0.1 is not launch-scale content coverage.

The product model keeps these boundaries explicit:

- **Work–Version:** Works are stable research contributions; Versions carry publication-specific metadata and evidence identity.
- **Scientific graph:** Paper Graph Edges are first-class, evidence-backed Work-to-Work scientific assertions.
- **Scientific content:** Physics Ontology, Method Taxonomy, Work-local Statements, and Work-local Physical Accounts describe the scientific contribution without becoming editorial navigation.
- **Editorial navigation:** Research Lines, Reading Roles, Editorial Anchors, and Learning Paths organize reading context and remain separate from ontology and scientific edges.
- **Governance:** Evidence Provenance, Bibliographic Provenance, and Curation Provenance are distinct; Agent drafting cannot bypass Human review gates.

## V0.1 scope and boundaries

The canonical stack is Astro, TypeScript, YAML structured records, and Markdown reading prose. Canonical production content lives under the closed-world `content/` root; generated indexes and reports are derived artifacts. V0.1 includes the fixed reader routes, three inspection layers, offline validation, synthetic validation fixtures, and a real clean-environment CI verification run.

V0.1 defers Pagefind, MDX absent a demonstrated content requirement, databases/CMS and editing interfaces, automatic source refresh or arXiv/ADS ingestion, LLM summaries, recommendations, semantic search, user accounts, application-level Actor administration, graph-database or complex interactive-graph work, and external deployment. These exclusions preserve a static-first, content-first, human-editable validation slice.

## Definition of done

Every major domain structure must be:

\[
\boxed{\textbf{Stored}+\textbf{Validated}+\textbf{Rendered}}
\]

V0.1 is complete only when the per-entity coverage matrix is complete, local `npm run verify` exits `0`, and a real remote CI run passes in a clean environment. Validation, build, and CI are fully offline with respect to external bibliographic providers and paper sources. The completion proof must also demonstrate that automated drafting cannot cross the Evidence and Human-review boundary.

## Authority and migration gate — complete

Authority descends as `PROJECT_CONTEXT.md → CONTEXT.md → accepted ADRs → V0.1_EXECUTION_SPEC.md → .planning/ → investigation evidence`. Before implementation planning begins, the execution spec must be finalized, valid legacy requirements reconciled into the authoritative model, `spec_mvp_v0.1.md` marked Superseded, investigation material retained as non-normative evidence, planning artifacts derived from the authoritative sources, and cross-document consistency verified. This charter and the requirements register are planning artifacts, not a new source of domain meaning.

This gate was satisfied on 2026-09-03. The migration ledger covers legacy §§0–18 with no genuinely new decision, and Phase 1 implementation planning is the next permitted action.
