import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { createDiagnostic as makeDiagnostic } from "./diagnostic.mjs";
import {
  AXIS_IDS,
  AXIS_QUESTIONS,
  CANONICALIZATION_VERSION,
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
const BIBLIOGRAPHIC_PROVIDERS = Object.freeze(["ads", "arxiv", "crossref", "publisher"]);
const VERSION_KINDS = Object.freeze(["arxiv_revision", "journal_manifestation"]);
const READER_STATES = Object.freeze(["draft", "visible"]);
const ACTOR_KINDS = Object.freeze(["human", "agent"]);
const ACTOR_CAPABILITIES = Object.freeze([
  "draft_records",
  "review_records",
  "independent_scientific_review",
  "activate_controlled_terms",
  "approve_visibility",
]);
const ASSESSMENT_STATES = Object.freeze([
  "present",
  "unknown",
  "not_applicable",
  "not_assessed",
]);
const TERM_STATUSES = Object.freeze(["proposed", "active", "deprecated"]);
const REVIEW_STATES = Object.freeze(["unreviewed", "reviewed"]);
const ASSERTION_BASES = Object.freeze(["explicit", "inferred"]);
const STATEMENT_KINDS = Object.freeze(["assumption", "claim", "prediction", "result"]);
const STATEMENT_LIFECYCLES = Object.freeze(["maintained", "superseded", "withdrawn"]);
const CAUSAL_LINK_RELATIONS = Object.freeze([
  "drives",
  "enables",
  "transforms_into",
  "produces",
  "modulates",
]);
const FUNCTIONAL_ROLES = Object.freeze([
  "energy_dissipation",
  "particle_interaction",
  "emission_process",
  "transport_process",
]);
const LOCATOR_TYPES = Object.freeze([
  "page",
  "section",
  "equation",
  "table",
  "figure",
  "paragraph",
]);
const RISK_ORDER = Object.freeze({ descriptive: 0, interpretive: 1, synthetic: 2 });
const PROCESS_AXES = Object.freeze([
  "energy_dissipation",
  "particle_interaction",
  "emission_process",
  "transport_process",
]);

const STRUCTURAL_DIAGNOSTIC_CODES = new Set([
  // Local record identity, shape, type, and controlled-value failures.
  "ACTOR_ID_DUPLICATE",
  "ACTOR_ID_INVALID",
  "ACTOR_KIND_INVALID",
  "ACTOR_LABEL_INVALID",
  "ACTOR_CAPABILITY_EVENTS_INVALID",
  "ACTOR_CAPABILITY_EVENT_INVALID",
  "ACTOR_CAPABILITY_INVALID",
  "ACTOR_CAPABILITY_ACTION_INVALID",
  "ACTOR_CAPABILITY_REASON_INVALID",
  "ACTOR_CAPABILITY_EFFECTIVE_AT_INVALID",
  "TERM_ID_DUPLICATE",
  "TERM_ID_INVALID",
  "TERM_INVALID_SHAPE",
  "TERM_LABEL_INVALID",
  "TERM_STATUS_INVALID",
  "TERM_ALIASES_INVALID",
  "TERM_DEFINITION_REQUIRED",
  "TERM_FUNCTIONAL_ROLES_REQUIRED",
  "TERM_FUNCTIONAL_ROLES_INVALID",
  "TERM_FUNCTIONAL_ROLE_INVALID",
  "TERM_SUCCESSOR_INVALID",
  "METHOD_TECHNIQUE_FAMILY_REQUIRED",
  "METHOD_ANNOTATION_INVALID_SHAPE",
  "METHOD_ANNOTATION_ID_INVALID",
  "METHOD_ANNOTATION_BASIS_INVALID",
  "VERSION_COLLECTION_INVALID",
  "VERSION_ID_DUPLICATE",
  "VERSION_ID_INVALID",
  "VERSION_INVALID_SHAPE",
  "VERSION_KIND_INVALID",
  "BIB_TITLE_INVALID",
  "BIB_AUTHORS_INVALID",
  "BIB_AUTHOR_DISPLAY_NAME_INVALID",
  "BIB_ORCID_INVALID",
  "BIB_DOI_MISSING",
  "BIB_DOI_NOT_NORMALIZED",
  "BIB_RELEASE_DATE_INVALID",
  "BIB_ACCESS_URLS_INVALID",
  "BIB_ACCESS_URL_INVALID",
  "BIB_FIELD_PROVENANCE_INVALID_SHAPE",
  "BIB_FIELD_PROVENANCE_POINTER_INVALID",
  "BIB_SOURCE_COLLECTION_INVALID",
  "BIB_SOURCE_ID_DUPLICATE",
  "BIB_SOURCE_ID_INVALID",
  "BIB_SOURCE_INVALID_SHAPE",
  "BIB_SOURCE_PROVIDER_INVALID",
  "BIB_SOURCE_RECORD_ID_INVALID",
  "BIB_SOURCE_RETRIEVED_AT_INVALID",
  "BIB_SOURCE_URL_INVALID",
  "BIB_DISCREPANCIES_INVALID_SHAPE",
  "BIB_DISCREPANCY_INVALID_SHAPE",
  "BIB_DISCREPANCY_ID_INVALID",
  "BIB_DISCREPANCY_ID_DUPLICATE",
  "BIB_DISCREPANCY_FIELD_INVALID",
  "BIB_DISCREPANCY_SOURCES_INVALID",
  "BIB_DISCREPANCY_SOURCES_DUPLICATE",
  "BIB_DISCREPANCY_VALUES_INVALID",
  "BIB_DISCREPANCY_VALUE_INVALID",
  "BIB_DISCREPANCY_VALUE_SOURCE_DUPLICATE",
  "BIB_DISCREPANCY_RESOLUTION_HISTORY_INVALID",
  "BIB_DISCREPANCY_RESOLUTION_INVALID",
  "EVIDENCE_ID_DUPLICATE",
  "EVIDENCE_ID_INVALID",
  "EVIDENCE_INVALID_SHAPE",
  "EVIDENCE_LOCATOR_INVALID",
  "EVIDENCE_LOCATOR_TYPE_INVALID",
  "EVIDENCE_LOCATOR_PAGE_INVALID",
  "EVIDENCE_LOCATOR_COMPONENT_INVALID",
  "EVIDENCE_SOURCE_REFERENCE_INVALID",
  "EVIDENCE_EXCERPT_INVALID",
  "EVIDENCE_REFERENCES_INVALID",
  "EVIDENCE_REFERENCE_DUPLICATE",
  "ANNOTATION_ASSESSMENT_INVALID",
  "ANNOTATION_VALUES_INVALID",
  "ANNOTATION_VALUE_INVALID",
  "ANNOTATION_ID_DUPLICATE",
  "ANNOTATION_ID_INVALID",
  "ANNOTATION_INVALID_SHAPE",
  "ANNOTATION_AXIS_DUPLICATE",
  "ANNOTATION_VALUE_DUPLICATE",
  "ANNOTATION_RISK_INVALID",
  "STATEMENT_ID_DUPLICATE",
  "STATEMENT_ID_INVALID",
  "STATEMENT_INVALID_SHAPE",
  "STATEMENT_KIND_INVALID",
  "STATEMENT_BASIS_INVALID",
  "STATEMENT_LIFECYCLE_INVALID",
  "STATEMENT_CANONICAL_TEXT_INVALID",
  "STATEMENT_REASON_INVALID",
  "STATEMENT_ATTESTATIONS_INVALID",
  "STATEMENT_ATTESTATIONS_REQUIRED",
  "STATEMENT_ATTESTATION_INVALID_SHAPE",
  "CAUSAL_STAGE_COLLECTION_INVALID",
  "CAUSAL_STAGE_ID_DUPLICATE",
  "CAUSAL_STAGE_ID_INVALID",
  "CAUSAL_STAGE_INVALID_SHAPE",
  "CAUSAL_LINK_COLLECTION_INVALID",
  "CAUSAL_LINK_ID_DUPLICATE",
  "CAUSAL_LINK_ID_INVALID",
  "CAUSAL_LINK_INVALID_SHAPE",
  "CAUSAL_LINK_RELATION_INVALID",
  "CAUSAL_LINK_ORIGIN_INVALID",
  "CAUSAL_LINK_RISK_INVALID",
  "WORK_ID_INVALID",
  "WORK_READER_STATE_INVALID",
]);

function isStructuralDiagnostic({ code = "" }) {
  return code.startsWith("STRUCTURE_") ||
    code.startsWith("MANIFEST_") ||
    STRUCTURAL_DIAGNOSTIC_CODES.has(code);
}

function actorMap(actors) {
  if (actors instanceof Map) {
    return actors;
  }
  if (!isObject(actors) || !Array.isArray(actors.actors)) {
    return new Map();
  }
  return new Map(
    actors.actors
      .filter((actor) => isObject(actor) && typeof actor.id === "string")
      .map((actor) => [actor.id, actor]),
  );
}

/**
 * Evaluate a capability against the append-only event history at action time.
 * The function intentionally does not mutate the registry or infer any
 * capability from an actor's kind or display label.
 */
export function evaluateActorCapability(actors, actorId, capability, at) {
  if (!ACTOR_CAPABILITIES.includes(capability) || !validateUtcTimestampValue(at)) {
    return false;
  }
  const actor = actorMap(actors).get(actorId);
  if (!actor || !Array.isArray(actor.capability_events)) {
    return false;
  }
  const actionTime = Date.parse(at);
  let authorized = false;
  actor.capability_events
    .map((event, index) => ({ event, index }))
    .filter(
      ({ event }) =>
        isObject(event) &&
        event.capability === capability &&
        ["grant", "revoke"].includes(event.action) &&
        validateUtcTimestampValue(event.effective_at) &&
        Date.parse(event.effective_at) <= actionTime,
    )
    .sort((left, right) => {
      const byTime = Date.parse(left.event.effective_at) - Date.parse(right.event.effective_at);
      return byTime || left.index - right.index;
    })
    .forEach(({ event }) => {
      authorized = event.action === "grant";
    });
  return authorized;
}

function validateUtcTimestampValue(value) {
  return (
    typeof value === "string" &&
    RFC3339_UTC.test(value) &&
    isValidGregorianDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}
const NAMESPACED_ID = /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._-]*$/u;
const DOI = /^10\.\d{4,9}\/[\S]+$/iu;
const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u;
const RFC3339_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const DATE_VALUES = Object.freeze({ year: /^\d{4}$/u, month: /^\d{4}-(?:0[1-9]|1[0-2])$/u });

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
    return false;
  }
  if (!Array.isArray(actors.actors)) {
    addDiagnostic(diagnostics, {
      code: "STRUCTURE_ACTORS_COLLECTION_INVALID",
      file: "content/actors.yaml",
      recordId: "actors",
      fieldPath: "/actors",
      message: "The actor registry must contain an actors array.",
    });
    return false;
  }

  let valid = true;
  const seen = new Set();
  for (const [index, actor] of actors.actors.entries()) {
    if (!isObject(actor)) {
      addDiagnostic(diagnostics, {
        code: "STRUCTURE_ACTOR_INVALID_SHAPE",
        file: "content/actors.yaml",
        recordId: "actors",
        fieldPath: `/actors/${index}`,
        message: "Every actor registry entry must be a mapping.",
      });
      valid = false;
      continue;
    }
    const actorId = actor.id;
    if (!validateNamespacedId(actorId, "actor", {
      code: "ACTOR_ID_INVALID",
      file: "content/actors.yaml",
      recordId: actorId ?? "actors",
      fieldPath: `/actors/${index}/id`,
      message: "Actor IDs must use the actor: namespace.",
    }, diagnostics)) {
      valid = false;
      continue;
    }
    if (seen.has(actorId)) {
      addDiagnostic(diagnostics, {
        code: "ACTOR_ID_DUPLICATE",
        file: "content/actors.yaml",
        recordId: actorId,
        fieldPath: `/actors/${index}/id`,
        message: `Actor ID is duplicated: ${actorId}.`,
      });
      valid = false;
    }
    seen.add(actorId);
    if (!ACTOR_KINDS.includes(actor.kind)) {
      addDiagnostic(diagnostics, {
        code: "ACTOR_KIND_INVALID",
        file: "content/actors.yaml",
        recordId: actorId,
        fieldPath: `/actors/${index}/kind`,
        message: "Actor kind must be human or agent.",
        relatedIds: ACTOR_KINDS,
      });
      valid = false;
    }
    if (typeof actor.label !== "string" || actor.label.trim() === "") {
      addDiagnostic(diagnostics, {
        code: "ACTOR_LABEL_INVALID",
        file: "content/actors.yaml",
        recordId: actorId,
        fieldPath: `/actors/${index}/label`,
        message: "Every actor requires a non-empty display label.",
      });
      valid = false;
    }
    if (!Array.isArray(actor.capability_events)) {
      addDiagnostic(diagnostics, {
        code: "ACTOR_CAPABILITY_EVENTS_INVALID",
        file: "content/actors.yaml",
        recordId: actorId,
        fieldPath: `/actors/${index}/capability_events`,
        message: "Actor capability_events must be an append-only array.",
      });
      valid = false;
    } else {
      for (const [capabilityIndex, capabilityEvent] of actor.capability_events.entries()) {
        if (!isObject(capabilityEvent)) {
          addDiagnostic(diagnostics, {
            code: "ACTOR_CAPABILITY_EVENT_INVALID",
            file: "content/actors.yaml",
            recordId: actorId,
            fieldPath: `/actors/${index}/capability_events/${capabilityIndex}`,
            message: "Every actor capability event must be a mapping.",
            relatedIds: ACTOR_CAPABILITIES,
          });
          valid = false;
          continue;
        }
        if (!ACTOR_CAPABILITIES.includes(capabilityEvent.capability)) {
          addDiagnostic(diagnostics, {
            code: "ACTOR_CAPABILITY_INVALID",
            file: "content/actors.yaml",
            recordId: actorId,
            fieldPath: `/actors/${index}/capability_events/${capabilityIndex}/capability`,
            message: `Actor capability is not in the frozen V0.1 vocabulary: ${capabilityEvent.capability}.`,
            relatedIds: ACTOR_CAPABILITIES,
          });
          valid = false;
        }
        if (
          actor.kind === "agent" &&
          capabilityEvent.capability !== "draft_records"
        ) {
          addDiagnostic(diagnostics, {
            code: "ACTOR_AGENT_CAPABILITY_FORBIDDEN",
            file: "content/actors.yaml",
            recordId: actorId,
            fieldPath: `/actors/${index}/capability_events/${capabilityIndex}/capability`,
            message: "V0.1 Agent actors may receive only draft_records.",
            relatedIds: ["draft_records"],
          });
          valid = false;
        }
        if (!["grant", "revoke"].includes(capabilityEvent.action)) {
          addDiagnostic(diagnostics, {
            code: "ACTOR_CAPABILITY_ACTION_INVALID",
            file: "content/actors.yaml",
            recordId: actorId,
            fieldPath: `/actors/${index}/capability_events/${capabilityIndex}/action`,
            message: "Actor capability action must be grant or revoke.",
            relatedIds: ["grant", "revoke"],
          });
          valid = false;
        }
        if (typeof capabilityEvent.reason !== "string" || capabilityEvent.reason.trim() === "") {
          addDiagnostic(diagnostics, {
            code: "ACTOR_CAPABILITY_REASON_INVALID",
            file: "content/actors.yaml",
            recordId: actorId,
            fieldPath: `/actors/${index}/capability_events/${capabilityIndex}/reason`,
            message: "Every actor capability event requires a reason.",
          });
          valid = false;
        }
        if (!validateUtcTimestamp(capabilityEvent.effective_at, {
          code: "ACTOR_CAPABILITY_EFFECTIVE_AT_INVALID",
          file: "content/actors.yaml",
          recordId: actorId,
          fieldPath: `/actors/${index}/capability_events/${capabilityIndex}/effective_at`,
          message: "Actor capability effective_at must be a UTC RFC 3339 timestamp.",
        }, diagnostics)) {
          valid = false;
        }
      }
    }
  }
  return valid;
}

