type RoutableEntity = {
  id?: unknown;
  slug?: unknown;
};

type ReaderRouteSnapshot = {
  works?: RoutableEntity[];
  researchLines?: RoutableEntity[];
  learningPaths?: RoutableEntity[];
};

function readerPath(
  entities: RoutableEntity[] | undefined,
  semanticId: string,
  collection: string,
) {
  const entity = entities?.find(({ id }) => id === semanticId);
  if (typeof entity?.slug !== "string" || entity.slug === "" || entity.slug.includes(":")) {
    throw new Error(`No filesystem-safe reader route slug for ${semanticId}.`);
  }
  return `/${collection}/${encodeURIComponent(entity.slug)}/`;
}

export function workReaderPath(snapshot: ReaderRouteSnapshot, workId: string) {
  return readerPath(snapshot.works, workId, "papers");
}

export function researchLineReaderPath(snapshot: ReaderRouteSnapshot, lineId: string) {
  return readerPath(snapshot.researchLines, lineId, "research-lines");
}

export function learningPathReaderPath(snapshot: ReaderRouteSnapshot, pathId: string) {
  return readerPath(snapshot.learningPaths, pathId, "learning-paths");
}
