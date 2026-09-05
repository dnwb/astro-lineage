/**
 * Reader-facing projections for the canonical content snapshot.
 *
 * A projection is deliberately a plain data object.  Release machinery and
 * curation bookkeeping are used to decide what may be projected, but are not
 * part of the projected content.  This keeps Visibility Digests independent
 * from Reader State, approvals, and generated artifacts.
 */

const NON_RENDERED_FIELDS = new Set([
  "reader_state",
  "visibility_approvals",
  "visibility_digest",
  "canonical_content_digest",
  "semantic_digest",
  "review_state",
  "review_binding",
  "curation_provenance",
  "review_provenance",
  "field_sources",
  "bibliographic_discrepancies",
  "resolution_history",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bytewiseCompare(left, right) {
  return Buffer.from(String(left)).compare(Buffer.from(String(right)));
}

function recordId(record) {
  return isObject(record) && typeof record.id === "string" ? record.id : "";
}

function sortRecords(records) {
  return [...records].sort((left, right) => bytewiseCompare(recordId(left), recordId(right)));
}

function sortByField(records, field) {
  return [...records].sort((left, right) => bytewiseCompare(left?.[field] ?? "", right?.[field] ?? ""));
}

function normalizeMarkdown(value) {
  return String(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/**
 * Recursively remove release and curation fields and sort mapping keys.  The
 * canonicalization procedure also sorts YAML mappings, but doing it here
 * makes the projection deterministic when it is consumed as JSON by routes
 * or tests as well.
 */
function projectValue(value) {
  if (Array.isArray(value)) {
    return value.map(projectValue);
  }
  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !NON_RENDERED_FIELDS.has(key))
      .sort(bytewiseCompare)
      .map((key) => [key, projectValue(value[key])]),
  );
}

function sortStringSet(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string"))]
    .sort(bytewiseCompare);
}

function reviewed(record) {
  return !isObject(record) || !Object.hasOwn(record, "review_state") || record.review_state === "reviewed";
}

function workRecord(work) {
  return isObject(work?.files?.["work.yaml"]) ? work.files["work.yaml"] : null;
}

function versionsRecord(work) {
  return isObject(work?.files?.["versions.yaml"]) ? work.files["versions.yaml"] : {};
}

function preferredVersionId(work) {
  const record = workRecord(work);
  return typeof record?.preferred_version?.version_id === "string"
    ? record.preferred_version.version_id
    : typeof record?.preferred_version_id === "string"
      ? record.preferred_version_id
      : null;
}

function preferredVersion(work) {
  const id = preferredVersionId(work);
  return (Array.isArray(versionsRecord(work).versions) ? versionsRecord(work).versions : [])
    .find((version) => isObject(version) && version.id === id) ?? null;
}

function workById(snapshot, workOrId) {
  const id = typeof workOrId === "string"
    ? workOrId
    : workOrId?.id ?? workOrId?.work_id;
  return Array.isArray(snapshot?.works)
    ? snapshot.works.find((work) => work?.id === id || work?.files?.["work.yaml"]?.work_id === id) ?? null
    : null;
}

function lineById(snapshot, lineOrId) {
  const id = typeof lineOrId === "string"
    ? lineOrId
    : lineOrId?.id ?? lineOrId?.line_id;
  return Array.isArray(snapshot?.researchLines)
    ? snapshot.researchLines.find((line) => line?.id === id || line?.line?.line_id === id) ?? null
    : null;
}

function lineRecord(line) {
  return isObject(line?.line) ? line.line : null;
}

function pathById(snapshot, pathOrId) {
  const id = typeof pathOrId === "string"
    ? pathOrId
    : pathOrId?.id ?? pathOrId?.path_id;
  return Array.isArray(snapshot?.learningPaths)
    ? snapshot.learningPaths.find((path) => path?.id === id || path?.path?.path_id === id) ?? null
    : null;
}

function pathRecord(path) {
  return isObject(path?.path) ? path.path : null;
}

function versionSummary(work) {
  const version = preferredVersion(work);
  const summary = {
    work_id: work?.id ?? workRecord(work)?.work_id ?? null,
    preferred_version_id: preferredVersionId(work),
  };
  if (isObject(version)) {
    for (const key of ["title", "authors", "release_date", "arxiv", "doi", "journal", "access_urls"]) {
      if (Object.hasOwn(version, key)) {
        summary[key] = projectValue(version[key]);
      }
    }
  }
  return projectValue(summary);
}

function visibleWorkIds(snapshot) {
  return new Set(
    (Array.isArray(snapshot?.works) ? snapshot.works : [])
      .filter((work) => workRecord(work)?.reader_state === "visible")
      .map((work) => work.id ?? workRecord(work)?.work_id)
      .filter((id) => typeof id === "string"),
  );
}

function visibleLineIds(snapshot) {
  return new Set(
    (Array.isArray(snapshot?.researchLines) ? snapshot.researchLines : [])
      .filter((line) => lineRecord(line)?.reader_state === "visible")
      .map((line) => line.id ?? lineRecord(line)?.line_id)
      .filter((id) => typeof id === "string"),
  );
}

function lineSummary(line, membership) {
  const record = lineRecord(line) ?? {};
  const summary = {
    line_id: line?.id ?? record.line_id ?? null,
    editorial_anchor: membership?.editorial_anchor === true,
  };
  for (const key of ["title", "scientific_question"]) {
    if (Object.hasOwn(record, key)) {
      summary[key] = projectValue(record[key]);
    }
  }
  return projectValue(summary);
}

function projectMembershipForWork(snapshot, workId) {
  const lineIds = visibleLineIds(snapshot);
  const memberships = [];
  for (const line of Array.isArray(snapshot?.researchLines) ? snapshot.researchLines : []) {
    const lineId = line?.id ?? lineRecord(line)?.line_id;
    if (!lineIds.has(lineId)) {
      continue;
    }
    for (const membership of Array.isArray(lineRecord(line)?.memberships) ? lineRecord(line).memberships : []) {
      if (!isObject(membership) || membership.work_id !== workId || !reviewed(membership)) {
        continue;
      }
      const projected = projectValue(membership);
      projected.line_id = lineId;
      projected.line = lineSummary(line, membership);
      if (Array.isArray(membership.reading_roles)) {
        projected.reading_roles = sortStringSet(membership.reading_roles);
      }
      memberships.push(projected);
    }
  }
  return sortRecords(memberships);
}

function projectMembershipForLine(snapshot, line, visibleWorks) {
  const lineId = line?.id ?? lineRecord(line)?.line_id;
  return sortRecords(
    (Array.isArray(lineRecord(line)?.memberships) ? lineRecord(line).memberships : [])
      .filter((membership) =>
        isObject(membership) &&
        reviewed(membership) &&
        visibleWorks.has(membership.work_id),
      )
      .map((membership) => {
        const projected = projectValue(membership);
        projected.line_id = lineId;
        projected.reading_roles = sortStringSet(membership.reading_roles);
        projected.work = versionSummary(
          (Array.isArray(snapshot?.works) ? snapshot.works : [])
            .find((work) => work.id === membership.work_id),
        );
        return projected;
      }),
  );
}

function edgeEndpoint(value, side) {
  const keys = side === "source"
    ? ["source_work_id", "source_work", "source"]
    : ["target_work_id", "target_work", "target"];
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string") {
      return candidate;
    }
    if (isObject(candidate)) {
      const id = candidate.work_id ?? candidate.id;
      if (typeof id === "string") {
        return id;
      }
    }
  }
  return null;
}