function validateAxes(axes, actorsById, diagnostics) {
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
  const terms = [];
  for (const entry of axes) {
    const axisId = entry.id;
    const axis = entry.value;
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
    if (axis.id !== axisId || !AXIS_IDS.includes(axis.id)) {
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
      continue;
    }
    for (const [termIndex, term] of axis.terms.entries()) {
      const validated = validateControlledTerm(
        term,
        termIndex,
        {
          file,
          recordId: axis.id,
          fieldPath: "/terms",
        },
        actorsById,
        diagnostics,
        {
          axisId: axis.id,
          requireFunctionalRoles: PROCESS_AXES.includes(axis.id),
        },
      );
      if (validated?.term && validated.valid) {
        terms.push({ ...validated, file, category: "physics", axisId: axis.id });
      }
    }
  }
  validateTermSuccessors(terms, diagnostics);
  return terms;
}

export function isValidationValid(diagnostics) {
  return !diagnostics.some(({ severity }) => severity === "error");
}

export function mergeValidationDiagnostics(report, additionalDiagnostics = []) {
  const diagnostics = [...report.diagnostics, ...additionalDiagnostics];
  return {
    ...report,
    valid: isValidationValid(diagnostics),
    diagnostics,
  };
}

function validateMethods(methods, actorsById, diagnostics) {
  if (!isObject(methods)) {
    addDiagnostic(diagnostics, {
      code: "STRUCTURE_METHOD_TAXONOMY_INVALID_SHAPE",
      file: "content/methods/taxonomy.yaml",
      recordId: "taxonomy",
      message: "The Method Taxonomy must be a mapping.",
    });
    return [];
  }
  const terms = [];
  let familyRecordsValid = Array.isArray(methods.method_families);
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
  if (Array.isArray(methods.method_families)) {
    for (const [index, family] of methods.method_families.entries()) {
      const validated = validateControlledTerm(
        family,
        index,
        {
          file: "content/methods/taxonomy.yaml",
          recordId: "taxonomy",
          fieldPath: "/method_families",
        },
        actorsById,
        diagnostics,
        { namespace: "method-family" },
      );
      if (validated?.term && validated.valid) {
        terms.push({
          ...validated,
          file: "content/methods/taxonomy.yaml",
          category: "method_family",
        });
      } else {
        familyRecordsValid = false;
      }
    }
  }
  const familyIds = new Set(
    terms
      .filter(({ term }) => term.id.startsWith("method-family:"))
      .map(({ term }) => term.id),
  );
  if (Array.isArray(methods.techniques)) {
    for (const [index, technique] of methods.techniques.entries()) {
      const validated = validateControlledTerm(
        technique,
        index,
        {
          file: "content/methods/taxonomy.yaml",
          recordId: "taxonomy",
          fieldPath: "/techniques",
        },
        actorsById,
        diagnostics,
        { namespace: "technique" },
      );
      const techniqueValid = validated?.term && validated.valid;
      if (techniqueValid) {
        terms.push({
          ...validated,
          file: "content/methods/taxonomy.yaml",
          category: "technique",
        });
      }
      if (!isObject(technique)) {
        continue;
      }
      if (!Array.isArray(technique.family_ids) || technique.family_ids.length === 0) {
        addDiagnostic(diagnostics, {
          code: "METHOD_TECHNIQUE_FAMILY_REQUIRED",
          file: "content/methods/taxonomy.yaml",
          recordId: technique.id ?? "taxonomy",
          fieldPath: `/techniques/${index}/family_ids`,
          message: "Every Canonical Technique must belong to one or more Method Families.",
        });
      } else if (techniqueValid && familyRecordsValid) {
        for (const [familyIndex, familyId] of technique.family_ids.entries()) {
          if (!familyIds.has(familyId)) {
            addDiagnostic(diagnostics, {
              code: "REFERENTIAL_METHOD_FAMILY_MISSING",
              file: "content/methods/taxonomy.yaml",
              recordId: technique.id ?? "taxonomy",
              fieldPath: `/techniques/${index}/family_ids/${familyIndex}`,
              message: `Method Family does not exist: ${familyId}.`,
              relatedIds: [familyId],
            });
          }
        }
      }
    }
  }
  validateTermSuccessors(terms, diagnostics);
  return terms;
}

function isNamespacedId(value, namespace) {
  return (
    typeof value === "string" &&
    NAMESPACED_ID.test(value) &&
    value.slice(0, value.indexOf(":")) === namespace
  );
}

function validateNamespacedId(value, namespace, details, diagnostics) {
  if (!isNamespacedId(value, namespace)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: details.code ?? "IDENTIFIER_INVALID",
      fieldPath: details.fieldPath ?? "/id",
      message: details.message ?? `Identifier must use the ${namespace}: namespace.`,
    });
    return false;
  }
  return true;
}

function validateUtcTimestamp(value, details, diagnostics) {
  const structurallyValid = typeof value === "string" && RFC3339_UTC.test(value);
  const calendarValid = structurallyValid && isValidGregorianDate(value.slice(0, 10));
  const parsed = structurallyValid ? Date.parse(value) : Number.NaN;
  if (!calendarValid || !Number.isFinite(parsed)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: details.code ?? "CURATION_TIMESTAMP_INVALID",
      message: details.message ?? "Curation timestamps must be valid UTC RFC 3339 dates.",
    });
    return false;
  }
  return true;
}

function validateStringArray(value, details, diagnostics, code, label, { required = false } = {}) {
  if (!Array.isArray(value)) {
    if (required || value !== undefined) {
      addDiagnostic(diagnostics, {
        ...details,
        code,
        message: `${label} must be an array of non-empty strings.`,
      });
      return false;
    }
    return true;
  }
  let valid = true;
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code,
        fieldPath: `${details.fieldPath ?? ""}/${index}`,
        message: `${label} entries must be non-empty strings.`,
      });
      valid = false;
    }
  });
  return valid;
}

function validateControlledTerm(
  term,
  index,
  details,
  actorsById,
  diagnostics,
  { namespace = "term", axisId = null, requireFunctionalRoles = false } = {},
) {
  if (!isObject(term)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "TERM_INVALID_SHAPE",
      fieldPath: `${details.fieldPath ?? ""}/${index}`,
      message: "Controlled Terms must be mappings.",
    });
    return null;
  }
  const termDetails = {
    ...details,
    recordId: term.id ?? details.recordId,
    fieldPath: `${details.fieldPath ?? ""}/${index}`,
  };
  let valid = true;
  if (!validateNamespacedId(term.id, namespace, {
    ...termDetails,
    code: "TERM_ID_INVALID",
    fieldPath: `${termDetails.fieldPath}/id`,
    message: `Controlled Term IDs must use the ${namespace}: namespace.`,
  }, diagnostics)) {
    valid = false;
  }
  if (typeof term.label !== "string" || term.label.trim() === "") {
    addDiagnostic(diagnostics, {
      ...termDetails,
      code: "TERM_LABEL_INVALID",
      fieldPath: `${termDetails.fieldPath}/label`,
      message: "Controlled Terms require a non-empty label.",
    });
    valid = false;
  }
  if (!TERM_STATUSES.includes(term.status)) {
    addDiagnostic(diagnostics, {
      ...termDetails,
      code: "TERM_STATUS_INVALID",
      fieldPath: `${termDetails.fieldPath}/status`,
      message: "Controlled Term status must be proposed, active, or deprecated.",
      relatedIds: TERM_STATUSES,
    });
    valid = false;
  }
  if (!validateStringArray(term.aliases, {
    ...termDetails,
    fieldPath: `${termDetails.fieldPath}/aliases`,
  }, diagnostics, "TERM_ALIASES_INVALID", "Controlled Term aliases")) {
    valid = false;
  }

  if (
    term.status === "active" &&
    (typeof term.definition !== "string" || term.definition.trim() === "")
  ) {
    addDiagnostic(diagnostics, {
      ...termDetails,
      code: "TERM_DEFINITION_REQUIRED",
      fieldPath: `${termDetails.fieldPath}/definition`,
      message: "An active Controlled Term requires a definition.",
    });
    valid = false;
  }
  if (term.status === "active") {
    for (const field of ["examples", "counterexamples"]) {
      if (!validateStringArray(term[field], {
        ...termDetails,
        fieldPath: `${termDetails.fieldPath}/${field}`,
      }, diagnostics, "TERM_ACTIVATION_EXAMPLES_REQUIRED", `Active Term ${field}`, { required: true })) {
        valid = false;
      }
      if (Array.isArray(term[field]) && term[field].length === 0) {
        addDiagnostic(diagnostics, {
          ...termDetails,
          code: "TERM_ACTIVATION_EXAMPLES_REQUIRED",
          fieldPath: `${termDetails.fieldPath}/${field}`,
          message: `Active Controlled Terms require at least one ${field} entry.`,
        });
        valid = false;
      }
    }
    if (typeof term.boundary_notes !== "string" || term.boundary_notes.trim() === "") {
      addDiagnostic(diagnostics, {
        ...termDetails,
        code: "TERM_BOUNDARY_NOTES_REQUIRED",
        fieldPath: `${termDetails.fieldPath}/boundary_notes`,
        message: "Active Controlled Terms require boundary notes.",
      });
      valid = false;
    }
    if (requireFunctionalRoles && !Array.isArray(term.allowed_functional_roles)) {
      addDiagnostic(diagnostics, {
        ...termDetails,
        code: "TERM_FUNCTIONAL_ROLES_REQUIRED",
        fieldPath: `${termDetails.fieldPath}/allowed_functional_roles`,
        message: "Process terms require an explicit allowed_functional_roles array.",
      });
      valid = false;
    }
    if (term.allowed_functional_roles !== undefined) {
      if (!Array.isArray(term.allowed_functional_roles)) {
        addDiagnostic(diagnostics, {
          ...termDetails,
          code: "TERM_FUNCTIONAL_ROLES_INVALID",
          fieldPath: `${termDetails.fieldPath}/allowed_functional_roles`,
          message: "allowed_functional_roles must be an array.",
        });
        valid = false;
      } else {
        for (const [roleIndex, role] of term.allowed_functional_roles.entries()) {
          if (!FUNCTIONAL_ROLES.includes(role)) {
            addDiagnostic(diagnostics, {
              ...termDetails,
              code: "TERM_FUNCTIONAL_ROLE_INVALID",
              fieldPath: `${termDetails.fieldPath}/allowed_functional_roles/${roleIndex}`,
              message: "allowed_functional_roles contains an unknown Functional Role.",
              relatedIds: FUNCTIONAL_ROLES,
            });
            valid = false;
          }
        }
      }
    }
  }

  if (TERM_STATUSES.includes(term.status)) {
    const requiresActivationReview = term.status === "active";
    if (
      !validateGovernedRecord(
        term,
        actorsById,
        termDetails,
        diagnostics,
        {
          independentReview: requiresActivationReview,
          independentReviewCapability: requiresActivationReview
            ? "activate_controlled_terms"
            : "review_records",
          reviewCapability: requiresActivationReview
            ? "activate_controlled_terms"
            : "review_records",
        },
      )
    ) {
      valid = false;
    }
  }

  if (term.status === "deprecated") {
    if (typeof term.deprecation_reason !== "string" || term.deprecation_reason.trim() === "") {
      addDiagnostic(diagnostics, {
        ...termDetails,
        code: "TERM_DEPRECATION_REASON_REQUIRED",
        fieldPath: `${termDetails.fieldPath}/deprecation_reason`,
        message: "Deprecated Controlled Terms require a reason.",
      });
      valid = false;
    }
    if (term.successor_id !== undefined && typeof term.successor_id !== "string") {
      addDiagnostic(diagnostics, {
        ...termDetails,
        code: "TERM_SUCCESSOR_INVALID",
        fieldPath: `${termDetails.fieldPath}/successor_id`,
        message: "A Controlled Term successor_id must be a namespaced ID when supplied.",
      });
      valid = false;
    }
    if (!isObject(term.deprecation_provenance)) {
      addDiagnostic(diagnostics, {
        ...termDetails,
        code: "TERM_DEPRECATION_PROVENANCE_REQUIRED",
        fieldPath: `${termDetails.fieldPath}/deprecation_provenance`,
        message: "Deprecated Controlled Terms require deprecation provenance.",
      });
      valid = false;
    } else {
      const deprecationDetails = {
        ...termDetails,
        fieldPath: `${termDetails.fieldPath}/deprecation_provenance`,
      };
      if (
        !validateCurationProvenance(
          term.deprecation_provenance,
          actorsById,
          deprecationDetails,
          diagnostics,
          { requiredActorKind: "human" },
        )
      ) {
        valid = false;
      }
      if (
        !requireActorCapability(
          term.deprecation_provenance,
          actorsById,
          "review_records",
          deprecationDetails,
          diagnostics,
          "TERM_DEPRECATION_CAPABILITY_REQUIRED",
        )
      ) {
        valid = false;
      }
    }
  }
  return { term, valid, axisId };
}

function validateTermSuccessors(terms, diagnostics) {
  for (const entry of terms) {
    if (!entry?.term?.successor_id) {
      continue;
    }
    const successor = terms.find(({ term }) => term?.id === entry.term.successor_id);
    if (!successor) {
      addDiagnostic(diagnostics, {
        file: entry.file,
        recordId: entry.term.id,
        code: "REFERENTIAL_TERM_SUCCESSOR_MISSING",
        fieldPath: "/successor_id",
        message: `Controlled Term successor does not exist: ${entry.term.successor_id}.`,
        relatedIds: [entry.term.successor_id],
      });
    } else if (successor.term.status !== "active") {
      addDiagnostic(diagnostics, {
        file: entry.file,
        recordId: entry.term.id,
        code: "TERM_SUCCESSOR_NOT_ACTIVE",
        fieldPath: "/successor_id",
        message: "A semantic successor must be an active Controlled Term.",
        relatedIds: [entry.term.successor_id],
      });
    }
  }
}

