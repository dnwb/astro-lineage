# Implementation plan

1. Red/green: image-bearing tar source with large binary members still yields bounded TeX text; unsupported and unsafe sources stay pending. Ticket 01.
2. Red/green: long TeX uses bounded reading portions and resumes after a failed portion; changed source invalidates progress. Ticket 02.
3. Red/green: one pending candidate does not block a second eligible result; coverage/evidence claims remain honest. Ticket 03.
4. Red/green: opening brief contains only eligible current-edition records and publishes through the immutable writer; reader projection renders it. Ticket 04.
5. Run focused offline tests, then serial verify/build if feasible. Review changed paths against baseline hashes and preserve unrelated edits.
6. Ticket 05: bounded real five-paper check, then one announcement-day trial only if the first succeeds; record environmental evidence, resource use, exact revisions, and pending outcomes. No broad backfill or timer.

Rollback: code and planning changes are isolated to this task's new files plus touched analyzer/tests; current generation pointer is never manually changed.
