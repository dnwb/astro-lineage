import { createHash } from "node:crypto";
import {
  AXIS_IDS,
  CANONICALIZATION_VERSION,
} from "../content-loader.mjs";
import { normalizeStatementText, validateEvidenceReferences } from "./evidence.mjs";
import { referenceWasCreatedAfterDeprecation } from "./methods.mjs";
import { ASSERTION_BASES, ASSESSMENT_STATES, CAUSAL_LINK_RELATIONS, REVIEW_STATES, RISK_LEVELS, RISK_ORDER, SCIENTIFIC_EDGE_DISPOSITIONS, SCIENTIFIC_EDGE_RELATIONS, V01_FIXTURE_WORK_IDS, addDiagnostic, hasParseDiagnostic, isNamespacedId, isObject, resolveScientificEdgePath, resolveWorkPath, validateGovernedRecord, validateNamespacedId } from "./ontology.mjs";

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

export function validateScientificEdges(snapshot, actorsById, diagnostics) {
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

export function validatePhysicalAccount(
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

export function validatePhysicsAnnotations(
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
