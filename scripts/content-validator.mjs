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
import { canonicalizeYaml, computeCanonicalContentDigest } from "./content-digest.mjs";
import {
  projectLearningPathForReader,
  projectResearchLineForReader,
  projectWorkForReader,
} from "./reader-projection.mjs";

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
const PUBLICATION_RELATIONS = Object.freeze(["revises", "published_as"]);
const PUBLICATION_RELATION_BASES = Object.freeze(["source_asserted", "curator_matched"]);
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
const READING_ROLES = Object.freeze([
  "foundation",
  "review",
  "method",
  "group_lineage",
  "frontier",
  "opportunity",
]);
const STATEMENT_KINDS = Object.freeze(["assumption", "claim", "prediction", "result"]);
const STATEMENT_LIFECYCLES = Object.freeze(["maintained", "superseded", "withdrawn"]);
const SCIENTIFIC_EDGE_RELATIONS = Object.freeze([
  "builds_on",
  "extends",
  "tests",
  "constrains",
  "challenges",
  "replaces_assumption",
  "corrects",
]);
const SCIENTIFIC_EDGE_DISPOSITIONS = Object.freeze([
  "active",
  "contested",
  "superseded",
  "withdrawn",
]);
const CAUSAL_LINK_RELATIONS = Object.freeze([
  "drives",
  "enables",
  "transforms_into",
  "produces",
  "modulates",
]);
const ARXIV_MODERN_ID = /^\d{4}\.\d{4,5}$/u;
const ARXIV_LEGACY_ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)?\/\d{7}$/u;
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
const V01_FIXTURE_WORK_IDS = new Set([
  "work:arnett-1982",
  "work:bromberg-2011",
  "work:zhu-2021",
  "work:transfit-2025",
  "work:long-yu-2026",
]);

function resolveWorkPath(work) {
  return typeof work?.sourcePath === "string" && work.sourcePath !== ""
    ? work.sourcePath
    : `content/works/${work?.slug ?? "unknown"}`;
}

function resolveResearchLinePath(researchLine) {
  return typeof researchLine?.sourcePath === "string" && researchLine.sourcePath !== ""
    ? researchLine.sourcePath
    : `content/research-lines/${researchLine?.slug ?? "unknown"}`;
}

function resolveLearningPathPath(learningPath) {
  return typeof learningPath?.sourcePath === "string" && learningPath.sourcePath !== ""
    ? learningPath.sourcePath
    : `content/learning-paths/${learningPath?.slug ?? "unknown"}`;
}

function resolveScientificEdgePath(scientificEdge) {
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

export function methodAnnotationSemanticDigest(annotation) {
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

/*
 * ArXiv identity is deliberately kept separate from access URLs and the
 * immutable internal Version ID. Publication Graph identity uses only the
 * frozen canonical arxiv_id + arxiv_revision fields.
 */
function arxivIdentityDescriptor(version, index) {
  return {
    baseId: version?.arxiv_id,
    basePath: `/versions/${index}/arxiv_id`,
    revision: version?.arxiv_revision,
    revisionPath: `/versions/${index}/arxiv_revision`,
    hasBase: isObject(version) && Object.hasOwn(version, "arxiv_id"),
    hasRevision: isObject(version) && Object.hasOwn(version, "arxiv_revision"),
  };
}

function canonicalArxivBaseStatus(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "invalid";
  }
  if (
    value !== value.trim() ||
    /^arxiv:/iu.test(value) ||
    /v\d+$/iu.test(value)
  ) {
    return "not_normalized";
  }
  return ARXIV_MODERN_ID.test(value) || ARXIV_LEGACY_ID.test(value)
    ? "valid"
    : "invalid";
}

function validateArxivIdentity(version, index, details, diagnostics) {
  const identity = arxivIdentityDescriptor(version, index);
  let valid = true;
  if (!identity.hasBase) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "BIB_ARXIV_ID_MISSING",
      fieldPath: identity.basePath,
      message: "An arxiv_revision requires a canonical arXiv base identifier.",
    });
    valid = false;
  } else {
    const status = canonicalArxivBaseStatus(identity.baseId);
    if (status === "not_normalized") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "BIB_ARXIV_ID_NOT_NORMALIZED",
        fieldPath: identity.basePath,
        message: "ArXiv base identifiers must omit the arXiv prefix, revision suffix, and surrounding whitespace.",
      });
      valid = false;
    } else if (status !== "valid") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "BIB_ARXIV_ID_INVALID",
        fieldPath: identity.basePath,
        message: "ArXiv base identifier must use canonical modern or legacy form.",
      });
      valid = false;
    }
  }
  if (!identity.hasRevision || !Number.isInteger(identity.revision) || identity.revision <= 0) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "BIB_ARXIV_REVISION_INVALID",
      fieldPath: identity.revisionPath,
      message: "ArXiv revision must be a positive integer separate from the base identifier.",
    });
    valid = false;
  }
  return valid;
}

function publisherIdentityDescriptor(version) {
  const value = version?.publisher_identifier;
  return {
    value: isObject(value) ? value.value : undefined,
    valuePath: "/publisher_identifier/value",
    reason: isObject(value) ? value.reason : undefined,
    reasonPath: "/publisher_identifier/reason",
    present: isObject(version) && Object.hasOwn(version, "publisher_identifier"),
  };
}

function validatePublisherIdentity(version, index, details, diagnostics) {
  const identity = publisherIdentityDescriptor(version);
  if (!identity.present) {
    return false;
  }
  let valid = true;
  if (typeof identity.value !== "string" || identity.value.trim() === "") {
    addDiagnostic(diagnostics, {
      ...details,
      code: "BIB_PUBLISHER_ID_INVALID",
      fieldPath: `/versions/${index}${identity.valuePath}`,
      message: "A DOI-less journal manifestation requires a non-empty stable publisher identifier.",
    });
    valid = false;
  }
  if (typeof identity.reason !== "string" || identity.reason.trim() === "") {
    addDiagnostic(diagnostics, {
      ...details,
      code: "BIB_PUBLISHER_ID_REASON_INVALID",
      fieldPath: `/versions/${index}${identity.reasonPath}`,
      message: "A stable publisher identifier requires a non-empty recorded reason.",
    });
    valid = false;
  }
  return valid;
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

  if (version.kind === "arxiv_revision") {
    validateArxivIdentity(version, index, versionDetails, diagnostics);
  }
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
    } else if (!publisherIdentityDescriptor(version).present) {
      addDiagnostic(diagnostics, {
        ...versionDetails,
        code: "BIB_DOI_MISSING",
        fieldPath: `/versions/${index}/doi`,
        message: "A journal manifestation requires a DOI or an explicitly justified stable publisher identifier.",
      });
    } else {
      validatePublisherIdentity(version, index, versionDetails, diagnostics);
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

function publicationRelationSourceDescriptor(relation) {
  return {
    ids: relation?.bibliographic_source_ids,
    fieldPath: "/bibliographic_source_ids",
  };
}

function sourceCoversVersionIdentity(source, version) {
  if (!source || !isObject(version) || !isObject(version.field_sources)) {
    return false;
  }
  const identityPointers = version.kind === "arxiv_revision"
    ? ["/arxiv_id", "/arxiv_revision"]
    : typeof version.doi === "string"
      ? ["/doi"]
      : ["/publisher_identifier/value"];
  return identityPointers.every((pointer) =>
    Array.isArray(version.field_sources[pointer]) &&
    version.field_sources[pointer].includes(source.id));
}

function sourceConnectsVersions(source, sourceVersion, targetVersion) {
  if (!source || !sourceVersion || !targetVersion) {
    return false;
  }
  return sourceCoversVersionIdentity(source, sourceVersion) &&
    sourceCoversVersionIdentity(source, targetVersion);
}

function normalizedPartialDate(releaseDate) {
  if (!isObject(releaseDate) || typeof releaseDate.value !== "string") {
    return null;
  }
  const { value, precision } = releaseDate;
  if (!Object.hasOwn(DATE_VALUES, precision) && precision !== "day") {
    return null;
  }
  if (precision === "year" && !/^\d{4}$/u.test(value)) {
    return null;
  }
  if (precision === "month" && !/^\d{4}-\d{2}$/u.test(value)) {
    return null;
  }
  if (precision === "day" && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }
  if (precision === "day" && !isValidGregorianDate(value)) {
    return null;
  }
  const parts = value.split("-").map(Number);
  return {
    precision,
    year: parts[0],
    month: parts[1],
    day: parts[2],
  };
}

/*
 * Return -1 only when source is definitely before target, 1 only when it is
 * definitely after target, and 0 when the partial dates cannot be compared
 * at their shared precision.  Equal year/month values are not contradictions
 * because a partial date does not fabricate day precision.
 */
function comparePartialReleaseDates(sourceVersion, targetVersion) {
  const sourceDate = normalizedPartialDate(sourceVersion?.release_date);
  const targetDate = normalizedPartialDate(targetVersion?.release_date);
  if (!sourceDate || !targetDate) {
    return 0;
  }
  if (sourceDate.year !== targetDate.year) {
    return sourceDate.year < targetDate.year ? -1 : 1;
  }
  if (sourceDate.month !== undefined && targetDate.month !== undefined && sourceDate.month !== targetDate.month) {
    return sourceDate.month < targetDate.month ? -1 : 1;
  }
  if (sourceDate.day !== undefined && targetDate.day !== undefined && sourceDate.day !== targetDate.day) {
    return sourceDate.day < targetDate.day ? -1 : 1;
  }
  return 0;
}

function arxivIdentityValue(version) {
  const identity = arxivIdentityDescriptor(version, 0);
  if (
    !identity.hasBase ||
    canonicalArxivBaseStatus(identity.baseId) !== "valid" ||
    !identity.hasRevision ||
    !Number.isInteger(identity.revision) ||
    identity.revision <= 0
  ) {
    return null;
  }
  return {
    base_id: identity.baseId,
    revision: identity.revision,
  };
}

function normalizePublicationReason(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : value ?? null;
}

/**
 * Semantic review bindings exclude curation/review metadata and formatting
 * details.  Bibliographic source references are set-like for the binding,
 * while relation endpoint direction and relation/basis values are semantic.
 */
export function publicationRelationSemanticDigest(relation) {
  const sourceIds = publicationRelationSourceDescriptor(relation).ids;
  const semanticProjection = {
    source_version_id: relation?.source_version_id ?? null,
    target_version_id: relation?.target_version_id ?? null,
    relation: relation?.relation ?? null,
    basis: relation?.basis ?? null,
    reason: normalizePublicationReason(relation?.reason),
    bibliographic_source_ids: Array.isArray(sourceIds)
      ? [...sourceIds].sort((left, right) => Buffer.from(String(left)).compare(Buffer.from(String(right))))
      : sourceIds ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(semanticProjection), "utf8")
    .digest("hex");
}

function validatePublicationRelationReviewBinding(relation, details, diagnostics) {
  if (relation.review_state !== "reviewed") {
    return true;
  }
  const binding = relation.review_binding;
  if (!isObject(binding)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "PUBLICATION_RELATION_REVIEW_BINDING_REQUIRED",
      fieldPath: `${details.fieldPath}/review_binding`,
      message: "A reviewed Publication Relation requires a semantic review binding.",
    });
    return false;
  }
  let valid = true;
  if (binding.canonicalization_version !== CANONICALIZATION_VERSION) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "PUBLICATION_RELATION_REVIEW_BINDING_VERSION_INVALID",
      fieldPath: `${details.fieldPath}/review_binding/canonicalization_version`,
      message: "Publication Relation review binding uses an unsupported canonicalization version.",
      relatedIds: [CANONICALIZATION_VERSION],
    });
    valid = false;
  }
  const expectedDigest = publicationRelationSemanticDigest(relation);
  if (binding.semantic_digest !== expectedDigest) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "PUBLICATION_RELATION_REVIEW_BINDING_STALE",
      fieldPath: `${details.fieldPath}/review_binding/semantic_digest`,
      message: "Reviewed Publication Relation semantic fields no longer match its review binding.",
    });
    valid = false;
  }
  return valid;
}

