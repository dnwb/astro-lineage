import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

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
const NAMESPACED_ID = /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._-]*$/u;
const DOI = /^10\.\d{4,9}\/[\S]+$/iu;
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
    return;
  }

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
    }
    if (typeof actor.label !== "string" || actor.label.trim() === "") {
      addDiagnostic(diagnostics, {
        code: "ACTOR_LABEL_INVALID",
        file: "content/actors.yaml",
        recordId: actorId,
        fieldPath: `/actors/${index}/label`,
        message: "Every actor requires a non-empty display label.",
      });
    }
    if (!Array.isArray(actor.capability_events)) {
      addDiagnostic(diagnostics, {
        code: "ACTOR_CAPABILITY_EVENTS_INVALID",
        file: "content/actors.yaml",
        recordId: actorId,
        fieldPath: `/actors/${index}/capability_events`,
        message: "Actor capability_events must be an append-only array.",
      });
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
        }
        if (typeof capabilityEvent.reason !== "string" || capabilityEvent.reason.trim() === "") {
          addDiagnostic(diagnostics, {
            code: "ACTOR_CAPABILITY_REASON_INVALID",
            file: "content/actors.yaml",
            recordId: actorId,
            fieldPath: `/actors/${index}/capability_events/${capabilityIndex}/reason`,
            message: "Every actor capability event requires a reason.",
          });
        }
        validateUtcTimestamp(capabilityEvent.effective_at, {
          code: "ACTOR_CAPABILITY_EFFECTIVE_AT_INVALID",
          file: "content/actors.yaml",
          recordId: actorId,
          fieldPath: `/actors/${index}/capability_events/${capabilityIndex}/effective_at`,
          message: "Actor capability effective_at must be a UTC RFC 3339 timestamp.",
        }, diagnostics);
      }
    }
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
    }
  }
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
  if (typeof value !== "string" || !RFC3339_UTC.test(value)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: details.code ?? "CURATION_TIMESTAMP_INVALID",
      message: details.message ?? "Curation timestamps must be UTC RFC 3339 values.",
    });
    return false;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    addDiagnostic(diagnostics, {
      ...details,
      code: details.code ?? "CURATION_TIMESTAMP_INVALID",
      message: details.message ?? "Curation timestamps must be valid UTC dates.",
    });
    return false;
  }
  return true;
}

