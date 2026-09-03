# Isolate synthetic validation fixtures

Synthetic valid and invalid datasets live under an isolated `tests/fixtures` root that production loaders never scan. Invalid fixtures assert exact validator error codes, and no fixture record may enter production indexes, counts, routes, or pages.
