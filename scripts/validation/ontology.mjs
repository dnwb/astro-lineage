import { createDiagnostic as makeDiagnostic } from "../diagnostic.mjs";
import {
  AXIS_IDS,
  AXIS_QUESTIONS,
  VALID_CANONICALIZATION_VERSIONS,
  VALID_SCHEMA_VERSIONS,
  VALID_VISIBILITY_PROFILE_IDS,
} from "../content-loader.mjs";

export const VALIDATOR_VERSION = "v0.1";

const MANIFEST_FIELDS = Object.freeze([
  "schema_version",
  "canonicalization_version",
  "visibility_profile_id",
]);

export const RISK_LEVELS = Object.freeze(["descriptive", "interpretive", "synthetic"]);

export const BIBLIOGRAPHIC_PROVIDERS = Object.freeze(["ads", "arxiv", "crossref", "publisher"]);

export const VERSION_KINDS = Object.freeze(["arxiv_revision", "journal_manifestation"]);

export const PUBLICATION_RELATIONS = Object.freeze(["revises", "published_as"]);

export const PUBLICATION_RELATION_BASES = Object.freeze(["source_asserted", "curator_matched"]);

export const READER_STATES = Object.freeze(["draft", "visible"]);

const ACTOR_KINDS = Object.freeze(["human", "agent"]);

const ACTOR_CAPABILITIES = Object.freeze([
  "draft_records",
  "review_records",
  "independent_scientific_review",
  "activate_controlled_terms",
  "approve_visibility",
]);

export const ASSESSMENT_STATES = Object.freeze([
  "present",
  "unknown",
  "not_applicable",
  "not_assessed",
]);

const TERM_STATUSES = Object.freeze(["proposed", "active", "deprecated"]);

export const REVIEW_STATES = Object.freeze(["unreviewed", "reviewed"]);

export const ASSERTION_BASES = Object.freeze(["explicit", "inferred"]);

export const READING_ROLES = Object.freeze([
  "foundation",
  "review",
  "method",
  "group_lineage",
  "frontier",
  "opportunity",
]);

export const STATEMENT_KINDS = Object.freeze(["assumption", "claim", "prediction", "result"]);

export const STATEMENT_LIFECYCLES = Object.freeze(["maintained", "superseded", "withdrawn"]);

export const SCIENTIFIC_EDGE_RELATIONS = Object.freeze([
  "builds_on",
  "extends",
  "tests",
  "constrains",
  "challenges",
  "replaces_assumption",
  "corrects",
]);

export const SCIENTIFIC_EDGE_DISPOSITIONS = Object.freeze([
  "active",
  "contested",
  "superseded",
  "withdrawn",
]);

export const CAUSAL_LINK_RELATIONS = Object.freeze([
  "drives",
  "enables",
  "transforms_into",
  "produces",
  "modulates",
]);

export const ARXIV_MODERN_ID = /^\d{4}\.\d{4,5}$/u;

export const ARXIV_LEGACY_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)?\/\d{7}$/u;

const FUNCTIONAL_ROLES = Object.freeze([
  "energy_dissipation",
  "particle_interaction",
  "emission_process",
  "transport_process",
]);

export const LOCATOR_TYPES = Object.freeze([
  "page",
  "section",
  "equation",
  "table",
  "figure",
  "paragraph",
]);

export const RISK_ORDER = Object.freeze({ descriptive: 0, interpretive: 1, synthetic: 2 });

const PROCESS_AXES = Object.freeze([
  "energy_dissipation",
  "particle_interaction",
  "emission_process",
  "transport_process",
]);

export const V01_FIXTURE_WORK_IDS = new Set([
  "work:arnett-1982",
  "work:bromberg-2011",
  "work:zhu-2021",
  "work:transfit-2025",
  "work:long-yu-2026",
]);

export function resolveWorkPath(work) {
  return typeof work?.sourcePath === "string" && work.sourcePath !== ""
    ? work.sourcePath
    : `content/works/${work?.slug ?? "unknown"}`;
}

export function resolveResearchLinePath(researchLine) {
  return typeof researchLine?.sourcePath === "string" && researchLine.sourcePath !== ""
    ? researchLine.sourcePath
    : `content/research-lines/${researchLine?.slug ?? "unknown"}`;
}