function edgeValue(edge) {
  return isObject(edge?.value) ? edge.value : isObject(edge) ? edge : null;
}

function edgeReviewState(edge) {
  const value = edgeValue(edge);
  if (Object.hasOwn(value ?? {}, "review_state")) {
    return value.review_state;
  }
  return edge?.review_state;
}

/**
 * Scientific Edges are governed records.  Unlike the older projection
 * helpers, an Edge with no review_state is never reader-visible: the global
 * Edge file can contain drafts which have not yet reached a review gate.
 */
function reviewedScientificEdge(edge) {
  return isObject(edgeValue(edge)) && edgeReviewState(edge) === "reviewed";
}

function normalizeReason(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ")
    : value ?? null;
}

function projectScientificEdge(edge) {
  const value = edgeValue(edge);
  const projected = projectValue(value);
  projected.id = edge?.id ?? value?.id ?? null;
  if (Object.hasOwn(value ?? {}, "reason")) {
    projected.reason = normalizeReason(value.reason);
  }
  if (Array.isArray(value?.evidence_ids)) {
    projected.evidence_ids = sortStringSet(value.evidence_ids);
  }
  projected.review_context = {
    status: edgeReviewState(edge),
    reviewer_actor_id: value?.review_provenance?.actor_id ?? edge?.review_provenance?.actor_id ?? null,
    reviewed_at: value?.review_provenance?.recorded_at ?? edge?.review_provenance?.recorded_at ?? null,
  };
  return projected;
}

