# Use one global canonical schema version

The canonical content manifest owns one global schema version, and concern files do not evolve independently. Unsupported versions fail explicitly, migrations are explicit tested transformations, and validation reports record schema version, validator version, and a deterministic canonical-content digest.