export function resolveLearningPathPath(learningPath) {
  return typeof learningPath?.sourcePath === "string" && learningPath.sourcePath !== ""
    ? learningPath.sourcePath
    : `content/learning-paths/${learningPath?.slug ?? "unknown"}`;
}

export function resolveScientificEdgePath(scientificEdge) {
  return typeof scientificEdge?.sourcePath === "string" && scientificEdge.sourcePath !== ""
    ? scientificEdge.sourcePath
    : `content/scientific-edges/${scientificEdge?.slug ?? "unknown"}.yaml`;
}

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
  "BIB_ARXIV_ID_MISSING",
  "BIB_ARXIV_ID_INVALID",
  "BIB_ARXIV_ID_NOT_NORMALIZED",
  "BIB_ARXIV_REVISION_INVALID",
  "BIB_TITLE_INVALID",
  "BIB_AUTHORS_INVALID",
  "BIB_AUTHOR_DISPLAY_NAME_INVALID",
  "BIB_ORCID_INVALID",
  "BIB_DOI_MISSING",
  "BIB_DOI_NOT_NORMALIZED",
  "BIB_PUBLISHER_ID_INVALID",
  "BIB_PUBLISHER_ID_MISSING",
  "BIB_PUBLISHER_ID_REASON_INVALID",
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
  "WORK_ID_DUPLICATE",
  "WORK_ID_INVALID",
  "WORK_READER_STATE_INVALID",
  "WORK_PREFERRED_VERSION_WITHOUT_VERSIONS",
  "WORK_PREFERRED_VERSION_INVALID",
  "WORK_PREFERRED_VERSION_REASON_INVALID",
  "WORK_CONCERN_OWNERSHIP_MISMATCH",
  "WORK_READING_FRONTMATTER_INVALID",
  "WORK_READING_OWNERSHIP_MISMATCH",
  "WORK_READING_EMPTY",
  "STRUCTURE_WORK_COLLECTION_INVALID",
  // Editorial bundle identity, membership shape, and role contracts.
  "RESEARCH_LINE_INVALID_SHAPE",
  "RESEARCH_LINE_ID_DUPLICATE",
  "RESEARCH_LINE_ID_INVALID",
  "RESEARCH_LINE_READER_STATE_INVALID",
  "RESEARCH_LINE_TITLE_INVALID",
  "RESEARCH_LINE_QUESTION_INVALID",
  "RESEARCH_LINE_PHYSICAL_STRUCTURE_INVALID",
  "RESEARCH_LINE_READING_FRONTMATTER_INVALID",
  "RESEARCH_LINE_READING_OWNERSHIP_MISMATCH",
  "RESEARCH_LINE_READING_EMPTY",
  "RESEARCH_LINE_MEMBERSHIPS_INVALID",
  "RESEARCH_LINE_MEMBERSHIP_INVALID_SHAPE",
  "RESEARCH_LINE_MEMBERSHIP_ID_INVALID",
  "RESEARCH_LINE_MEMBERSHIP_ID_DUPLICATE",
  "RESEARCH_LINE_MEMBERSHIP_WORK_ID_INVALID",
  "READING_ROLE_REQUIRED",
  "READING_ROLE_INVALID",
  "READING_ROLE_DUPLICATE",
  "EDITORIAL_ANCHOR_INVALID",
  "VISIBILITY_APPROVALS_INVALID",
  "VISIBILITY_APPROVAL_INVALID_SHAPE",
  "VISIBILITY_APPROVAL_PROFILE_INVALID",
  "VISIBILITY_APPROVAL_DIGEST_INVALID",
  "VISIBILITY_APPROVAL_TIMESTAMP_INVALID",
  // Learning Path bundle identity and local shape contracts.
  "LEARNING_PATH_INVALID_SHAPE",
  "LEARNING_PATH_ID_DUPLICATE",
  "LEARNING_PATH_ID_INVALID",
  "LEARNING_PATH_READER_STATE_INVALID",
  "LEARNING_PATH_TITLE_INVALID",
  "LEARNING_PATH_READING_FRONTMATTER_INVALID",
  "LEARNING_PATH_READING_OWNERSHIP_MISMATCH",
  "LEARNING_PATH_READING_EMPTY",
  "LEARNING_PATH_ENTRIES_INVALID",
  "LEARNING_PATH_ENTRY_INVALID_SHAPE",
  "LEARNING_PATH_ENTRY_WORK_ID_INVALID",
  "LEARNING_PATH_TRANSITIONS_INVALID",
  "LEARNING_PATH_TRANSITION_INVALID_SHAPE",
  "LEARNING_PATH_TRANSITION_ENDPOINT_INVALID",
  "LEARNING_PATH_TRANSITION_REASON_REQUIRED",
  "LEARNING_PATH_TRANSITION_REASON_INVALID",
  "LEARNING_PATH_TRANSITION_REASON_NOT_NORMALIZED",
  // Publication Graph record identity and local relation shape.
  "PUBLICATION_RELATION_COLLECTION_INVALID",
  "PUBLICATION_RELATION_INVALID_SHAPE",
  "PUBLICATION_RELATION_ID_INVALID",
  "PUBLICATION_RELATION_ID_DUPLICATE",
  "PUBLICATION_RELATION_INVALID",
  "PUBLICATION_RELATION_ENDPOINT_INVALID",
  "PUBLICATION_RELATION_BASIS_INVALID",
  "PUBLICATION_RELATION_BIBLIOGRAPHIC_SOURCES_INVALID",
  "PUBLICATION_RELATION_BIBLIOGRAPHIC_SOURCE_ID_INVALID",
  "PUBLICATION_RELATION_BIBLIOGRAPHIC_SOURCE_DUPLICATE",
  // Scientific Edge record identity, shape, and controlled-value failures.
  "SCIENTIFIC_EDGE_INVALID_SHAPE",
  "SCIENTIFIC_EDGE_ID_INVALID",
  "SCIENTIFIC_EDGE_ID_DUPLICATE",
  "SCIENTIFIC_EDGE_RELATION_INVALID",
  "SCIENTIFIC_EDGE_BASIS_INVALID",
  "SCIENTIFIC_EDGE_DISPOSITION_INVALID",
  "SCIENTIFIC_EDGE_REASON_INVALID",
  "SCIENTIFIC_EDGE_EVIDENCE_INVALID",
  "SCIENTIFIC_EDGE_EVIDENCE_DUPLICATE",
  "SCIENTIFIC_EDGE_ENDPOINT_INVALID",
]);