function validatePublicationRelations(
  versionsEnvelope,
  versionsById,
  sourceIds,
  actorsById,
  details,
  diagnostics,
) {
  const relations = versionsEnvelope.publication_relations;
  if (!Array.isArray(relations)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "PUBLICATION_RELATION_COLLECTION_INVALID",
      fieldPath: "/publication_relations",
      message: "versions.yaml must contain a publication_relations array.",
    });
    return;
  }

  const sourcesById = new Map(
    (Array.isArray(versionsEnvelope.bibliographic_sources)
      ? versionsEnvelope.bibliographic_sources
      : [])
      .filter((source) => isObject(source) && typeof source.id === "string")
      .map((source) => [source.id, source]),
  );
  const versionIdCounts = new Map();
  for (const version of versionsEnvelope.versions ?? []) {
    if (isObject(version) && typeof version.id === "string") {
      versionIdCounts.set(version.id, (versionIdCounts.get(version.id) ?? 0) + 1);
    }
  }
  const seenIds = new Set();
  const revisionEdges = [];
  const incomingPublishedAs = new Map();

  for (const [index, relation] of relations.entries()) {
    const relationDetails = {
      ...details,
      recordId: relation?.id ?? details.recordId,
      fieldPath: `/publication_relations/${index}`,
    };
    if (!isObject(relation)) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "PUBLICATION_RELATION_INVALID_SHAPE",
        message: "Publication Relations must be mappings.",
      });
      continue;
    }

    let structurallyValid = true;
    if (!validateNamespacedId(relation.id, "publication-relation", {
      ...relationDetails,
      code: "PUBLICATION_RELATION_ID_INVALID",
      fieldPath: `${relationDetails.fieldPath}/id`,
      message: "Publication Relation IDs must use the publication-relation: namespace.",
    }, diagnostics)) {
      structurallyValid = false;
    }
    if (seenIds.has(relation.id)) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "PUBLICATION_RELATION_ID_DUPLICATE",
        fieldPath: `${relationDetails.fieldPath}/id`,
        message: `Publication Relation ID is duplicated: ${relation.id}.`,
      });
      structurallyValid = false;
    }
    seenIds.add(relation.id);

    if (!PUBLICATION_RELATIONS.includes(relation.relation)) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "PUBLICATION_RELATION_INVALID",
        fieldPath: `${relationDetails.fieldPath}/relation`,
        message: "Publication Relation relation must be revises or published_as.",
        relatedIds: PUBLICATION_RELATIONS,
      });
      structurallyValid = false;
    }
    if (!PUBLICATION_RELATION_BASES.includes(relation.basis)) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "PUBLICATION_RELATION_BASIS_INVALID",
        fieldPath: `${relationDetails.fieldPath}/basis`,
        message: "Publication Relation basis must be source_asserted or curator_matched.",
        relatedIds: PUBLICATION_RELATION_BASES,
      });
      structurallyValid = false;
    }

    const endpointIds = {
      source: relation.source_version_id,
      target: relation.target_version_id,
    };
    for (const side of ["source", "target"]) {
      if (typeof endpointIds[side] !== "string" || endpointIds[side].trim() === "") {
        addDiagnostic(diagnostics, {
          ...relationDetails,
          code: "PUBLICATION_RELATION_ENDPOINT_INVALID",
          fieldPath: `${relationDetails.fieldPath}/${side}_version_id`,
          message: `Publication Relation ${side} endpoint must be a Version ID string.`,
        });
        structurallyValid = false;
      }
    }

    const sourceDescriptor = publicationRelationSourceDescriptor(relation);
    const declaredSourceIds = sourceDescriptor.ids;
    if (!Array.isArray(declaredSourceIds) || declaredSourceIds.length === 0) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "PUBLICATION_RELATION_BIBLIOGRAPHIC_SOURCES_INVALID",
        fieldPath: `${relationDetails.fieldPath}${sourceDescriptor.fieldPath}`,
        message: "Publication Relations require a non-empty array of Bibliographic Source IDs.",
      });
      structurallyValid = false;
    }
    const relationSourceSet = new Set();
    if (Array.isArray(declaredSourceIds)) {
      for (const [sourceIndex, sourceId] of declaredSourceIds.entries()) {
        if (typeof sourceId !== "string" || sourceId.trim() === "") {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "PUBLICATION_RELATION_BIBLIOGRAPHIC_SOURCE_ID_INVALID",
            fieldPath: `${relationDetails.fieldPath}${sourceDescriptor.fieldPath}/${sourceIndex}`,
            message: "Publication Relation Bibliographic Source IDs must be non-empty strings.",
          });
          structurallyValid = false;
          continue;
        }
        if (relationSourceSet.has(sourceId)) {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "PUBLICATION_RELATION_BIBLIOGRAPHIC_SOURCE_DUPLICATE",
            fieldPath: `${relationDetails.fieldPath}${sourceDescriptor.fieldPath}/${sourceIndex}`,
            message: `A Publication Relation cannot repeat a Bibliographic Source ID: ${sourceId}.`,
            relatedIds: [sourceId],
          });
          structurallyValid = false;
        }
        relationSourceSet.add(sourceId);
        if (!sourceIds.has(sourceId)) {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "REFERENTIAL_BIB_SOURCE_MISSING",
            fieldPath: `${relationDetails.fieldPath}${sourceDescriptor.fieldPath}/${sourceIndex}`,
            message: `Bibliographic Source does not exist: ${sourceId}.`,
            relatedIds: [sourceId],
          });
        }
      }
    }

    const requiresReason = relation.relation === "published_as" || relation.basis === "curator_matched";
    if (
      requiresReason &&
      (typeof relation.reason !== "string" || relation.reason.trim() === "")
    ) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "PUBLICATION_RELATION_REASON_REQUIRED",
        fieldPath: `${relationDetails.fieldPath}/reason`,
        message: "This Publication Relation requires a non-empty normalized reason.",
      });
    } else if (relation.reason !== undefined &&
      (typeof relation.reason !== "string" || relation.reason.trim() === "")) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "PUBLICATION_RELATION_REASON_INVALID",
        fieldPath: `${relationDetails.fieldPath}/reason`,
        message: "A Publication Relation reason must be a non-empty string when supplied.",
      });
    } else if (
      typeof relation.reason === "string" &&
      relation.reason !== normalizePublicationReason(relation.reason)
    ) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "PUBLICATION_RELATION_REASON_NOT_NORMALIZED",
        fieldPath: `${relationDetails.fieldPath}/reason`,
        message: "Publication Relation reason must be stored in normalized whitespace form.",
      });
    }

    if (!structurallyValid) {
      continue;
    }
    const sourceVersion = versionsById.get(endpointIds.source);
    const targetVersion = versionsById.get(endpointIds.target);
    if (!sourceVersion) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "REFERENTIAL_VERSION_MISSING",
        fieldPath: `${relationDetails.fieldPath}/source_version_id`,
        message: `Publication Relation source Version does not exist: ${endpointIds.source}.`,
        relatedIds: [endpointIds.source],
      });
    }
    if (!targetVersion) {
      addDiagnostic(diagnostics, {
        ...relationDetails,
        code: "REFERENTIAL_VERSION_MISSING",
        fieldPath: `${relationDetails.fieldPath}/target_version_id`,
        message: `Publication Relation target Version does not exist: ${endpointIds.target}.`,
        relatedIds: [endpointIds.target],
      });
    }

    const endpointsAvailable = isObject(sourceVersion) &&
      isObject(targetVersion) &&
      versionIdCounts.get(endpointIds.source) === 1 &&
      versionIdCounts.get(endpointIds.target) === 1 &&
      isNamespacedId(endpointIds.source, "version") &&
      isNamespacedId(endpointIds.target, "version") &&
      VERSION_KINDS.includes(sourceVersion.kind) &&
      VERSION_KINDS.includes(targetVersion.kind);
    const relationSourceRecords = (Array.isArray(declaredSourceIds) ? declaredSourceIds : [])
      .map((sourceId) => sourcesById.get(sourceId))
      .filter((source) => isObject(source) && BIBLIOGRAPHIC_PROVIDERS.includes(source.provider));
    const allSourcesExist = Array.isArray(declaredSourceIds) &&
      declaredSourceIds.length > 0 &&
      declaredSourceIds.every((sourceId) => sourceIds.has(sourceId));

    if (endpointsAvailable) {
      if (relation.relation === "revises") {
        if (sourceVersion.kind !== "arxiv_revision" || targetVersion.kind !== "arxiv_revision") {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "PUBLICATION_RELATION_ENDPOINT_KIND_INVALID",
            fieldPath: `${relationDetails.fieldPath}/relation`,
            message: "A revises relation requires arxiv_revision source and target Versions.",
            relatedIds: ["arxiv_revision"],
          });
        }
        const sourceIdentity = arxivIdentityValue(sourceVersion);
        const targetIdentity = arxivIdentityValue(targetVersion);
        const graphEdgeEligible = sourceVersion.kind === "arxiv_revision" &&
          targetVersion.kind === "arxiv_revision" &&
          sourceIdentity && targetIdentity;
        if (sourceIdentity && targetIdentity && sourceIdentity.base_id !== targetIdentity.base_id) {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "PUBLICATION_REVISES_IDENTITY_MISMATCH",
            fieldPath: `${relationDetails.fieldPath}/target_version_id`,
            message: "A revises relation requires the same canonical arXiv base identifier at both endpoints.",
            relatedIds: [sourceIdentity.base_id, targetIdentity.base_id],
          });
        }
        if (sourceIdentity && targetIdentity && sourceIdentity.revision <= targetIdentity.revision) {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "PUBLICATION_REVISES_REVISION_ORDER_INVALID",
            fieldPath: `${relationDetails.fieldPath}/source_version_id`,
            message: "A revises relation must point from a higher to a lower arXiv revision number.",
            relatedIds: [String(sourceIdentity.revision), String(targetIdentity.revision)],
          });
        }
        if (comparePartialReleaseDates(sourceVersion, targetVersion) < 0) {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "PUBLICATION_REVISES_DATE_ORDER_INVALID",
            fieldPath: `${relationDetails.fieldPath}/source_version_id`,
            message: "Comparable release dates must not place the later arXiv revision before its target.",
            relatedIds: [endpointIds.source, endpointIds.target],
          });
        }
        // Revision-number/date contradictions are independently reported, but
        // remain graph-eligible so a hostile reverse edge cannot hide a real
        // Publication Graph cycle behind one semantic diagnostic.
        if (graphEdgeEligible) {
          revisionEdges.push({
            source: endpointIds.source,
            target: endpointIds.target,
            relationId: relation.id,
          });
        }
      } else if (relation.relation === "published_as") {
        if (sourceVersion.kind !== "arxiv_revision" || targetVersion.kind !== "journal_manifestation") {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "PUBLICATION_RELATION_ENDPOINT_KIND_INVALID",
            fieldPath: `${relationDetails.fieldPath}/relation`,
            message: "A published_as relation requires an arxiv_revision source and journal_manifestation target.",
            relatedIds: ["arxiv_revision", "journal_manifestation"],
          });
        } else {
          const prior = incomingPublishedAs.get(endpointIds.target);
          if (prior) {
            addDiagnostic(diagnostics, {
              ...relationDetails,
              code: "PUBLICATION_PUBLISHED_AS_CARDINALITY_INVALID",
              fieldPath: `${relationDetails.fieldPath}/target_version_id`,
              message: "A journal manifestation may have at most one incoming published_as relation.",
              relatedIds: [prior, relation.id].filter(Boolean),
            });
          } else {
            incomingPublishedAs.set(endpointIds.target, relation.id);
          }
        }
      }

      if (relation.basis === "source_asserted" && allSourcesExist && relationSourceRecords.length > 0) {
        const sourceAsserted = relationSourceRecords.some((source) =>
          sourceConnectsVersions(source, sourceVersion, targetVersion),
        );
        if (!sourceAsserted) {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "PUBLICATION_SOURCE_ASSERTION_COVERAGE_INVALID",
            fieldPath: `${relationDetails.fieldPath}${sourceDescriptor.fieldPath}`,
            message: "A source_asserted relation requires an authoritative Bibliographic Source explicitly connecting both endpoint Versions.",
            relatedIds: [endpointIds.source, endpointIds.target],
          });
        }
      }
      if (relation.basis === "curator_matched" && allSourcesExist) {
        const distinctSources = [...new Set(declaredSourceIds)];
        if (distinctSources.length < 2) {
          addDiagnostic(diagnostics, {
            ...relationDetails,
            code: "PUBLICATION_CURATOR_MATCH_SOURCES_REQUIRED",
            fieldPath: `${relationDetails.fieldPath}${sourceDescriptor.fieldPath}`,
            message: "A curator_matched relation requires at least two distinct Bibliographic Sources.",
          });
        } else {
          const sourceCoversSourceEndpoint = distinctSources.some((sourceId) =>
            sourceCoversVersionIdentity(sourcesById.get(sourceId), sourceVersion),
          );
          const sourceCoversTargetEndpoint = distinctSources.some((sourceId) =>
            sourceCoversVersionIdentity(sourcesById.get(sourceId), targetVersion),
          );
          const allSourcesMeaningful = distinctSources.every((sourceId) => {
            const source = sourcesById.get(sourceId);
            return sourceCoversVersionIdentity(source, sourceVersion) ||
              sourceCoversVersionIdentity(source, targetVersion);
          });
          if (!sourceCoversSourceEndpoint || !sourceCoversTargetEndpoint || !allSourcesMeaningful) {
            addDiagnostic(diagnostics, {
              ...relationDetails,
              code: "PUBLICATION_CURATOR_MATCH_COVERAGE_INVALID",
              fieldPath: `${relationDetails.fieldPath}${sourceDescriptor.fieldPath}`,
              message: "A curator_matched relation requires meaningful Bibliographic Sources covering both endpoint Versions.",
              relatedIds: [endpointIds.source, endpointIds.target],
            });
          }
        }
      }
    }

    validateGovernedRecord(relation, actorsById, relationDetails, diagnostics);
    if (endpointsAvailable && allSourcesExist) {
      validatePublicationRelationReviewBinding(relation, relationDetails, diagnostics);
    }
  }

  const adjacency = new Map();
  for (const edge of revisionEdges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }
    adjacency.get(edge.source).push(edge);
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, []);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const cycleRelationIds = new Set();
  function visit(versionId, path = []) {
    if (visiting.has(versionId)) {
      for (const edge of path) {
        cycleRelationIds.add(edge.relationId);
      }
      return true;
    }
    if (visited.has(versionId)) {
      return false;
    }
    visiting.add(versionId);
    let cyclic = false;
    for (const edge of adjacency.get(versionId) ?? []) {
      if (visit(edge.target, [...path, edge])) {
        cyclic = true;
      }
    }
    visiting.delete(versionId);
    visited.add(versionId);
    return cyclic;
  }
  let hasCycle = false;
  for (const versionId of adjacency.keys()) {
    if (visit(versionId)) {
      hasCycle = true;
    }
  }
  if (hasCycle) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "PUBLICATION_GRAPH_CYCLE",
      fieldPath: "/publication_relations",
      message: "The Publication Graph revises relations must be acyclic.",
      relatedIds: [...cycleRelationIds].filter(Boolean),
    });
  }
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

