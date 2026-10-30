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
