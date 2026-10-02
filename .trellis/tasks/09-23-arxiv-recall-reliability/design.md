# Design

Keep the existing feed -> analysis -> validated reader architecture. Reuse discovery snapshots, immutable generation publication, archive editions and daily eligibility. Add only the durable local bookkeeping needed for gaps and resumable screening. Body evidence is acquired separately from abstract triage. Files remain local; no new provider or dependency.

Implementation isolation uses temporary Git worktrees with a live-file overlay, preserving the dirty source baseline. Integration applies only each worker's delta against its overlay. Do not commit dirty baseline or publish PR without project-required commit confirmation.