function isValidGregorianDate(value) {
  const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    return false;
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateCurationProvenance(
  provenance,
  actorsById,
  details,
  diagnostics,
  { requiredActorKind } = {},
) {
  if (!isObject(provenance)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "CURATION_PROVENANCE_INVALID_SHAPE",
      message: "Curation Provenance must be a mapping.",
    });
    return false;
  }

  let valid = true;
  if (typeof provenance.actor_id !== "string") {
    addDiagnostic(diagnostics, {
      ...details,
      code: "CURATION_ACTOR_REQUIRED",
      fieldPath: `${details.fieldPath ?? ""}/actor_id`,
      message: "Curation Provenance requires an actor_id.",
    });
    valid = false;
  } else {
    const actor = actorsById?.get(provenance.actor_id);
    if (actorsById && !actor) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "REFERENTIAL_ACTOR_MISSING",
        fieldPath: `${details.fieldPath ?? ""}/actor_id`,
        recordId: details.recordId,
        message: `Curation actor does not exist: ${provenance.actor_id}.`,
        relatedIds: [provenance.actor_id],
      });
      valid = false;
    } else if (actor) {
      if (actor.kind !== "human" && actor.kind !== "agent") {
        valid = false;
      }
      if (requiredActorKind && actor.kind !== requiredActorKind) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "CURATION_HUMAN_ACTOR_REQUIRED",
          fieldPath: `${details.fieldPath ?? ""}/actor_id`,
          message: `This curation event requires a ${requiredActorKind} actor.`,
          relatedIds: [requiredActorKind],
        });
        valid = false;
      }
    }
  }
  if (
    !validateUtcTimestamp(
      provenance.recorded_at,
      {
        ...details,
        code: "CURATION_TIMESTAMP_INVALID",
        fieldPath: `${details.fieldPath ?? ""}/recorded_at`,
        message: "Curation Provenance recorded_at must be a UTC RFC 3339 timestamp.",
      },
      diagnostics,
    )
  ) {
    valid = false;
  }
  return valid;
}

function actorForProvenance(provenance, actorsById) {
  return actorsById && isObject(provenance) && typeof provenance.actor_id === "string"
    ? actorsById.get(provenance.actor_id)
    : undefined;
}

function normalizeMethodReason(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : value ?? null;
}

function referenceWasCreatedAfterDeprecation(record, term) {
  if (term?.status !== "deprecated") {
    return false;
  }
  const referenceTime = Date.parse(record?.curation_provenance?.recorded_at);
  const deprecationTime = Date.parse(term?.deprecation_provenance?.recorded_at);
  return Number.isFinite(referenceTime)
    && Number.isFinite(deprecationTime)
    && referenceTime >= deprecationTime;
}

function methodAnnotationSemanticDigest(annotation) {
  const semanticProjection = {
    technique_id: annotation.technique_id ?? null,
    basis: annotation.basis ?? null,
    reason: normalizeMethodReason(annotation.reason),
    evidence_ids: Array.isArray(annotation.evidence_ids)
      ? [...annotation.evidence_ids].sort()
      : annotation.evidence_ids ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(semanticProjection), "utf8")
    .digest("hex");
}

function validateMethodReviewBinding(annotation, details, diagnostics) {
  if (annotation.review_state !== "reviewed") {
    return true;
  }
  const binding = annotation.review_binding;
  if (!isObject(binding)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "METHOD_REVIEW_BINDING_REQUIRED",
      fieldPath: `${details.fieldPath}/review_binding`,
      message: "A reviewed Method Annotation requires a semantic review binding.",
    });
    return false;
  }
  let valid = true;
  if (binding.canonicalization_version !== CANONICALIZATION_VERSION) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "METHOD_REVIEW_BINDING_VERSION_INVALID",
      fieldPath: `${details.fieldPath}/review_binding/canonicalization_version`,
      message: "Method review binding uses an unsupported canonicalization version.",
      relatedIds: [CANONICALIZATION_VERSION],
    });
    valid = false;
  }
  const expectedDigest = methodAnnotationSemanticDigest(annotation);
  if (binding.semantic_digest !== expectedDigest) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "METHOD_REVIEW_BINDING_STALE",
      fieldPath: `${details.fieldPath}/review_binding/semantic_digest`,
      message: "Reviewed Method Annotation semantic fields no longer match its review binding.",
    });
    valid = false;
  }
  return valid;
}

function requireActorCapability(
  provenance,
  actors,
  capability,
  details,
  diagnostics,
  code = "CURATION_CAPABILITY_REQUIRED",
) {
  if (!actors) {
    return true;
  }
  const actor = actorForProvenance(provenance, actors);
  if (!actor || !isObject(provenance)) {
    return false;
  }
  if (!evaluateActorCapability(actors, actor.id, capability, provenance.recorded_at)) {
    addDiagnostic(diagnostics, {
      ...details,
      code,
      fieldPath: `${details.fieldPath ?? ""}/actor_id`,
      message: `Actor ${actor.id} did not hold ${capability} at the curation action time.`,
      relatedIds: [capability],
    });
    return false;
  }
  return true;
}

function validateGovernedRecord(
  record,
  actorsById,
  details,
  diagnostics,
  {
    independentReview = false,
    independentReviewCapability = "independent_scientific_review",
    reviewCapability = "review_records",
    reviewRequired = true,
  } = {},
) {
  let valid = true;
  const creatorProvenance = record?.curation_provenance;
  if (
    !validateCurationProvenance(
      creatorProvenance,
      actorsById,
      {
        ...details,
        fieldPath: `${details.fieldPath ?? ""}/curation_provenance`,
      },
      diagnostics,
    )
  ) {
    valid = false;
  } else if (
    !requireActorCapability(
      creatorProvenance,
      actorsById,
      "draft_records",
      {
        ...details,
        fieldPath: `${details.fieldPath ?? ""}/curation_provenance`,
      },
      diagnostics,
    )
  ) {
    valid = false;
  }

  if (!reviewRequired) {
    return valid;
  }
  const reviewState = record?.review_state;
  if (!REVIEW_STATES.includes(reviewState)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "REVIEW_STATE_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/review_state`,
      message: "Governed records require review_state unreviewed or reviewed.",
      relatedIds: REVIEW_STATES,
    });
    return false;
  }
  const reviewProvenance = record?.review_provenance;
  if (reviewState === "unreviewed") {
    if (reviewProvenance !== undefined) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "REVIEW_PROVENANCE_WITHOUT_REVIEW",
        fieldPath: `${details.fieldPath ?? ""}/review_provenance`,
        message: "An unreviewed record cannot carry review provenance.",
      });
      valid = false;
    }
    if (record?.review_binding !== undefined) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "REVIEW_BINDING_WITHOUT_REVIEW",
        fieldPath: `${details.fieldPath ?? ""}/review_binding`,
        message: "An unreviewed record cannot carry a semantic review binding.",
      });
      valid = false;
    }
    return valid;
  }

  const creator = actorForProvenance(creatorProvenance, actorsById);
  const reviewer = actorForProvenance(reviewProvenance, actorsById);
  const reviewDetails = {
    ...details,
    fieldPath: `${details.fieldPath ?? ""}/review_provenance`,
  };
  if (
    !validateCurationProvenance(
      reviewProvenance,
      actorsById,
      reviewDetails,
      diagnostics,
      { requiredActorKind: creator?.kind === "agent" || independentReview ? "human" : undefined },
    )
  ) {
    valid = false;
  }
  if (!actorsById) {
    return valid;
  }
  if (!reviewer) {
    return false;
  }
  if (creator?.kind === "agent" && reviewer.kind !== "human") {
    addDiagnostic(diagnostics, {
      ...reviewDetails,
      code: "CURATION_HUMAN_REVIEW_REQUIRED",
      message: "Agent-created records require a Human review gate.",
    });
    valid = false;
  }
  if (independentReview && reviewer.id === creator?.id) {
    addDiagnostic(diagnostics, {
      ...reviewDetails,
      code: "CURATION_INDEPENDENT_REVIEW_REQUIRED",
      message: "Independent review requires a reviewer distinct from the creator.",
      relatedIds: creator ? [creator.id] : [],
    });
    valid = false;
  }
  if (
    !requireActorCapability(
      reviewProvenance,
      actorsById,
      independentReview ? independentReviewCapability : reviewCapability,
      reviewDetails,
      diagnostics,
    )
  ) {
    valid = false;
  }
  return valid;
}

function decodePointer(pointer) {
  if (pointer === "") {
    return [];
  }
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    return null;
  }
  const segments = pointer.slice(1).split("/");
  if (segments.some((segment) => /~(?![01])/u.test(segment))) {
    return null;
  }
  return segments.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function readPointer(value, pointer) {
  const segments = decodePointer(pointer);
  if (!segments) {
    return { valid: false, exists: false, value: undefined };
  }
  let current = value;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^\d+$/u.test(segment) || Number(segment) >= current.length) {
        return { valid: true, exists: false, value: undefined };
      }
      current = current[Number(segment)];
    } else if (isObject(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return { valid: true, exists: false, value: undefined };
    }
  }
  return { valid: true, exists: true, value: current };
}

function collectLeafPointers(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectLeafPointers(item, `${prefix}/${index}`),
    );
  }
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      collectLeafPointers(item, `${prefix}/${pointerSegment(key)}`),
    );
  }
  return [prefix || "/"];
}

function validateReleaseDate(releaseDate, details, diagnostics) {
  if (!isObject(releaseDate)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "BIB_RELEASE_DATE_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/release_date`,
      message: "Version release_date must be a { value, precision } mapping.",
    });
    return false;
  }
  const { value, precision } = releaseDate;
  let valid = true;
  const precisionIsKnown =
    typeof precision === "string" && Object.hasOwn(DATE_VALUES, precision);
  if (!precisionIsKnown && precision !== "day") {
    addDiagnostic(diagnostics, {
      ...details,
      code: "BIB_RELEASE_DATE_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/release_date/precision`,
      message: "Release date precision must be year, month, or day.",
      relatedIds: ["year", "month", "day"],
    });
    valid = false;
  }
  if (typeof value !== "string") {
    valid = false;
  } else if (precision === "day") {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      valid = false;
    } else {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      ) {
        valid = false;
      }
    }
  } else if (precisionIsKnown && typeof value === "string" && !DATE_VALUES[precision].test(value)) {
    valid = false;
  }
  if (!valid) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "BIB_RELEASE_DATE_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/release_date`,
      message: "Release date value must be a strict Gregorian partial ISO date matching precision.",
    });
  }
  return valid;
}

function isValidOrcid(value) {
  if (typeof value !== "string" || !ORCID.test(value)) {
    return false;
  }
  const digits = value.replaceAll("-", "");
  let total = 0;
  for (const digit of digits.slice(0, -1)) {
    total = (total + Number(digit)) * 2;
  }
  const remainder = total % 11;
  const checkDigit = (12 - remainder) % 11;
  const expected = checkDigit === 10 ? "X" : String(checkDigit);
  return digits.at(-1) === expected;
}

function validateBibliographicSource(source, index, sourceIds, details, diagnostics) {
  if (!isObject(source)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "BIB_SOURCE_INVALID_SHAPE",
      fieldPath: `/bibliographic_sources/${index}`,
      message: "Bibliographic Sources must be mappings.",
    });
    return;
  }
  const sourceDetails = {
    ...details,
    recordId: source.id ?? details.recordId,
  };
  if (validateNamespacedId(source.id, "source", {
    ...sourceDetails,
    code: "BIB_SOURCE_ID_INVALID",
    fieldPath: `/bibliographic_sources/${index}/id`,
    message: "Bibliographic Source IDs must use the source: namespace.",
  }, diagnostics)) {
    if (sourceIds.has(source.id)) {
      addDiagnostic(diagnostics, {
        ...sourceDetails,
        code: "BIB_SOURCE_ID_DUPLICATE",
        fieldPath: `/bibliographic_sources/${index}/id`,
        message: `Bibliographic Source ID is duplicated: ${source.id}.`,
      });
    }
    sourceIds.add(source.id);
  }
  if (!BIBLIOGRAPHIC_PROVIDERS.includes(source.provider)) {
    addDiagnostic(diagnostics, {
      ...sourceDetails,
      code: "BIB_SOURCE_PROVIDER_INVALID",
      fieldPath: `/bibliographic_sources/${index}/provider`,
      message: "Bibliographic Source provider is not supported.",
      relatedIds: BIBLIOGRAPHIC_PROVIDERS,
    });
  }
  if (typeof source.record_id !== "string" || source.record_id.trim() === "") {
    addDiagnostic(diagnostics, {
      ...sourceDetails,
      code: "BIB_SOURCE_RECORD_ID_INVALID",
      fieldPath: `/bibliographic_sources/${index}/record_id`,
      message: "Bibliographic Source record_id must be a non-empty string.",
    });
  }
  if (
    typeof source.source_url !== "string" ||
    !/^https?:\/\/[^\s]+$/u.test(source.source_url)
  ) {
    addDiagnostic(diagnostics, {
      ...sourceDetails,
      code: "BIB_SOURCE_URL_INVALID",
      fieldPath: `/bibliographic_sources/${index}/source_url`,
      message: "Bibliographic Source source_url must be an HTTP(S) retrieval record URL.",
    });
  }
  validateUtcTimestamp(
    source.retrieved_at,
    {
      ...sourceDetails,
      code: "BIB_SOURCE_RETRIEVED_AT_INVALID",
      fieldPath: `/bibliographic_sources/${index}/retrieved_at`,
      message: "Bibliographic Source retrieved_at must be a UTC RFC 3339 timestamp.",
    },
    diagnostics,
  );
  if (source.checksum !== undefined && source.snapshot === undefined) {
    addDiagnostic(diagnostics, {
      ...sourceDetails,
      code: "BIB_SOURCE_CHECKSUM_WITHOUT_SNAPSHOT",
      fieldPath: `/bibliographic_sources/${index}/checksum`,
      message: "A checksum requires an actually preserved source snapshot.",
    });
  }
}

