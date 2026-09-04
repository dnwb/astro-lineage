import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDiagnostic as makeDiagnostic } from "./diagnostic.mjs";
import {
  AXIS_IDS,
  AXIS_QUESTIONS,
  VALID_CANONICALIZATION_VERSIONS,
  VALID_SCHEMA_VERSIONS,
  VALID_VISIBILITY_PROFILE_IDS,
  loadCanonicalContent,
} from "./content-loader.mjs";
import { computeCanonicalContentDigest } from "./content-digest.mjs";

export const VALIDATOR_VERSION = "v0.1";
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONTENT_ROOT = fileURLToPath(new URL("../content/", import.meta.url));

const MANIFEST_FIELDS = Object.freeze([
  "schema_version",
  "canonicalization_version",
  "visibility_profile_id",
]);
const RISK_LEVELS = Object.freeze(["descriptive", "interpretive", "synthetic"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function addDiagnostic(diagnostics, details) {
  diagnostics.push(makeDiagnostic(details));
}

function hasStructuralFailure(diagnostics) {
  return diagnostics.some(({ code }) => code.startsWith("STRUCTURE_"));
}

function validateManifest(manifest, diagnostics) {
  if (!isObject(manifest)) {
    addDiagnostic(diagnostics, {
      code: "MANIFEST_INVALID_SHAPE",
      file: "content/manifest.yaml",
      recordId: "manifest",
      message: "The canonical manifest must be a mapping.",
    });
    return;
  }

  for (const field of MANIFEST_FIELDS) {
    if (!(field in manifest)) {
      addDiagnostic(diagnostics, {
        code: "MANIFEST_REQUIRED_FIELD_MISSING",
        file: "content/manifest.yaml",
        recordId: "manifest",
        fieldPath: `/${pointerSegment(field)}`,
        message: `The canonical manifest requires ${field}.`,
      });
    }
  }
  for (const field of Object.keys(manifest)) {
    if (!MANIFEST_FIELDS.includes(field)) {
      addDiagnostic(diagnostics, {
        code: "MANIFEST_UNKNOWN_FIELD",
        file: "content/manifest.yaml",
        recordId: "manifest",
        fieldPath: `/${pointerSegment(field)}`,
        message: `The canonical manifest does not allow ${field}.`,
      });
    }
  }

  const checks = [
    ["schema_version", VALID_SCHEMA_VERSIONS, "MANIFEST_UNSUPPORTED_SCHEMA_VERSION"],
    [
      "canonicalization_version",
      VALID_CANONICALIZATION_VERSIONS,
      "MANIFEST_UNSUPPORTED_CANONICALIZATION_VERSION",
    ],
    ["visibility_profile_id", VALID_VISIBILITY_PROFILE_IDS, "MANIFEST_UNSUPPORTED_VISIBILITY_PROFILE"],
  ];
  for (const [field, allowed, code] of checks) {
    if (!(field in manifest)) {
      continue;
    }
    if (typeof manifest[field] !== "string") {
      addDiagnostic(diagnostics, {
        code: "MANIFEST_INVALID_FIELD",
        file: "content/manifest.yaml",
        recordId: "manifest",
        fieldPath: `/${pointerSegment(field)}`,
        message: `${field} must be a string.`,
      });
    } else if (!allowed.includes(manifest[field])) {
      addDiagnostic(diagnostics, {
        code,
        file: "content/manifest.yaml",
        recordId: "manifest",
        fieldPath: `/${pointerSegment(field)}`,
        message: `${field} is not supported by this validator: ${manifest[field]}.`,
        relatedIds: allowed,
      });
    }
  }
}

function validateActors(actors, diagnostics) {
  if (!isObject(actors)) {
    addDiagnostic(diagnostics, {
      code: "STRUCTURE_ACTORS_INVALID_SHAPE",
      file: "content/actors.yaml",
      recordId: "actors",
      message: "The actor registry must be a mapping.",
    });
    return;
  }
  if (!Array.isArray(actors.actors)) {
    addDiagnostic(diagnostics, {
      code: "STRUCTURE_ACTORS_COLLECTION_INVALID",
      file: "content/actors.yaml",
      recordId: "actors",
      fieldPath: "/actors",
      message: "The actor registry must contain an actors array.",
    });
  }
}

function validateAxes(axes, diagnostics) {
  if (axes.length !== AXIS_IDS.length) {
    addDiagnostic(diagnostics, {
      code: "STRUCTURE_AXIS_SET_INVALID",
      file: "content/ontology/axes",
      recordId: "ontology",
      message: `Expected exactly ${AXIS_IDS.length} Physics Ontology axis files.`,
      relatedIds: AXIS_IDS,
    });
  }

  const seen = new Set();
  for (const [index, axis] of axes.entries()) {
    const fallbackId = AXIS_IDS[index] ?? `axis-${index + 1}`;
    const axisId = isObject(axis) && typeof axis.id === "string" ? axis.id : fallbackId;
    const file = `content/ontology/axes/${axisId}.yaml`;
    if (!isObject(axis)) {
      addDiagnostic(diagnostics, {
        code: "STRUCTURE_AXIS_INVALID_SHAPE",
        file,
        recordId: axisId,
        message: "A Physics Ontology axis must be a mapping.",
      });
      continue;
    }
    if (seen.has(axis.id)) {
      addDiagnostic(diagnostics, {
        code: "STRUCTURE_AXIS_DUPLICATE_ID",
        file,
        recordId: axis.id,
        fieldPath: "/id",
        message: `Physics Ontology axis ID is duplicated: ${axis.id}.`,
      });
    }
    seen.add(axis.id);
    if (axis.id !== fallbackId || !AXIS_IDS.includes(axis.id)) {
      addDiagnostic(diagnostics, {
        code: "STRUCTURE_AXIS_ID_MISMATCH",
        file,
        recordId: axis.id ?? null,
        fieldPath: "/id",
        message: `Axis identity must match one of the frozen schema-level IDs.`,
        relatedIds: AXIS_IDS,
      });
    }
    if (AXIS_QUESTIONS[axis.id] && axis.question !== AXIS_QUESTIONS[axis.id]) {
      addDiagnostic(diagnostics, {
        code: "STRUCTURE_AXIS_QUESTION_MISMATCH",
        file,
        recordId: axis.id,
        fieldPath: "/question",
        message: "Physics Ontology axis question does not match its frozen schema-level contract.",
      });
    }
    for (const field of ["label", "question"]) {
      if (typeof axis[field] !== "string" || axis[field].trim() === "") {
        addDiagnostic(diagnostics, {
          code: "STRUCTURE_AXIS_FIELD_INVALID",
          file,
          recordId: axis.id,
          fieldPath: `/${field}`,
          message: `Physics Ontology axis ${field} must be a non-empty string.`,
        });
      }
    }
    if (!RISK_LEVELS.includes(axis.default_risk)) {
      addDiagnostic(diagnostics, {
        code: "STRUCTURE_AXIS_DEFAULT_RISK_INVALID",
        file,
        recordId: axis.id,
        fieldPath: "/default_risk",
        message: "Physics Ontology axis default_risk must be a frozen Interpretive Risk level.",
        relatedIds: RISK_LEVELS,
      });
    }
    if (!Array.isArray(axis.terms)) {
      addDiagnostic(diagnostics, {
        code: "STRUCTURE_AXIS_TERMS_INVALID",
        file,
        recordId: axis.id,
        fieldPath: "/terms",
        message: "Physics Ontology axis terms must be an array.",
      });
    }
  }
}

function validateMethods(methods, diagnostics) {
  if (!isObject(methods)) {
    addDiagnostic(diagnostics, {
      code: "STRUCTURE_METHOD_TAXONOMY_INVALID_SHAPE",
      file: "content/methods/taxonomy.yaml",
      recordId: "taxonomy",
      message: "The Method Taxonomy must be a mapping.",
    });
    return;
  }
  for (const field of ["method_families", "techniques"]) {
    if (!Array.isArray(methods[field])) {
      addDiagnostic(diagnostics, {
        code: "STRUCTURE_METHOD_COLLECTION_INVALID",
        file: "content/methods/taxonomy.yaml",
        recordId: "taxonomy",
        fieldPath: `/${field}`,
        message: `The Method Taxonomy must contain a ${field} array.`,
      });
    }
  }
}

function validateRecordEnvelopes(snapshot, diagnostics) {
  for (const work of snapshot.works) {
    for (const fileName of ["work.yaml", "versions.yaml", "evidence.yaml", "annotations.yaml", "statements.yaml", "physical-account.yaml"]) {
      const value = work.files[fileName];
      if (value !== undefined && !isObject(value)) {
        addDiagnostic(diagnostics, {
          code: "STRUCTURE_WORK_RECORD_INVALID_SHAPE",
          file: `content/works/${work.id}/${fileName}`,
          recordId: work.id,
          fieldPath: null,
          message: `${fileName} must be a YAML mapping envelope.`,
        });
      }
    }
  }
}

function hasParseDiagnostic(diagnostics, file) {
  return diagnostics.some(
    (item) => item.code === "STRUCTURE_YAML_PARSE_ERROR" && item.file === file,
  );
}

function determinePasses(diagnostics, discovery) {
  const structural = diagnostics.some(({ code }) => code.startsWith("STRUCTURE_") || code.startsWith("MANIFEST_"));
  const structureStatus = structural ? "partial" : "complete";
  const downstreamStatus = structural ? "skipped" : "complete";
  return {
    structural: {
      status: structureStatus,
      diagnostic_count: diagnostics.filter(({ code }) => code.startsWith("STRUCTURE_") || code.startsWith("MANIFEST_")).length,
    },
    referential: {
      status: downstreamStatus,
      diagnostic_count: 0,
    },
    semantic: {
      status: downstreamStatus,
      diagnostic_count: 0,
    },
    discovery: {
      status: hasStructuralFailure(discovery.diagnostics) ? "partial" : "complete",
      file_count: discovery.files.length,
      diagnostic_count: discovery.diagnostics.length,
    },
  };
}

export async function validateCanonicalContent(
  contentRoot = CONTENT_ROOT,
) {
  const snapshot = await loadCanonicalContent(contentRoot);
  const diagnostics = [...snapshot.discovery.diagnostics];
  if (!hasParseDiagnostic(diagnostics, "content/manifest.yaml")) {
    validateManifest(snapshot.manifest, diagnostics);
  }
  if (!hasParseDiagnostic(diagnostics, "content/actors.yaml")) {
    validateActors(snapshot.actors, diagnostics);
  }
  if (!hasStructuralFailure(snapshot.discovery.diagnostics)) {
    validateAxes(snapshot.axes, diagnostics);
    validateMethods(snapshot.methods, diagnostics);
  }
  validateRecordEnvelopes(snapshot, diagnostics);

  const canonicalContentDigest = await computeCanonicalContentDigest(snapshot.discovery.root);
  const manifest = snapshot.manifest;
  const report = {
    dataset: "production",
    valid: diagnostics.length === 0,
    validator_version: VALIDATOR_VERSION,
    schema_version: typeof manifest.schema_version === "string" ? manifest.schema_version : null,
    canonicalization_version:
      manifest.canonicalization_version ?? null,
    visibility_profile_id: manifest.visibility_profile_id ?? null,
    canonical_content_digest: canonicalContentDigest,
    passes: determinePasses(diagnostics, snapshot.discovery),
    statistics: {
      works: snapshot.works.length,
      scientific_edges: snapshot.scientificEdges.length,
      ontology_axes: snapshot.axes.length,
      research_lines: snapshot.researchLines.length,
      learning_paths: snapshot.learningPaths.length,
    },
    diagnostics,
  };
  return report;
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderValidationMarkdown(report) {
  const lines = [
    "# Validation Report",
    "",
    `- Status: **${report.valid ? "valid" : "invalid"}**`,
    `- Dataset: ${report.dataset}`,
    `- Validator: ${report.validator_version}`,
    `- Schema: ${report.schema_version ?? "unavailable"}`,
    `- Canonicalization: ${report.canonicalization_version}`,
    `- Visibility profile: ${report.visibility_profile_id}`,
    `- Canonical content digest: \`${report.canonical_content_digest ?? "unavailable"}\``,
    "",
    "## Stored + Validated + Rendered",
    "",
    "| Pass | Status | Diagnostics |",
    "| --- | --- | ---: |",
  ];
  for (const [name, pass] of Object.entries(report.passes)) {
    lines.push(`| ${name} | ${pass.status} | ${pass.diagnostic_count ?? ""} |`);
  }
  lines.push("", "## Statistics", "");
  for (const [name, value] of Object.entries(report.statistics)) {
    lines.push(`- ${name}: ${value}`);
  }
  lines.push("", "## Diagnostics", "");
  if (report.diagnostics.length === 0) {
    lines.push("No diagnostics.");
  } else {
    lines.push(
      "| Severity | Code | File | Record | Field | Message | Related IDs |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const item of report.diagnostics) {
      lines.push(
        `| ${markdownCell(item.severity)} | ${markdownCell(item.code)} | ${markdownCell(item.file)} | ${markdownCell(item.record_id)} | ${markdownCell(item.field_path)} | ${markdownCell(item.message)} | ${markdownCell(item.related_ids.join(", "))} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function writeValidationReports(
  report,
  outputRoot = PROJECT_ROOT,
) {
  const validationDirectory = join(outputRoot, "validation");
  await mkdir(validationDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(validationDirectory, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      join(validationDirectory, "report.md"),
      renderValidationMarkdown(report),
      "utf8",
    ),
  ]);
}

export async function runValidation({
  contentRoot = CONTENT_ROOT,
  outputRoot = PROJECT_ROOT,
} = {}) {
  const report = await validateCanonicalContent(contentRoot);
  await writeValidationReports(report, outputRoot);
  return report;
}
