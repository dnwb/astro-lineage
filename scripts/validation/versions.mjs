import { createHash } from "node:crypto";
import { CANONICALIZATION_VERSION } from "../content-loader.mjs";
import { ARXIV_LEGACY_ID, ARXIV_MODERN_ID, BIBLIOGRAPHIC_PROVIDERS, DATE_VALUES, DOI, ORCID, PUBLICATION_RELATIONS, PUBLICATION_RELATION_BASES, VERSION_KINDS, addDiagnostic, isNamespacedId, isObject, isValidGregorianDate, pointerSegment, validateCurationProvenance, validateGovernedRecord, validateNamespacedId, validateUtcTimestamp } from "./ontology.mjs";

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

export function validateBibliographicSource(source, index, sourceIds, details, diagnostics) {
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

export function validateVersionBibliography(version, index, sourceIds, details, diagnostics) {
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

export function validateBibliographicDiscrepancies(
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

export function validatePublicationRelations(
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
