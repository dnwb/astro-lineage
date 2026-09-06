import { parse as parseYaml } from "yaml";
import { createHash } from "node:crypto";
import { CANONICALIZATION_VERSION } from "../content-loader.mjs";
import { READER_STATES, READING_ROLES, addDiagnostic, hasParseDiagnostic, isObject, isStructuralDiagnostic, resolveLearningPathPath, resolveResearchLinePath, validateGovernedRecord, validateNamespacedId } from "./ontology.mjs";

export function extractWorkReadingFrontmatter(reading) {
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

export function validateResearchLines(snapshot, actorsById, diagnostics) {
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

export function validateLearningPaths(snapshot, actorsById, diagnostics) {
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

export function deriveResearchLineInventory(snapshot, diagnostics, visibilityByLineId = new Map()) {
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

export function deriveLearningPathInventory(snapshot, diagnostics, visibilityByPathId = new Map()) {
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
