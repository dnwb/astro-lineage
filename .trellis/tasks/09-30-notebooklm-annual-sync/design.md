# Minimal design

Successful Astro build -> offline extraction of archive HTML -> immutable content-addressed monthly text bundles in `.cache/notebooklm/export.json` -> post-build browser synchronization via the existing NotebookLM skill's patchright environment. Group daily reports by Gregorian year and weekly reports by ISO year/Thursday month. Split oversized monthly bundles. No extra analysis or evidence upgrade.

Use existing JSON atomic writes and refresh locks. Remote source names contain the bundle key and full content hash, allowing reconciliation after remote-success/local-crash. Verify the new source's embedded hash before replacing only generated revisions of the same bundle. Do not delete notebooks or user sources. Authentication failures are explicit and do not block independent channel delivery. Export/build/tests stay offline.