/**
 * Edge review state is retained in the aggregate edge inventory for callers
 * that need to distinguish reviewed records from curation drafts.  Work
 * projections still expose the richer review_context used by Provenance
 * Detail; restoring this field after the generic projection keeps all other
 * governed metadata excluded.
 */
function restoreScientificEdgeReviewState(edge) {
  const projected = projectValue(edge);
  if (isObject(edge?.review_context) && Object.hasOwn(edge.review_context, "status")) {
    projected.review_state = edge.review_context.status;
  }
  return Object.fromEntries(
    Object.keys(projected)
      .sort(bytewiseCompare)
      .map((key) => [key, projected[key]]),
  );
}

function readerVisibleScientificEdges(snapshot) {
  const visibleWorks = visibleWorkIds(snapshot);
  return (Array.isArray(snapshot?.scientificEdges) ? snapshot.scientificEdges : [])
    .filter((edge) => {
      if (!reviewedScientificEdge(edge)) {
        return false;
      }
      const value = edgeValue(edge);
      const source = edgeEndpoint(value, "source");
      const target = edgeEndpoint(value, "target");
      return source && target && visibleWorks.has(source) && visibleWorks.has(target);
    });
}

function projectEdgesForWork(snapshot, workId) {
  return sortRecords(
    readerVisibleScientificEdges(snapshot)
      .filter((edge) => {
        const value = edgeValue(edge);
        const source = edgeEndpoint(value, "source");
        const target = edgeEndpoint(value, "target");
        return source === workId || target === workId;
      })
      .map(projectScientificEdge),
  );
}

function collectEvidenceIds(value, evidenceIds) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEvidenceIds(item, evidenceIds);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "evidence_ids" && Array.isArray(child)) {
      for (const id of child) {
        if (typeof id === "string") {
          evidenceIds.add(id);
        }
      }
    } else {
      collectEvidenceIds(child, evidenceIds);
    }
  }
}

function restrictEvidenceIds(value, visibleEvidenceIds) {
  if (Array.isArray(value)) {
    return value.map((item) => restrictEvidenceIds(item, visibleEvidenceIds));
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "evidence_ids" && Array.isArray(child)
        ? child.filter((id) => visibleEvidenceIds.has(id))
        : restrictEvidenceIds(child, visibleEvidenceIds),
    ]),
  );
}

