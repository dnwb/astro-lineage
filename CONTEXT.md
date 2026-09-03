# High-Energy Transient Reading Radar

This context describes the scientific reading model used to organize high-energy transient literature by physical relationships and research lineage.

## Language

**Work**:
An intellectually distinct research contribution and the only node type in the Paper Graph. Work identity follows continuity of the core research contribution rather than identifier, title, author list, or publication venue; a Work may have multiple Versions and explicitly selects a preferred Version for display.
_Avoid_: Publication version, physical concept node, learning-path node

**Version**:
A specific public expression of a Work, such as a curated public arXiv revision or journal publication, that owns its bibliographic metadata. Curated public arXiv revisions have distinct Version identities even when they belong to the same Work.
_Avoid_: Independent Work, duplicate Paper

**Version Kind**:
The controlled form of a Version as either an arXiv revision or a journal manifestation.
_Avoid_: Work type, publication status

**External Version Identity**:
An explicit normalized scholarly identifier for a Version, such as an arXiv base identifier plus revision number or a journal DOI, stored independently from the internal Version ID and its access URL.
_Avoid_: Facts parsed from an internal ID

**Release Date**:
The date on which a specific Version became publicly available, recorded with explicit year, month, or day precision.
_Avoid_: Work year, undifferentiated publication date

**Preferred Version**:
The Version explicitly selected with a reason and Curation Provenance to provide a Work's reader-facing citation and display metadata; it is an editorial choice rather than an automatic newest-Version or easiest-reading-copy rule.
_Avoid_: Work identity, automatically latest Version

**Reader Entity**:
A Work, Research Line, or Learning Path that has its own independently governed reader-facing publication lifecycle.
_Avoid_: Any canonical record, hidden curation record

**Reader State**:
The explicit editorial lifecycle of a Reader Entity as draft or visible. Draft relaxes visibility readiness but never correctness; visible requires a release-specific Visibility Profile and Human release approval, while canonical unreviewed records may remain hidden.
_Avoid_: Journal publication status, inferred completeness

**Visibility Profile**:
A single immutable release-specific set of curation-readiness conditions with distinct clauses for Works, Research Lines, and Learning Paths that a Reader Entity must satisfy before a Human may approve it as visible.
_Avoid_: Correctness validation, field-count heuristic

**Visibility Digest**:
A deterministic semantic digest computed directly from all canonical inputs in one Reader Entity's approved reader-facing content, including cross-entity dependencies but excluding generated indexes and release machinery such as approvals, stored digests, and Reader State.
_Avoid_: Global canonical-content digest, digest of hidden drafts

**Paper**:
The user-facing name for a Work when version-level precision is unnecessary.
_Avoid_: Version

**Paper Graph**:
A directed graph whose nodes are Works and whose Edges are explicit scientific assertions about relationships between Works.
_Avoid_: Heterogeneous knowledge graph, causal graph

**Publication Graph**:
A graph of publication identity and evolution that connects Versions to their owning Works and to related Versions, kept separate from scientific relationships between Works.
_Avoid_: Paper Graph, scientific lineage

**Bibliographic Provenance**:
The source record supporting Version metadata or a Publication Relation, kept separate from Scientific Evidence and Curation Provenance.
_Avoid_: Scientific Evidence, curator identity

**Bibliographic Source**:
A reusable Work-local retrieval attestation that identifies an authoritative ADS, arXiv, Crossref, or publisher record used by Version metadata or Publication Relations.
_Avoid_: Scientific excerpt, global Person record

**Bibliographic Discrepancy**:
A preserved disagreement among Bibliographic Sources about a reader-relevant Version field whose current state is derived from append-only Human resolution events.
_Avoid_: Silently chosen metadata

**Publication Relation Basis**:
Whether a Publication Relation is asserted by a bibliographic source or matched by a curator.
_Avoid_: Scientific explicit/inferred basis

### Publication Relations

**belongs_to**:
Connects a concrete Version to the Work whose research contribution it manifests, expressed canonically by the owning concern-file envelope.
_Avoid_: Scientific derivation

**revises**:
Connects a later curated arXiv revision to an earlier curated revision when the text or content is revised, without implying adjacency in the complete public revision history.
_Avoid_: Immediate-predecessor assertion, mere publication correspondence

