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
  "bibliographic_sources",
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

function projectEdgesForWork(snapshot, workId) {
  const visibleWorks = visibleWorkIds(snapshot);
  return sortRecords(
    (Array.isArray(snapshot?.scientificEdges) ? snapshot.scientificEdges : [])
      .map((edge) => ({ edge, value: edgeValue(edge) }))
      .filter(({ value }) => {
        if (!reviewed(value)) {
          return false;
        }
        const source = edgeEndpoint(value, "source");
        const target = edgeEndpoint(value, "target");
        return source && target && visibleWorks.has(source) && visibleWorks.has(target) &&
          (source === workId || target === workId);
      })
      .map(({ edge, value }) => ({
        ...projectValue(value),
        id: edge.id ?? value.id ?? null,
      })),
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

function projectEvidence(work, evidenceIds) {
  const envelope = work?.files?.["evidence.yaml"];
  return sortRecords(
    (Array.isArray(envelope?.evidence) ? envelope.evidence : [])
      .filter((evidence) =>
        isObject(evidence) &&
        typeof evidence.id === "string" &&
        evidenceIds.has(evidence.id) &&
        reviewed(evidence),
      )
      .map(projectValue),
  );
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
  collectEvidenceIds(scientificEdges, evidenceIds);
  const evidence = projectEvidence(work, evidenceIds);
  const visibleEvidenceIds = new Set(evidence.map((item) => item.id));

  const metadata = projectValue(record);
  metadata.work_id = workId;
  metadata.preferred_version_id = preferredVersionId(work);
  metadata.preferred_version = projectValue(record.preferred_version ?? {});

  return projectValue({
    ...metadata,
    versions: sortRecords((Array.isArray(versions.versions) ? versions.versions : []).map(projectValue)),
    publication_relations: projectPublicationRelations(work),
    reading: normalizeMarkdown(work.files?.["reading.md"] ?? ""),
    annotations: restrictEvidenceIds(physicsAnnotations, visibleEvidenceIds),
    method_annotations: restrictEvidenceIds(methodAnnotations, visibleEvidenceIds),
    statements: restrictEvidenceIds(statements, visibleEvidenceIds),
    physical_account: restrictEvidenceIds(physicalAccount, visibleEvidenceIds),
    evidence,
    research_lines: projectMembershipForWork(snapshot, workId),
    scientific_edges: restrictEvidenceIds(scientificEdges, visibleEvidenceIds),
  });
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
  const visibleWorks = visibleWorkIds(snapshot);
  const scientificEdges = sortRecords(
    (Array.isArray(snapshot?.scientificEdges) ? snapshot.scientificEdges : [])
      .map((edge) => ({ edge, value: edgeValue(edge) }))
      .filter(({ value }) => {
        if (!reviewed(value)) {
          return false;
        }
        const source = edgeEndpoint(value, "source");
        const target = edgeEndpoint(value, "target");
        return source && target && visibleWorks.has(source) && visibleWorks.has(target);
      })
      .map(({ edge, value }) => ({ ...projectValue(value), id: edge.id ?? value.id ?? null })),
  );

  return projectValue({
    works: sortByField(works, "work_id"),
    research_lines: sortByField(researchLines, "line_id"),
    scientific_edges: scientificEdges,
  });
}
