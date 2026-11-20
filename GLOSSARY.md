# Domain Glossary

This document serves as the Single Source of Truth (SSOT) for domain concepts, models, and terminology used across AstroLineage.

---

## 1. Academic Sources & Providers

### Academic Source (`source`)

An origin of academic literature tracked by the lineage system.

- Canonical sources:
  - `arxiv`: High-energy astrophysics preprints (primarily `astro-ph.HE`).
  - `nature`: Research articles from Nature covering high-energy astrophysics phenomena.
  - `nature-astronomy`: Research articles from Nature Astronomy.
  - `science`: Research articles from Science covering astrophysical transients and compact objects.

### Source Ingestion Cadence

The publication frequency and update schedule native to each academic source:

- `arxiv`: Daily on business days (Mon–Fri morning UTC+8).
- `nature` / `nature-astronomy`: Weekly release schedule (primarily Thursdays UTC+8).
- `science`: Weekly release schedule (primarily Thursdays/Fridays UTC+8).
  The scheduler queries each provider according to its respective cadence or during scheduled daily batch runs.

### Ingestion Adapter

A decoupled domain module responsible for fetching raw metadata from a specific academic provider (e.g. arXiv RSS/API, Crossref API, NASA ADS/SciX, or Journal RSS feeds) and transforming it into the standard `RawPaperCandidate` format.

---

## 2. Paper Identification & Representation

### Paper Identifier (`paper_id`)

The canonical unique string identifier for an academic work tracked in the system:

- For arXiv works: The canonical arXiv ID (e.g., `2609.12345`).
- For journal works without arXiv preprints: The normalized DOI prefixed with `doi:` (e.g., `doi:10.1038/s41586-026-00000-0`).
- If a work has both an arXiv ID and a journal DOI, the `arxiv_id` remains the primary lookup key, while `doi` is preserved in the metadata.

### Paper Record (`PaperRecord`)

The core domain entity representing a screened, analyzed, or classified academic paper:

- `id` / `paper_id`: Canonical unique identifier (`arxiv_id` or `doi:..`).
- `source`: The `Academic Source` tag (`arxiv`, `nature`, `nature-astronomy`, `science`).
- `title`: Original English title.
- `title_zh`: Chinese translated title following the canonical acronym policy.
- `authors`: Array of author names.
- `doi`: Digital Object Identifier string (optional for bare preprints).
- `url`: Primary landing URL (arXiv abstract page or Journal publication page).
- `pdf_url`: PDF download link where accessible.
- `priority`: Classification level (`must_read`, `worth_knowing`, `skim`, `skip`).
- `summary` / `bluf`: Structured reading analysis (core question, findings, methodology).

---

## 3. Filtering & Governance

### High-Energy Astronomy Filter (`HE_DOMAIN_FILTER`)

The domain gatekeeper that evaluates whether a paper belongs to high-energy transient astrophysics (GRBs, FRBs, Supernovae, AGNs, compact binaries, gravitational waves, cosmic rays).
Non-astronomy or off-domain papers from multidisciplinary journals (such as biology, materials science, chemistry in Nature/Science) are rejected deterministically before deep LLM analysis.

### Source Badge

A visual UI token attached to paper cards and catalog entries indicating the origin journal or archive (e.g., `[Nature]`, `[Science]`, `[arXiv]`).

---

## 4. Research Lines & Community Channels

### Research Line (`R1`–`R7`)

A canonical high-energy astrophysics theme tracked across the knowledge base and weekly syntheses (`R1`: Central Engines, `R2`: Relativistic Jets & GRBs, `R3`: Explosive Transients & CSM, `R4`: Pulsar Winds & High-Energy Binaries, `R5`: Magnetar Bursts & FRB Environments, `R6`: Dense-Environment & Multi-Messenger Transients, `R7`: High-Energy X-Ray Timing & Compact Binaries).

### Channel Section

A discussion board in the QQ Channel community corresponding to an active publication route (`R1`, `R2`, `R3`, `R4`, `R6`, `R7`). Radio/FRB works route to `R4` (`脉冲星与快速射电暴`), and X-ray magnetar burst/flare works route to `R7` (`X射线时变、磁星与致密双星`); `R5` is retired from active routing and preserved only for legacy post compatibility.

---

## 5. Causal Lineage

### Causal Stage (`stage_id`)

A discrete physical evolution node (prefixed `stage:`) defined in one of the 41 canonical works in the research group's causal graph catalog.

### Causal Anchor (`causal_anchor`)

A machine-inferred or reviewed link attaching a screened `PaperRecord` (`must_read` or `worth_knowing`) to 1–3 existing `Causal Stage` nodes via a typed physical relation (`supports`, `constrains`, `challenges`, `extends`, `tests`). `skip` papers are never anchored.
