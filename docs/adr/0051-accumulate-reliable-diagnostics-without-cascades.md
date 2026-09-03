# Accumulate reliable diagnostics without cascades

Validation collects all diagnostics it can discover safely, quarantines invalid records from dependent passes, and marks each pass complete, partial, or skipped. Reports are written before a non-zero exit, while downstream checks avoid emitting cascades caused solely by an upstream invalid record.