function extractEditorialReadingFrontmatter(reading, field) {
  if (typeof reading !== "string" || !reading.startsWith("---")) {
    return null;
  }
  const match = reading.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) {
    return null;
  }
  try {
    const frontmatter = parseYaml(match[1]);
    return isObject(frontmatter) && typeof frontmatter[field] === "string"
      ? frontmatter
      : null;
  } catch {
    return null;
  }
}

function normalizeEditorialReason(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : value ?? null;
}

/**
 * A membership's review binding covers only its semantic assertion.  The
 * record ID is stable identity; both relationship endpoints are semantic.
 * Role ordering is set-like and therefore canonicalized before hashing.
 */
export function researchLineMembershipSemanticDigest(membership, lineId = null) {
  const semanticProjection = {
    line_id: lineId,
    work_id: membership?.work_id ?? null,
    reading_roles: Array.isArray(membership?.reading_roles)
      ? membership.reading_roles
        .filter((role) => typeof role === "string")
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
      : membership?.reading_roles ?? null,
    editorial_anchor: membership?.editorial_anchor === true,
    reason: normalizeEditorialReason(membership?.reason),
  };
  return createHash("sha256")
    .update(JSON.stringify(semanticProjection), "utf8")
    .digest("hex");
}

function validateMembershipReviewBinding(membership, lineId, details, diagnostics) {
  if (membership?.review_state !== "reviewed") {
    return true;
  }
  const binding = membership.review_binding;
  if (!isObject(binding)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "MEMBERSHIP_REVIEW_BINDING_REQUIRED",
      fieldPath: `${details.fieldPath}/review_binding`,
      message: "A reviewed Research Line Membership requires a semantic review binding.",
    });
    return false;
  }
  let valid = true;
  if (binding.canonicalization_version !== CANONICALIZATION_VERSION) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "MEMBERSHIP_REVIEW_BINDING_VERSION_INVALID",
      fieldPath: `${details.fieldPath}/review_binding/canonicalization_version`,
      message: "Membership review binding uses an unsupported canonicalization version.",
      relatedIds: [CANONICALIZATION_VERSION],
    });
    valid = false;
  }
  const expectedDigest = researchLineMembershipSemanticDigest(membership, lineId);
  if (binding.semantic_digest !== expectedDigest) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "MEMBERSHIP_REVIEW_BINDING_STALE",
      fieldPath: `${details.fieldPath}/review_binding/semantic_digest`,
      message: "Reviewed Research Line Membership semantic fields no longer match its review binding.",
    });
    valid = false;
  }
  return valid;
}

/**
 * Visibility digests use the same canonical YAML mapping procedure as the
 * global content digest, but hash the reader projection for one entity.  The
 * projection itself owns filtering of hidden records and release metadata.
 */
export function computeReaderVisibilityDigest(snapshot, entityType, entityId) {
  const projection = entityType === "work"
      ? projectWorkForReader(snapshot, entityId)
      : entityType === "research_line"
        ? projectResearchLineForReader(snapshot, entityId)
      : entityType === "learning_path"
        ? projectLearningPathForReader(snapshot, entityId)
      : null;
  if (projection === null) {
    return null;
  }
  return createHash("sha256")
    .update(canonicalizeYaml(projection), "utf8")
    .digest("hex");
}

function validateVisibilityApprovals(
  record,
  entity,
  details,
  manifest,
  actorsById,
  currentDigest,
  diagnostics,
) {
  const approvals = record?.visibility_approvals;
  const visible = record?.reader_state === "visible";
  if (approvals !== undefined && !Array.isArray(approvals)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "VISIBILITY_APPROVALS_INVALID",
      fieldPath: "/visibility_approvals",
      message: "Visibility approvals must be an append-only array.",
    });
    return { valid: false, status: "skipped" };
  }

  let currentApproval = false;
  let approvalsValid = true;
  for (const [index, approval] of (approvals ?? []).entries()) {
    const approvalDetails = {
      ...details,
      recordId: entity.id,
      fieldPath: `/visibility_approvals/${index}`,
    };
    if (!isObject(approval)) {
      addDiagnostic(diagnostics, {
        ...approvalDetails,
        code: "VISIBILITY_APPROVAL_INVALID_SHAPE",
        message: "Every Visibility Approval must be a mapping.",
      });
      approvalsValid = false;
      continue;
    }
    let approvalValid = true;
    if (typeof approval.profile_id !== "string" || approval.profile_id.length === 0) {
      addDiagnostic(diagnostics, {
        ...approvalDetails,
        code: "VISIBILITY_APPROVAL_PROFILE_INVALID",
        fieldPath: `${approvalDetails.fieldPath}/profile_id`,
        message: "Visibility Approval profile_id must be a non-empty string.",
        relatedIds: typeof manifest?.visibility_profile_id === "string"
          ? [manifest.visibility_profile_id]
          : [],
      });
      approvalValid = false;
      approvalsValid = false;
    }
    if (
      typeof approval.visibility_digest !== "string" ||
      !/^[0-9a-f]{64}$/u.test(approval.visibility_digest)
    ) {
      addDiagnostic(diagnostics, {
        ...approvalDetails,
        code: "VISIBILITY_APPROVAL_DIGEST_INVALID",
        fieldPath: `${approvalDetails.fieldPath}/visibility_digest`,
        message: "Visibility Approval visibility_digest must be a lowercase SHA-256 digest.",
      });
      approvalValid = false;
      approvalsValid = false;
    }
    const approvalActor = actorsById?.get(approval.actor_id);
    if (typeof approval.actor_id !== "string" || !approvalActor) {
      addDiagnostic(diagnostics, {
        ...approvalDetails,
        code: "VISIBILITY_APPROVAL_ACTOR_INVALID",
        fieldPath: `${approvalDetails.fieldPath}/actor_id`,
        message: "Visibility Approval requires an existing Actor Registry actor.",
        relatedIds: typeof approval.actor_id === "string" ? [approval.actor_id] : [],
      });
      approvalValid = false;
      approvalsValid = false;
    } else if (approvalActor.kind !== "human") {
      addDiagnostic(diagnostics, {
        ...approvalDetails,
        code: "VISIBILITY_APPROVAL_HUMAN_REQUIRED",
        fieldPath: `${approvalDetails.fieldPath}/actor_id`,
        message: "Visibility Approval requires a Human reviewer.",
        relatedIds: [approval.actor_id],
      });
      approvalValid = false;
      approvalsValid = false;
    }
    if (
      !validateUtcTimestamp(
        approval.approved_at,
        {
          ...approvalDetails,
          code: "VISIBILITY_APPROVAL_TIMESTAMP_INVALID",
          fieldPath: `${approvalDetails.fieldPath}/approved_at`,
          message: "Visibility Approval approved_at must be a UTC RFC 3339 timestamp.",
        },
        diagnostics,
      )
    ) {
      approvalValid = false;
      approvalsValid = false;
    }
    if (
      approvalValid &&
      approvalActor &&
      approvalActor.kind === "human" &&
      !requireActorCapability(
        { actor_id: approval.actor_id, recorded_at: approval.approved_at },
        actorsById,
        "approve_visibility",
        {
          ...approvalDetails,
          fieldPath: `${approvalDetails.fieldPath}`,
        },
        diagnostics,
        "VISIBILITY_APPROVAL_CAPABILITY_REQUIRED",
      )
    ) {
      approvalValid = false;
      approvalsValid = false;
    }
    if (
      visible &&
      approvalValid &&
      approval.profile_id === manifest?.visibility_profile_id &&
      approval.visibility_digest === currentDigest
    ) {
      currentApproval = true;
    }
  }

  if (visible && !currentApproval && approvalsValid) {
    addDiagnostic(diagnostics, {
      ...details,
      code: approvals?.length ? "VISIBILITY_APPROVAL_STALE" : "VISIBILITY_APPROVAL_REQUIRED",
      fieldPath: "/visibility_approvals",
      message: approvals?.length
        ? "No Visibility Approval matches the current reader-facing digest and release profile."
        : "A visible Reader Entity requires a Human Visibility Approval.",
    });
  }
  return {
    valid: approvalsValid && currentApproval,
    status: !approvalsValid
      ? "skipped"
      : visible
        ? (currentApproval ? "approved" : approvals?.length ? "stale" : "unapproved")
        : "hidden",
  };
}