**published_as**:
Connects one explicitly justified arXiv revision to a journal manifestation as a publication correspondence, without asserting textual identity or deriving the relation from shared Work membership.
_Avoid_: Revises, automatically generated correspondence

**Edge**:
A first-class scientific assertion between two Works, composed of a typed relation, a reason, and provenance.
_Avoid_: Bare link, related-work label

**Assertion Basis**:
Whether an Edge is explicitly stated by a Work or inferred by a curator from evidence.
_Avoid_: Review state, truth status

**Explicit Edge**:
An Edge whose relationship is directly stated in a concrete Version.
_Avoid_: Curator synthesis

**Inferred Edge**:
An Edge synthesized by a curator rather than directly stated by a Work; it requires evidence from both endpoint Works and stricter review.
_Avoid_: Implicit link, unsupported interpretation

**Independent Review**:
Review of an Inferred Edge by a curator other than its creator, based on Bilateral Evidence.
_Avoid_: Creator self-review

**Evidence**:
A canonical reusable Work-local provenance entity that supports Annotations, Scientific Statements, Causal Links, or Scientific Edges by pointing to a concrete Version and a typed locator within it.
_Avoid_: Duplicated embedded locator, unlocated citation, Work-level citation

An Evidence record and its referenced Version belong to the same Work. An excerpt aids verification but does not replace the Version and locator. A checksum is present only when the referenced source snapshot is actually preserved.

**Evidence Provenance**:
The record of which Versions and locators support an Edge.
_Avoid_: Curation history

**Bilateral Evidence**:
Evidence anchored to concrete Versions and locators from both endpoint Works of an Inferred Edge.
_Avoid_: Two citations from only one endpoint

**Curation Provenance**:
The record of which Curation Actor created or reviewed a governed record and when the event occurred, using a canonical UTC timestamp.
_Avoid_: Scientific evidence

**Curation Actor**:
An immutable registry identity for a human or agent that creates or reviews curated records, with explicit project-granted capabilities and no stored credentials or secrets.
_Avoid_: Anonymous automation, credential identity

**Actor Capability**:
A temporally scoped project authorization granted to or revoked from a Curation Actor and evaluated at the time of a governed action.
_Avoid_: Actor kind, inferred permission

**Human Review Gate**:
The requirement that an eligible human reviewer approve an agent-created reader-facing record, an Inferred assertion requiring independent review, or Controlled Term activation. Different agents do not constitute production review independence.
_Avoid_: Agent-to-agent approval as independent production review

**Review State**:
The procedural state `unreviewed | reviewed` indicating whether a governed record satisfied its entity-specific review requirements; it does not express lifecycle, disposition, or permanent truth.
_Avoid_: Truth status, lifecycle, disposition

**Material Change**:
A semantic change to a governed record's meaning or support that resets its Review State to unreviewed according to entity-specific rules.
_Avoid_: Typographic correction

**Visibility Approval**:
An append-only Human review record binding an immutable Visibility Profile and current Visibility Digest for one Reader Entity.
_Avoid_: Boolean approval flag, mutable latest approval

**Disposition**:
The current standing of an Edge as active, contested, superseded, or withdrawn, independent of its Review State.
_Avoid_: Review state, truth status

**Active Edge**:
An Edge currently adopted by the curated graph.
_Avoid_: Permanently true assertion

**Contested Edge**:
An Edge with a credible recorded disagreement that remains visible with that context and does not contribute a positive ranking signal by default.
_Avoid_: Withdrawn edge, unreviewed edge

**Superseded Edge**:
An Edge replaced by a successor Edge while retained in the audit history.
_Avoid_: Silent overwrite

**Withdrawn Edge**:
An Edge removed from the current graph because of insufficient evidence, duplication, or curation error while retained in the audit history.
_Avoid_: Contested edge, hard deletion

**Edge Presentation**:
The display and ranking treatment derived from the independent combination of an Edge's Review State and Disposition.
_Avoid_: Stored truth label

**Scientific Delta**:
The specific change in scientific content that one Work makes relative to another.
_Avoid_: General relevance, topic similarity

**Core Relation**:
One of the seven first-version Edge types: builds_on, extends, tests, constrains, challenges, replaces_assumption, or corrects. A new relation is admitted only when these cannot express an important Scientific Delta.
_Avoid_: Related to, arbitrary relation label

