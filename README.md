# AstroLineage

AstroLineage is the V0.1 static reader slice for an internal high-energy
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
npm run dev -- --host 127.0.0.1
# for a development server reachable from another local-network device:
npm run dev -- --host 0.0.0.0
```

The development script validates canonical content before starting Astro and
passes additional Astro arguments through. Use `--host 0.0.0.0` when a second
device on the same local network must reach the development server. The Astro
site is static-first and reads canonical YAML and Markdown directly from
`content/`. No network access or bibliographic refresh is required for
validation, tests, builds, or verification.

Refresh the cached daily arXiv discovery page separately when an upstream
update is wanted, then rebuild the static site:

```bash
npm run arxiv:refresh
npm run build
```

`npm run arxiv:refresh` now fetches the complete arXiv announcement batch. The
batch uses the official 14:00 submission-cutoff mapping in
`America/New_York`: Sunday covers Thursday-to-Friday, Monday covers
Friday-to-Monday, and Tuesday through Thursday cover the preceding day. Both
boundaries are converted to the UTC format required by the arXiv API. The
refresh follows Atom pagination serially, respects the API request interval on
every retry, and publishes only after every page and the paired Radar edition
have passed validation. `npm run arxiv:schedule` selects the latest batch whose
20:00 announcement has completed and catches up a missed batch from Friday,
Saturday, or early Monday.

For a local systemd user timer, install the reviewed unit files and enable the
timer:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/astrolineage-arxiv-daily.service ~/.config/systemd/user/
cp deploy/systemd/astrolineage-arxiv-daily.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now astrolineage-arxiv-daily.timer
```

The timer runs Sun–Thu at 20:30 in `America/New_York`, after the usual
announcement time, with a small randomized delay. Persistent timer recovery is
resolved from the last successful batch, rather than from the day on which the
process happens to restart. It only refreshes the local cache; static builds
and CI remain offline and are run separately.

Each production refresh also writes its raw Atom pages and an immutable
manifest under `.cache/arxiv-daily/runs/<run-id>/`. The manifest records the
query, announcement window, parser version, page URLs, byte lengths and SHA-256
fingerprints. `run-state.json` keeps the last attempt, last success and last
failure without replacing the last-good `src/data/arxiv-daily.json`. The seven
newest terminal runs are retained; the run referenced by the current cache and
the last successful state are always retained as well. Incomplete or unreadable
runs are kept for diagnosis. Replay a published snapshot with:

```bash
npm run arxiv:replay -- --run-id=<run-id>
```

Replay verifies the recorded batch window, base query, generated page URLs,
every raw page, and reconstructs the normalized entries without contacting
arXiv. The cache payload records the run ID and relative manifest path, so a
displayed edition can be traced back to its exact response files.

The feed and Radar are committed together as an immutable generation through a
single `current-generation.json` pointer. Existing JSON paths remain
compatibility mirrors; the reader follows the pointer and therefore never
combines mirrors from different refreshes. A complete generation is retained
for recovery if a process stops before the pointer switch.

The result is available at `/arxiv-daily/`; its Chinese editorial guides and
original English abstracts share the same page-level language switch.

### Formula rendering

Formula source stays in TeX and is rendered at build time by the pinned KaTeX
package with `htmlAndMathml` output. The built page contains KaTeX's local
typeset HTML plus one semantic MathML tree with the original TeX annotation;
the browser does not need MathJax/KaTeX JavaScript, a CDN, or a network
conversion pass. Inline math stays in the sentence flow. Display math gets a
centered viewport that keeps its typeset size and scrolls horizontally when it
is wider than the reader. KaTeX's bundled fonts are copied into the static
site by Astro. An unsupported TeX macro is kept as escaped source with a
visible “公式暂未渲染” marker so it cannot be mistaken for a valid equation.

For the validated static build, use the existing Astro preview server:

```bash
npm run verify
npm run build                 # only when a standalone build is needed
npm exec -- astro preview --host 127.0.0.1 --port 3000
```

For a LAN trial, bind the preview explicitly to all interfaces and replace
`127.0.0.1` in the browser address with the server's local IP:

```bash
npm exec -- astro preview --host 0.0.0.0 --port 3000
# http://<server-ip>:3000/
```

This project does not modify firewall rules, create a public tunnel, or deploy
to an external host. A localhost response proves only the local service; a
second physical device is required for LAN acceptance.

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
the reader-projection tests.

## Delivery boundary

V0.1 verification is offline and does not deploy a site. The verification
contract includes an independent clean-environment remote CI gate. Post-V0.1 compatibility
hardening uses the same local and clean-CI verification contract without
reopening Tickets 01–14.

The repository workflow at `.github/workflows/verify.yml` is verification-only:
it checks out the repository on a clean Node.js 22.20.0 runner, installs the
locked package set with `npm ci --ignore-scripts`, and runs `npm run verify`. The
verification commands read committed canonical records and do not contact
bibliographic providers or paper sources; dependency installation is the only
package-registry operation. The workflow has no deployment step.
