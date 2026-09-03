# Validate structure, references, and semantics

Validation is layered into structural, referential, and semantic checks, and every validation failure blocks the build. Astro or Zod handles local shape but does not own cross-record invariants such as reference existence, DAG acyclicity, evidence requirements, lifecycle successors, or Editorial Anchor membership.