function projectEvidence(workOrWorks, evidenceIds, ownedEvidenceIds = new Set()) {
  const works = Array.isArray(workOrWorks) ? workOrWorks : [workOrWorks];
  const projectedById = new Map();
  for (const work of works) {
    const envelope = work?.files?.["evidence.yaml"];
    const ownerWorkId = work?.id ?? workRecord(work)?.work_id;
    for (const evidence of Array.isArray(envelope?.evidence) ? envelope.evidence : []) {
      if (
        !isObject(evidence) ||
        typeof evidence.id !== "string" ||
        !evidenceIds.has(evidence.id) ||
        !reviewed(evidence) ||
        projectedById.has(evidence.id)
      ) {
        continue;
      }
      const projected = {
        ...projectValue(evidence),
        review_context: {
          status: evidence.review_state,
          reviewer_actor_id: evidence.review_provenance?.actor_id ?? null,
          reviewed_at: evidence.review_provenance?.recorded_at ?? null,
        },
      };
      if (ownedEvidenceIds.has(evidence.id) && typeof ownerWorkId === "string") {
        projected.work_id = ownerWorkId;
      }
      projectedById.set(evidence.id, projected);
    }
  }
  return sortRecords([...projectedById.values()]);
}

function projectPhysicsAnnotations(work) {
  const envelope = work?.files?.["annotations.yaml"];
  return sortRecords(
    (Array.isArray(envelope?.annotations) ? envelope.annotations : [])
      .filter(reviewed)
      .map((annotation) => {
        const projected = projectValue(annotation);
        if (isObject(annotation.assessment) && Array.isArray(annotation.assessment.values)) {
          projected.assessment = {
            ...projected.assessment,
            values: annotation.assessment.values
              .filter(isObject)
              .map(projectValue)
              .sort((left, right) => bytewiseCompare(left.term_id ?? "", right.term_id ?? "")),
          };
        }
        if (Array.isArray(annotation.evidence_ids)) {
          projected.evidence_ids = sortStringSet(annotation.evidence_ids);
        }
        return projected;
      }),
  );
}

function projectMethodAnnotations(work) {
  const envelope = work?.files?.["annotations.yaml"];
  return sortRecords(
    (Array.isArray(envelope?.method_annotations) ? envelope.method_annotations : [])
      .filter(reviewed)
      .map((annotation) => {
        const projected = projectValue(annotation);
        if (Array.isArray(annotation.evidence_ids)) {
          projected.evidence_ids = sortStringSet(annotation.evidence_ids);
        }
        return projected;
      }),
  );
}

function projectStatements(work) {
  const envelope = work?.files?.["statements.yaml"];
  return sortRecords(
    (Array.isArray(envelope?.statements) ? envelope.statements : [])
      .filter(reviewed)
      .map((statement) => {
        const projected = projectValue(statement);
        if (Array.isArray(statement.attestations)) {
          projected.attestations = statement.attestations
            .filter(isObject)
            .map((attestation) => {
              const result = projectValue(attestation);
              if (Array.isArray(attestation.evidence_ids)) {
                result.evidence_ids = sortStringSet(attestation.evidence_ids);
              }
              return result;
            })
            .sort((left, right) => bytewiseCompare(left.version_id ?? "", right.version_id ?? ""));
        }
        return projected;
      }),
  );
}

function projectPhysicalAccount(work, visibleAnnotationIds, evidenceIds) {
  const account = work?.files?.["physical-account.yaml"];
  const metadata = projectValue(isObject(account) ? account : {});
  delete metadata.stages;
  delete metadata.links;

  const stages = sortRecords(
    (Array.isArray(account?.stages) ? account.stages : [])
      .filter((stage) =>
        isObject(stage) &&
        (!stage.annotation_id || visibleAnnotationIds.has(stage.annotation_id)),
      )
      .map(projectValue),
  );
  const stageIds = new Set(stages.map((stage) => stage.id));
  const links = sortRecords(
    (Array.isArray(account?.links) ? account.links : [])
      .filter((link) =>
        isObject(link) &&
        reviewed(link) &&
        stageIds.has(link.source_stage_id) &&
        stageIds.has(link.target_stage_id),
      )
      .map(projectValue),
  );

  const projected = {
    ...metadata,
    stages,
    links,
  };
  collectEvidenceIds(projected, evidenceIds);
  return projected;
}

