/**
 * reader-localization.ts
 *
 * English-only passthrough for reader titles, blocks, and transitions.
 * Directly returns canonical English entity names and parsed blocks without Chinese translation overrides.
 */

export type ReaderBlock =
  | { kind: "heading"; depth: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

export function localizedWorkTitle(_workId: string, fallback: string) {
  return fallback;
}

export function localizedLineTitle(_lineId: string, fallback: string) {
  return fallback;
}

export function localizedLineQuestion(_lineId: string, fallback: string) {
  return fallback;
}

export function localizedPathTitle(_pathId: string, fallback: string) {
  return fallback;
}

export function localizedEdgeReason(_edgeId: string | undefined, fallback: string) {
  return fallback;
}

export function localizedMembershipReason(_membershipId: string | undefined, fallback: string) {
  return fallback;
}

export function localizedPathTransition(
  _sourceWorkId: string,
  _targetWorkId: string,
  fallback: string
) {
  return fallback;
}

export function localizedBlocks(_entityId: string, _section: string, blocks: ReaderBlock[]) {
  return blocks;
}

function bilingualMarker(text: string): "primary" | "english" | null {
  if (/中文/u.test(text)) return "primary";
  if (/english/iu.test(text)) return "english";
  return null;
}

export function selectBilingualBlocks(
  blocks: ReaderBlock[],
  language: "primary" | "english" = "english"
): ReaderBlock[] {
  const hasMarkers = blocks.some(
    (block) => block.kind === "heading" && bilingualMarker(block.text) !== null
  );
  if (!hasMarkers) return blocks;

  let activeLanguage: "primary" | "english" | null = null;
  const selected: ReaderBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      const marker = bilingualMarker(block.text);
      if (marker) {
        activeLanguage = marker;
        continue;
      }
    }
    if (activeLanguage === language) selected.push(block);
  }
  return selected;
}

export function localizedRole(role: string) {
  return (
    {
      foundational: "Foundational",
      observational: "Observational",
      methodological: "Methodological",
      synthesis: "Synthesis",
      historical_context: "Historical Context",
      group_lineage: "Group Lineage",
    }[role] ?? role
  );
}

export function localizedAccessKind(kind: string) {
  return { ads: "ADS", arxiv: "arXiv", doi: "DOI" }[kind] ?? kind;
}

export function localizedReviewStatus(status: string) {
  return (
    {
      reviewed: "Reviewed",
      active: "Active",
      contested: "Contested",
      unreviewed: "Unreviewed",
      unavailable: "Unavailable",
    }[status] ?? status
  );
}

export function localizedRelation(relation: string) {
  return (
    {
      builds_on: "Builds on",
      extends: "Extends",
      tests: "Tests",
      constrains: "Constrains",
      challenges: "Challenges",
      replaces_assumption: "Replaces assumption",
      corrects: "Corrects",
      published_as: "Published as",
    }[relation] ?? relation
  );
}

export function localizedLocatorType(type: string) {
  return (
    {
      section: "Section",
      equation: "Equation",
      table: "Table",
      figure: "Figure",
      paragraph: "Paragraph",
    }[type] ?? type
  );
}
