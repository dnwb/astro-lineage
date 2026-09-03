# Generate aggregate indexes from local records

Small local records under `content/` are canonical, while aggregate indexes live under ignored root-level `generated/`. Canonical loaders never scan generated output, indexes are never edited manually, and every artifact must be fully reproducible from `content/`; any exception requires a later ADR.
