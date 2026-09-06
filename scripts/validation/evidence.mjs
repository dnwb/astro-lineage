import { createHash } from "node:crypto";
import { CANONICALIZATION_VERSION } from "../content-loader.mjs";
import { ASSERTION_BASES, LOCATOR_TYPES, STATEMENT_KINDS, STATEMENT_LIFECYCLES, addDiagnostic, isObject, resolveWorkPath, validateGovernedRecord, validateNamespacedId } from "./ontology.mjs";

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

export function validateEvidenceRecords(work, versionsById, actorsById, diagnostics) {
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

export function validateEvidenceReferences(
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

export function normalizeStatementText(value) {
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

export function validateStatements(
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