export function isStructuralDiagnostic({ code = "" }) {
  return code.startsWith("STRUCTURE_") ||
    code.startsWith("MANIFEST_") ||
    STRUCTURAL_DIAGNOSTIC_CODES.has(code);
}

export function actorMap(actors) {
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

export const DOI = /^10\.\d{4,9}\/[\S]+$/iu;

export const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u;

const RFC3339_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

export const DATE_VALUES = Object.freeze({ year: /^\d{4}$/u, month: /^\d{4}-(?:0[1-9]|1[0-2])$/u });

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

export function addDiagnostic(diagnostics, details) {
  diagnostics.push(makeDiagnostic(details));
}

export function hasStructuralFailure(diagnostics) {
  return diagnostics.some(({ code }) => code.startsWith("STRUCTURE_"));
}

export function validateManifest(manifest, diagnostics) {
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

export function validateActors(actors, diagnostics) {
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

export function validateAxes(axes, actorsById, diagnostics) {
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

export function isNamespacedId(value, namespace) {
  return (
    typeof value === "string" &&
    NAMESPACED_ID.test(value) &&
    value.slice(0, value.indexOf(":")) === namespace
  );
}

export function validateNamespacedId(value, namespace, details, diagnostics) {
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

export function validateUtcTimestamp(value, details, diagnostics) {
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

export function validateControlledTerm(
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

export function validateTermSuccessors(terms, diagnostics) {
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

export function isValidGregorianDate(value) {
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

export function validateCurationProvenance(
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

export function requireActorCapability(
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

export function validateGovernedRecord(
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

export function hasParseDiagnostic(diagnostics, file) {
  return diagnostics.some(
    (item) => item.code === "STRUCTURE_YAML_PARSE_ERROR" && item.file === file,
  );
}
