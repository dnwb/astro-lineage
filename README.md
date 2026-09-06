# High-Energy Transient Reading Radar

This repository is the V0.1 static reader slice for an internal high-energy
transient astrophysics group. It organizes five curated Works by physical
structure, research context, and a reviewed Learning Path. The reader presents
scientific content first and keeps Version Evidence, typed locators,
publication correspondence, and review context in an on-demand Provenance
Detail layer.

It is not an arXiv mirror, ADS or Zotero replacement, publication list, news
site, AI-summary site, or generic paper search engine. V0.1 has no standalone
Research Map page and no public Validation Report route. The home page is the
static navigation/map view; `validation/report.json` and `validation/report.md`
are local governance artifacts.

## Setup and local development

Use Node.js 22.20.0 or newer and npm. From the project root:

```bash
npm ci
npm run dev
```

The Astro site is static-first and reads canonical YAML and Markdown directly
from `content/`. No network access or bibliographic refresh is required for
validation, tests, builds, or verification.

## Frozen verification commands

These commands are the V0.1 contract:

```bash
npm run validate  # structural, referential, semantic validation and reports
npm run test      # unit, fixture-isolation, projection, and render tests
npm run check     # Astro and TypeScript static checks
npm run build     # validate, regenerate ignored indexes, and build static HTML
npm run verify    # the complete local V0.1 proof
```

`npm run verify` is the single local completion proof. Validation always emits
both reports, including when it finds errors; a direct production build remains
validation-gated. Generated indexes under `generated/` and reports under
`validation/` are ignored derived artifacts and may be removed and reproduced.

## Governed content changes

Canonical production content is closed-world under `content/`. Keep every Work
in its complete seven-file bundle:

```text
content/works/<work-slug>/
  work.yaml
  versions.yaml
  evidence.yaml
  annotations.yaml
  statements.yaml
  physical-account.yaml
  reading.md
```

To add or revise a Work:

1. Allocate an immutable namespaced `work:` ID in `work.yaml` and keep that
   semantic ID identical in every Work-owned YAML envelope and `reading.md`
   frontmatter. Choose a separate filesystem slug for the bundle directory;
   it must not contain `:` and must not be treated as the Work ID.
2. Store Version metadata on `versions.yaml`; bind every Evidence record to a
   concrete Version with a typed locator. Do not infer metadata from an ID or
   guess missing bibliographic values.
3. Add the Work's assessed Physics Ontology axes, reviewed active Method
   Annotation, Work-local Statements, and Physical Account only when their
   Evidence and review requirements are satisfied.
4. Add reviewed Research Line Membership records in the relevant Line bundle,
   including exactly one global Editorial Anchor for a visible Work. Do not put
   editorial relations in the Work bundle.
5. Keep `reader_state: draft` while curating. A visible Work needs a current
   Human visibility approval for `v0.1-default`; a reader-facing change makes
   the previous digest stale and requires a new approval record.

Research Lines are governed bundles containing exactly `line.yaml` and
`reading.md`. Their memberships own context-local Reading Roles and Editorial
Anchor designations. A visible Line needs a reviewed membership to a visible
Work and its own profile-bound Human visibility approval. The Line ID comes
from `line.yaml`; its bundle directory uses a separate colon-free filesystem
slug.

Learning Paths are governed bundles containing exactly `path.yaml` and
`reading.md`. Store a duplicate-free ordered sequence of visible Work IDs and
exactly one normalized Pedagogical Transition for each adjacent pair. Path
content is reviewed atomically and has its own profile-bound Human visibility
approval; transition reasons do not create Scientific Edges. The Path ID comes
from `path.yaml`; its bundle directory uses a separate colon-free filesystem
slug. Scientific Edge IDs likewise come from their YAML records, while their
filename stems remain independent and colon-free.

Static Reader Entity route segments use these same colon-free slugs (for
example, `/papers/transfit-2025/`), while page lookup, displayed identity, and
all canonical references continue to use the namespaced semantic ID.

For all three Reader Entity types, preserve append-only provenance and review
history. Run `npm run validate` after each content change, inspect the emitted
reports, and finish with `npm run verify`. Never hand-edit generated indexes or
use generated output as canonical content. Synthetic adversarial datasets live
only under `tests/fixtures/` and never affect production discovery or counts.

## Reader coverage

The real-fixture Stored + Validated + Rendered evidence is recorded row by row
in [the V0.1 coverage matrix](docs/coverage/v0.1-stored-validated-rendered.md).
The matrix is deliberately separate from canonical content and is checked by
Ticket 13 tests.

## Delivery boundary

V0.1 verification is offline and does not deploy a site. Ticket 14 completed
the independent clean-environment remote CI gate. Post-V0.1 compatibility
hardening uses the same local and clean-CI verification contract without
reopening Tickets 01–14.

The repository workflow at `.github/workflows/verify.yml` is verification-only:
it checks out the repository on a clean Node.js 22.20.0 runner, installs the
locked package set with `npm ci --ignore-scripts`, and runs `npm run verify`. The
verification commands read committed canonical records and do not contact
bibliographic providers or paper sources; dependency installation is the only
package-registry operation. The workflow has no deployment step.
