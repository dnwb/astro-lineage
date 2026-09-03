# Model curated arXiv revisions as Versions

Each curated public arXiv revision has a distinct Version identity, and Evidence binds to that exact revision so later revisions cannot silently move its source text. Revisions are recorded lazily when canonical records need them rather than exhaustively imported; `revises` connects a later curated revision to an earlier curated revision without claiming adjacency in the complete public revision history, balancing stable provenance against unnecessary curation work.
