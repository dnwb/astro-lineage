import { createHash } from "node:crypto";
import { CANONICALIZATION_VERSION } from "../content-loader.mjs";
import { validateEvidenceReferences } from "./evidence.mjs";
import { ASSERTION_BASES, addDiagnostic, isObject, resolveWorkPath, validateControlledTerm, validateGovernedRecord, validateNamespacedId, validateTermSuccessors } from "./ontology.mjs";

export function validateMethods(methods, actorsById, diagnostics) {
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

function normalizeMethodReason(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : value ?? null;
}

export function referenceWasCreatedAfterDeprecation(record, term) {
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

export function validateMethodAnnotations(
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