function validateVersionBibliography(version, index, sourceIds, details, diagnostics) {
  if (!isObject(version)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "VERSION_INVALID_SHAPE",
      fieldPath: `/versions/${index}`,
      message: "Versions must be mappings.",
    });
    return;
  }
  const versionDetails = {
    ...details,
    recordId: version.id ?? details.recordId,
  };
  validateNamespacedId(version.id, "version", {
    ...versionDetails,
    code: "VERSION_ID_INVALID",
    fieldPath: `/versions/${index}/id`,
    message: "Version IDs must use the version: namespace.",
  }, diagnostics);
  if (!VERSION_KINDS.includes(version.kind)) {
    addDiagnostic(diagnostics, {
      ...versionDetails,
      code: "VERSION_KIND_INVALID",
      fieldPath: `/versions/${index}/kind`,
      message: "Version kind must be arxiv_revision or journal_manifestation.",
      relatedIds: VERSION_KINDS,
    });
  }
  if (typeof version.title !== "string" || version.title.trim() === "") {
    addDiagnostic(diagnostics, {
      ...versionDetails,
      code: "BIB_TITLE_INVALID",
      fieldPath: `/versions/${index}/title`,
      message: "Version title must be a non-empty string.",
    });
  }
  if (!Array.isArray(version.authors) || version.authors.length === 0) {
    addDiagnostic(diagnostics, {
      ...versionDetails,
      code: "BIB_AUTHORS_INVALID",
      fieldPath: `/versions/${index}/authors`,
      message: "Version authors must be a non-empty ordered array.",
    });
  } else {
    version.authors.forEach((author, authorIndex) => {
      if (!isObject(author) || typeof author.display_name !== "string" || author.display_name.trim() === "") {
        addDiagnostic(diagnostics, {
          ...versionDetails,
          code: "BIB_AUTHOR_DISPLAY_NAME_INVALID",
          fieldPath: `/versions/${index}/authors/${authorIndex}/display_name`,
          message: "Every Version-local author requires a non-empty display_name.",
        });
      }
      if (author?.orcid !== undefined && !isValidOrcid(author.orcid)) {
        addDiagnostic(diagnostics, {
          ...versionDetails,
          code: "BIB_ORCID_INVALID",
          fieldPath: `/versions/${index}/authors/${authorIndex}/orcid`,
          message: "ORCID must use canonical 16-digit form when supplied.",
        });
      }
    });
  }
  validateReleaseDate(version.release_date, {
    ...versionDetails,
    fieldPath: `/versions/${index}`,
  }, diagnostics);

  if (version.kind === "journal_manifestation") {
    if (typeof version.doi === "string") {
      if (version.doi.trim() !== version.doi || /^doi:/iu.test(version.doi) || version.doi !== version.doi.toLowerCase() || !DOI.test(version.doi)) {
        addDiagnostic(diagnostics, {
          ...versionDetails,
          code: "BIB_DOI_NOT_NORMALIZED",
          fieldPath: `/versions/${index}/doi`,
          message: "DOI must be lowercase, prefix-free, and free of surrounding whitespace.",
        });
      }
    } else {
      addDiagnostic(diagnostics, {
        ...versionDetails,
        code: "BIB_DOI_MISSING",
        fieldPath: `/versions/${index}/doi`,
        message: "A journal manifestation requires a DOI or an explicitly justified stable publisher identifier.",
      });
    }
  }
  if (version.access_urls !== undefined) {
    if (!Array.isArray(version.access_urls)) {
      addDiagnostic(diagnostics, {
        ...versionDetails,
        code: "BIB_ACCESS_URLS_INVALID",
        fieldPath: `/versions/${index}/access_urls`,
        message: "Version access_urls must be an array.",
      });
    } else {
      version.access_urls.forEach((link, linkIndex) => {
        if (!isObject(link) || typeof link.kind !== "string" || typeof link.url !== "string" || !/^https?:\/\/[^\s]+$/u.test(link.url)) {
          addDiagnostic(diagnostics, {
            ...versionDetails,
            code: "BIB_ACCESS_URL_INVALID",
            fieldPath: `/versions/${index}/access_urls/${linkIndex}`,
            message: "Every access URL requires a kind and HTTP(S) URL.",
          });
        }
      });
    }
  }

  if (!isObject(version.field_sources)) {
    addDiagnostic(diagnostics, {
      ...versionDetails,
      code: "BIB_FIELD_PROVENANCE_INVALID_SHAPE",
      fieldPath: `/versions/${index}/field_sources`,
      message: "Version field_sources must be a mapping of Version-relative RFC 6901 pointers.",
    });
    return;
  }
  const bibliographicFields = { ...version };
  delete bibliographicFields.id;
  delete bibliographicFields.kind;
  delete bibliographicFields.field_sources;
  const requiredPointers = collectLeafPointers(bibliographicFields);
  const sourcePointers = Object.keys(version.field_sources);
  for (const pointer of requiredPointers) {
    const sources = version.field_sources[pointer];
    if (!Array.isArray(sources) || sources.length === 0) {
      addDiagnostic(diagnostics, {
        ...versionDetails,
        code: "BIB_FIELD_PROVENANCE_MISSING",
        fieldPath: pointer,
        message: "Every stored non-derived Version bibliographic field requires source IDs.",
      });
      continue;
    }
    for (const sourceId of sources) {
      if (!sourceIds.has(sourceId)) {
        addDiagnostic(diagnostics, {
          ...versionDetails,
          code: "REFERENTIAL_BIB_SOURCE_MISSING",
          fieldPath: pointer,
          message: `Bibliographic Source does not exist: ${sourceId}.`,
          relatedIds: [sourceId],
        });
      }
    }
  }
  for (const pointer of sourcePointers) {
    const read = readPointer(bibliographicFields, pointer);
    if (!read.valid || !read.exists || isObject(read.value) || Array.isArray(read.value)) {
      addDiagnostic(diagnostics, {
        ...versionDetails,
        code: "BIB_FIELD_PROVENANCE_POINTER_INVALID",
        fieldPath: `/versions/${index}/field_sources/${pointerSegment(pointer)}`,
        message: "field_sources keys must point to an existing Version leaf field.",
      });
    }
  }
}

export function deriveBibliographicDiscrepancyState(discrepancy) {
  const events = Array.isArray(discrepancy?.resolution_events)
    ? discrepancy.resolution_events
    : [];
  const resolutionEvent = events.length > 0 ? events[events.length - 1] : null;
  return {
    status: resolutionEvent ? "resolved" : "unresolved",
    selected_value: resolutionEvent?.selected_value ?? null,
    resolution_event: resolutionEvent,
  };
}

function stableValueKey(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableValueKey(item)).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValueKey(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateBibliographicDiscrepancies(
  versionsEnvelope,
  versionsById,
  sourceIds,
  actorsById,
  work,
  details,
  diagnostics,
) {
  const discrepancies = versionsEnvelope.bibliographic_discrepancies;
  if (discrepancies === undefined) {
    return;
  }
  if (!Array.isArray(discrepancies)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "BIB_DISCREPANCIES_INVALID_SHAPE",
      fieldPath: "/bibliographic_discrepancies",
      message: "Bibliographic discrepancies must be an array.",
    });
    return;
  }
  const discrepancyIds = new Set();
  discrepancies.forEach((discrepancy, index) => {
    if (!isObject(discrepancy)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "BIB_DISCREPANCY_INVALID_SHAPE",
        fieldPath: `/bibliographic_discrepancies/${index}`,
        message: "Bibliographic discrepancies must be mappings.",
      });
      return;
    }
    const discrepancyDetails = {
      ...details,
      recordId: discrepancy.id ?? details.recordId,
    };
    validateNamespacedId(discrepancy.id, "discrepancy", {
      ...discrepancyDetails,
      code: "BIB_DISCREPANCY_ID_INVALID",
      fieldPath: `/bibliographic_discrepancies/${index}/id`,
      message: "Bibliographic Discrepancy IDs must use the discrepancy: namespace.",
    }, diagnostics);
    if (discrepancyIds.has(discrepancy.id)) {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "BIB_DISCREPANCY_ID_DUPLICATE",
        fieldPath: `/bibliographic_discrepancies/${index}/id`,
        message: `Bibliographic Discrepancy ID is duplicated: ${discrepancy.id}.`,
      });
    }
    discrepancyIds.add(discrepancy.id);
    if (!versionsById.has(discrepancy.version_id)) {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "REFERENTIAL_VERSION_MISSING",
        fieldPath: `/bibliographic_discrepancies/${index}/version_id`,
        message: `Discrepancy Version does not exist: ${discrepancy.version_id}.`,
        relatedIds: [discrepancy.version_id],
      });
    }
    const targetVersion = versionsById.get(discrepancy.version_id);
    if (targetVersion && (typeof discrepancy.field_path !== "string" || !readPointer(targetVersion, discrepancy.field_path).exists)) {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "BIB_DISCREPANCY_FIELD_INVALID",
        fieldPath: `/bibliographic_discrepancies/${index}/field_path`,
        message: "Discrepancy field_path must point to a field on the affected Version.",
      });
    }
    const declaredSourceIds = discrepancy.conflicting_source_ids;
    const declaredSourceSet = new Set();
    if (!Array.isArray(declaredSourceIds) || declaredSourceIds.length < 2) {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "BIB_DISCREPANCY_SOURCES_INVALID",
        fieldPath: `/bibliographic_discrepancies/${index}/conflicting_source_ids`,
        message: "A discrepancy must preserve at least two conflicting source IDs.",
      });
    } else {
      for (const [sourceIndex, sourceId] of declaredSourceIds.entries()) {
        if (declaredSourceSet.has(sourceId)) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "BIB_DISCREPANCY_SOURCES_DUPLICATE",
            fieldPath: `/bibliographic_discrepancies/${index}/conflicting_source_ids/${sourceIndex}`,
            message: `A discrepancy cannot declare a conflicting source more than once: ${sourceId}.`,
            relatedIds: [sourceId],
          });
        }
        declaredSourceSet.add(sourceId);
        if (!sourceIds.has(sourceId)) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "REFERENTIAL_BIB_SOURCE_MISSING",
            fieldPath: `/bibliographic_discrepancies/${index}/conflicting_source_ids`,
            message: `Bibliographic Source does not exist: ${sourceId}.`,
            relatedIds: [sourceId],
          });
        }
      }
    }
    const conflictingValues = discrepancy.conflicting_values;
    if (!Array.isArray(conflictingValues) || conflictingValues.length < 2) {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "BIB_DISCREPANCY_VALUES_INVALID",
        fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values`,
        message: "A discrepancy must preserve the conflicting values with their source IDs.",
      });
    } else {
      if (
        Array.isArray(declaredSourceIds) &&
        conflictingValues.length !== declaredSourceIds.length
      ) {
        addDiagnostic(diagnostics, {
          ...discrepancyDetails,
          code: "BIB_DISCREPANCY_VALUE_SOURCE_MISMATCH",
          fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values`,
          message: "A discrepancy requires exactly one conflicting value for each declared source.",
          relatedIds: declaredSourceIds,
        });
      }
      const valueSourceSet = new Set();
      const valueKeys = new Set();
      for (const [valueIndex, conflict] of conflictingValues.entries()) {
        if (!isObject(conflict) || typeof conflict.source_id !== "string" || !Object.hasOwn(conflict, "value")) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "BIB_DISCREPANCY_VALUE_INVALID",
            fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values/${valueIndex}`,
            message: "Each conflicting value requires source_id and value.",
          });
          continue;
        }
        if (!sourceIds.has(conflict.source_id)) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "REFERENTIAL_BIB_SOURCE_MISSING",
            fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values/${valueIndex}/source_id`,
            message: `Bibliographic Source does not exist: ${conflict.source_id}.`,
            relatedIds: [conflict.source_id],
          });
        }
        if (!declaredSourceSet.has(conflict.source_id)) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "BIB_DISCREPANCY_VALUE_SOURCE_MISMATCH",
            fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values/${valueIndex}/source_id`,
            message: `Conflicting value source is not one of the declared conflicting sources: ${conflict.source_id}.`,
            relatedIds: declaredSourceIds ?? [],
          });
        }
        if (valueSourceSet.has(conflict.source_id)) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "BIB_DISCREPANCY_VALUE_SOURCE_DUPLICATE",
            fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values/${valueIndex}/source_id`,
            message: `A discrepancy cannot assign multiple conflicting values to source ${conflict.source_id}.`,
            relatedIds: [conflict.source_id],
          });
        }
        valueSourceSet.add(conflict.source_id);
        const valueKey = stableValueKey(conflict.value);
        if (valueKeys.has(valueKey)) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "BIB_DISCREPANCY_VALUES_NOT_DISTINCT",
            fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values/${valueIndex}/value`,
            message: "A discrepancy must preserve at least two distinct conflicting values.",
          });
        }
        valueKeys.add(valueKey);
      }
      for (const sourceId of declaredSourceSet) {
        if (!valueSourceSet.has(sourceId)) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "BIB_DISCREPANCY_VALUE_SOURCE_MISMATCH",
            fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values`,
            message: `A conflicting value is missing for declared source ${sourceId}.`,
            relatedIds: [sourceId],
          });
        }
      }
    }
    if (Object.hasOwn(discrepancy, "current_value") || Object.hasOwn(discrepancy, "current_state")) {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "BIB_DISCREPANCY_DERIVED_STATE_STORED",
        fieldPath: `/bibliographic_discrepancies/${index}`,
        message: "Current discrepancy state is derived from resolution_events and must not be stored.",
      });
    }
    if (!Array.isArray(discrepancy.resolution_events)) {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "BIB_DISCREPANCY_RESOLUTION_HISTORY_INVALID",
        fieldPath: `/bibliographic_discrepancies/${index}/resolution_events`,
        message: "Discrepancy resolution history must be an array.",
      });
    } else {
      discrepancy.resolution_events.forEach((event, eventIndex) => {
        if (!isObject(event) || typeof event.reason !== "string" || event.reason.trim() === "" || !Object.hasOwn(event, "selected_value")) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "BIB_DISCREPANCY_RESOLUTION_INVALID",
            fieldPath: `/bibliographic_discrepancies/${index}/resolution_events/${eventIndex}`,
            message: "Each resolution event requires selected_value and a normalized reason.",
          });
          return;
        }
        validateCurationProvenance(
          event.provenance,
          actorsById,
          {
            ...discrepancyDetails,
            fieldPath: `/bibliographic_discrepancies/${index}/resolution_events/${eventIndex}/provenance`,
          },
          diagnostics,
          { requiredActorKind: "human" },
        );
      });
    }
    const state = deriveBibliographicDiscrepancyState(discrepancy);
    if (work.reader_state === "visible" && discrepancy.reader_relevant === true && state.status === "unresolved") {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "BIB_DISCREPANCY_BLOCKS_VISIBILITY",
        fieldPath: `/bibliographic_discrepancies/${index}/resolution_events`,
        message: "An unresolved reader-relevant Bibliographic Discrepancy blocks Work visibility.",
      });
    }
  });
}

function extractWorkReadingFrontmatter(reading) {
  if (typeof reading !== "string" || !reading.startsWith("---")) {
    return null;
  }
  const match = reading.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) {
    return null;
  }
  try {
    return parseYaml(match[1]);
  } catch {
    return null;
  }
}

function validateEvidenceLocator(locator, details, diagnostics) {
  if (!isObject(locator)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "EVIDENCE_LOCATOR_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/locator`,
      message: "Evidence requires a typed locator mapping.",
    });
    return false;
  }
  let valid = true;
  if (!LOCATOR_TYPES.includes(locator.type)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "EVIDENCE_LOCATOR_TYPE_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/locator/type`,
      message: "Evidence locator type is not supported.",
      relatedIds: LOCATOR_TYPES,
    });
    valid = false;
  }
  if (!Number.isInteger(locator.page) || locator.page <= 0) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "EVIDENCE_LOCATOR_PAGE_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/locator/page`,
      message: "Evidence locators require a positive integer page.",
    });
    valid = false;
  }
  const componentByType = {
    section: "section",
    equation: "equation",
    table: "table",
    figure: "figure",
    paragraph: "paragraph",
  };
  const component = componentByType[locator.type];
  if (component && (typeof locator[component] !== "string" || locator[component].trim() === "")) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "EVIDENCE_LOCATOR_COMPONENT_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/locator/${component}`,
      message: `A ${locator.type} locator requires a non-empty ${component} component.`,
    });
    valid = false;
  }
  return valid;
}