### Core Relations

All Core Relations use the direction `source Work → relation → target Work`, where the source makes the Scientific Delta and the target is depended on, tested, constrained, challenged, changed, or corrected.

**builds_on**:
The source materially depends on a method, model, or result from the target.
_Avoid_: Ordinary citation, reverse provides-method-for edge

**extends**:
The source preserves the target's core contribution while expanding its scope, physical processes, or methodological capability.
_Avoid_: Unspecified improvement, separate generalizes edge

**tests**:
The source directly evaluates a falsifiable prediction or claim from the target.
_Avoid_: General comparison

**constrains**:
The source narrows the target model's allowed parameter space or domain of applicability without merely declaring it right or wrong.
_Avoid_: Generic observational relevance

**challenges**:
The source provides evidence or reasoning in clear tension with a target claim without supplying a definitive correction.
_Avoid_: Disagreement without evidence, corrects

**replaces_assumption**:
The source replaces or removes a named assumption or approximation used by the target, and its Scientific Delta depends on that change.
_Avoid_: Unnamed methodological difference

**corrects**:
The source identifies a specific error in the target and supplies a corrected result.
_Avoid_: Challenges without correction

**Physics Concept**:
A controlled term describing physical content shared by Papers; it is not a Paper Graph node.
_Avoid_: Concept node

**Physics Ontology**:
A controlled set of axes that describes the scientific world, with each axis restricted to one ontological kind.
_Avoid_: Method taxonomy, editorial classification, mixed tag bag

**Ontology Axis**:
A schema-level dimension whose terms all answer one type of scientific question without mixing objects, processes, mechanisms, or observables; changing that question requires schema migration rather than ordinary term lifecycle.
_Avoid_: Mixed-category field

**Axis Assessment**:
The completeness state of a Work's Ontology Axis as present, unknown, not_applicable, or not_assessed.
_Avoid_: Missing field, overloaded null

- `present` requires one or more valid values.
- `unknown` means the axis was assessed but remains scientifically indeterminate.
- `not_applicable` means the axis question does not apply to the Work.
- `not_assessed` means curation has not yet been performed and is the only assessment state that represents curation debt.

States other than `present` forbid values.

**Functional Role**:
The part a physical process plays in a Work's physical account. A microscopic process may serve more than one Functional Role when scientifically justified, so functional axes are not assumed to be philosophically absolute partitions.
_Avoid_: Unqualified duplicate tag

**Canonical Process**:
A controlled physical-process identity that remains the same when it serves different Functional Roles in different Works.
_Avoid_: Role-specific duplicate concept

**Process Role Assignment**:
A Work-specific assignment of one or more allowed Functional Roles to a Canonical Process.
_Avoid_: Global reclassification of the process

**Annotation**:
A first-class Work-specific assignment of a Canonical Concept to an Ontology Axis or allowed Functional Role, carrying Curation Provenance and evidence according to its Interpretive Risk.
_Avoid_: Bare tag, Paper Graph Edge

**Method Annotation**:
A first-class Work-specific assignment of an active Canonical Technique from the Method Taxonomy, carrying Curation Provenance, Version-specific Evidence, and a Method Annotation Basis.
_Avoid_: Reading Role `method`, free-text method description

**Method Annotation Basis**:
Whether a Method Annotation is explicit in a Version or inferred by a curator. Explicit assignments may be self-reviewed by an eligible Human creator, while inferred assignments require a normalized reason and review by a distinct eligible Human.
_Avoid_: Physics Interpretive Risk, unmarked method inference

**Interpretive Risk**:
The degree to which an Annotation depends on scientific interpretation rather than direct descriptive evidence; it determines the required Evidence and review strength.
_Avoid_: Importance, confidence score

Interpretive Risk is frozen to three levels:

- `descriptive`: Curation Provenance is required; Evidence is optional; creator self-review is allowed.
- `interpretive`: a reason and at least one concrete Version locator are required; creator self-review is allowed.
- `synthetic`: a normalized reason, multiple Evidence references, and independent review are required.

**Risk Escalation**:
A reasoned increase from an Ontology Axis's default Interpretive Risk for a specific Annotation; risk may not be silently downgraded.
_Avoid_: Arbitrary risk override

