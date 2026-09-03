# Authorize curation actions at event time

Actor capabilities are temporally scoped append-only grants and revocations, and validators authorize each governed action using the capabilities effective at its UTC timestamp. Later grants cannot retroactively legitimize earlier actions and later revocations do not invalidate valid past actions. Actor Registry mutation remains repository-level governance outside the five V0.1 content capabilities, avoiding an application-level IAM or self-authorizing bootstrap mechanism.