function projectPublicationRelations(work) {
  const envelope = versionsRecord(work);
  return sortRecords(
    (Array.isArray(envelope.publication_relations) ? envelope.publication_relations : [])
      .filter(reviewed)
      .map(projectValue),
  );
}

function projectBibliographicSources(work, publicationRelations) {
  const envelope = versionsRecord(work);
  const sourceIds = new Set(
    publicationRelations.flatMap((relation) =>
      Array.isArray(relation?.bibliographic_source_ids)
        ? relation.bibliographic_source_ids
        : []),
  );
  return sortRecords(
    (Array.isArray(envelope.bibliographic_sources) ? envelope.bibliographic_sources : [])
      .filter((source) => isObject(source) && typeof source.id === "string" && sourceIds.has(source.id))
      .map(projectValue),
  );
}

function pathEntryWorkId(entry) {
  if (typeof entry === "string") {
    return entry;
  }
  if (!isObject(entry)) {
    return null;
  }
  if (typeof entry.work_id === "string") {
    return entry.work_id;
  }
  if (isObject(entry.work)) {
    return typeof entry.work.work_id === "string"
      ? entry.work.work_id
      : typeof entry.work.id === "string"
        ? entry.work.id
        : null;
  }
  return null;
}

function pathTransitionEndpoint(transition, side) {
  const key = side === "source" ? "source_work_id" : "target_work_id";
  if (typeof transition?.[key] === "string") {
    return transition[key];
  }
  const objectKey = side === "source" ? "source" : "target";
  const endpoint = transition?.[objectKey];
  if (typeof endpoint === "string") {
    return endpoint;
  }
  if (isObject(endpoint)) {
    return typeof endpoint.work_id === "string"
      ? endpoint.work_id
      : typeof endpoint.id === "string"
        ? endpoint.id
        : null;
  }
  return null;
}

function projectLearningPathReviewContext(record) {
  return {
    status: record?.review_state ?? null,
    reviewer_actor_id: record?.review_provenance?.actor_id ?? null,
    reviewed_at: record?.review_provenance?.recorded_at ?? null,
  };
}

/**
 * Return the path's ordered, reader-visible Work entries.  Work order is
 * pedagogical content and therefore must never be sorted like an aggregate
 * index.  A malformed or hidden Work is omitted here; the semantic validator
 * is responsible for rejecting a visible path that names one.
 */
function projectLearningPathEntries(snapshot, path, visibleWorkIdsSet) {
  const record = pathRecord(path);
  const entries = Array.isArray(record?.entries) ? record.entries : [];
  return entries
    .map((entry) => {
      const workId = pathEntryWorkId(entry);
      if (!workId || !visibleWorkIdsSet.has(workId)) {
        return null;
      }
      const work = workById(snapshot, workId);
      if (!work) {
        return null;
      }
      const projected = projectValue(isObject(entry) ? entry : { work_id: workId });
      projected.work_id = workId;
      projected.work = versionSummary(work);
      return projected;
    })
    .filter((entry) => entry !== null);
}

/**
 * Rebuild transitions in the order of the projected path.  This keeps the
 * reader projection deterministic even when the canonical transition array
 * is physically reordered, while preserving the path-local adjacency rule.
 */
function projectLearningPathTransitions(record, entries) {
  const transitions = Array.isArray(record?.transitions) ? record.transitions : [];
  const transitionByPair = new Map();
  for (const transition of transitions) {
    if (!isObject(transition)) {
      continue;
    }
    const sourceWorkId = pathTransitionEndpoint(transition, "source");
    const targetWorkId = pathTransitionEndpoint(transition, "target");
    if (!sourceWorkId || !targetWorkId) {
      continue;
    }
    const key = `${sourceWorkId}\0${targetWorkId}`;
    if (!transitionByPair.has(key)) {
      transitionByPair.set(key, transition);
    }
  }

  const projected = [];
  for (let index = 0; index < entries.length - 1; index += 1) {
    const sourceWorkId = entries[index].work_id;
    const targetWorkId = entries[index + 1].work_id;
    const transition = transitionByPair.get(`${sourceWorkId}\0${targetWorkId}`);
    if (!transition) {
      continue;
    }
    const value = projectValue(transition);
    value.source_work_id = sourceWorkId;
    value.target_work_id = targetWorkId;
    if (Object.hasOwn(transition, "reason")) {
      value.reason = normalizeReason(transition.reason);
    }
    projected.push(value);
  }
  return projected;
}

