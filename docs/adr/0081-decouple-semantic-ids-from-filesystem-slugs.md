# Decouple semantic IDs from filesystem slugs

Canonical semantic IDs remain immutable namespaced values and may contain `:`, while filesystem slugs and filename stems are separate location identifiers and must not contain `:`. Work, Research Line, and Learning Path IDs come from their structured records; Scientific Edge IDs come from their YAML records. Bundle ownership remains cross-checked through the semantic IDs stored in YAML envelopes and Markdown frontmatter, not by requiring a directory or filename to equal an ID.

Static reader route segments also use the entity's filesystem-safe slug because Astro materializes those segments as output directories. Route props, record lookup, displayed identity, cross-record references, and governance continue to use the canonical semantic ID. This prevents generated `dist/` paths from reintroducing Windows-incompatible names; percent-encoding `:` is not a filesystem boundary because file-URL handling decodes it before output is written.

This decision supersedes any reading of ADR 0036 that derives a bundle path from its semantic ID, supersedes ADR 0069 only where it requires a directory ID to equal the stored ownership ID, and supersedes ADR 0039 only where it requires the immutable Work ID itself to be the Paper route key. Their bundle-shape, semantic ownership, and fixed route-family requirements remain in force.
