# QQ chat memory

The bot stores the latest ten messages per conversation in `.cache/qq-bot/memory/`.
This directory is ignored by Git and is outside the website data/public directories.
Files use hashed conversation keys (not encryption), mode 0600, inside a 0700 directory.
Chat content remains readable by the host account; do not publish or back it up to a
public location.

Retention is seven days from the last accepted user message, not from a read or bot
reply. Expired sessions cannot be used or revived by an assistant reply. They are
removed on access and on startup/hourly sweeps while the bot is running. When stopped,
physical deletion waits until next startup. Successful sends are recorded; failed
sends are not represented as delivered answers. Users, groups and channels remain
separate. Invalid records fail closed without echoing their contents or overwriting
them. Investigate storage errors locally.

The ten-message context window remains bounded (8192 characters per message); this
is not a seven-day complete transcript. Maximum 1000 stored sessions, rejecting new
sessions at capacity rather than silently deleting unexpired conversations. Writes
use same-directory temporary files and atomic rename. One process owns the directory;
multi-process writers and power-loss fsync durability are not supported.

This release does not add rolling model summaries, long-term profiles, Pi tasks,
NotebookLM sync or proactive notifications. Existing process-only history cannot be
recovered after restart. Deployment needs a separately approved bot restart; no
service is restarted by tests.

Offline regression: `node --test tests/qq-official-bot.test.mjs tests/agent-core.test.mjs`.
Tests use temporary directories and injected replies; no real provider or QQ calls.