/**
 * Return the Learning Path reader projection, or null unless the path is a
 * visible Reader Entity whose structured content was reviewed atomically.
 * Approval records, release digests, and curation fields stay out of the
 * canonical reader content; review provenance is exposed only as an
 * on-demand context object, matching the Work Edge inspection pattern.
 */
export function projectLearningPathForReader(snapshot, pathOrId) {
  const path = pathById(snapshot, pathOrId);
  const record = pathRecord(path);
  if (
    !path ||
    record?.reader_state !== "visible" ||
    record?.review_state !== "reviewed"
  ) {
    return null;
  }

  const pathId = path.id ?? record.path_id;
  const visibleWorks = visibleWorkIds(snapshot);
  const entries = projectLearningPathEntries(snapshot, path, visibleWorks);
  const metadata = projectValue(record);
  delete metadata.entries;
  delete metadata.transitions;

  const projected = projectValue({
    ...metadata,
    path_id: pathId,
    reading: normalizeMarkdown(path.reading ?? ""),
    entries,
    transitions: projectLearningPathTransitions(record, entries),
  });
  projected.review_context = projectLearningPathReviewContext(record);
  return projected;
}

export const projectVisibleLearningPath = projectLearningPathForReader;

export function projectVisibleLearningPaths(snapshot) {
  return sortByField(
    (Array.isArray(snapshot?.learningPaths) ? snapshot.learningPaths : [])
      .map((path) => projectLearningPathForReader(snapshot, path.id))
      .filter((path) => path !== null),
    "path_id",
  );
}

/**
 * Return the Work reader projection, or null when the Work is not visible.
 * The helper accepts either an immutable Work ID or the loader's Work record.
 */