function validateEvidenceRecords(work, versionsById, actorsById, diagnostics) {
  const evidenceEnvelope = work.files["evidence.yaml"];
  const file = `content/works/${work.id}/evidence.yaml`;
  const evidenceById = new Map();
  if (!isObject(evidenceEnvelope) || !Array.isArray(evidenceEnvelope.evidence)) {
    return evidenceById;
  }
  for (const [index, evidence] of evidenceEnvelope.evidence.entries()) {
    if (!isObject(evidence)) {
      addDiagnostic(diagnostics, {
        code: "EVIDENCE_INVALID_SHAPE",
        file,
        recordId: work.id,
        fieldPath: `/evidence/${index}`,
        message: "Evidence records must be mappings.",
      });
      continue;
    }
    const details = {
      file,
      recordId: evidence.id ?? work.id,
      fieldPath: `/evidence/${index}`,
    };
    if (!validateNamespacedId(evidence.id, "evidence", {
      ...details,
      code: "EVIDENCE_ID_INVALID",
      fieldPath: `${details.fieldPath}/id`,
      message: "Evidence IDs must use the evidence: namespace.",
    }, diagnostics)) {
      continue;
    }
    if (evidenceById.has(evidence.id)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "EVIDENCE_ID_DUPLICATE",
        fieldPath: `${details.fieldPath}/id`,
        message: `Evidence ID is duplicated: ${evidence.id}.`,
      });
    }
    evidenceById.set(evidence.id, evidence);
    if (!versionsById.has(evidence.version_id)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "REFERENTIAL_VERSION_MISSING",
        fieldPath: `${details.fieldPath}/version_id`,
        message: `Evidence Version does not exist: ${evidence.version_id}.`,
        relatedIds: [evidence.version_id],
      });
    }
    if (
      typeof evidence.source_url !== "string" ||
      !/^https?:\/\/[^\s]+$/u.test(evidence.source_url)
    ) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "EVIDENCE_SOURCE_REFERENCE_INVALID",
        fieldPath: `${details.fieldPath}/source_url`,
        message: "Evidence requires a stable HTTP(S) source reference.",
      });
    }
    validateEvidenceLocator(evidence.locator, details, diagnostics);
    if (typeof evidence.excerpt !== "string" || evidence.excerpt.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "EVIDENCE_EXCERPT_INVALID",
        fieldPath: `${details.fieldPath}/excerpt`,
        message: "Evidence requires a short non-empty excerpt for verification.",
      });
    }
    if (evidence.checksum !== undefined && evidence.snapshot === undefined) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "EVIDENCE_CHECKSUM_WITHOUT_SNAPSHOT",
        fieldPath: `${details.fieldPath}/checksum`,
        message: "An Evidence checksum requires an actually preserved source snapshot.",
      });
    }
    validateGovernedRecord(evidence, actorsById, details, diagnostics);
  }
  return evidenceById;
}

function validateEvidenceReferences(
  evidenceIds,
  evidenceById,
  details,
  diagnostics,
  { required = false } = {},
) {
  if (!Array.isArray(evidenceIds)) {
    if (required || evidenceIds !== undefined) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "EVIDENCE_REFERENCES_INVALID",
        fieldPath: `${details.fieldPath ?? ""}/evidence_ids`,
        message: "evidence_ids must be an array of Evidence IDs.",
      });
      return false;
    }
    return true;
  }
  let valid = true;
  const seen = new Set();
  if (required && evidenceIds.length === 0) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "EVIDENCE_REQUIRED",
      fieldPath: `${details.fieldPath ?? ""}/evidence_ids`,
      message: "This governed record requires at least one Evidence reference.",
    });
    valid = false;
  }
  for (const [index, evidenceId] of evidenceIds.entries()) {
    if (seen.has(evidenceId)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "EVIDENCE_REFERENCE_DUPLICATE",
        fieldPath: `${details.fieldPath ?? ""}/evidence_ids/${index}`,
        message: `An Evidence ID cannot be referenced more than once: ${evidenceId}.`,
        relatedIds: [evidenceId],
      });
      valid = false;
    }
    seen.add(evidenceId);
    if (!evidenceById.has(evidenceId)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "REFERENTIAL_EVIDENCE_MISSING",
        fieldPath: `${details.fieldPath ?? ""}/evidence_ids/${index}`,
        message: `Evidence does not exist: ${evidenceId}.`,
        relatedIds: [evidenceId],
      });
      valid = false;
    }
  }
  return valid;
}

function normalizeStatementText(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : value ?? null;
}

function statementSemanticDigest(statement) {
  const attestations = Array.isArray(statement.attestations)
    ? statement.attestations
      .map((attestation) => ({
        version_id: attestation?.version_id ?? null,
        evidence_ids: Array.isArray(attestation?.evidence_ids)
          ? [...attestation.evidence_ids].sort()
          : attestation?.evidence_ids ?? null,
      }))
      .sort((left, right) => {
        const leftKey = JSON.stringify(left);
        const rightKey = JSON.stringify(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      })
    : statement.attestations ?? null;
  const semanticProjection = {
    kind: statement.kind ?? null,
    basis: statement.basis ?? null,
    lifecycle: statement.lifecycle ?? null,
    canonical_text: normalizeStatementText(statement.canonical_text),
    reason: normalizeStatementText(statement.reason),
    attestations,
  };
  return createHash("sha256")
    .update(JSON.stringify(semanticProjection), "utf8")
    .digest("hex");
}

function validateStatementReviewBinding(statement, details, diagnostics) {
  if (statement.review_state !== "reviewed") {
    return true;
  }
  const binding = statement.review_binding;
  if (!isObject(binding)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "STATEMENT_REVIEW_BINDING_REQUIRED",
      fieldPath: `${details.fieldPath}/review_binding`,
      message: "A reviewed Scientific Statement requires a semantic review binding.",
    });
    return false;
  }
  let valid = true;
  if (binding.canonicalization_version !== CANONICALIZATION_VERSION) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "STATEMENT_REVIEW_BINDING_VERSION_INVALID",
      fieldPath: `${details.fieldPath}/review_binding/canonicalization_version`,
      message: "Statement review binding uses an unsupported canonicalization version.",
      relatedIds: [CANONICALIZATION_VERSION],
    });
    valid = false;
  }
  const expectedDigest = statementSemanticDigest(statement);
  if (binding.semantic_digest !== expectedDigest) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "STATEMENT_REVIEW_BINDING_STALE",
      fieldPath: `${details.fieldPath}/review_binding`,
      message: "Reviewed Scientific Statement semantic fields no longer match its review binding.",
    });
    valid = false;
  }
  return valid;
}

function validateStatements(
  work,
  versionsById,
  evidenceById,
  actorsById,
  diagnostics,
) {
  const file = `content/works/${work.id}/statements.yaml`;
  const envelope = work.files["statements.yaml"];
  if (!isObject(envelope) || !Array.isArray(envelope.statements)) {
    return;
  }

  const seenIds = new Set();
  for (const [index, statement] of envelope.statements.entries()) {
    const details = {
      file,
      recordId: statement?.id ?? work.id,
      fieldPath: `/statements/${index}`,
    };
    if (!isObject(statement)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_INVALID_SHAPE",
        message: "Scientific Statements must be mappings.",
      });
      continue;
    }

    validateNamespacedId(statement.id, "statement", {
      ...details,
      code: "STATEMENT_ID_INVALID",
      fieldPath: `${details.fieldPath}/id`,
      message: "Scientific Statement IDs must use the statement: namespace.",
    }, diagnostics);
    if (seenIds.has(statement.id)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_ID_DUPLICATE",
        fieldPath: `${details.fieldPath}/id`,
        message: `Scientific Statement ID is duplicated: ${statement.id}.`,
      });
    }
    seenIds.add(statement.id);

    if (!STATEMENT_KINDS.includes(statement.kind)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_KIND_INVALID",
        fieldPath: `${details.fieldPath}/kind`,
        message: "Scientific Statement kind must be assumption, claim, prediction, or result.",
        relatedIds: STATEMENT_KINDS,
      });
    }
    if (!ASSERTION_BASES.includes(statement.basis)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_BASIS_INVALID",
        fieldPath: `${details.fieldPath}/basis`,
        message: "Scientific Statement basis must be explicit or inferred.",
        relatedIds: ASSERTION_BASES,
      });
    }
    if (!STATEMENT_LIFECYCLES.includes(statement.lifecycle)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_LIFECYCLE_INVALID",
        fieldPath: `${details.fieldPath}/lifecycle`,
        message: "Scientific Statement lifecycle must be maintained, superseded, or withdrawn.",
        relatedIds: STATEMENT_LIFECYCLES,
      });
    }
    if (typeof statement.canonical_text !== "string" || statement.canonical_text.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_CANONICAL_TEXT_INVALID",
        fieldPath: `${details.fieldPath}/canonical_text`,
        message: "Scientific Statements require a non-empty canonical semantic paraphrase.",
      });
    }
    if (statement.basis === "inferred" &&
      (typeof statement.reason !== "string" || statement.reason.trim() === "")) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_INFERRED_REASON_REQUIRED",
        fieldPath: `${details.fieldPath}/reason`,
        message: "Inferred Scientific Statements require a normalized reason.",
      });
    } else if (statement.reason !== undefined &&
      (typeof statement.reason !== "string" || statement.reason.trim() === "")) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_REASON_INVALID",
        fieldPath: `${details.fieldPath}/reason`,
        message: "A Scientific Statement reason must be a non-empty string when supplied.",
      });
    }

    const attestations = statement.attestations;
    if (!Array.isArray(attestations)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_ATTESTATIONS_INVALID",
        fieldPath: `${details.fieldPath}/attestations`,
        message: "Scientific Statements require an attestations array.",
      });
    } else if (attestations.length === 0) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "STATEMENT_ATTESTATIONS_REQUIRED",
        fieldPath: `${details.fieldPath}/attestations`,
        message: "Scientific Statements require at least one Version attestation.",
      });
    } else {
      for (const [attestationIndex, attestation] of attestations.entries()) {
        const attestationDetails = {
          ...details,
          fieldPath: `${details.fieldPath}/attestations/${attestationIndex}`,
        };
        if (!isObject(attestation)) {
          addDiagnostic(diagnostics, {
            ...attestationDetails,
            code: "STATEMENT_ATTESTATION_INVALID_SHAPE",
            message: "Statement Attestations must be mappings.",
          });
          continue;
        }

        const versionId = attestation.version_id;
        if (typeof versionId !== "string" || !versionsById.has(versionId)) {
          addDiagnostic(diagnostics, {
            ...attestationDetails,
            code: "STATEMENT_ATTESTATION_VERSION_MISMATCH",
            fieldPath: `${attestationDetails.fieldPath}/version_id`,
            message: "Statement Attestations must reference an existing Version from the same Work.",
            relatedIds: [...versionsById.keys()],
          });
        }

        const evidenceIds = attestation.evidence_ids;
        validateEvidenceReferences(
          evidenceIds,
          evidenceById,
          attestationDetails,
          diagnostics,
          { required: true },
        );

        if (Array.isArray(evidenceIds)) {
          for (const [evidenceIndex, evidenceId] of evidenceIds.entries()) {
            const evidence = evidenceById.get(evidenceId);
            if (!evidence) {
              continue;
            }
            if (versionsById.has(versionId) && evidence.version_id !== versionId) {
              addDiagnostic(diagnostics, {
                ...attestationDetails,
                code: "STATEMENT_ATTESTATION_EVIDENCE_VERSION_MISMATCH",
                fieldPath: `${attestationDetails.fieldPath}/evidence_ids/${evidenceIndex}`,
                message: "Statement Attestation Evidence must reference the attestation Version.",
                relatedIds: [evidenceId, versionId, evidence.version_id],
              });
            }
            if (typeof statement.canonical_text === "string" &&
              typeof evidence.excerpt === "string" &&
              normalizeStatementText(statement.canonical_text) === normalizeStatementText(evidence.excerpt)) {
              addDiagnostic(diagnostics, {
                ...details,
                code: "STATEMENT_CANONICAL_TEXT_EXCERPT_COLLISION",
                fieldPath: `${details.fieldPath}/canonical_text`,
                message: "Scientific Statement canonical_text must be a semantic paraphrase rather than an Evidence excerpt.",
                relatedIds: [evidenceId],
              });
            }
          }
        }
      }
    }

    validateGovernedRecord(
      statement,
      actorsById,
      details,
      diagnostics,
      { independentReview: statement.basis === "inferred" },
    );
    validateStatementReviewBinding(statement, details, diagnostics);
  }
}

function causalLinkSemanticDigest(link) {
  const semanticProjection = {
    source_stage_id: link.source_stage_id ?? null,
    target_stage_id: link.target_stage_id ?? null,
    relation: link.relation ?? null,
    origin: link.origin ?? null,
    interpretive_risk: link.interpretive_risk ?? null,
    reason: normalizeStatementText(link.reason),
    evidence_ids: Array.isArray(link.evidence_ids)
      ? [...link.evidence_ids].sort()
      : link.evidence_ids ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(semanticProjection), "utf8")
    .digest("hex");
}

function validateCausalLinkReviewBinding(link, details, diagnostics) {
  if (link.review_state !== "reviewed") {
    return true;
  }
  const binding = link.review_binding;
  if (!isObject(binding)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "CAUSAL_LINK_REVIEW_BINDING_REQUIRED",
      fieldPath: `${details.fieldPath}/review_binding`,
      message: "A reviewed Causal Link requires a semantic review binding.",
    });
    return false;
  }
  let valid = true;
  if (binding.canonicalization_version !== CANONICALIZATION_VERSION) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "CAUSAL_LINK_REVIEW_BINDING_VERSION_INVALID",
      fieldPath: `${details.fieldPath}/review_binding/canonicalization_version`,
      message: "Causal Link review binding uses an unsupported canonicalization version.",
      relatedIds: [CANONICALIZATION_VERSION],
    });
    valid = false;
  }
  const expectedDigest = causalLinkSemanticDigest(link);
  if (binding.semantic_digest !== expectedDigest) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "CAUSAL_LINK_REVIEW_BINDING_STALE",
      fieldPath: `${details.fieldPath}/review_binding`,
      message: "Reviewed Causal Link semantic fields no longer match its review binding.",
    });
    valid = false;
  }
  return valid;
}