function validateResearchLines(snapshot, actorsById, diagnostics) {
  const worksById = new Map(snapshot.works.map((work) => [work.id, work]));
  const seenLineIds = new Set();
  const pairOwners = new Map();
  const membershipIds = new Set();
  const memberships = [];
  const invalidLineIds = new Set();
  const invalidWorkIds = new Set();

  for (const researchLine of snapshot.researchLines) {
    const line = researchLine.line;
    const linePath = resolveResearchLinePath(researchLine);
    const file = `${linePath}/line.yaml`;
    const details = { file, recordId: researchLine.id };
    if (!isObject(line) || hasParseDiagnostic(diagnostics, file)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_INVALID_SHAPE",
        fieldPath: null,
        message: "A Research Line record must be a YAML mapping.",
      });
      invalidLineIds.add(researchLine.id);
      continue;
    }

    const validLineId = validateNamespacedId(line.line_id, "research-line", {
      ...details,
      code: "RESEARCH_LINE_ID_INVALID",
      fieldPath: "/line_id",
      message: "Research Line IDs must use the research-line: namespace.",
    }, diagnostics);
    if (validLineId && seenLineIds.has(line.line_id)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_ID_DUPLICATE",
        fieldPath: "/line_id",
        message: `Research Line ID is duplicated: ${line.line_id}.`,
        relatedIds: [line.line_id],
      });
      invalidLineIds.add(line.line_id);
    } else if (validLineId) {
      seenLineIds.add(line.line_id);
    }
    if (!READER_STATES.includes(line.reader_state)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_READER_STATE_INVALID",
        fieldPath: "/reader_state",
        message: "Research Line reader_state must be draft or visible.",
        relatedIds: READER_STATES,
      });
    }
    if (typeof line.title !== "string" || line.title.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_TITLE_INVALID",
        fieldPath: "/title",
        message: "Research Lines require a non-empty title.",
      });
    }
    if (typeof line.scientific_question !== "string" || line.scientific_question.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_QUESTION_INVALID",
        fieldPath: "/scientific_question",
        message: "Research Lines require a non-empty scientific question.",
      });
    }
    if (!Array.isArray(line.physical_structure) || line.physical_structure.some((item) => typeof item !== "string" || item.trim() === "")) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_PHYSICAL_STRUCTURE_INVALID",
        fieldPath: "/physical_structure",
        message: "Research Line physical_structure must be an array of non-empty axis references.",
      });
    }

    const readingFile = `${linePath}/reading.md`;
    const frontmatter = extractEditorialReadingFrontmatter(researchLine.reading, "line_id");
    if (!frontmatter) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_READING_FRONTMATTER_INVALID",
        file: readingFile,
        fieldPath: "/line_id",
        message: "Research Line reading.md must begin with YAML frontmatter containing line_id.",
      });
    } else if (frontmatter.line_id !== researchLine.id) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_READING_OWNERSHIP_MISMATCH",
        file: readingFile,
        fieldPath: "/line_id",
        message: "Research Line reading.md line_id must match the canonical line_id.",
        relatedIds: [researchLine.id],
      });
    }
    if (typeof researchLine.reading !== "string" || researchLine.reading.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_READING_EMPTY",
        file: readingFile,
        fieldPath: null,
        message: "Research Line reading.md must contain reader-facing prose.",
      });
    }

    if (!Array.isArray(line.memberships)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "RESEARCH_LINE_MEMBERSHIPS_INVALID",
        fieldPath: "/memberships",
        message: "Research Lines require an explicit memberships array.",
      });
      invalidLineIds.add(researchLine.id);
      continue;
    }

    const lineStructurallyValid = !diagnostics.some(
      (diagnostic) =>
        diagnostic.file?.startsWith(`${linePath}/`) &&
        diagnostic.record_id === researchLine.id &&
        isStructuralDiagnostic(diagnostic),
    );
    for (const [index, membership] of line.memberships.entries()) {
      const diagnosticStart = diagnostics.length;
      const membershipDetails = {
        file,
        recordId: membership?.id ?? researchLine.id,
        fieldPath: `/memberships/${index}`,
      };
      if (!isObject(membership)) {
        addDiagnostic(diagnostics, {
          ...membershipDetails,
          code: "RESEARCH_LINE_MEMBERSHIP_INVALID_SHAPE",
          message: "Research Line Memberships must be mappings.",
        });
        invalidLineIds.add(researchLine.id);
        continue;
      }
      validateNamespacedId(membership.id, "membership", {
        ...membershipDetails,
        code: "RESEARCH_LINE_MEMBERSHIP_ID_INVALID",
        fieldPath: `${membershipDetails.fieldPath}/id`,
        message: "Research Line Membership IDs must use the membership: namespace.",
      }, diagnostics);
      if (membershipIds.has(membership.id)) {
        addDiagnostic(diagnostics, {
          ...membershipDetails,
          code: "RESEARCH_LINE_MEMBERSHIP_ID_DUPLICATE",
          fieldPath: `${membershipDetails.fieldPath}/id`,
          message: `Research Line Membership ID is duplicated: ${membership.id}.`,
        });
      }
      membershipIds.add(membership.id);

      if (!validateNamespacedId(membership.work_id, "work", {
        ...membershipDetails,
        code: "RESEARCH_LINE_MEMBERSHIP_WORK_ID_INVALID",
        fieldPath: `${membershipDetails.fieldPath}/work_id`,
        message: "Research Line Membership work_id must use the work: namespace.",
      }, diagnostics) || !worksById.has(membership.work_id)) {
        if (typeof membership.work_id === "string" && !worksById.has(membership.work_id)) {
          addDiagnostic(diagnostics, {
            ...membershipDetails,
            code: "REFERENTIAL_WORK_MISSING",
            fieldPath: `${membershipDetails.fieldPath}/work_id`,
            message: `Research Line Membership Work does not exist: ${membership.work_id}.`,
            relatedIds: [membership.work_id],
          });
        }
      }

      if (!Array.isArray(membership.reading_roles) || membership.reading_roles.length === 0) {
        addDiagnostic(diagnostics, {
          ...membershipDetails,
          code: "READING_ROLE_REQUIRED",
          fieldPath: `${membershipDetails.fieldPath}/reading_roles`,
          message: "Research Line Memberships require a non-empty Reading Role set.",
        });
      } else {
        const roles = new Set();
        for (const [roleIndex, role] of membership.reading_roles.entries()) {
          if (!READING_ROLES.includes(role)) {
            addDiagnostic(diagnostics, {
              ...membershipDetails,
              code: "READING_ROLE_INVALID",
              fieldPath: `${membershipDetails.fieldPath}/reading_roles/${roleIndex}`,
              message: `Reading Role is not in the frozen V0.1 vocabulary: ${role}.`,
              relatedIds: READING_ROLES,
            });
          }
          if (roles.has(role)) {
            addDiagnostic(diagnostics, {
              ...membershipDetails,
              code: "READING_ROLE_DUPLICATE",
              fieldPath: `${membershipDetails.fieldPath}/reading_roles/${roleIndex}`,
              message: `Reading Role is duplicated on this membership: ${role}.`,
              relatedIds: [role],
            });
          }
          roles.add(role);
        }
      }
      if (typeof membership.editorial_anchor !== "boolean") {
        addDiagnostic(diagnostics, {
          ...membershipDetails,
          code: "EDITORIAL_ANCHOR_INVALID",
          fieldPath: `${membershipDetails.fieldPath}/editorial_anchor`,
          message: "Research Line Membership editorial_anchor must be boolean.",
        });
      }

      const pairKey = `${researchLine.id}\0${membership.work_id}`;
      if (pairOwners.has(pairKey)) {
        addDiagnostic(diagnostics, {
          ...membershipDetails,
          code: "RESEARCH_LINE_MEMBERSHIP_PAIR_DUPLICATE",
          fieldPath: `${membershipDetails.fieldPath}/work_id`,
          message: "A Work–Research Line pair may have at most one membership.",
          relatedIds: [pairOwners.get(pairKey), membership.id].filter(Boolean),
        });
      } else {
        pairOwners.set(pairKey, membership.id);
      }

      const membershipStructurallyValid = lineStructurallyValid && !diagnostics
        .slice(diagnosticStart)
        .some(isStructuralDiagnostic);
      if (membershipStructurallyValid) {
        validateGovernedRecord(membership, actorsById, membershipDetails, diagnostics);
        validateMembershipReviewBinding(membership, researchLine.id, membershipDetails, diagnostics);
        memberships.push({ researchLine, membership, index });
      } else {
        invalidLineIds.add(researchLine.id);
        if (typeof membership.work_id === "string") {
          invalidWorkIds.add(membership.work_id);
        }
      }
    }
    if (!lineStructurallyValid) {
      invalidLineIds.add(researchLine.id);
      for (const membership of line.memberships) {
        if (typeof membership?.work_id === "string") {
          invalidWorkIds.add(membership.work_id);
        }
      }
    }
  }

  return { memberships, invalidLineIds, invalidWorkIds };
}

/**
 * A Learning Path's structured review is atomic. Entries and transitions
 * retain their array order because order is the meaning of the path; only
 * transition reason whitespace is normalized for semantic comparison.
 */
export function learningPathSemanticDigest(path) {
  const semanticProjection = {
    title: normalizeEditorialReason(path?.title),
    entries: Array.isArray(path?.entries)
      ? path.entries.map((entry) => ({
        work_id: entry?.work_id ?? null,
      }))
      : path?.entries ?? null,
    transitions: Array.isArray(path?.transitions)
      ? path.transitions.map((transition) => ({
        source_work_id: transition?.source_work_id ?? null,
        target_work_id: transition?.target_work_id ?? null,
        reason: normalizeEditorialReason(transition?.reason),
      }))
      : path?.transitions ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(semanticProjection), "utf8")
    .digest("hex");
}

function validateLearningPathReviewBinding(path, details, diagnostics) {
  if (path?.review_state !== "reviewed") {
    return true;
  }
  const binding = path.review_binding;
  if (!isObject(binding)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "LEARNING_PATH_REVIEW_BINDING_REQUIRED",
      fieldPath: `${details.fieldPath}/review_binding`,
      message: "A reviewed Learning Path requires an atomic semantic review binding.",
    });
    return false;
  }
  let valid = true;
  if (binding.canonicalization_version !== CANONICALIZATION_VERSION) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "LEARNING_PATH_REVIEW_BINDING_VERSION_INVALID",
      fieldPath: `${details.fieldPath}/review_binding/canonicalization_version`,
      message: "Learning Path review binding uses an unsupported canonicalization version.",
      relatedIds: [CANONICALIZATION_VERSION],
    });
    valid = false;
  }
  const expectedDigest = learningPathSemanticDigest(path);
  if (binding.semantic_digest !== expectedDigest) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "LEARNING_PATH_REVIEW_BINDING_STALE",
      fieldPath: `${details.fieldPath}/review_binding/semantic_digest`,
      message: "Reviewed Learning Path entries or transitions no longer match its review binding.",
    });
    valid = false;
  }
  return valid;
}

