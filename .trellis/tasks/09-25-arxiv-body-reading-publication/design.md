# Design

The existing analyzer is the orchestration boundary. Its durable queue stores screening and reading status; source loading remains injectable and produces exact revision-bound bytes. Source text extraction returns ordered readable portions with real section locators, excludes non-TeX members from model input, and keeps finite resource caps. Model reading validates each portion before it is marked complete. Final analysis may claim full-body coverage only when all required portions for the same package hash were read and the synthesis passes current evidence checks. Any changed identity, package hash or reading contract invalidates progress.

The current Daily Radar validator and immutable edition publisher remain the publication boundary. The opening brief is derived only from eligible current-edition records; stale or pending records do not contribute. Related Work suggestions remain contextual and do not write canonical Edges.

Compatibility: accept prior queue items without reading progress. Retry their body from the beginning, preserving abstract triage. Keep the current published generation until a validated replacement wins compare-and-swap. No schema change to canonical content.

Resource and security limits: bounds on downloaded bytes, expanded package bytes, tar members, text bytes, include traversal, prompt size, model calls and time; never execute TeX or claim visual inspection. Fail closed for unsupported source structures.