function validatePhysicalAccount(
  work,
  versionsById,
  evidenceById,
  actorsById,
  diagnostics,
  annotationState = { available: true, annotationIds: new Set() },
) {
  const file = `content/works/${work.id}/physical-account.yaml`;
  const envelope = work.files["physical-account.yaml"];
  if (!isObject(envelope)) {
    return;
  }

  const annotationIds = annotationState.annotationIds ?? new Set();
  let topologyAvailable = annotationState.available !== false;
  const stageIds = new Set();
  const validStageIds = new Set();
  const duplicateStageIds = new Set();
  const stages = envelope.stages;
  if (!Array.isArray(stages)) {
    addDiagnostic(diagnostics, {
      file,
      recordId: work.id,
      code: "CAUSAL_STAGE_COLLECTION_INVALID",
      fieldPath: "/stages",
      message: "physical-account.yaml must contain a stages array.",
    });
    topologyAvailable = false;
  } else {
    for (const [index, stage] of stages.entries()) {
      const details = {
        file,
        recordId: stage?.id ?? work.id,
        fieldPath: `/stages/${index}`,
      };
      if (!isObject(stage)) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "CAUSAL_STAGE_INVALID_SHAPE",
          message: "Causal Stages must be mappings.",
        });
        topologyAvailable = false;
        continue;
      }

      let valid = validateNamespacedId(stage.id, "stage", {
        ...details,
        code: "CAUSAL_STAGE_ID_INVALID",
        fieldPath: `${details.fieldPath}/id`,
        message: "Causal Stage IDs must use the stage: namespace.",
      }, diagnostics);
      if (!valid) {
        topologyAvailable = false;
      }
      if (stageIds.has(stage.id)) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "CAUSAL_STAGE_ID_DUPLICATE",
          fieldPath: `${details.fieldPath}/id`,
          message: `Causal Stage ID is duplicated: ${stage.id}.`,
        });
        duplicateStageIds.add(stage.id);
        validStageIds.delete(stage.id);
        valid = false;
        topologyAvailable = false;
      }
      stageIds.add(stage.id);
      if (
        annotationState.available !== false &&
        (typeof stage.annotation_id !== "string" || !annotationIds.has(stage.annotation_id))
      ) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "REFERENTIAL_CAUSAL_ANNOTATION_MISSING",
          fieldPath: `${details.fieldPath}/annotation_id`,
          message: `Causal Stage Annotation does not exist in this Work: ${stage.annotation_id}.`,
          relatedIds: [stage.annotation_id],
        });
        valid = false;
      }
      if (valid && !duplicateStageIds.has(stage.id)) {
        validStageIds.add(stage.id);
      }
    }
  }

  const links = envelope.links;
  if (!Array.isArray(links)) {
    addDiagnostic(diagnostics, {
      file,
      recordId: work.id,
      code: "CAUSAL_LINK_COLLECTION_INVALID",
      fieldPath: "/links",
      message: "physical-account.yaml must contain a links array.",
    });
    return;
  }

  const seenLinkIds = new Set();
  const dagLinks = [];
  for (const [index, link] of links.entries()) {
    const details = {
      file,
      recordId: link?.id ?? work.id,
      fieldPath: `/links/${index}`,
    };
    if (!isObject(link)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "CAUSAL_LINK_INVALID_SHAPE",
        message: "Causal Links must be mappings.",
      });
      continue;
    }

    let valid = validateNamespacedId(link.id, "causal-link", {
      ...details,
      code: "CAUSAL_LINK_ID_INVALID",
      fieldPath: `${details.fieldPath}/id`,
      message: "Causal Link IDs must use the causal-link: namespace.",
    }, diagnostics);
    let dagEligible = valid;
    if (seenLinkIds.has(link.id)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "CAUSAL_LINK_ID_DUPLICATE",
        fieldPath: `${details.fieldPath}/id`,
        message: `Causal Link ID is duplicated: ${link.id}.`,
      });
      valid = false;
      dagEligible = false;
    }
    seenLinkIds.add(link.id);

    if (!CAUSAL_LINK_RELATIONS.includes(link.relation)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "CAUSAL_LINK_RELATION_INVALID",
        fieldPath: `${details.fieldPath}/relation`,
        message: "Causal Link relation is not in the frozen vocabulary.",
        relatedIds: CAUSAL_LINK_RELATIONS,
      });
      valid = false;
      dagEligible = false;
    }
    if (!ASSERTION_BASES.includes(link.origin)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "CAUSAL_LINK_ORIGIN_INVALID",
        fieldPath: `${details.fieldPath}/origin`,
        message: "Causal Link origin must be explicit or inferred.",
        relatedIds: ASSERTION_BASES,
      });
      valid = false;
      dagEligible = false;
    }
    if (!RISK_LEVELS.includes(link.interpretive_risk)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "CAUSAL_LINK_RISK_INVALID",
        fieldPath: `${details.fieldPath}/interpretive_risk`,
        message: "Causal Link Interpretive Risk must be descriptive, interpretive, or synthetic.",
        relatedIds: RISK_LEVELS,
      });
      valid = false;
      dagEligible = false;
    }
    if (typeof link.reason !== "string" || link.reason.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "CAUSAL_LINK_REASON_REQUIRED",
        fieldPath: `${details.fieldPath}/reason`,
        message: "Causal Links require a non-empty normalized reason.",
      });
      valid = false;
      dagEligible = false;
    }

    let sourceExists = false;
    let targetExists = false;
    if (topologyAvailable) {
      sourceExists = typeof link.source_stage_id === "string"
        && validStageIds.has(link.source_stage_id);
      targetExists = typeof link.target_stage_id === "string"
        && validStageIds.has(link.target_stage_id);
      if (!sourceExists) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "REFERENTIAL_CAUSAL_STAGE_MISSING",
          fieldPath: `${details.fieldPath}/source_stage_id`,
          message: `Causal Link source Stage does not exist in this Work: ${link.source_stage_id}.`,
          relatedIds: [link.source_stage_id],
        });
        valid = false;
        dagEligible = false;
      }
      if (!targetExists) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "REFERENTIAL_CAUSAL_STAGE_MISSING",
          fieldPath: `${details.fieldPath}/target_stage_id`,
          message: `Causal Link target Stage does not exist in this Work: ${link.target_stage_id}.`,
          relatedIds: [link.target_stage_id],
        });
        valid = false;
        dagEligible = false;
      }
    }
    if (
      typeof link.source_stage_id === "string" &&
      typeof link.target_stage_id === "string" &&
      link.source_stage_id === link.target_stage_id
    ) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "CAUSAL_LINK_SELF_LOOP",
        message: "A Causal Link cannot point from a Stage to itself.",
        relatedIds: [link.source_stage_id],
      });
      valid = false;
      dagEligible = false;
    }

    const evidenceValid = validateEvidenceReferences(
      link.evidence_ids,
      evidenceById,
      details,
      diagnostics,
      { required: true },
    );
    if (!evidenceValid) {
      valid = false;
    }
    if (Array.isArray(link.evidence_ids)) {
      for (const [evidenceIndex, evidenceId] of link.evidence_ids.entries()) {
        const evidence = evidenceById.get(evidenceId);
        if (evidence && !versionsById.has(evidence.version_id)) {
          addDiagnostic(diagnostics, {
            ...details,
            code: "CAUSAL_LINK_EVIDENCE_VERSION_MISMATCH",
            fieldPath: `${details.fieldPath}/evidence_ids/${evidenceIndex}`,
            message: "Causal Link Evidence must belong to a Version from this Work.",
            relatedIds: [evidenceId, evidence.version_id],
          });
          valid = false;
        }
      }
    }

    if (link.origin === "explicit" && link.interpretive_risk === "descriptive") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "CAUSAL_LINK_EXPLICIT_DESCRIPTIVE_FORBIDDEN",
        fieldPath: `${details.fieldPath}/interpretive_risk`,
        message: "Explicit Causal Links require at least interpretive risk.",
      });
      valid = false;
    }
    if (link.origin === "inferred") {
      if (link.interpretive_risk === "descriptive") {
        addDiagnostic(diagnostics, {
          ...details,
          code: "CAUSAL_LINK_INFERRED_DESCRIPTIVE_FORBIDDEN",
          fieldPath: `${details.fieldPath}/interpretive_risk`,
          message: "Inferred Causal Links may not use descriptive risk.",
        });
        valid = false;
      }
      if (!Array.isArray(link.evidence_ids) || link.evidence_ids.length < 2) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "CAUSAL_LINK_MULTIPLE_EVIDENCE_REQUIRED",
          fieldPath: `${details.fieldPath}/evidence_ids`,
          message: "Inferred Causal Links require multiple Evidence records.",
        });
        valid = false;
      }
    }

    if (!validateGovernedRecord(
      link,
      actorsById,
      details,
      diagnostics,
      { independentReview: link.origin === "inferred" },
    )) {
      valid = false;
    }
    if (!validateCausalLinkReviewBinding(link, details, diagnostics)) {
      valid = false;
    }

    // Structural and endpoint failures are quarantined from the DAG pass.
    // Review/governance failures keep their diagnostics but do not mask a
    // topological cycle in otherwise well-formed stage endpoints.
    if (topologyAvailable && dagEligible && sourceExists && targetExists) {
      dagLinks.push({ source: link.source_stage_id, target: link.target_stage_id });
    }
  }

  const adjacency = new Map([...validStageIds].map((stageId) => [stageId, []]));
  for (const { source, target } of dagLinks) {
    adjacency.get(source)?.push(target);
  }
  const visiting = new Set();
  const visited = new Set();
  function hasCycle(stageId) {
    if (visiting.has(stageId)) {
      return true;
    }
    if (visited.has(stageId)) {
      return false;
    }
    visiting.add(stageId);
    for (const target of adjacency.get(stageId) ?? []) {
      if (hasCycle(target)) {
        return true;
      }
    }
    visiting.delete(stageId);
    visited.add(stageId);
    return false;
  }
  if ([...adjacency.keys()].some(hasCycle)) {
    addDiagnostic(diagnostics, {
      file,
      recordId: work.id,
      code: "CAUSAL_ACCOUNT_CYCLE",
      fieldPath: "/links",
      message: "The Work-local Physical Account must be acyclic.",
    });
  }
}

function validatePhysicsAnnotations(
  work,
  axisById,
  termsById,
  evidenceById,
  actorsById,
  diagnostics,
) {
  const file = `content/works/${work.id}/annotations.yaml`;
  const envelope = work.files["annotations.yaml"];
  if (!isObject(envelope) || !Array.isArray(envelope.annotations)) {
    return { available: false, annotationIds: new Set() };
  }
  let structurallyAvailable = true;
  const seenIds = new Set();
  const seenAxes = new Set();
  for (const [index, annotation] of envelope.annotations.entries()) {
    if (!isObject(annotation)) {
      addDiagnostic(diagnostics, {
        code: "ANNOTATION_INVALID_SHAPE",
        file,
        recordId: work.id,
        fieldPath: `/annotations/${index}`,
        message: "Physics Annotations must be mappings.",
      });
      structurallyAvailable = false;
      continue;
    }
    const details = {
      file,
      recordId: annotation.id ?? work.id,
      fieldPath: `/annotations/${index}`,
    };
    if (!validateNamespacedId(annotation.id, "annotation", {
      ...details,
      code: "ANNOTATION_ID_INVALID",
      fieldPath: `${details.fieldPath}/id`,
      message: "Annotation IDs must use the annotation: namespace.",
    }, diagnostics)) {
      structurallyAvailable = false;
      continue;
    }
    if (seenIds.has(annotation.id)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "ANNOTATION_ID_DUPLICATE",
        fieldPath: `${details.fieldPath}/id`,
        message: `Annotation ID is duplicated: ${annotation.id}.`,
      });
      structurallyAvailable = false;
    }
    seenIds.add(annotation.id);
    const axis = axisById.get(annotation.axis);
    if (!axis) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "REFERENTIAL_AXIS_MISSING",
        fieldPath: `${details.fieldPath}/axis`,
        message: `Physics Ontology axis does not exist: ${annotation.axis}.`,
        relatedIds: [annotation.axis],
      });
    }
    if (seenAxes.has(annotation.axis)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "ANNOTATION_AXIS_DUPLICATE",
        fieldPath: `${details.fieldPath}/axis`,
        message: `A Work may have only one assessment for axis ${annotation.axis}.`,
        relatedIds: [annotation.axis],
      });
    }
    seenAxes.add(annotation.axis);
    const assessment = annotation.assessment;
    if (!isObject(assessment) || !ASSESSMENT_STATES.includes(assessment.state)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "ANNOTATION_ASSESSMENT_INVALID",
        fieldPath: `${details.fieldPath}/assessment/state`,
        message: "Annotation assessment requires one of the four explicit states.",
        relatedIds: ASSESSMENT_STATES,
      });
      structurallyAvailable = false;
    } else {
      if (!Array.isArray(assessment.values)) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "ANNOTATION_VALUES_INVALID",
          fieldPath: `${details.fieldPath}/assessment/values`,
          message: "Annotation assessment values must be an array.",
        });
        structurallyAvailable = false;
      } else {
        if (assessment.state === "present" && assessment.values.length === 0) {
          addDiagnostic(diagnostics, {
            ...details,
            code: "ANNOTATION_VALUES_REQUIRED",
            fieldPath: `${details.fieldPath}/assessment/values`,
            message: "A present assessment requires one or more values.",
          });
        }
        if (assessment.state !== "present" && assessment.values.length > 0) {
          addDiagnostic(diagnostics, {
            ...details,
            code: "ANNOTATION_VALUES_FORBIDDEN",
            fieldPath: `${details.fieldPath}/assessment/values`,
            message: "Only a present assessment may carry values.",
          });
        }
        const valueIds = new Set();
        for (const [valueIndex, value] of assessment.values.entries()) {
          const termId = isObject(value) ? value.term_id : undefined;
          if (typeof termId !== "string") {
            addDiagnostic(diagnostics, {
              ...details,
              code: "ANNOTATION_VALUE_INVALID",
              fieldPath: `${details.fieldPath}/assessment/values/${valueIndex}`,
              message: "Each Annotation value requires a term_id.",
            });
            structurallyAvailable = false;
            continue;
          }
          if (valueIds.has(termId)) {
            addDiagnostic(diagnostics, {
              ...details,
              code: "ANNOTATION_VALUE_DUPLICATE",
              fieldPath: `${details.fieldPath}/assessment/values/${valueIndex}/term_id`,
              message: `An Annotation cannot repeat a term: ${termId}.`,
              relatedIds: [termId],
            });
          }
          valueIds.add(termId);
          const termEntry = termsById.get(termId);
          if (!termEntry) {
            addDiagnostic(diagnostics, {
              ...details,
              code: "REFERENTIAL_TERM_MISSING",
              fieldPath: `${details.fieldPath}/assessment/values/${valueIndex}/term_id`,
              message: `Controlled Term does not exist: ${termId}.`,
              relatedIds: [termId],
            });
          } else {
            if (termEntry.category !== "physics" || termEntry.axisId !== annotation.axis) {
              addDiagnostic(diagnostics, {
                ...details,
                code: "ANNOTATION_TERM_AXIS_MISMATCH",
                fieldPath: `${details.fieldPath}/assessment/values/${valueIndex}/term_id`,
                message: "An Annotation value must reference a term defined on its axis.",
                relatedIds: [termId, annotation.axis],
              });
            }
            if (termEntry.term.status === "proposed") {
              addDiagnostic(diagnostics, {
                ...details,
                code: "ANNOTATION_TERM_NOT_ACTIVE",
                fieldPath: `${details.fieldPath}/assessment/values/${valueIndex}/term_id`,
                message: "Current Physics Annotations cannot reference proposed terms.",
                relatedIds: [termId],
              });
            } else if (referenceWasCreatedAfterDeprecation(annotation, termEntry.term)) {
              addDiagnostic(diagnostics, {
                ...details,
                code: "ANNOTATION_TERM_DEPRECATED_FOR_NEW_ASSIGNMENT",
                fieldPath: `${details.fieldPath}/assessment/values/${valueIndex}/term_id`,
                message: "Deprecated Physics terms may be retained only by historical assignments created before deprecation.",
                relatedIds: [termId],
              });
            }
          }
        }
      }
    }
    const defaultRisk = axis?.default_risk;
    const risk = annotation.interpretive_risk ?? defaultRisk;
    if (!RISK_LEVELS.includes(risk)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "ANNOTATION_RISK_INVALID",
        fieldPath: `${details.fieldPath}/interpretive_risk`,
        message: "Annotation Interpretive Risk must be descriptive, interpretive, or synthetic.",
        relatedIds: RISK_LEVELS,
      });
    } else if (defaultRisk && RISK_ORDER[risk] < RISK_ORDER[defaultRisk]) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "ANNOTATION_RISK_DOWNGRADE_FORBIDDEN",
        fieldPath: `${details.fieldPath}/interpretive_risk`,
        message: "An Annotation may not downgrade its axis default Interpretive Risk.",
        relatedIds: [defaultRisk],
      });
    } else if (defaultRisk && RISK_ORDER[risk] > RISK_ORDER[defaultRisk]) {
      if (!isObject(annotation.risk_escalation) || typeof annotation.risk_escalation.reason !== "string" || annotation.risk_escalation.reason.trim() === "") {
        addDiagnostic(diagnostics, {
          ...details,
          code: "ANNOTATION_RISK_ESCALATION_REASON_REQUIRED",
          fieldPath: `${details.fieldPath}/risk_escalation/reason`,
          message: "An escalated Annotation risk requires a normalized reason.",
        });
      }
    } else if (annotation.risk_escalation !== undefined) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "ANNOTATION_RISK_ESCALATION_UNEXPECTED",
        fieldPath: `${details.fieldPath}/risk_escalation`,
        message: "Risk escalation metadata is allowed only above the axis default.",
      });
    }
    const evidenceIds = annotation.evidence_ids;
    if (risk === "interpretive") {
      const reason = annotation.reason ?? annotation.risk_escalation?.reason;
      if (typeof reason !== "string" || reason.trim() === "") {
        addDiagnostic(diagnostics, {
          ...details,
          code: "ANNOTATION_REASON_REQUIRED",
          fieldPath: `${details.fieldPath}/reason`,
          message: "Interpretive Annotations require a normalized reason.",
        });
      }
      validateEvidenceReferences(evidenceIds, evidenceById, details, diagnostics, { required: true });
    } else if (risk === "synthetic") {
      if (typeof annotation.reason !== "string" || annotation.reason.trim() === "") {
        addDiagnostic(diagnostics, {
          ...details,
          code: "ANNOTATION_REASON_REQUIRED",
          fieldPath: `${details.fieldPath}/reason`,
          message: "Synthetic Annotations require a normalized reason.",
        });
      }
      if (!Array.isArray(evidenceIds) || evidenceIds.length < 2) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "ANNOTATION_MULTIPLE_EVIDENCE_REQUIRED",
          fieldPath: `${details.fieldPath}/evidence_ids`,
          message: "Synthetic Annotations require multiple Evidence records.",
        });
      }
      validateEvidenceReferences(evidenceIds, evidenceById, details, diagnostics, { required: true });
    } else {
      validateEvidenceReferences(evidenceIds, evidenceById, details, diagnostics);
    }
    validateGovernedRecord(
      annotation,
      actorsById,
      details,
      diagnostics,
      { independentReview: risk === "synthetic" },
    );
  }
  if (work.id === "work:arnett-1982") {
    for (const axisId of AXIS_IDS) {
      if (!seenAxes.has(axisId)) {
        addDiagnostic(diagnostics, {
          file,
          recordId: work.id,
          code: "ANNOTATION_AXIS_COVERAGE_INCOMPLETE",
          fieldPath: "/annotations",
          message: `Arnett fixture requires an assessment for axis ${axisId}.`,
          relatedIds: [axisId],
        });
      }
    }
    for (const annotation of envelope.annotations) {
      if (annotation?.assessment?.state === "not_assessed") {
        addDiagnostic(diagnostics, {
          file,
          recordId: annotation.id ?? work.id,
          code: "ANNOTATION_NOT_ASSESSED_FORBIDDEN",
          fieldPath: "/assessment/state",
          message: "The V0.1 fixture profile forbids not_assessed Physics axes.",
        });
      }
    }
  }
  return { available: structurallyAvailable, annotationIds: seenIds };
}