function validateLearningPaths(snapshot, actorsById, diagnostics) {
  const worksById = new Map(snapshot.works.map((work) => [work.id, work]));
  const seenPathIds = new Set();
  const invalidPathIds = new Set();
  const learningPaths = [];

  for (const learningPath of snapshot.learningPaths) {
    const learningPathPath = resolveLearningPathPath(learningPath);
    const path = learningPath.path;
    const file = `${learningPathPath}/path.yaml`;
    const details = { file, recordId: learningPath.id, fieldPath: "" };
    const diagnosticStart = diagnostics.length;
    if (!isObject(path) || hasParseDiagnostic(diagnostics, file)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "LEARNING_PATH_INVALID_SHAPE",
        fieldPath: null,
        message: "A Learning Path record must be a YAML mapping.",
      });
      invalidPathIds.add(learningPath.id);
      continue;
    }

    let structurallyValid = true;
    const validPathId = validateNamespacedId(path.path_id, "learning-path", {
      ...details,
      code: "LEARNING_PATH_ID_INVALID",
      fieldPath: "/path_id",
      message: "Learning Path IDs must use the learning-path: namespace.",
    }, diagnostics);
    if (!validPathId) {
      structurallyValid = false;
    } else if (seenPathIds.has(path.path_id)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "LEARNING_PATH_ID_DUPLICATE",
        fieldPath: "/path_id",
        message: `Learning Path ID is duplicated: ${path.path_id}.`,
        relatedIds: [path.path_id],
      });
      structurallyValid = false;
      invalidPathIds.add(path.path_id);
    } else {
      seenPathIds.add(path.path_id);
    }
    if (!READER_STATES.includes(path.reader_state)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "LEARNING_PATH_READER_STATE_INVALID",
        fieldPath: "/reader_state",
        message: "Learning Path reader_state must be draft or visible.",
        relatedIds: READER_STATES,
      });
      structurallyValid = false;
    }
    if (typeof path.title !== "string" || path.title.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "LEARNING_PATH_TITLE_INVALID",
        fieldPath: "/title",
        message: "Learning Paths require a non-empty title.",
      });
      structurallyValid = false;
    }

    const readingFile = `${learningPathPath}/reading.md`;
    const frontmatter = extractEditorialReadingFrontmatter(learningPath.reading, "path_id");
    if (!frontmatter) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "LEARNING_PATH_READING_FRONTMATTER_INVALID",
        file: readingFile,
        fieldPath: "/path_id",
        message: "Learning Path reading.md must begin with YAML frontmatter containing path_id.",
      });
      structurallyValid = false;
    } else if (frontmatter.path_id !== learningPath.id) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "LEARNING_PATH_READING_OWNERSHIP_MISMATCH",
        file: readingFile,
        fieldPath: "/path_id",
        message: "Learning Path reading.md path_id must match the canonical path_id.",
        relatedIds: [learningPath.id],
      });
      structurallyValid = false;
    }
    if (typeof learningPath.reading !== "string" || learningPath.reading.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "LEARNING_PATH_READING_EMPTY",
        file: readingFile,
        fieldPath: null,
        message: "Learning Path reading.md must contain reader-facing prose.",
      });
      structurallyValid = false;
    }

    const entries = path.entries;
    if (!Array.isArray(entries)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "LEARNING_PATH_ENTRIES_INVALID",
        fieldPath: "/entries",
        message: "Learning Paths require an explicit entries array.",
      });
      structurallyValid = false;
    }

    const entryWorkIds = new Set();
    if (Array.isArray(entries)) {
      for (const [index, entry] of entries.entries()) {
        const entryDetails = {
          ...details,
          recordId: learningPath.id,
          fieldPath: `/entries/${index}`,
        };
        if (!isObject(entry)) {
          addDiagnostic(diagnostics, {
            ...entryDetails,
            code: "LEARNING_PATH_ENTRY_INVALID_SHAPE",
            message: "Learning Path entries must be mappings containing work_id.",
          });
          structurallyValid = false;
          continue;
        }
        if (!validateNamespacedId(entry.work_id, "work", {
          ...entryDetails,
          code: "LEARNING_PATH_ENTRY_WORK_ID_INVALID",
          fieldPath: `${entryDetails.fieldPath}/work_id`,
          message: "Learning Path entry work_id must use the work: namespace.",
        }, diagnostics)) {
          structurallyValid = false;
          continue;
        }
        if (entryWorkIds.has(entry.work_id)) {
          addDiagnostic(diagnostics, {
            ...entryDetails,
            code: "LEARNING_PATH_ENTRY_DUPLICATE",
            fieldPath: `${entryDetails.fieldPath}/work_id`,
            message: `A Learning Path cannot repeat a Work: ${entry.work_id}.`,
            relatedIds: [entry.work_id],
          });
        }
        entryWorkIds.add(entry.work_id);
        if (!worksById.has(entry.work_id)) {
          addDiagnostic(diagnostics, {
            ...entryDetails,
            code: "REFERENTIAL_LEARNING_PATH_WORK_MISSING",
            fieldPath: `${entryDetails.fieldPath}/work_id`,
            message: `Learning Path Work does not exist: ${entry.work_id}.`,
            relatedIds: [entry.work_id],
          });
        }
      }
    }

    const transitions = path.transitions;
    if (!Array.isArray(transitions)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "LEARNING_PATH_TRANSITIONS_INVALID",
        fieldPath: "/transitions",
        message: "Learning Paths require an explicit transitions array.",
      });
      structurallyValid = false;
    }

    if (Array.isArray(entries) && Array.isArray(transitions)) {
      const expectedTransitionCount = Math.max(0, entries.length - 1);
      if (transitions.length !== expectedTransitionCount) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "LEARNING_PATH_TRANSITION_COUNT_INVALID",
          fieldPath: "/transitions",
          message: `A Learning Path with ${entries.length} entries requires exactly ${expectedTransitionCount} transitions.`,
          relatedIds: [String(expectedTransitionCount)],
        });
      }
    }

    if (Array.isArray(transitions)) {
      for (const [index, transition] of transitions.entries()) {
        const transitionDetails = {
          ...details,
          recordId: learningPath.id,
          fieldPath: `/transitions/${index}`,
        };
        if (!isObject(transition)) {
          addDiagnostic(diagnostics, {
            ...transitionDetails,
            code: "LEARNING_PATH_TRANSITION_INVALID_SHAPE",
            message: "Pedagogical Transitions must be mappings.",
          });
          structurallyValid = false;
          continue;
        }
        for (const side of ["source", "target"]) {
          const field = `${side}_work_id`;
          if (!validateNamespacedId(transition[field], "work", {
            ...transitionDetails,
            code: "LEARNING_PATH_TRANSITION_ENDPOINT_INVALID",
            fieldPath: `${transitionDetails.fieldPath}/${field}`,
            message: `Pedagogical Transition ${side} endpoint must use the work: namespace.`,
          }, diagnostics)) {
            structurallyValid = false;
          } else if (!worksById.has(transition[field])) {
            addDiagnostic(diagnostics, {
              ...transitionDetails,
              code: "REFERENTIAL_LEARNING_PATH_WORK_MISSING",
              fieldPath: `${transitionDetails.fieldPath}/${field}`,
              message: `Pedagogical Transition Work does not exist: ${transition[field]}.`,
              relatedIds: [transition[field]],
            });
          }
        }
        if (typeof transition.reason !== "string" || transition.reason.trim() === "") {
          addDiagnostic(diagnostics, {
            ...transitionDetails,
            code: transition.reason === undefined
              ? "LEARNING_PATH_TRANSITION_REASON_REQUIRED"
              : "LEARNING_PATH_TRANSITION_REASON_INVALID",
            fieldPath: `${transitionDetails.fieldPath}/reason`,
            message: "Every Pedagogical Transition requires a non-empty normalized reason.",
          });
          structurallyValid = false;
        } else if (transition.reason !== normalizeEditorialReason(transition.reason)) {
          addDiagnostic(diagnostics, {
            ...transitionDetails,
            code: "LEARNING_PATH_TRANSITION_REASON_NOT_NORMALIZED",
            fieldPath: `${transitionDetails.fieldPath}/reason`,
            message: "Pedagogical Transition reason must use normalized whitespace.",
          });
          structurallyValid = false;
        }
      }
    }

    if (Array.isArray(entries) && Array.isArray(transitions) && transitions.length === Math.max(0, entries.length - 1)) {
      for (const [index, transition] of transitions.entries()) {
        if (!isObject(transition) || !isObject(entries[index]) || !isObject(entries[index + 1])) {
          continue;
        }
        const expectedSource = entries[index].work_id;
        const expectedTarget = entries[index + 1].work_id;
        if (
          transition.source_work_id !== expectedSource ||
          transition.target_work_id !== expectedTarget
        ) {
          addDiagnostic(diagnostics, {
            ...details,
            code: "LEARNING_PATH_TRANSITION_ADJACENCY_INVALID",
            fieldPath: `/transitions/${index}`,
            message: "Each Pedagogical Transition must connect the adjacent path entries in order.",
            relatedIds: [expectedSource, expectedTarget, transition.source_work_id, transition.target_work_id]
              .filter((value) => typeof value === "string"),
          });
        }
      }
    }

    if (!structurallyValid) {
      invalidPathIds.add(learningPath.id);
      continue;
    }
    validateGovernedRecord(path, actorsById, {
      ...details,
      fieldPath: "",
    }, diagnostics);
    validateLearningPathReviewBinding(path, {
      ...details,
      fieldPath: "",
    }, diagnostics);
    if (diagnostics.slice(diagnosticStart).some(({ severity }) => severity === "error")) {
      invalidPathIds.add(learningPath.id);
      continue;
    }
    learningPaths.push({ learningPath, path });
  }

  return { learningPaths, invalidPathIds };
}

function validateFinalSnapshotVisibility(snapshot, actorsById, diagnostics, editorialState) {
  const {
    memberships,
    invalidLineIds,
    invalidWorkIds,
    invalidPathIds = new Set(),
  } = editorialState;
  const visibilityByWorkId = new Map();
  const visibilityByLineId = new Map();
  const visibilityByPathId = new Map();
  const visibleWorks = new Set(
    // A quarantined child membership still names a visible Work endpoint.
    // Keep endpoint candidates intact so an unrelated visible Research Line
    // does not acquire a derived membership failure.
    snapshot.works
      .filter((work) => work.files["work.yaml"]?.reader_state === "visible")
      .map((work) => work.id),
  );
  const visibleLines = new Set(
    // Likewise, retain a visible line endpoint while its malformed child is
    // quarantined; otherwise valid anchor memberships would cascade into
    // VISIBLE_WORK_ANCHOR_LINE_NOT_VISIBLE diagnostics.
    snapshot.researchLines
      .filter((line) =>
        line.line?.reader_state === "visible")
      .map((line) => line.id),
  );
  const activeTechniqueIds = new Set(
    (Array.isArray(snapshot.methods?.techniques) ? snapshot.methods.techniques : [])
      .filter((technique) => technique?.status === "active")
      .map((technique) => technique.id),
  );

  for (const work of snapshot.works) {
    const record = work.files["work.yaml"];
    if (!isObject(record)) {
      continue;
    }
    const workPath = resolveWorkPath(work);
    const details = { file: `${workPath}/work.yaml`, recordId: work.id };
    const structurallyInvalid = invalidWorkIds.has(work.id) || diagnostics.some(
      (diagnostic) =>
        diagnostic.file?.startsWith(`${workPath}/`) && isStructuralDiagnostic(diagnostic),
    );
    if (structurallyInvalid) {
      visibilityByWorkId.set(work.id, { visibility_digest: null, visibility_status: "skipped" });
      continue;
    }
    const digest = computeReaderVisibilityDigest(snapshot, "work", work.id);
    const approval = validateVisibilityApprovals(
      record,
      work,
      details,
      snapshot.manifest,
      actorsById,
      digest,
      diagnostics,
    );
    visibilityByWorkId.set(work.id, { visibility_digest: digest, visibility_status: approval.status });

    if (record.reader_state !== "visible") {
      continue;
    }
    const versions = work.files["versions.yaml"]?.versions;
    if (!Array.isArray(versions) || versions.length === 0) {
      addDiagnostic(diagnostics, { ...details, code: "VISIBLE_WORK_VERSION_REQUIRED", fieldPath: "/reader_state", message: "A visible Work requires at least one Version." });
    }
    if (typeof work.files["reading.md"] !== "string" || work.files["reading.md"].trim() === "") {
      addDiagnostic(diagnostics, { ...details, code: "VISIBLE_WORK_READING_REQUIRED", fieldPath: "/reader_state", message: "A visible Work requires renderable reading prose." });
    }
    const annotations = work.files["annotations.yaml"]?.annotations;
    const assessedAxes = new Set(
      (Array.isArray(annotations) ? annotations : [])
        .filter((annotation) => annotation?.assessment?.state && annotation.assessment.state !== "not_assessed")
        .map((annotation) => annotation.axis),
    );
    if (AXIS_IDS.some((axisId) => !assessedAxes.has(axisId))) {
      addDiagnostic(diagnostics, { ...details, code: "VISIBLE_WORK_AXIS_COVERAGE_INCOMPLETE", fieldPath: "/reader_state", message: "A visible V0.1 Work requires all 16 Physics axes to be assessed." });
    }
    const methods = work.files["annotations.yaml"]?.method_annotations;
    if (!(Array.isArray(methods) && methods.some((method) =>
      method?.review_state === "reviewed" && activeTechniqueIds.has(method.technique_id)))) {
      addDiagnostic(diagnostics, { ...details, code: "VISIBLE_WORK_METHOD_REQUIRED", fieldPath: "/reader_state", message: "A visible Work requires a reviewed active technique-level Method Annotation." });
    }

    const workMemberships = memberships.filter(({ membership }) => membership.work_id === work.id);
    if (workMemberships.length === 0) {
      addDiagnostic(diagnostics, { ...details, code: "VISIBLE_WORK_MEMBERSHIP_REQUIRED", fieldPath: "/reader_state", message: "A visible Work requires at least one Research Line Membership." });
    }
    const anchors = workMemberships.filter(({ membership }) => membership.editorial_anchor === true);
    if (anchors.length !== 1) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "EDITORIAL_ANCHOR_CARDINALITY_INVALID",
        fieldPath: "/reader_state",
        message: "A visible Work requires exactly one global Editorial Anchor membership.",
        relatedIds: anchors.map(({ membership }) => membership.id).filter(Boolean),
      });
    } else {
      const anchor = anchors[0];
      if (!visibleLines.has(anchor.researchLine.id)) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "VISIBLE_WORK_ANCHOR_LINE_NOT_VISIBLE",
          fieldPath: "/reader_state",
          message: "A visible Work's Editorial Anchor must belong to a visible Research Line.",
          relatedIds: [anchor.researchLine.id],
        });
      }
      if (anchor.membership.review_state !== "reviewed") {
        addDiagnostic(diagnostics, {
          ...details,
          code: "VISIBLE_WORK_ANCHOR_MEMBERSHIP_NOT_REVIEWED",
          fieldPath: "/reader_state",
          message: "A visible Work's Editorial Anchor membership must be reviewed.",
          relatedIds: [anchor.membership.id].filter(Boolean),
        });
      }
    }
  }

  for (const researchLine of snapshot.researchLines) {
    const record = researchLine.line;
    if (!isObject(record)) {
      continue;
    }
    const linePath = resolveResearchLinePath(researchLine);
    const details = { file: `${linePath}/line.yaml`, recordId: researchLine.id };
    const structurallyInvalid = invalidLineIds.has(researchLine.id) || diagnostics.some(
      (diagnostic) =>
        diagnostic.file?.startsWith(`${linePath}/`) && isStructuralDiagnostic(diagnostic),
    );
    if (structurallyInvalid) {
      visibilityByLineId.set(researchLine.id, { visibility_digest: null, visibility_status: "skipped" });
      continue;
    }
    const digest = computeReaderVisibilityDigest(snapshot, "research_line", researchLine.id);
    const approval = validateVisibilityApprovals(
      record,
      researchLine,
      details,
      snapshot.manifest,
      actorsById,
      digest,
      diagnostics,
    );
    visibilityByLineId.set(researchLine.id, { visibility_digest: digest, visibility_status: approval.status });
    if (record.reader_state !== "visible") {
      continue;
    }
    const eligible = memberships.filter(
      ({ researchLine: owner, membership }) =>
        owner.id === researchLine.id &&
        membership.review_state === "reviewed" &&
        visibleWorks.has(membership.work_id),
    );
    if (eligible.length === 0) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "VISIBLE_RESEARCH_LINE_MEMBERSHIP_REQUIRED",
        fieldPath: "/memberships",
        message: "A visible Research Line requires at least one reviewed membership to a visible Work.",
      });
    }
  }

  for (const learningPath of snapshot.learningPaths) {
    const record = learningPath.path;
    if (!isObject(record)) {
      continue;
    }
    const pathRoot = resolveLearningPathPath(learningPath);
    const details = {
      file: `${pathRoot}/path.yaml`,
      recordId: learningPath.id,
    };
    const structurallyInvalid = invalidPathIds.has(learningPath.id) || diagnostics.some(
      (diagnostic) =>
        diagnostic.file?.startsWith(`${pathRoot}/`) && isStructuralDiagnostic(diagnostic),
    );
    if (structurallyInvalid) {
      visibilityByPathId.set(learningPath.id, {
        visibility_digest: null,
        visibility_status: "skipped",
      });
      continue;
    }
    const digest = computeReaderVisibilityDigest(snapshot, "learning_path", learningPath.id);
    const approval = validateVisibilityApprovals(
      record,
      learningPath,
      details,
      snapshot.manifest,
      actorsById,
      digest,
      diagnostics,
    );
    visibilityByPathId.set(learningPath.id, {
      visibility_digest: digest,
      visibility_status: approval.status,
    });
    if (record.reader_state !== "visible") {
      continue;
    }
    const entries = record.entries;
    if (!Array.isArray(entries) || entries.length < 2) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "VISIBLE_LEARNING_PATH_ENTRIES_REQUIRED",
        fieldPath: "/entries",
        message: "A visible Learning Path requires at least two ordered Work entries.",
      });
    }
    if (record.review_state !== "reviewed") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "VISIBLE_LEARNING_PATH_REVIEW_REQUIRED",
        fieldPath: "/review_state",
        message: "A visible Learning Path requires reviewed atomic structured content.",
      });
    }
    for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
      if (!isObject(entry) || typeof entry.work_id !== "string") {
        continue;
      }
      const work = snapshot.works.find((candidate) => candidate.id === entry.work_id);
      if (work && !visibleWorks.has(entry.work_id)) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "VISIBLE_LEARNING_PATH_WORK_NOT_VISIBLE",
          fieldPath: `/entries/${index}/work_id`,
          message: "A visible Learning Path may reference only visible Works.",
          relatedIds: [entry.work_id],
        });
      }
    }
  }

  const researchLineInventory = deriveResearchLineInventory(
    snapshot,
    diagnostics,
    visibilityByLineId,
  );
  const learningPathInventory = deriveLearningPathInventory(
    snapshot,
    diagnostics,
    visibilityByPathId,
  );
  return { visibilityByWorkId, researchLineInventory, learningPathInventory };
}

