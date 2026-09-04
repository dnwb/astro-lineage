export const DIAGNOSTIC_FIELDS = Object.freeze([
  "severity",
  "code",
  "dataset",
  "file",
  "record_id",
  "field_path",
  "message",
  "related_ids",
]);

export function createDiagnostic({
  severity = "error",
  code,
  dataset = "production",
  file,
  recordId = null,
  fieldPath = null,
  message,
  relatedIds = [],
}) {
  return {
    severity,
    code,
    dataset,
    file,
    record_id: recordId,
    field_path: fieldPath,
    message,
    related_ids: [...relatedIds],
  };
}
