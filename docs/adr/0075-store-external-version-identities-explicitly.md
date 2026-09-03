# Store external Version identities explicitly

Every Version stores normalized external scholarly identity independently from its immutable internal ID and access URLs. ArXiv base identifiers omit prefixes and revision suffixes, revision is a separate positive integer, DOI values are lowercase without resolver syntax, and ORCIDs use canonical form with checksum validation; a DOI-less journal manifestation instead records another stable publisher identifier with a reason. Validators never parse scholarly facts from internal IDs or URLs.