function deriveResearchLineInventory(snapshot, diagnostics, visibilityByLineId = new Map()) {
  return snapshot.researchLines
    .map((researchLine) => {
      const path = resolveResearchLinePath(researchLine);
      const visibility = visibilityByLineId.get(researchLine.id) ?? {};
      return {
        line_id: researchLine.id,
        reader_state: researchLine.line?.reader_state ?? null,
        validation_status: diagnostics.some(({ file, record_id, severity }) =>
          severity === "error" && (file === path || file?.startsWith(`${path}/`) || record_id === researchLine.id))
          ? "invalid"
          : "valid",
        memberships: Array.isArray(researchLine.line?.memberships) ? researchLine.line.memberships.length : 0,
        ...visibility,
      };
    })
    .sort((left, right) => Buffer.from(left.line_id).compare(Buffer.from(right.line_id)));
}

function deriveLearningPathInventory(snapshot, diagnostics, visibilityByPathId = new Map()) {
  return snapshot.learningPaths
    .map((learningPath) => {
      const path = resolveLearningPathPath(learningPath);
      const visibility = visibilityByPathId.get(learningPath.id) ?? {};
      const record = learningPath.path;
      return {
        path_id: learningPath.id,
        reader_state: record?.reader_state ?? null,
        validation_status: diagnostics.some(({ file, record_id, severity }) =>
          severity === "error" && (file === path || file?.startsWith(`${path}/`) || record_id === learningPath.id))
          ? "invalid"
          : "valid",
        entries: Array.isArray(record?.entries) ? record.entries.length : 0,
        transitions: Array.isArray(record?.transitions) ? record.transitions.length : 0,
        ...visibility,
      };
    })
    .sort((left, right) => Buffer.from(left.path_id).compare(Buffer.from(right.path_id)));
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
  if (locator.page !== undefined && (!Number.isInteger(locator.page) || locator.page <= 0)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "EVIDENCE_LOCATOR_PAGE_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/locator/page`,
      message: "Evidence locator page must be a positive integer when supplied.",
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
  const file = `${resolveWorkPath(work)}/evidence.yaml`;
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

export function statementSemanticDigest(statement) {
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
  const file = `${resolveWorkPath(work)}/statements.yaml`;
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

/**
 * Scientific Edge review bindings cover the assertion itself, but not its
 * curation/review metadata or independent Disposition axis.  Evidence IDs
 * are a set-like semantic collection for this purpose, while endpoint and
 * optional Statement direction remain significant.
 */
export function scientificEdgeSemanticDigest(edge) {
  const semanticProjection = {
    source_work_id: edge?.source_work_id ?? null,
    source_statement_id: edge?.source_statement_id ?? null,
    target_work_id: edge?.target_work_id ?? null,
    target_statement_id: edge?.target_statement_id ?? null,
    relation: edge?.relation ?? null,
    basis: edge?.basis ?? null,
    reason: normalizeStatementText(edge?.reason),
    evidence_ids: Array.isArray(edge?.evidence_ids)
      ? [...edge.evidence_ids].sort((left, right) =>
        Buffer.from(String(left)).compare(Buffer.from(String(right))))
      : edge?.evidence_ids ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(semanticProjection), "utf8")
    .digest("hex");
}

function validateScientificEdgeReviewBinding(edge, details, diagnostics) {
  if (edge.review_state !== "reviewed") {
    return true;
  }
  const binding = edge.review_binding;
  if (!isObject(binding)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "SCIENTIFIC_EDGE_REVIEW_BINDING_REQUIRED",
      fieldPath: `${details.fieldPath ?? ""}/review_binding`,
      message: "A reviewed Scientific Edge requires a semantic review binding.",
    });
    return false;
  }
  let valid = true;
  if (binding.canonicalization_version !== CANONICALIZATION_VERSION) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "SCIENTIFIC_EDGE_REVIEW_BINDING_VERSION_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/review_binding/canonicalization_version`,
      message: "Scientific Edge review binding uses an unsupported canonicalization version.",
      relatedIds: [CANONICALIZATION_VERSION],
    });
    valid = false;
  }
  const expectedDigest = scientificEdgeSemanticDigest(edge);
  if (binding.semantic_digest !== expectedDigest) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "SCIENTIFIC_EDGE_REVIEW_BINDING_STALE",
      fieldPath: `${details.fieldPath ?? ""}/review_binding/semantic_digest`,
      message: "Reviewed Scientific Edge semantic fields no longer match its review binding.",
    });
    valid = false;
  }
  return valid;
}

function validateScientificEdgeGovernance(edge, actorsById, details, diagnostics) {
  let valid = true;
  const reviewState = edge?.review_state;

  // Validate curation authorship for every Edge, then handle the procedural
  // review state locally so the Edge-specific metadata diagnostic remains
  // stable without changing the shared governance behavior of other records.
  const governanceOptions = reviewState === "reviewed"
    ? { independentReview: edge.basis === "inferred" }
    : { reviewRequired: false };
  if (!validateGovernedRecord(edge, actorsById, details, diagnostics, governanceOptions)) {
    valid = false;
  }

  if (!REVIEW_STATES.includes(reviewState)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: "REVIEW_STATE_INVALID",
      fieldPath: `${details.fieldPath ?? ""}/review_state`,
      message: "Governed Scientific Edges require review_state unreviewed or reviewed.",
      relatedIds: REVIEW_STATES,
    });
    return false;
  }

  if (reviewState === "unreviewed") {
    for (const field of ["review_provenance", "review_binding"]) {
      if (edge[field] !== undefined) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "SCIENTIFIC_EDGE_UNREVIEWED_REVIEW_METADATA",
          fieldPath: `${details.fieldPath ?? ""}/${field}`,
          message: "An unreviewed Scientific Edge cannot carry review metadata.",
        });
        valid = false;
      }
    }
    return valid;
  }

  return valid;
}

function scientificEdgeReferences(snapshot) {
  const worksById = new Map(
    (Array.isArray(snapshot?.works) ? snapshot.works : [])
      .filter((work) => isObject(work) && typeof work.id === "string")
      .map((work) => [work.id, work]),
  );
  const statementOwners = new Map();
  const statementRecords = new Map();
  const evidenceOwners = new Map();
  const evidenceRecords = new Map();
  for (const work of worksById.values()) {
    const statements = work.files?.["statements.yaml"]?.statements;
    for (const statement of Array.isArray(statements) ? statements : []) {
      if (!isObject(statement) || typeof statement.id !== "string") {
        continue;
      }
      if (!statementOwners.has(statement.id)) {
        statementOwners.set(statement.id, new Set());
      }
      statementOwners.get(statement.id).add(work.id);
      if (!statementRecords.has(statement.id)) {
        statementRecords.set(statement.id, []);
      }
      statementRecords.get(statement.id).push({ workId: work.id, record: statement });
    }
    const evidence = work.files?.["evidence.yaml"]?.evidence;
    for (const record of Array.isArray(evidence) ? evidence : []) {
      if (!isObject(record) || typeof record.id !== "string") {
        continue;
      }
      if (!evidenceOwners.has(record.id)) {
        evidenceOwners.set(record.id, new Set());
      }
      evidenceOwners.get(record.id).add(work.id);
      if (!evidenceRecords.has(record.id)) {
        evidenceRecords.set(record.id, []);
      }
      evidenceRecords.get(record.id).push({ workId: work.id, record });
    }
  }
  return { worksById, statementOwners, statementRecords, evidenceOwners, evidenceRecords };
}

/**
 * Validate the global one-file-per-record Scientific Edge collection.  The
 * returned projection IDs let the visibility pass quarantine records with
 * any Edge-local failure, preventing malformed global records from changing
 * an otherwise unrelated Work's reader digest.
 */
