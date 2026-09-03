# Use a versioned semantic content digest

Validation computes a deterministic semantic SHA-256 over canonical content, with sorted paths, canonicalized YAML, normalized Markdown encoding and line endings, and explicit exclusion of generated files, caches, and fixtures. Canonicalization rules have their own version so a rules change cannot silently alter digest meaning.