export function projectWorkForReader(snapshot, workOrId) {
  const work = workById(snapshot, workOrId);
  const record = workRecord(work);
  if (!work || record?.reader_state !== "visible") {
    return null;
  }
  const workId = work.id ?? record.work_id;
  const versions = versionsRecord(work);
  const physicsAnnotations = projectPhysicsAnnotations(work);
  const methodAnnotations = projectMethodAnnotations(work);
  const statements = projectStatements(work);
  const publicationRelations = projectPublicationRelations(work);
  const bibliographicSources = projectBibliographicSources(work, publicationRelations);
  const visibleAnnotationIds = new Set([
    ...physicsAnnotations,
    ...methodAnnotations,
  ].map((annotation) => annotation.id).filter((id) => typeof id === "string"));
  const evidenceIds = new Set();
  collectEvidenceIds(physicsAnnotations, evidenceIds);
  collectEvidenceIds(methodAnnotations, evidenceIds);
  collectEvidenceIds(statements, evidenceIds);
  const physicalAccount = projectPhysicalAccount(work, visibleAnnotationIds, evidenceIds);
  const scientificEdges = projectEdgesForWork(snapshot, workId);
  const edgeEvidenceIds = new Set();
  collectEvidenceIds(scientificEdges, evidenceIds);
  collectEvidenceIds(scientificEdges, edgeEvidenceIds);
  const evidenceWorks = [work];
  const edgeEndpointIds = new Set();
  for (const edge of scientificEdges) {
    for (const side of ["source", "target"]) {
      const endpointId = edgeEndpoint(edge, side);
      if (typeof endpointId === "string") {
        edgeEndpointIds.add(endpointId);
      }
    }
  }
  for (const endpointId of edgeEndpointIds) {
    const endpointWork = workById(snapshot, endpointId);
    if (endpointWork && !evidenceWorks.includes(endpointWork)) {
      evidenceWorks.push(endpointWork);
    }
  }
  const evidence = projectEvidence(evidenceWorks, evidenceIds, edgeEvidenceIds);
  const visibleEvidenceIds = new Set(evidence.map((item) => item.id));

  const metadata = projectValue(record);
  metadata.work_id = workId;
  metadata.preferred_version_id = preferredVersionId(work);
  metadata.preferred_version = projectValue(record.preferred_version ?? {});

  const projected = projectValue({
    ...metadata,
    versions: sortRecords((Array.isArray(versions.versions) ? versions.versions : []).map(projectValue)),
    publication_relations: publicationRelations,
    bibliographic_sources: bibliographicSources,
    reading: normalizeMarkdown(work.files?.["reading.md"] ?? ""),
    annotations: restrictEvidenceIds(physicsAnnotations, visibleEvidenceIds),
    method_annotations: restrictEvidenceIds(methodAnnotations, visibleEvidenceIds),
    statements: restrictEvidenceIds(statements, visibleEvidenceIds),
    physical_account: restrictEvidenceIds(physicalAccount, visibleEvidenceIds),
    evidence,
    research_lines: projectMembershipForWork(snapshot, workId),
    scientific_edges: restrictEvidenceIds(scientificEdges, visibleEvidenceIds),
  });
  projected.scientific_edges = restrictEvidenceIds(scientificEdges, visibleEvidenceIds)
    .map((edge) => restoreScientificEdgeReviewState(edge));
  return projected;
}

/** Alias for callers that use the visibility terminology in the function name. */
export const projectVisibleWork = projectWorkForReader;

/**
 * Return the Research Line reader projection, or null when the line is not
 * visible.  Memberships are endpoint-filtered against the same snapshot so a
 * draft Work can never leak into a visible Line page.
 */
export function projectResearchLineForReader(snapshot, lineOrId) {
  const line = lineById(snapshot, lineOrId);
  const record = lineRecord(line);
  if (!line || record?.reader_state !== "visible") {
    return null;
  }
  const lineId = line.id ?? record.line_id;
  const metadata = projectValue(record);
  delete metadata.memberships;
  const visibleWorks = visibleWorkIds(snapshot);

  return projectValue({
    ...metadata,
    line_id: lineId,
    reading: normalizeMarkdown(line.reading ?? ""),
    memberships: projectMembershipForLine(snapshot, line, visibleWorks),
  });
}

export const projectVisibleResearchLine = projectResearchLineForReader;

/**
 * Project all currently visible Work and Research Line entities.  Scientific
 * Edges are included only when both endpoint Works are visible and the Edge
 * itself is reviewed; they are cross-file dependencies of Work pages.
 */
export function projectVisibleSnapshot(snapshot) {
  const works = (Array.isArray(snapshot?.works) ? snapshot.works : [])
    .map((work) => projectWorkForReader(snapshot, work.id))
    .filter((work) => work !== null);
  const researchLines = (Array.isArray(snapshot?.researchLines) ? snapshot.researchLines : [])
    .map((line) => projectResearchLineForReader(snapshot, line.id))
    .filter((line) => line !== null);
  const learningPaths = projectVisibleLearningPaths(snapshot);
  const scientificEdges = sortRecords(
    readerVisibleScientificEdges(snapshot).map(projectScientificEdge),
  );

  const projected = projectValue({
    works: sortByField(works, "work_id"),
    research_lines: sortByField(researchLines, "line_id"),
    learning_paths: learningPaths,
    scientific_edges: scientificEdges,
  });
  projected.scientific_edges = scientificEdges.map((edge) => restoreScientificEdgeReviewState(edge));
  return projected;
}
