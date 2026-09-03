# Treat canonical content as closed-world

`content/` is the sole canonical production root and its declared layout is closed-world: unknown files, directories, names, and extensions are structural errors rather than silently ignored data. Generated reverse indexes live under ignored root-level `generated/`, which canonical loaders never scan, making accidental non-consumption visible and preventing generated artifacts from becoming a second truth source.
