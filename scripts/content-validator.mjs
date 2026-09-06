import {
  CONTENT_ROOT,
  PROJECT_ROOT,
  isValidationValid,
  mergeValidationDiagnostics,
  renderValidationMarkdown,
  validateCanonicalContent,
  writeValidationReports,
} from "./validation/works.mjs";
import {
  VALIDATOR_VERSION,
  evaluateActorCapability,
} from "./validation/ontology.mjs";
import { methodAnnotationSemanticDigest } from "./validation/methods.mjs";
import {
  deriveBibliographicDiscrepancyState,
  publicationRelationSemanticDigest,
} from "./validation/versions.mjs";
import {
  learningPathSemanticDigest,
  researchLineMembershipSemanticDigest,
} from "./validation/editorial.mjs";
import { computeReaderVisibilityDigest } from "./validation/visibility.mjs";
import { statementSemanticDigest } from "./validation/evidence.mjs";
import {
  causalLinkSemanticDigest,
  scientificEdgeSemanticDigest,
} from "./validation/edges.mjs";

export {
  VALIDATOR_VERSION,
  causalLinkSemanticDigest,
  computeReaderVisibilityDigest,
  deriveBibliographicDiscrepancyState,
  evaluateActorCapability,
  isValidationValid,
  learningPathSemanticDigest,
  mergeValidationDiagnostics,
  methodAnnotationSemanticDigest,
  publicationRelationSemanticDigest,
  renderValidationMarkdown,
  researchLineMembershipSemanticDigest,
  scientificEdgeSemanticDigest,
  statementSemanticDigest,
  validateCanonicalContent,
  writeValidationReports,
};

export async function runValidation({
  contentRoot = CONTENT_ROOT,
  outputRoot = PROJECT_ROOT,
  additionalDiagnostics = [],
  dataset = "production",
} = {}) {
  const report = mergeValidationDiagnostics(
    await validateCanonicalContent(contentRoot, { dataset }),
    additionalDiagnostics,
  );
  await writeValidationReports(report, outputRoot);
  return report;
}