function validateCurationProvenance(provenance, actorsById, details, diagnostics) {
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
    const actor = actorsById.get(provenance.actor_id);
    if (!actor) {
      addDiagnostic(diagnostics, {
        ...details,
        code: "REFERENTIAL_ACTOR_MISSING",
        fieldPath: `${details.fieldPath ?? ""}/actor_id`,
        recordId: details.recordId,
        message: `Curation actor does not exist: ${provenance.actor_id}.`,
        relatedIds: [provenance.actor_id],
      });
      valid = false;
    } else if (actor.kind !== "human" && actor.kind !== "agent") {
      valid = false;
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
  if (!(precision in DATE_VALUES) && precision !== "day") {
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
  } else if (typeof value === "string" && !DATE_VALUES[precision].test(value)) {
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

function validateVersionBibliography(version, index, sourceIds, sourcesById, details, diagnostics) {
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
      if (author?.orcid !== undefined && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u.test(author.orcid)) {
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
  for (const sourceId of sourceIds) {
    if (!sourcesById.has(sourceId)) {
      addDiagnostic(diagnostics, {
        ...versionDetails,
        code: "REFERENTIAL_BIB_SOURCE_MISSING",
        fieldPath: `/versions/${index}/field_sources`,
        message: `Bibliographic Source does not exist: ${sourceId}.`,
        relatedIds: [sourceId],
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
    if (!Array.isArray(discrepancy.conflicting_source_ids) || discrepancy.conflicting_source_ids.length < 2) {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "BIB_DISCREPANCY_SOURCES_INVALID",
        fieldPath: `/bibliographic_discrepancies/${index}/conflicting_source_ids`,
        message: "A discrepancy must preserve at least two conflicting source IDs.",
      });
    } else {
      for (const sourceId of discrepancy.conflicting_source_ids) {
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
    if (!Array.isArray(discrepancy.conflicting_values) || discrepancy.conflicting_values.length < 2) {
      addDiagnostic(diagnostics, {
        ...discrepancyDetails,
        code: "BIB_DISCREPANCY_VALUES_INVALID",
        fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values`,
        message: "A discrepancy must preserve the conflicting values with their source IDs.",
      });
    } else {
      for (const [valueIndex, conflict] of discrepancy.conflicting_values.entries()) {
        if (!isObject(conflict) || typeof conflict.source_id !== "string" || !Object.hasOwn(conflict, "value")) {
          addDiagnostic(diagnostics, {
            ...discrepancyDetails,
            code: "BIB_DISCREPANCY_VALUE_INVALID",
            fieldPath: `/bibliographic_discrepancies/${index}/conflicting_values/${valueIndex}`,
            message: "Each conflicting value requires source_id and value.",
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

const WORK_CONCERN_COLLECTIONS = Object.freeze([
  ["evidence.yaml", "evidence"],
  ["annotations.yaml", "annotations"],
  ["annotations.yaml", "method_annotations"],
  ["statements.yaml", "statements"],
  ["physical-account.yaml", "stages"],
  ["physical-account.yaml", "links"],
]);

function validateWorkRecords(snapshot, actorsById, diagnostics) {
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
    const sourcesById = new Map();
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
      if (isObject(source) && typeof source.id === "string") {
        sourcesById.set(source.id, source);
      }
    }
    for (const [index, version] of versionsEnvelope.versions.entries()) {
      validateVersionBibliography(
        version,
        index,
        sourceIds,
        sourcesById,
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

function indexActors(actors) {
  if (!isObject(actors) || !Array.isArray(actors.actors)) {
    return new Map();
  }
  return new Map(
    actors.actors
      .filter((actor) => isObject(actor) && typeof actor.id === "string")
      .map((actor) => [actor.id, actor]),
  );
}

function hasParseDiagnostic(diagnostics, file) {
  return diagnostics.some(
    (item) => item.code === "STRUCTURE_YAML_PARSE_ERROR" && item.file === file,
  );
}

function determinePasses(diagnostics, discovery) {
  const isStructural = ({ code }) =>
    code.startsWith("STRUCTURE_") || code.startsWith("MANIFEST_");
  const isReferential = ({ code }) => code.startsWith("REFERENTIAL_");
  const structural = diagnostics.some(isStructural);
  const referential = diagnostics.some(isReferential);
  const semantic = diagnostics.some(
    (item) => !isStructural(item) && !isReferential(item),
  );
  return {
    structural: {
      status: structural ? "partial" : "complete",
      diagnostic_count: diagnostics.filter(isStructural).length,
    },
    referential: {
      status: structural ? "skipped" : referential ? "partial" : "complete",
      diagnostic_count: diagnostics.filter(isReferential).length,
    },
    semantic: {
      status: structural ? "skipped" : semantic ? "partial" : "complete",
      diagnostic_count: diagnostics.filter(
        (item) => !isStructural(item) && !isReferential(item),
      ).length,
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
    validateWorkRecords(snapshot, indexActors(snapshot.actors), diagnostics);
  }
  validateRecordEnvelopes(snapshot, diagnostics);

  const canonicalContentDigest = await computeCanonicalContentDigest(snapshot.discovery.root);
  const manifest = snapshot.manifest;
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
  additionalDiagnostics = [],
} = {}) {
  const report = mergeValidationDiagnostics(
    await validateCanonicalContent(contentRoot),
    additionalDiagnostics,
  );
  await writeValidationReports(report, outputRoot);
  return report;
}