function validateMethodAnnotations(
  work,
  termsById,
  evidenceById,
  actorsById,
  diagnostics,
) {
  const file = `content/works/${work.id}/annotations.yaml`;
  const envelope = work.files["annotations.yaml"];
  if (!isObject(envelope) || !Array.isArray(envelope.method_annotations)) {
    return;
  }
  let reviewedActiveTechnique = false;
  for (const [index, annotation] of envelope.method_annotations.entries()) {
    const details = {
      file,
      recordId: annotation?.id ?? work.id,
      fieldPath: `/method_annotations/${index}`,
    };
    if (!isObject(annotation)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "METHOD_ANNOTATION_INVALID_SHAPE",
        message: "Method Annotations must be mappings.",
      });
      continue;
    }
    validateNamespacedId(annotation.id, "annotation", {
      ...details,
      code: "METHOD_ANNOTATION_ID_INVALID",
      fieldPath: `${details.fieldPath}/id`,
      message: "Method Annotation IDs must use the annotation: namespace.",
    }, diagnostics);
    if (annotation.interpretive_risk !== undefined) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "METHOD_ANNOTATION_RISK_FORBIDDEN",
        fieldPath: `${details.fieldPath}/interpretive_risk`,
        message: "Method Annotations do not carry Physics Interpretive Risk.",
      });
    }
    if (!ASSERTION_BASES.includes(annotation.basis)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "METHOD_ANNOTATION_BASIS_INVALID",
        fieldPath: `${details.fieldPath}/basis`,
        message: "Method Annotation basis must be explicit or inferred.",
        relatedIds: ASSERTION_BASES,
      });
    }
    const technique = termsById.get(annotation.technique_id);
    if (!technique || technique.category !== "technique") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "REFERENTIAL_TECHNIQUE_MISSING",
        fieldPath: `${details.fieldPath}/technique_id`,
        message: `Canonical Technique does not exist: ${annotation.technique_id}.`,
        relatedIds: [annotation.technique_id],
      });
    } else if (technique.term.status === "proposed") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "METHOD_TECHNIQUE_NOT_ACTIVE",
        fieldPath: `${details.fieldPath}/technique_id`,
        message: "Method Annotations must reference active Canonical Techniques.",
        relatedIds: [annotation.technique_id],
      });
    } else if (referenceWasCreatedAfterDeprecation(annotation, technique.term)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "METHOD_TECHNIQUE_DEPRECATED_FOR_NEW_ASSIGNMENT",
        fieldPath: `${details.fieldPath}/technique_id`,
        message: "Deprecated Techniques may be retained only by historical Method Annotations created before deprecation.",
        relatedIds: [annotation.technique_id],
      });
    }
    validateEvidenceReferences(annotation.evidence_ids, evidenceById, details, diagnostics, { required: true });
    if (annotation.basis === "inferred" && (typeof annotation.reason !== "string" || annotation.reason.trim() === "")) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "METHOD_INFERRED_REASON_REQUIRED",
        fieldPath: `${details.fieldPath}/reason`,
        message: "Inferred Method Annotations require a normalized reason.",
      });
    }
    validateGovernedRecord(
      annotation,
      actorsById,
      details,
      diagnostics,
      { independentReview: annotation.basis === "inferred" },
    );
    validateMethodReviewBinding(annotation, details, diagnostics);
    if (annotation.review_state === "reviewed" && technique?.term.status === "active") {
      reviewedActiveTechnique = true;
    }
  }
  if (work.id === "work:arnett-1982" && !reviewedActiveTechnique) {
    addDiagnostic(diagnostics, {
      file,
      recordId: work.id,
      code: "METHOD_REVIEWED_TECHNIQUE_REQUIRED",
      fieldPath: "/method_annotations",
      message: "Arnett requires a reviewed Method Annotation to an active technique.",
    });
  }
}

const WORK_CONCERN_COLLECTIONS = Object.freeze([
  ["evidence.yaml", "evidence"],
  ["annotations.yaml", "annotations"],
  ["annotations.yaml", "method_annotations"],
  ["statements.yaml", "statements"],
  ["physical-account.yaml", "stages"],
  ["physical-account.yaml", "links"],
]);

function validateWorkRecords(
  snapshot,
  actorsById,
  axisById,
  termsById,
  diagnostics,
) {
  for (const work of snapshot.works) {
    const workFile = `content/works/${work.id}/work.yaml`;
    const workRecord = work.files["work.yaml"];
    if (!isObject(workRecord) || hasParseDiagnostic(diagnostics, workFile)) {
      continue;
    }
    const details = { file: workFile, recordId: work.id };
    if (!validateNamespacedId(workRecord.work_id, "work", {
      ...details,
      code: "WORK_ID_INVALID",
      fieldPath: "/work_id",
      message: "Work IDs must use the work: namespace.",
    }, diagnostics)) {
      // Keep the ownership comparison below independent of ID syntax so that a
      // typo in a valid-looking ID still has one actionable diagnostic.
    }
    if (workRecord.work_id !== work.id) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "WORK_ID_DIRECTORY_MISMATCH",
        fieldPath: "/work_id",
        message: "work.yaml work_id must match its bundle directory ID.",
        relatedIds: [work.id],
      });
    }
    if (!READER_STATES.includes(workRecord.reader_state)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "WORK_READER_STATE_INVALID",
        fieldPath: "/reader_state",
        message: "Work reader_state must be draft or visible.",
        relatedIds: READER_STATES,
      });
    }

    for (const fileName of [
      "versions.yaml",
      "evidence.yaml",
      "annotations.yaml",
      "statements.yaml",
      "physical-account.yaml",
    ]) {
      const value = work.files[fileName];
      const file = `content/works/${work.id}/${fileName}`;
      if (hasParseDiagnostic(diagnostics, file)) {
        continue;
      }
      if (!isObject(value)) {
        continue;
      }
      if (value.work_id !== work.id) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "WORK_CONCERN_OWNERSHIP_MISMATCH",
          file,
          fieldPath: "/work_id",
          message: `${fileName} work_id must match its Work bundle directory.`,
          relatedIds: [work.id],
        });
      }
    }
    const reading = work.files["reading.md"];
    const frontmatter = extractWorkReadingFrontmatter(reading);
    if (!frontmatter || !isObject(frontmatter)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "WORK_READING_FRONTMATTER_INVALID",
        file: `content/works/${work.id}/reading.md`,
        fieldPath: "/work_id",
        message: "Work reading.md must begin with YAML frontmatter containing work_id.",
      });
    } else if (frontmatter.work_id !== work.id) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "WORK_READING_OWNERSHIP_MISMATCH",
        file: `content/works/${work.id}/reading.md`,
        fieldPath: "/work_id",
        message: "reading.md frontmatter work_id must match its Work bundle directory.",
        relatedIds: [work.id],
      });
    }
    if (typeof reading === "string" && reading.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "WORK_READING_EMPTY",
        file: `content/works/${work.id}/reading.md`,
        fieldPath: null,
        message: "Work reading.md must contain reader-facing prose.",
      });
    }

    const versionsEnvelope = work.files["versions.yaml"];
    if (!isObject(versionsEnvelope) || hasParseDiagnostic(diagnostics, `content/works/${work.id}/versions.yaml`)) {
      continue;
    }
    if (!Array.isArray(versionsEnvelope.versions)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "VERSION_COLLECTION_INVALID",
        file: `content/works/${work.id}/versions.yaml`,
        fieldPath: "/versions",
        message: "versions.yaml must contain a versions array.",
      });
      continue;
    }
    if (versionsEnvelope.versions.length === 0) {
      if (Object.hasOwn(workRecord, "preferred_version")) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "WORK_PREFERRED_VERSION_WITHOUT_VERSIONS",
          file: workFile,
          fieldPath: "/preferred_version",
          message: "A Preferred Version cannot be selected when no Versions exist.",
        });
      }
    }
    const versionsById = new Map();
    for (const [index, version] of versionsEnvelope.versions.entries()) {
      if (isObject(version) && typeof version.id === "string") {
        if (versionsById.has(version.id)) {
          addDiagnostic(diagnostics, {
            ...details,
            code: "VERSION_ID_DUPLICATE",
            file: `content/works/${work.id}/versions.yaml`,
            recordId: version.id,
            fieldPath: `/versions/${index}/id`,
            message: `Version ID is duplicated: ${version.id}.`,
          });
        }
        versionsById.set(version.id, version);
      }
    }
    const sources = versionsEnvelope.bibliographic_sources;
    if (!Array.isArray(sources)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "BIB_SOURCE_COLLECTION_INVALID",
        file: `content/works/${work.id}/versions.yaml`,
        fieldPath: "/bibliographic_sources",
        message: "versions.yaml must contain a bibliographic_sources array.",
      });
    }
    const sourceIds = new Set();
    for (const [index, source] of (sources ?? []).entries()) {
      validateBibliographicSource(
        source,
        index,
        sourceIds,
        {
          ...details,
          file: `content/works/${work.id}/versions.yaml`,
        },
        diagnostics,
      );
    }
    for (const [index, version] of versionsEnvelope.versions.entries()) {
      validateVersionBibliography(
        version,
        index,
        sourceIds,
        {
          ...details,
          file: `content/works/${work.id}/versions.yaml`,
        },
        diagnostics,
      );
    }

    if (!isObject(workRecord.preferred_version)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "WORK_PREFERRED_VERSION_INVALID",
        fieldPath: "/preferred_version",
        message: "A Work with Versions requires a Preferred Version mapping.",
      });
    } else {
      const preferred = workRecord.preferred_version;
      if (!versionsById.has(preferred.version_id)) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "REFERENTIAL_PREFERRED_VERSION_MISSING",
          fieldPath: "/preferred_version/version_id",
          message: `Preferred Version does not exist: ${preferred.version_id}.`,
          relatedIds: [preferred.version_id],
        });
      }
      if (typeof preferred.reason !== "string" || preferred.reason.trim() === "") {
        addDiagnostic(diagnostics, {
          ...details,
          code: "WORK_PREFERRED_VERSION_REASON_INVALID",
          fieldPath: "/preferred_version/reason",
          message: "Preferred Version selection requires a non-empty reason.",
        });
      }
      validateCurationProvenance(
        preferred.curation_provenance,
        actorsById,
        {
          ...details,
          fieldPath: "/preferred_version/curation_provenance",
        },
        diagnostics,
      );
    }
    validateBibliographicDiscrepancies(
      versionsEnvelope,
      versionsById,
      sourceIds,
      actorsById,
      workRecord,
      {
        ...details,
        file: `content/works/${work.id}/versions.yaml`,
      },
      diagnostics,
    );

    const evidenceById = validateEvidenceRecords(
      work,
      versionsById,
      actorsById,
      diagnostics,
    );
    const physicsAnnotationState = validatePhysicsAnnotations(
      work,
      axisById,
      termsById,
      evidenceById,
      actorsById,
      diagnostics,
    );
    validateMethodAnnotations(
      work,
      termsById,
      evidenceById,
      actorsById,
      diagnostics,
    );
    validateStatements(
      work,
      versionsById,
      evidenceById,
      actorsById,
      diagnostics,
    );
    validatePhysicalAccount(
      work,
      versionsById,
      evidenceById,
      actorsById,
      diagnostics,
      physicsAnnotationState,
    );

    for (const [fileName, field] of WORK_CONCERN_COLLECTIONS) {
      const value = work.files[fileName];
      if (!isObject(value) || !Array.isArray(value[field])) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "STRUCTURE_WORK_COLLECTION_INVALID",
          file: `content/works/${work.id}/${fileName}`,
          fieldPath: `/${field}`,
          message: `${fileName} must contain an explicit ${field} array.`,
        });
      }
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
  const isReferential = ({ code = "" }) => code.startsWith("REFERENTIAL_");
  const structural = diagnostics.some(isStructuralDiagnostic);
  const referential = diagnostics.some(isReferential);
  const semantic = diagnostics.some(
    (item) => !isStructuralDiagnostic(item) && !isReferential(item),
  );
  return {
    structural: {
      status: structural ? "partial" : "complete",
      diagnostic_count: diagnostics.filter(isStructuralDiagnostic).length,
    },
    referential: {
      status: structural ? "skipped" : referential ? "partial" : "complete",
      diagnostic_count: diagnostics.filter(isReferential).length,
    },
    semantic: {
      status: structural ? "skipped" : semantic ? "partial" : "complete",
      diagnostic_count: diagnostics.filter(
        (item) => !isStructuralDiagnostic(item) && !isReferential(item),
      ).length,
    },
    discovery: {
      status: hasStructuralFailure(discovery.diagnostics) ? "partial" : "complete",
      file_count: discovery.files.length,
      diagnostic_count: discovery.diagnostics.length,
    },
  };
}