**Causal Scaffold**:
A composable account of physical flow that permits missing stages, branching, convergence, and multiple messengers without creating mandatory causal Edges in the taxonomy.
_Avoid_: Universal linear pipeline, implicit Paper Graph edge

**Physical Account**:
A Work-local directed acyclic graph that instantiates a Causal Scaffold using Causal Stages and links kept strictly separate from Paper Graph Edges.
_Avoid_: Paper Graph, mandatory universal chain

**Causal Stage**:
A Work-local stage in a Physical Account that refers to controlled scientific Annotations.
_Avoid_: Paper Graph node

**Causal Link**:
A first-class Work-local relationship between two Causal Stages, carrying a reason and governance metadata independently from Paper Graph Edges.
_Avoid_: Scientific Edge, bare diagram arrow

**Causal Link Origin**:
Whether a Causal Link is explicit in a concrete Version or inferred by a curator; the vocabulary is shared with other assertions but its Evidence, Interpretive Risk, and review rules remain independent.
_Avoid_: Scientific Edge basis as shared governance

### Causal Link Relations

**drives**:
The source supplies the dominant energy, momentum, or causal influence for the target.
_Avoid_: Merely permits

**enables**:
The source supplies a condition needed for the target without directly driving it.
_Avoid_: Dominant causal drive

**transforms_into**:
The source matter, energy, or state becomes the target matter, energy, or state.
_Avoid_: Produces without transformation

**produces**:
The source generates a new physical component, process, or signal represented by the target.
_Avoid_: Merely modifies

**modulates**:
The source changes the target's strength, timescale, form, or efficiency without generating it; enhancement or suppression is stated in the reason.
_Avoid_: Unspecific related-to link

**Scientific Statement**:
A lazily created, Work-local assumption, claim, prediction, or result that provides a stable referential anchor when free text would be insufficient. It may be explicit or curator-inferred.
_Avoid_: Paper Graph node, sentence extracted without referential value

**Canonical Statement**:
A normalized semantic paraphrase of a Scientific Statement; verbatim excerpts remain Evidence rather than becoming the canonical wording.
_Avoid_: Unmarked quotation, source excerpt as identity

**Statement Basis**:
Whether a Scientific Statement is explicit in a Version or inferred by a curator. Inferred Statements require a normalized reason, concrete Evidence, and independent review.
_Avoid_: Unmarked curator interpretation

**Statement Identity**:
The stable identity of a Scientific Statement within its Work; supporting Evidence points to concrete Versions and locators.
_Avoid_: Version locator as identity, global statement ID

**Statement Attestation**:
Version-specific Evidence that supports the wording or presence of a Scientific Statement without defining its Work-local identity.
_Avoid_: Overwritten historical evidence

**Statement Lifecycle**:
The Work-internal standing of a Scientific Statement as maintained, superseded, or withdrawn, independent of its Review State. External scientific disagreement is represented by Work-to-Work Edges.
_Avoid_: Contested, truth status

### Physics Ontology Axes

**progenitor_system**:
The physical system or object configuration from which the modeled event or source develops.
_Avoid_: Central remnant, environment

**central_object**:
The physical object that carries the central engine, when one exists.
_Avoid_: Energy reservoir, release process, mandatory value

**energy_reservoir**:
The form or store of energy available to power the modeled system.
_Avoid_: Central object, transfer process

**energy_transfer**:
The process by which energy leaves its reservoir or is injected into the evolving system.
_Avoid_: Energy reservoir

**outflow**:
The moving material, radiation, or field-dominated component that carries energy or matter through the modeled system.
_Avoid_: External environment

**environment**:
The surrounding material or field configuration with which the source or outflow interacts.
_Avoid_: Progenitor system, outflow

**dynamics**:
The macroscopic evolution, propagation, or interaction of the modeled system and its components.
_Avoid_: Microscopic interaction, radiation transport

**energy_dissipation**:
The Functional Role in which macroscopic or field energy becomes thermal or non-thermal particle energy.
_Avoid_: Generic dynamics, emitted messenger

**particle_interaction**:
The Functional Role in which microscopic particle reactions transform particle species or distributions.
_Avoid_: Macroscopic dissipation

