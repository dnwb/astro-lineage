import { fileURLToPath } from "node:url";
import {
  VALID_CANONICALIZATION_VERSIONS,
  VALID_VISIBILITY_PROFILE_IDS,
  loadCanonicalContent,
} from "../content-loader.mjs";
import { computeCanonicalContentDigest } from "../content-digest.mjs";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { validatePhysicalAccount, validatePhysicsAnnotations, validateScientificEdges } from "./edges.mjs";
import { deriveLearningPathInventory, deriveResearchLineInventory, extractWorkReadingFrontmatter, validateLearningPaths, validateResearchLines } from "./editorial.mjs";
import { validateEvidenceRecords, validateStatements } from "./evidence.mjs";
import { validateMethodAnnotations, validateMethods } from "./methods.mjs";
import { PUBLICATION_RELATIONS, READER_STATES, VALIDATOR_VERSION, actorMap, addDiagnostic, hasParseDiagnostic, hasStructuralFailure, isObject, isStructuralDiagnostic, resolveScientificEdgePath, resolveWorkPath, validateActors, validateAxes, validateCurationProvenance, validateManifest, validateNamespacedId } from "./ontology.mjs";
import { validateBibliographicDiscrepancies, validateBibliographicSource, validatePublicationRelations, validateVersionBibliography } from "./versions.mjs";
import { validateFinalSnapshotVisibility } from "./visibility.mjs";

export const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const CONTENT_ROOT = fileURLToPath(new URL("../../content/", import.meta.url));

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
