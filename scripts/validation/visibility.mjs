import {
  projectLearningPathForReader,
  projectResearchLineForReader,
  projectWorkForReader,
} from "../reader-projection.mjs";
import { createHash } from "node:crypto";
import { canonicalizeYaml } from "../content-digest.mjs";
import { AXIS_IDS } from "../content-loader.mjs";
import { deriveLearningPathInventory, deriveResearchLineInventory } from "./editorial.mjs";
import { addDiagnostic, isObject, isStructuralDiagnostic, requireActorCapability, resolveLearningPathPath, resolveResearchLinePath, resolveWorkPath, validateUtcTimestamp } from "./ontology.mjs";

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

export function validateFinalSnapshotVisibility(snapshot, actorsById, diagnostics, editorialState) {
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
