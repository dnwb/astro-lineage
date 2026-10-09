# No-Must-Read Daily Editions and Canonical Reading Priorities

Daily Radar editions where zero analyzed papers meet the Must Read threshold are authentic, valid publication states. They reflect real academic lulls rather than pipeline failures, and must never trigger fallback to historical editions.

When an edition contains no Must Read papers, the system delivers the current edition with an explicit batch note stating that no breakthroughs met the Must Read bar, and elevates the followed papers (internal schema: `worth_knowing`) as the primary reading targets.

Reader-facing vocabulary across all channels (QQ Official Bot, QQ Channel briefs, daily archives, and web UI) must strictly follow canonical terms:

1. High priority is designated as “必读” (Must Read).
2. Medium priority is designated as “关注”. The phrase “重点关注” is deprecated and forbidden in reader interfaces.
3. Internal schema keys such as `worth_knowing` and `must_read` are implementation details and must not leak into reader-facing text.

Fallback to earlier dates is strictly restricted to unanalyzed or unreleased batches (such as official arXiv recess/holiday periods or unrecoverable upstream failures).
