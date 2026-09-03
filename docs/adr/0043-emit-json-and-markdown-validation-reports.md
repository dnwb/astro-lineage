# Emit JSON and Markdown validation reports

Validation emits ignored generated reports at `validation/report.json` for CI, tests, and agents and `validation/report.md` for human review. Reports are produced even when validation fails, failures still block the build, and V0.1 does not add a public validation route.
