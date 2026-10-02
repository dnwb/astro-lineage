# QQ seven-day memory

User approved implementation. This bounded slice replaces the existing short-lived
Map with local private, atomic session files. Keep the existing ten-message window;
seven days is retention, not an unbounded transcript or context window.

Acceptance: last user message controls seven-day expiry; assistant replies and reads
do not renew it; fresh store instances recover history; group/channel/private and
user keys stay isolated; expired files are removed on access/startup/hourly sweep;
malformed files fail closed without echoing chat; tests never use production storage.
Only successfully sent assistant replies enter history. No Pi, rolling summarizer,
canonical edits, live model calls, publication or service restart in this slice.

Implementation: Node built-ins, hashed filenames under ignored .cache/qq-bot/memory,
private directory/file modes, bounded records and atomic replacement. Single bot
process only. Run focused offline tests and syntax/diff checks. Preserve prior edits.

## Validation

- Offline bot/core tests: 11 passed (2026-09-29).
- Syntax checks and git diff --check passed.
- Deployment pending: existing service not restarted. No live calls/messages.
- Full repository verify not rerun for this bounded slice; previous unrelated suite
  failures are not represented as resolved by these focused tests.
