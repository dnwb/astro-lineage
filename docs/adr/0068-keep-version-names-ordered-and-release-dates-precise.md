# Keep Version names ordered and release dates precise

Versions preserve ordered Version-local author display names with optional unguessed ORCID identifiers, without forcing names into given and family components or introducing global Person identity in V0.1. Every canonical Version records a non-null `release_date: { value, precision }` whose value is strict Gregorian partial ISO in `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` form and matches explicit year, month, or day precision, so arXiv release and journal publication are not conflated and precision is never fabricated.