**emission_process**:
The Functional Role in which a physical process produces an observable messenger.
_Avoid_: Propagation or attenuation

**transport_process**:
The Functional Role in which propagation, absorption, scattering, diffusion, or escape alters a messenger before observation.
_Avoid_: Messenger production

**phenomenon**:
The observational event or source class addressed by a Work.
_Avoid_: Physical mechanism, messenger

**messenger**:
The physical carrier of information, such as a photon, neutrino, gravitational wave, or cosmic ray.
_Avoid_: Radio, optical, X-ray, gamma-ray

**photon_band**:
The electromagnetic band of a photon observation, such as radio, optical, ultraviolet, X-ray, or gamma-ray.
_Avoid_: Messenger type

**observable**:
The form of an actual measurement, such as a light curve, spectrum, polarization, timing signal, or morphology.
_Avoid_: Model-inferred physical parameter

**inference_target**:
The physical quantity, property, or hypothesis that a Work attempts to infer from observations or calculations.
_Avoid_: Observable, inferred value, posterior result

**Inference Result**:
The Work's actual model-dependent conclusion about an Inference Target; it belongs to scientific content rather than to the controlled taxonomy.
_Avoid_: Ontology term

**Method Taxonomy**:
A controlled description of how a Work investigates a question, kept separate from the Physics Ontology.
_Avoid_: Physics axis, reading role

**Method Family**:
A broad Controlled Term category of investigative practice to which one or more Canonical Techniques belong; a Work may use multiple Method Families.
_Avoid_: Specific algorithm, model character

**Canonical Technique**:
A Controlled Term for a concrete method used by a Work within a Method Family, such as MCMC or hydrodynamics.
_Avoid_: Broad method family, semi-analytic

**Model Character**:
A descriptor of how a model is formulated, such as analytic or semi-analytic, kept distinct from concrete Canonical Techniques.
_Avoid_: Inference algorithm, simulation technique

**Controlled Term**:
A vocabulary entry with an immutable canonical ID, mutable display labels or aliases, a definition, and a lifecycle status.
_Avoid_: Free tag, display label as identity

Activation requires independent review, a definition, examples, counterexamples, boundary notes, and allowed Functional Roles where applicable.

**Term Status**:
The lifecycle of a Controlled Term as proposed, active, or deprecated.
_Avoid_: Hard deletion

**Successor Term**:
The active Controlled Term that semantically replaces a deprecated term without changing the deprecated term's canonical ID or history.
_Avoid_: Renamed label, overwritten ID

A deprecated term requires a reason but requires a Successor Term only when a genuine semantic replacement exists. Historical references are preserved.

**Research Line**:
A curated navigation view in the Editorial Layer that gathers Works around a recurring scientific question without imposing a scientific classification.
_Avoid_: Folder, mutually exclusive category

**Editorial Layer**:
The context that organizes presentation, navigation, and reading without claiming to describe the scientific world itself.
_Avoid_: Physics ontology, method taxonomy

**Research Line Membership**:
An independently reviewed Editorial Layer association between a Work and a Research Line, carrying a non-empty set of context-local Reading Roles; each Work–Research Line pair has at most one membership.
_Avoid_: Ontological classification

**Editorial Anchor**:
The designation on the single Research Line Membership used as a visible Work's default presentation and routing home; it organizes the website without asserting a unique scientific classification.
_Avoid_: Primary line, ontological category, editorial_anchor as scientific truth

**Learning Path**:
A path-local curated sequence of distinct Works whose adjacent Pedagogical Transitions explain why each Work should be read after the previous one; its structured sequence and transitions are reviewed atomically as one path.
_Avoid_: Global next-read property

**Pedagogical Transition**:
A path-local editorial judgment that orders two Works and explains why the target should be read after the source.
_Avoid_: Scientific Edge, global next-read link

**Reading Role**:
One or more context-local values—`foundation`, `review`, `method`, `group_lineage`, `frontier`, or `opportunity`—explaining why a Work is read within a Research Line Membership or Learning Path. The `method` role is editorial and is not a Method Taxonomy assignment.
_Avoid_: Global paper property, primary role, Method Taxonomy technique

**Hub**:
A Physics Concept shared across multiple Research Lines that helps reveal connections between Papers; it is not a Paper Graph node.
_Avoid_: Hub paper, graph node