function scientificAccountEvidenceIds(work) {
  const evidenceIds = new Set();
  const statements = work.files["statements.yaml"]?.statements;
  if (Array.isArray(statements)) {
    for (const statement of statements) {
      const attestations = Array.isArray(statement?.attestations)
        ? statement.attestations
        : [];
      for (const attestation of attestations) {
        const attestationEvidenceIds = Array.isArray(attestation?.evidence_ids)
          ? attestation.evidence_ids
          : [];
        for (const evidenceId of attestationEvidenceIds) {
          evidenceIds.add(evidenceId);
        }
      }
    }
  }
  const links = work.files["physical-account.yaml"]?.links;
  if (Array.isArray(links)) {
    for (const link of links) {
      for (const evidenceId of link?.evidence_ids ?? []) {
        evidenceIds.add(evidenceId);
      }
    }
  }
  return evidenceIds;
}

function resolveScientificAccountEvidence(evidenceIds, evidenceById) {
  const ids = [...new Set(Array.isArray(evidenceIds) ? evidenceIds : [])];
  return {
    evidence_ids: ids,
    evidence: ids.map((evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return {
        id: evidenceId,
        evidence_id: evidenceId,
        version_id: evidence?.version_id ?? null,
        source_url: evidence?.source_url ?? null,
        locator: evidence?.locator ?? null,
      };
    }),
  };
}

function scientificAccountInspection(work, validationStatus) {
  const evidenceEnvelope = work.files["evidence.yaml"];
  const evidenceById = new Map(
    (Array.isArray(evidenceEnvelope?.evidence) ? evidenceEnvelope.evidence : [])
      .filter((evidence) => isObject(evidence) && typeof evidence.id === "string")
      .map((evidence) => [evidence.id, evidence]),
  );
  const statements = Array.isArray(work.files["statements.yaml"]?.statements)
    ? work.files["statements.yaml"].statements
    : [];
  const account = work.files["physical-account.yaml"];
  const stages = Array.isArray(account?.stages) ? account.stages : [];
  const links = Array.isArray(account?.links) ? account.links : [];
  return {
    work_id: work.id,
    validation_status: validationStatus,
    statements: statements.filter(isObject).map((statement) => ({
      id: statement.id ?? null,
      kind: statement.kind ?? null,
      basis: statement.basis ?? null,
      lifecycle: statement.lifecycle ?? null,
      canonical_text: statement.canonical_text ?? null,
      reason: statement.reason ?? null,
      review_state: statement.review_state ?? null,
      curation_provenance: statement.curation_provenance ?? null,
      review_provenance: statement.review_provenance ?? null,
      attestations: Array.isArray(statement.attestations)
        ? statement.attestations.map((attestation) => ({
          version_id: attestation?.version_id ?? null,
          evidence_ids: Array.isArray(attestation?.evidence_ids)
            ? [...attestation.evidence_ids]
            : [],
        }))
        : [],
      ...resolveScientificAccountEvidence(
        (Array.isArray(statement.attestations) ? statement.attestations : [])
          .flatMap((attestation) =>
            Array.isArray(attestation?.evidence_ids) ? attestation.evidence_ids : []),
        evidenceById,
      ),
    })),
    stages: stages.filter(isObject).map((stage) => ({
      id: stage.id ?? null,
      annotation_id: stage.annotation_id ?? null,
      label: stage.label ?? null,
    })),
    links: links.filter(isObject).map((link) => ({
      id: link.id ?? null,
      relation: link.relation ?? null,
      origin: link.origin ?? null,
      interpretive_risk: link.interpretive_risk ?? null,
      reason: link.reason ?? null,
      review_state: link.review_state ?? null,
      curation_provenance: link.curation_provenance ?? null,
      review_provenance: link.review_provenance ?? null,
      source_stage_id: link.source_stage_id ?? null,
      target_stage_id: link.target_stage_id ?? null,
      ...resolveScientificAccountEvidence(link.evidence_ids, evidenceById),
    })),
  };
}

function scientificAccountDependencyError(work, diagnostics) {
  const workPath = `content/works/${work.id}`;
  const evidenceIds = scientificAccountEvidenceIds(work);
  const annotationIds = new Set(
    (Array.isArray(work.files["physical-account.yaml"]?.stages)
      ? work.files["physical-account.yaml"].stages
      : [])
      .filter(isObject)
      .map((stage) => stage.annotation_id),
  );
  return diagnostics.some(({ file, record_id, severity }) => {
    if (severity !== "error") {
      return false;
    }
    if (file === `${workPath}/evidence.yaml`) {
      return record_id === work.id || evidenceIds.has(record_id);
    }
    if (file === `${workPath}/annotations.yaml`) {
      return record_id === work.id || annotationIds.has(record_id);
    }
    return false;
  });
}

function deriveWorkInventory(snapshot, diagnostics, { actorRegistryValid = true } = {}) {
  return [...snapshot.works]
    .sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)))
    .map((work) => {
      const workPath = `content/works/${work.id}`;
      const statements = work.files["statements.yaml"]?.statements;
      const account = work.files["physical-account.yaml"];
      const workDiagnostics = diagnostics.filter(
        ({ file, record_id }) =>
          file === workPath ||
          file?.startsWith(`${workPath}/`) ||
          record_id === work.id,
      );
      const scientificAccountDiagnostics = diagnostics.filter(
        ({ file }) =>
          file === `${workPath}/statements.yaml` ||
          file === `${workPath}/physical-account.yaml`,
      );
      const hasGovernedScientificAccountRecords =
        (Array.isArray(statements) && statements.length > 0) ||
        (Array.isArray(account?.links) && account.links.length > 0);
      return {
        work_id: work.id,
        reader_state: work.files["work.yaml"]?.reader_state ?? null,
        validation_status: workDiagnostics.some(({ severity }) => severity === "error")
          ? "invalid"
          : "valid",
        scientific_statements: Array.isArray(statements) ? statements.length : 0,
        causal_stages: Array.isArray(account?.stages) ? account.stages.length : 0,
        causal_links: Array.isArray(account?.links) ? account.links.length : 0,
        scientific_account_validation_status: scientificAccountDiagnostics.some(
          ({ severity }) => severity === "error",
        ) || scientificAccountDependencyError(work, diagnostics) ||
          (actorRegistryValid === false && hasGovernedScientificAccountRecords)
          ? "invalid"
          : "valid",
      };
    });
}

export async function validateCanonicalContent(
  contentRoot = CONTENT_ROOT,
) {
  const snapshot = await loadCanonicalContent(contentRoot);
  const diagnostics = [...snapshot.discovery.diagnostics];
  const actorRegistryValid = !hasParseDiagnostic(diagnostics, "content/actors.yaml")
    && validateActors(snapshot.actors, diagnostics);
  const actorsById = actorRegistryValid ? actorMap(snapshot.actors) : null;
  let controlledTermEntries = [];
  if (!hasParseDiagnostic(diagnostics, "content/manifest.yaml")) {
    validateManifest(snapshot.manifest, diagnostics);
  }
  if (!hasStructuralFailure(snapshot.discovery.diagnostics)) {
    controlledTermEntries.push(...validateAxes(snapshot.axes, actorsById, diagnostics));
    controlledTermEntries.push(...validateMethods(snapshot.methods, actorsById, diagnostics));
    const controlledTermIds = new Set();
    const duplicateControlledTermIds = new Set();
    for (const entry of controlledTermEntries) {
      if (controlledTermIds.has(entry.term.id) && !duplicateControlledTermIds.has(entry.term.id)) {
        addDiagnostic(diagnostics, {
          code: "TERM_ID_DUPLICATE",
          file: entry.file,
          recordId: entry.term.id,
          fieldPath: "/id",
          message: `Controlled Term ID is duplicated across canonical vocabularies: ${entry.term.id}.`,
        });
        duplicateControlledTermIds.add(entry.term.id);
      }
      controlledTermIds.add(entry.term.id);
    }
    const axisById = new Map(
      snapshot.axes
        .filter(({ value }) => isObject(value) && typeof value.id === "string")
        .map(({ id, value }) => [id, value]),
    );
    const termsById = new Map();
    for (const entry of controlledTermEntries) {
      if (!termsById.has(entry.term.id)) {
        termsById.set(entry.term.id, entry);
      }
    }
    validateWorkRecords(snapshot, actorsById, axisById, termsById, diagnostics);
  }
  validateRecordEnvelopes(snapshot, diagnostics);

  const canonicalContentDigest = await computeCanonicalContentDigest(snapshot.discovery.root);
  const manifest = snapshot.manifest;
  const workInventory = deriveWorkInventory(snapshot, diagnostics, { actorRegistryValid });
  const accountStatusByWorkId = new Map(
    workInventory.map((work) => [work.work_id, work.scientific_account_validation_status]),
  );
  const report = {
    dataset: "production",
    valid: isValidationValid(diagnostics),
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
      scientific_statements: snapshot.works.reduce(
        (count, work) => count + (
          Array.isArray(work.files["statements.yaml"]?.statements)
            ? work.files["statements.yaml"].statements.length
            : 0
        ),
        0,
      ),
      causal_stages: snapshot.works.reduce(
        (count, work) => count + (
          Array.isArray(work.files["physical-account.yaml"]?.stages)
            ? work.files["physical-account.yaml"].stages.length
            : 0
        ),
        0,
      ),
      causal_links: snapshot.works.reduce(
        (count, work) => count + (
          Array.isArray(work.files["physical-account.yaml"]?.links)
            ? work.files["physical-account.yaml"].links.length
            : 0
        ),
        0,
      ),
    },
    scientific_accounts: snapshot.works.map((work) =>
      scientificAccountInspection(work, accountStatusByWorkId.get(work.id) ?? "invalid")),
    work_inventory: workInventory,
    diagnostics,
  };
  return report;
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function scientificAccountEvidenceCell(evidence) {
  return (evidence ?? [])
    .map((item) => {
      const evidenceId = item.id ?? item.evidence_id ?? "";
      const versionId = item.version_id ?? "unavailable";
      const sourceUrl = item.source_url ?? "unavailable";
      const locator = item.locator && typeof item.locator === "object"
        ? Object.entries(item.locator)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")
        : "locator=unavailable";
      return `${evidenceId} (${versionId}; ${locator}; source_url=${sourceUrl})`;
    })
    .join("; ");
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
  lines.push(
    "",
    "## Work Inventory",
    "",
    "| Work ID | Reader State | Validation | Statements | Stages | Links | Scientific Account |",
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
  );
  for (const work of report.work_inventory ?? []) {
    lines.push(
      `| ${markdownCell(work.work_id)} | ${markdownCell(work.reader_state)} | ${markdownCell(work.validation_status)} | ${markdownCell(work.scientific_statements)} | ${markdownCell(work.causal_stages)} | ${markdownCell(work.causal_links)} | ${markdownCell(work.scientific_account_validation_status)} |`,
    );
  }
  lines.push(
    "",
    "## Scientific Account Provenance",
    "",
    "### Statements",
    "",
    "| Work ID | Statement ID | Kind | Basis | Lifecycle | Review | Canonical Text | Evidence (Version / Locator / Source) | Reason | Curation Actor | Curation Time | Review Actor | Review Time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const account of report.scientific_accounts ?? []) {
    for (const statement of account.statements ?? []) {
      lines.push(
        `| ${markdownCell(account.work_id)} | ${markdownCell(statement.id)} | ${markdownCell(statement.kind)} | ${markdownCell(statement.basis)} | ${markdownCell(statement.lifecycle)} | ${markdownCell(statement.review_state)} | ${markdownCell(statement.canonical_text)} | ${markdownCell(scientificAccountEvidenceCell(statement.evidence))} | ${markdownCell(statement.reason)} | ${markdownCell(statement.curation_provenance?.actor_id)} | ${markdownCell(statement.curation_provenance?.recorded_at)} | ${markdownCell(statement.review_provenance?.actor_id)} | ${markdownCell(statement.review_provenance?.recorded_at)} |`,
      );
    }
  }
  lines.push(
    "",
    "### Causal Stages",
    "",
    "| Work ID | Stage ID | Annotation ID | Label |",
    "| --- | --- | --- | --- |",
  );
  for (const account of report.scientific_accounts ?? []) {
    for (const stage of account.stages ?? []) {
      lines.push(
        `| ${markdownCell(account.work_id)} | ${markdownCell(stage.id)} | ${markdownCell(stage.annotation_id)} | ${markdownCell(stage.label)} |`,
      );
    }
  }
  lines.push(
    "",
    "### Causal Links",
    "",
    "| Work ID | Causal Link ID | Relation | Origin | Interpretive Risk | Source Stage | Target Stage | Review | Evidence (Version / Locator / Source) | Reason | Curation Actor | Curation Time | Review Actor | Review Time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const account of report.scientific_accounts ?? []) {
    for (const link of account.links ?? []) {
      lines.push(
        `| ${markdownCell(account.work_id)} | ${markdownCell(link.id)} | ${markdownCell(link.relation)} | ${markdownCell(link.origin)} | ${markdownCell(link.interpretive_risk)} | ${markdownCell(link.source_stage_id)} | ${markdownCell(link.target_stage_id)} | ${markdownCell(link.review_state)} | ${markdownCell(scientificAccountEvidenceCell(link.evidence))} | ${markdownCell(link.reason)} | ${markdownCell(link.curation_provenance?.actor_id)} | ${markdownCell(link.curation_provenance?.recorded_at)} | ${markdownCell(link.review_provenance?.actor_id)} | ${markdownCell(link.review_provenance?.recorded_at)} |`,
      );
    }
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
  additionalDiagnostics = [],
} = {}) {
  const report = mergeValidationDiagnostics(
    await validateCanonicalContent(contentRoot),
    additionalDiagnostics,
  );
  await writeValidationReports(report, outputRoot);
  return report;
}
