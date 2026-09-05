# Validator fixture catalog

Ticket 12 fixtures are small, reviewable descriptors rather than a second
canonical content root. Each descriptor names the canonical snapshot used as
its baseline and an explicit mutation implemented by
`ticket12-validator-fixtures.test.mjs`. The test materializes that snapshot in
a temporary directory before loading it, so fixture records cannot enter
production discovery, indexes, routes, or generated reports.

Valid descriptors live under `valid/`; adversarial descriptors live under
`invalid/<invariant-name>/`. Every invalid descriptor declares the exact
diagnostic code, severity, record, and record-relative JSON Pointer expected
from its mutation. `dataset` is passed to the validator explicitly and is
asserted in both diagnostics and reports.
