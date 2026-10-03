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

## Deployment verification — 2026-10-03

The earlier deployment-pending note is stale. The actual unit is
`astrolineage-qq-bot.service`, active since 2026-09-29 20:51:56 PDT, after the
current memory module's modification time. The web and channel-agent units are
also active. Two local memory records parse successfully, remain within seven
days of `lastUserAt`, retain 10/3 messages and have mode 0600. No chat content or
credentials were printed, no message was sent and no service was restarted.
The QQ bot/user suites pass 11/11 offline checks. This verifies deployment and
current persistence metadata, not a new seven-day-long live expiry experiment.
Proactive messaging permission remains a separate external pending item.
