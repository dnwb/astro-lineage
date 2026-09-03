# Treat human-readable IDs as domain-opaque

IDs are immutable, namespaced, and human-readable, but their mnemonic components do not encode domain facts. Metadata corrections never rename an allocated ID, and implementations may validate namespace and uniqueness but must not derive authorship, year, title, classification, or other domain values from ID strings.