function validateScientificEdges(snapshot, actorsById, diagnostics) {
  const fileRecords = Array.isArray(snapshot?.scientificEdges)
    ? snapshot.scientificEdges
    : [];
  const {
    worksById,
    statementOwners,
    statementRecords,
    evidenceOwners,
    evidenceRecords,
  } = scientificEdgeReferences(snapshot);
  const seenIds = new Map();
  const seenDeltas = new Map();
  const projectionEdgeSourcePaths = new Set();
  const relationCounts = Object.fromEntries(
    SCIENTIFIC_EDGE_RELATIONS.map((relation) => [relation, 0]),
  );

  for (const entry of fileRecords) {
    const fileId = entry?.id;
    const file = resolveScientificEdgePath(entry);
    const edge = entry?.value;
    const details = {
      file,
      recordId: isObject(edge) && edge.id !== undefined ? edge.id : fileId,
      fieldPath: null,
    };
    const diagnosticStart = diagnostics.length;

    if (!isObject(edge) || hasParseDiagnostic(diagnostics, file)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "SCIENTIFIC_EDGE_INVALID_SHAPE",
        message: "A Scientific Edge record must be a YAML mapping.",
      });
      continue;
    }

    let structurallyValid = true;
    if (!validateNamespacedId(edge.id, "edge", {
      ...details,
      code: "SCIENTIFIC_EDGE_ID_INVALID",
      fieldPath: "/id",
      message: "Scientific Edge IDs must use the edge: namespace.",
    }, diagnostics)) {
      structurallyValid = false;
    }
    if (seenIds.has(edge.id)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "SCIENTIFIC_EDGE_ID_DUPLICATE",
        fieldPath: "/id",
        message: `Scientific Edge ID is duplicated: ${edge.id}.`,
        relatedIds: [seenIds.get(edge.id), edge.id].filter(Boolean),
      });
      structurallyValid = false;
    } else if (typeof edge.id === "string") {
      seenIds.set(edge.id, fileId);
    }

    if (!SCIENTIFIC_EDGE_RELATIONS.includes(edge.relation)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "SCIENTIFIC_EDGE_RELATION_INVALID",
        fieldPath: "/relation",
        message: "Scientific Edge relation is not in the frozen seven-value vocabulary.",
        relatedIds: SCIENTIFIC_EDGE_RELATIONS,
      });
      structurallyValid = false;
    }
    if (!ASSERTION_BASES.includes(edge.basis)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "SCIENTIFIC_EDGE_BASIS_INVALID",
        fieldPath: "/basis",
        message: "Scientific Edge basis must be explicit or inferred.",
        relatedIds: ASSERTION_BASES,
      });
      structurallyValid = false;
    }
    if (!SCIENTIFIC_EDGE_DISPOSITIONS.includes(edge.disposition)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "SCIENTIFIC_EDGE_DISPOSITION_INVALID",
        fieldPath: "/disposition",
        message: "Scientific Edge disposition must be active, contested, superseded, or withdrawn.",
        relatedIds: SCIENTIFIC_EDGE_DISPOSITIONS,
      });
      structurallyValid = false;
    }
    const normalizedReason = normalizeStatementText(edge.reason);
    if (typeof edge.reason !== "string" || edge.reason.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "SCIENTIFIC_EDGE_REASON_INVALID",
        fieldPath: "/reason",
        message: "Scientific Edges require a non-empty reason.",
      });
      structurallyValid = false;
    }

    const endpointValues = {
      source: edge.source_work_id,
      target: edge.target_work_id,
    };
    const endpointExists = { source: false, target: false };
    for (const side of ["source", "target"]) {
      const workId = endpointValues[side];
      if (!isNamespacedId(workId, "work")) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "SCIENTIFIC_EDGE_ENDPOINT_INVALID",
          fieldPath: `/${side}_work_id`,
          message: `Scientific Edge ${side} endpoint must use the work: namespace.`,
        });
        structurallyValid = false;
        continue;
      }
      endpointExists[side] = worksById.has(workId);
      if (!endpointExists[side]) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "REFERENTIAL_SCIENTIFIC_EDGE_WORK_MISSING",
          fieldPath: `/${side}_work_id`,
          message: `Scientific Edge ${side} Work does not exist: ${workId}.`,
          relatedIds: [workId],
        });
      }
    }
    if (
      typeof endpointValues.source === "string" &&
      typeof endpointValues.target === "string" &&
      endpointValues.source === endpointValues.target
    ) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "SCIENTIFIC_EDGE_SELF_LOOP",
        fieldPath: "/target_work_id",
        message: "A Scientific Edge cannot point from a Work to itself.",
        relatedIds: [endpointValues.source],
      });
      structurallyValid = false;
    }

    for (const side of ["source", "target"]) {
      const field = `${side}_statement_id`;
      const statementId = edge[field];
      if (statementId === undefined) {
        continue;
      }
      if (!isNamespacedId(statementId, "statement")) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "SCIENTIFIC_EDGE_ENDPOINT_INVALID",
          fieldPath: `/${field}`,
          message: `Scientific Edge ${side} Statement endpoint must use the statement: namespace.`,
        });
        structurallyValid = false;
        continue;
      }
      const owners = statementOwners.get(statementId);
      if (!owners) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "REFERENTIAL_SCIENTIFIC_EDGE_STATEMENT_MISSING",
          fieldPath: `/${field}`,
          message: `Scientific Edge ${side} Statement does not exist: ${statementId}.`,
          relatedIds: [statementId],
        });
      } else if (!owners.has(endpointValues[side])) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "SCIENTIFIC_EDGE_STATEMENT_WORK_MISMATCH",
          fieldPath: `/${field}`,
          message: `Scientific Edge ${side} Statement must belong to its ${side} Work.`,
          relatedIds: [statementId, endpointValues[side]].filter(Boolean),
        });
      } else if (
        edge.review_state === "reviewed" &&
        statementRecords.get(statementId)?.some(
          ({ workId, record }) =>
            workId === endpointValues[side] && record.review_state === "unreviewed",
        )
      ) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "SCIENTIFIC_EDGE_STATEMENT_NOT_REVIEWED",
          fieldPath: `/${field}`,
          message: "A reviewed Scientific Edge cannot expose an unreviewed Statement endpoint.",
          relatedIds: [statementId],
        });
      }
    }

    let evidenceReferencesValid = true;
    const evidenceOwnersById = new Map();
    if (!Array.isArray(edge.evidence_ids) || edge.evidence_ids.length === 0) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "SCIENTIFIC_EDGE_EVIDENCE_INVALID",
        fieldPath: "/evidence_ids",
        message: "Scientific Edges require a non-empty array of Evidence IDs.",
      });
      evidenceReferencesValid = false;
    } else {
      const seenEvidence = new Set();
      for (const [index, evidenceId] of edge.evidence_ids.entries()) {
        const evidencePath = `/evidence_ids/${index}`;
        if (typeof evidenceId !== "string" || evidenceId.trim() === "") {
          addDiagnostic(diagnostics, {
            ...details,
            code: "SCIENTIFIC_EDGE_EVIDENCE_INVALID",
            fieldPath: evidencePath,
            message: "Scientific Edge Evidence IDs must be non-empty strings.",
          });
          evidenceReferencesValid = false;
          continue;
        }
        if (seenEvidence.has(evidenceId)) {
          addDiagnostic(diagnostics, {
            ...details,
            code: "SCIENTIFIC_EDGE_EVIDENCE_DUPLICATE",
            fieldPath: evidencePath,
            message: `A Scientific Edge cannot repeat an Evidence ID: ${evidenceId}.`,
            relatedIds: [evidenceId],
          });
          evidenceReferencesValid = false;
        }
        seenEvidence.add(evidenceId);

        const owners = evidenceOwners.get(evidenceId);
        if (!owners) {
          addDiagnostic(diagnostics, {
            ...details,
            code: "REFERENTIAL_SCIENTIFIC_EDGE_EVIDENCE_MISSING",
            fieldPath: evidencePath,
            message: `Scientific Edge Evidence does not exist: ${evidenceId}.`,
            relatedIds: [evidenceId],
          });
          evidenceReferencesValid = false;
          continue;
        }
        if (
          !owners.has(endpointValues.source) &&
          !owners.has(endpointValues.target)
        ) {
          addDiagnostic(diagnostics, {
            ...details,
            code: "SCIENTIFIC_EDGE_EVIDENCE_WORK_MISMATCH",
            fieldPath: evidencePath,
            message: "Scientific Edge Evidence must belong to its source or target Work.",
            relatedIds: [evidenceId, endpointValues.source, endpointValues.target].filter(Boolean),
          });
          evidenceReferencesValid = false;
          continue;
        }
        evidenceOwnersById.set(evidenceId, owners);
        if (
          edge.review_state === "reviewed" &&
          evidenceRecords.get(evidenceId)?.some(
            ({ workId, record }) =>
              (workId === endpointValues.source || workId === endpointValues.target) &&
              record.review_state === "unreviewed",
          )
        ) {
          addDiagnostic(diagnostics, {
            ...details,
            code: "SCIENTIFIC_EDGE_EVIDENCE_NOT_REVIEWED",
            fieldPath: evidencePath,
            message: "A reviewed Scientific Edge cannot depend on unreviewed Evidence.",
            relatedIds: [evidenceId],
          });
          evidenceReferencesValid = false;
        }
      }
    }

    if (
      evidenceReferencesValid &&
      endpointExists.source &&
      endpointExists.target &&
      edge.basis === "explicit" &&
      ![...evidenceOwnersById.values()].some((owners) => owners.has(endpointValues.source))
    ) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "SCIENTIFIC_EDGE_SOURCE_EVIDENCE_REQUIRED",
        fieldPath: "/evidence_ids",
        message: "An explicit Scientific Edge requires at least one source-Work Evidence record.",
        relatedIds: [endpointValues.source],
      });
      structurallyValid = false;
    }
    if (
      evidenceReferencesValid &&
      endpointExists.source &&
      endpointExists.target &&
      edge.basis === "inferred"
    ) {
      const sourceEvidence = [...evidenceOwnersById.values()]
        .some((owners) => owners.has(endpointValues.source));
      const targetEvidence = [...evidenceOwnersById.values()]
        .some((owners) => owners.has(endpointValues.target));
      if (!sourceEvidence || !targetEvidence) {
        addDiagnostic(diagnostics, {
          ...details,
          code: "SCIENTIFIC_EDGE_BILATERAL_EVIDENCE_REQUIRED",
          fieldPath: "/evidence_ids",
          message: "An inferred Scientific Edge requires Evidence from both endpoint Works.",
          relatedIds: [endpointValues.source, endpointValues.target].filter(Boolean),
        });
        structurallyValid = false;
      }
    }

    const deltaEligible = structurallyValid &&
      endpointExists.source && endpointExists.target &&
      typeof normalizedReason === "string" && normalizedReason !== "";
    if (deltaEligible) {
      const deltaKey = `${endpointValues.source}\0${endpointValues.target}\0${normalizedReason}`;
      if (seenDeltas.has(deltaKey)) {
        const prior = seenDeltas.get(deltaKey);
        addDiagnostic(diagnostics, {
          ...details,
          code: "SCIENTIFIC_EDGE_DELTA_DUPLICATE",
          fieldPath: null,
          message: "Scientific Edge duplicates an existing Scientific Delta for the same directed Work pair.",
          relatedIds: [prior, edge.id].filter(Boolean),
        });
      } else {
        seenDeltas.set(deltaKey, edge.id);
      }
    }

    validateScientificEdgeGovernance(edge, actorsById, details, diagnostics);
    validateScientificEdgeReviewBinding(edge, details, diagnostics);

    // A record enters the reader projection only when every validation local
    // to that record succeeded.  This keeps unrelated visible Work digests
    // independent of malformed global Edge files.
    const recordDiagnostics = diagnostics.slice(diagnosticStart);
    if (recordDiagnostics.length === 0) {
      projectionEdgeSourcePaths.add(file);
      if (SCIENTIFIC_EDGE_RELATIONS.includes(edge.relation)) {
        relationCounts[edge.relation] += 1;
      }
    }
  }
  return { projectionEdgeSourcePaths, relationCounts };
}

export function causalLinkSemanticDigest(link) {
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
  const file = `${resolveWorkPath(work)}/physical-account.yaml`;
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
  const file = `${resolveWorkPath(work)}/annotations.yaml`;
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
  if (V01_FIXTURE_WORK_IDS.has(work.id)) {
    for (const axisId of AXIS_IDS) {
      if (!seenAxes.has(axisId)) {
        addDiagnostic(diagnostics, {
          file,
          recordId: work.id,
          code: "ANNOTATION_AXIS_COVERAGE_INCOMPLETE",
          fieldPath: "/annotations",
          message: `The V0.1 fixture profile requires an assessment for axis ${axisId}.`,
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
  const file = `${resolveWorkPath(work)}/annotations.yaml`;
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
  const seenWorkIds = new Set();
  for (const work of snapshot.works) {
    const workPath = resolveWorkPath(work);
    const workFile = `${workPath}/work.yaml`;
    const workRecord = work.files["work.yaml"];
    if (!isObject(workRecord) || hasParseDiagnostic(diagnostics, workFile)) {
      continue;
    }
    const details = { file: workFile, recordId: work.id };
    const validWorkId = validateNamespacedId(workRecord.work_id, "work", {
      ...details,
      code: "WORK_ID_INVALID",
      fieldPath: "/work_id",
      message: "Work IDs must use the work: namespace.",
    }, diagnostics);
    if (validWorkId && seenWorkIds.has(workRecord.work_id)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "WORK_ID_DUPLICATE",
        fieldPath: "/work_id",
        message: `Work ID is duplicated: ${workRecord.work_id}.`,
        relatedIds: [workRecord.work_id],
      });
    } else if (validWorkId) {
      seenWorkIds.add(workRecord.work_id);
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
      const file = `${workPath}/${fileName}`;
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
          message: `${fileName} work_id must match the canonical Work ID.`,
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
        file: `${workPath}/reading.md`,
        fieldPath: "/work_id",
        message: "Work reading.md must begin with YAML frontmatter containing work_id.",
      });
    } else if (frontmatter.work_id !== work.id) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "WORK_READING_OWNERSHIP_MISMATCH",
        file: `${workPath}/reading.md`,
        fieldPath: "/work_id",
        message: "reading.md frontmatter work_id must match the canonical Work ID.",
        relatedIds: [work.id],
      });
    }
    if (typeof reading === "string" && reading.trim() === "") {
      addDiagnostic(diagnostics, {
        ...details,
        code: "WORK_READING_EMPTY",
        file: `${workPath}/reading.md`,
        fieldPath: null,
        message: "Work reading.md must contain reader-facing prose.",
      });
    }

    const versionsEnvelope = work.files["versions.yaml"];
    if (!isObject(versionsEnvelope) || hasParseDiagnostic(diagnostics, `${workPath}/versions.yaml`)) {
      continue;
    }
    if (!Array.isArray(versionsEnvelope.versions)) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "VERSION_COLLECTION_INVALID",
        file: `${workPath}/versions.yaml`,
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
            file: `${workPath}/versions.yaml`,
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
        file: `${workPath}/versions.yaml`,
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
          file: `${workPath}/versions.yaml`,
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
          file: `${workPath}/versions.yaml`,
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
        file: `${workPath}/versions.yaml`,
      },
      diagnostics,
    );
    validatePublicationRelations(
      versionsEnvelope,
      versionsById,
      sourceIds,
      actorsById,
      {
        ...details,
        file: `${workPath}/versions.yaml`,
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
          file: `${workPath}/${fileName}`,
          fieldPath: `/${field}`,
          message: `${fileName} must contain an explicit ${field} array.`,
        });
      }
    }
  }
}

function validateRecordEnvelopes(snapshot, diagnostics) {
  for (const work of snapshot.works) {
    const workPath = resolveWorkPath(work);
    for (const fileName of ["work.yaml", "versions.yaml", "evidence.yaml", "annotations.yaml", "statements.yaml", "physical-account.yaml"]) {
      const value = work.files[fileName];
      if (value !== undefined && !isObject(value)) {
        addDiagnostic(diagnostics, {
          code: "STRUCTURE_WORK_RECORD_INVALID_SHAPE",
          file: `${workPath}/${fileName}`,
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
  const workPath = resolveWorkPath(work);
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

function deriveWorkInventory(
  snapshot,
  diagnostics,
  { actorRegistryValid = true, visibilityByWorkId = new Map() } = {},
) {
  return [...snapshot.works]
    .sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)))
    .map((work) => {
      const workPath = resolveWorkPath(work);
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
      const visibility = visibilityByWorkId.get(work.id) ?? {};
      const readerState = work.files["work.yaml"]?.reader_state ?? null;
      return {
        work_id: work.id,
        reader_state: readerState,
        validation_status: workDiagnostics.some(({ severity }) => severity === "error") ||
          (readerState === "visible" && visibility.visibility_status !== "approved")
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
        ...visibility,
      };
    });
}

export async function validateCanonicalContent(
  contentRoot = CONTENT_ROOT,
  { dataset = "production" } = {},
) {
  const reportDataset = typeof dataset === "string" && dataset.trim() !== ""
    ? dataset
    : "production";
  const snapshot = await loadCanonicalContent(contentRoot);
  const diagnostics = [...snapshot.discovery.diagnostics];
  const actorRegistryValid = !hasParseDiagnostic(diagnostics, "content/actors.yaml")
    && validateActors(snapshot.actors, diagnostics);
  const actorsById = actorRegistryValid ? actorMap(snapshot.actors) : null;
  let editorialState = {
    memberships: [],
    invalidLineIds: new Set(),
    invalidWorkIds: new Set(),
    learningPaths: [],
    invalidPathIds: new Set(),
  };
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
    const researchLineState = validateResearchLines(snapshot, actorsById, diagnostics);
    const learningPathState = validateLearningPaths(snapshot, actorsById, diagnostics);
    editorialState = {
      ...researchLineState,
      ...learningPathState,
    };
  }
  validateRecordEnvelopes(snapshot, diagnostics);

  // Scientific Edges are global records, so validate them after Work-local
  // registries have been loaded but before any Work visibility digest is
  // computed.  Invalid Edge records are quarantined from that dependent pass.
  const scientificEdgeState = validateScientificEdges(snapshot, actorsById, diagnostics);
  const visibilitySnapshot = {
    ...snapshot,
    scientificEdges: snapshot.scientificEdges.filter((edge) =>
      scientificEdgeState.projectionEdgeSourcePaths.has(resolveScientificEdgePath(edge))),
  };

  const manifestSupportsVisibility =
    !hasParseDiagnostic(diagnostics, "content/manifest.yaml") &&
    isObject(snapshot.manifest) &&
    VALID_CANONICALIZATION_VERSIONS.includes(snapshot.manifest.canonicalization_version) &&
    VALID_VISIBILITY_PROFILE_IDS.includes(snapshot.manifest.visibility_profile_id);
  // Discovery-level structural failures quarantine the snapshot's dependent
  // passes.  Do not run final-snapshot visibility with the empty editorial
  // state produced by that quarantine: doing so would manufacture membership
  // and anchor errors for otherwise untouched visible Works.
  const visibilityState = actorRegistryValid && manifestSupportsVisibility &&
    !hasStructuralFailure(snapshot.discovery.diagnostics)
    ? validateFinalSnapshotVisibility(visibilitySnapshot, actorsById, diagnostics, editorialState)
    : {
      visibilityByWorkId: new Map(),
      researchLineInventory: deriveResearchLineInventory(snapshot, diagnostics),
      learningPathInventory: deriveLearningPathInventory(snapshot, diagnostics),
    };
  const {
    visibilityByWorkId,
    researchLineInventory,
    learningPathInventory,
  } = visibilityState;

  const canonicalContentDigest = await computeCanonicalContentDigest(snapshot.discovery.root);
  const manifest = snapshot.manifest;
  const workInventory = deriveWorkInventory(snapshot, diagnostics, {
    actorRegistryValid,
    visibilityByWorkId,
  });
  const accountStatusByWorkId = new Map(
    workInventory.map((work) => [work.work_id, work.scientific_account_validation_status]),
  );
  const scientificEdges = snapshot.scientificEdges
    .map(({ id, value }) => ({
      ...(isObject(value) ? value : {}),
      id: isObject(value) && value.id !== undefined ? value.id : id,
    }))
    .filter((edge) => edge.review_state === "reviewed");
  // Every validator diagnostic is created through shared helpers while the
  // passes run.  Rebind the dataset once at the report boundary so isolated
  // synthetic fixtures can be identified without teaching every pass about
  // test-only paths or changing production defaults.
  const reportDiagnostics = diagnostics.map((diagnostic) => ({
    ...diagnostic,
    dataset: reportDataset,
  }));
  const report = {
    dataset: reportDataset,
    valid: isValidationValid(reportDiagnostics),
    validator_version: VALIDATOR_VERSION,
    schema_version: typeof manifest.schema_version === "string" ? manifest.schema_version : null,
    canonicalization_version:
      manifest.canonicalization_version ?? null,
    visibility_profile_id: manifest.visibility_profile_id ?? null,
    canonical_content_digest: canonicalContentDigest,
    passes: determinePasses(diagnostics, snapshot.discovery),
    statistics: {
      works: snapshot.works.length,
      actors: Array.isArray(snapshot.actors?.actors) ? snapshot.actors.actors.length : 0,
      versions: snapshot.works.reduce(
        (count, work) => count + (
          Array.isArray(work.files["versions.yaml"]?.versions)
            ? work.files["versions.yaml"].versions.length
            : 0
        ),
        0,
      ),
      evidence: snapshot.works.reduce(
        (count, work) => count + (
          Array.isArray(work.files["evidence.yaml"]?.evidence)
            ? work.files["evidence.yaml"].evidence.length
            : 0
        ),
        0,
      ),
      physics_annotations: snapshot.works.reduce(
        (count, work) => count + (
          Array.isArray(work.files["annotations.yaml"]?.annotations)
            ? work.files["annotations.yaml"].annotations.length
            : 0
        ),
        0,
      ),
      method_annotations: snapshot.works.reduce(
        (count, work) => count + (
          Array.isArray(work.files["annotations.yaml"]?.method_annotations)
            ? work.files["annotations.yaml"].method_annotations.length
            : 0
        ),
        0,
      ),
      scientific_edges: snapshot.scientificEdges.length,
      scientific_edge_relation_counts: scientificEdgeState.relationCounts,
      ontology_axes: snapshot.axes.length,
      controlled_terms: controlledTermEntries.length,
      research_lines: snapshot.researchLines.length,
      research_line_memberships: snapshot.researchLines.reduce(
        (count, line) => count + (
          Array.isArray(line.line?.memberships) ? line.line.memberships.length : 0
        ),
        0,
      ),
      learning_paths: snapshot.learningPaths.length,
      learning_path_entries: snapshot.learningPaths.reduce(
        (count, path) => count + (
          Array.isArray(path.path?.entries) ? path.path.entries.length : 0
        ),
        0,
      ),
      pedagogical_transitions: snapshot.learningPaths.reduce(
        (count, path) => count + (
          Array.isArray(path.path?.transitions) ? path.path.transitions.length : 0
        ),
        0,
      ),
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
      publication_relations: snapshot.works.reduce(
        (count, work) => count + (
          Array.isArray(work.files["versions.yaml"]?.publication_relations)
            ? work.files["versions.yaml"].publication_relations.length
            : 0
        ),
        0,
      ),
      publication_relation_counts: Object.fromEntries(
        PUBLICATION_RELATIONS.map((relation) => [
          relation,
          snapshot.works.reduce((count, work) => count + (
            Array.isArray(work.files["versions.yaml"]?.publication_relations)
              ? work.files["versions.yaml"].publication_relations.filter(
                (candidate) => candidate?.relation === relation,
              ).length
              : 0
          ), 0),
        ]),
      ),
    },
    scientific_accounts: snapshot.works.map((work) =>
      scientificAccountInspection(work, accountStatusByWorkId.get(work.id) ?? "invalid")),
    scientific_edges: scientificEdges,
    work_inventory: workInventory,
    research_line_inventory: researchLineInventory,
    learning_path_inventory: learningPathInventory,
    diagnostics: reportDiagnostics,
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
    const rendered = isObject(value) ? JSON.stringify(value) : value;
    lines.push(`- ${name}: ${rendered}`);
  }
  lines.push(
    "",
    "## Work Inventory",
    "",
    "| Work ID | Reader State | Visibility | Visibility Digest | Validation | Statements | Stages | Links | Scientific Account |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |",
  );
  for (const work of report.work_inventory ?? []) {
    lines.push(
      `| ${markdownCell(work.work_id)} | ${markdownCell(work.reader_state)} | ${markdownCell(work.visibility_status)} | ${markdownCell(work.visibility_digest)} | ${markdownCell(work.validation_status)} | ${markdownCell(work.scientific_statements)} | ${markdownCell(work.causal_stages)} | ${markdownCell(work.causal_links)} | ${markdownCell(work.scientific_account_validation_status)} |`,
    );
  }
  lines.push(
    "",
    "## Research Line Inventory",
    "",
    "| Research Line ID | Reader State | Visibility | Visibility Digest | Validation | Memberships |",
    "| --- | --- | --- | --- | --- | ---: |",
  );
  for (const line of report.research_line_inventory ?? []) {
    lines.push(
      `| ${markdownCell(line.line_id)} | ${markdownCell(line.reader_state)} | ${markdownCell(line.visibility_status)} | ${markdownCell(line.visibility_digest)} | ${markdownCell(line.validation_status)} | ${markdownCell(line.memberships)} |`,
    );
  }
  lines.push(
    "",
    "## Learning Path Inventory",
    "",
    "| Path ID | Reader State | Visibility | Visibility Digest | Validation | Entries | Transitions |",
    "| --- | --- | --- | --- | --- | ---: | ---: |",
  );
  for (const path of report.learning_path_inventory ?? []) {
    lines.push(
      `| ${markdownCell(path.path_id)} | ${markdownCell(path.reader_state)} | ${markdownCell(path.visibility_status)} | ${markdownCell(path.visibility_digest)} | ${markdownCell(path.validation_status)} | ${markdownCell(path.entries)} | ${markdownCell(path.transitions)} |`,
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
  lines.push(
    "",
    "## Scientific Edges",
    "",
    "| Edge ID | Source Work | Source Statement | Relation | Target Work | Target Statement | Basis | Disposition | Reason | Evidence IDs | Curation Actor | Curation Time | Review Actor | Review Time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const edge of report.scientific_edges ?? []) {
    lines.push(
      `| ${markdownCell(edge.id)} | ${markdownCell(edge.source_work_id)} | ${markdownCell(edge.source_statement_id)} | ${markdownCell(edge.relation)} | ${markdownCell(edge.target_work_id)} | ${markdownCell(edge.target_statement_id)} | ${markdownCell(edge.basis)} | ${markdownCell(edge.disposition)} | ${markdownCell(edge.reason)} | ${markdownCell(Array.isArray(edge.evidence_ids) ? edge.evidence_ids.join(", ") : edge.evidence_ids)} | ${markdownCell(edge.curation_provenance?.actor_id)} | ${markdownCell(edge.curation_provenance?.recorded_at)} | ${markdownCell(edge.review_provenance?.actor_id)} | ${markdownCell(edge.review_provenance?.recorded_at)} |`,
    );
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
  dataset = "production",
} = {}) {
  const report = mergeValidationDiagnostics(
    await validateCanonicalContent(contentRoot, { dataset }),
    additionalDiagnostics,
  );
  await writeValidationReports(report, outputRoot);
  return report;
}
