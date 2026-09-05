import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";

import { createDiagnostic as diagnostic } from "./diagnostic.mjs";

export const SCHEMA_VERSION = "v0.1";
export const CANONICALIZATION_VERSION = "v1";
export const VISIBILITY_PROFILE_ID = "v0.1-default";
export const VALID_SCHEMA_VERSIONS = Object.freeze([SCHEMA_VERSION]);
export const VALID_CANONICALIZATION_VERSIONS = Object.freeze([
  CANONICALIZATION_VERSION,
]);
export const VALID_VISIBILITY_PROFILE_IDS = Object.freeze([VISIBILITY_PROFILE_ID]);

export const AXIS_IDS = Object.freeze([
  "progenitor_system",
  "central_object",
  "energy_reservoir",
  "energy_transfer",
  "outflow",
  "environment",
  "dynamics",
  "energy_dissipation",
  "particle_interaction",
  "emission_process",
  "transport_process",
  "phenomenon",
  "messenger",
  "photon_band",
  "observable",
  "inference_target",
]);

export const AXIS_QUESTIONS = Object.freeze({
  progenitor_system:
    "What physical system or object configuration gives rise to the modeled event or source?",
  central_object: "What physical object carries the central engine, when one exists?",
  energy_reservoir: "What form or store of energy is available to power the modeled system?",
  energy_transfer: "By what process does energy leave its reservoir or enter the evolving system?",
  outflow:
    "What moving material, radiation, or field-dominated component carries energy or matter through the modeled system?",
  environment: "What surrounding material or field configuration interacts with the source or outflow?",
  dynamics:
    "What macroscopic evolution, propagation, or interaction governs the modeled system and its components?",
  energy_dissipation:
    "Where does macroscopic or field energy become thermal or non-thermal particle energy?",
  particle_interaction:
    "Which microscopic particle reactions transform particle species or distributions?",
  emission_process: "Which physical process produces an observable messenger?",
  transport_process:
    "Which propagation, absorption, scattering, diffusion, or escape process alters a messenger before observation?",
  phenomenon: "What observational event or source class does the Work address?",
  messenger: "What physical carrier transports information from the source to the observer?",
  photon_band: "Which electromagnetic band describes the photon observation?",
  observable: "What form of measurement is actually recorded?",
  inference_target:
    "What physical quantity, property, or hypothesis does the Work attempt to infer?",
});

export const WORK_CONCERN_FILES = Object.freeze([
  "work.yaml",
  "versions.yaml",
  "evidence.yaml",
  "annotations.yaml",
  "statements.yaml",
  "physical-account.yaml",
  "reading.md",
]);

export const ROOT_FILES = Object.freeze(["manifest.yaml", "actors.yaml"]);
export const ROOT_DIRECTORIES = Object.freeze([
  "works",
  "scientific-edges",
  "ontology",
  "methods",
  "research-lines",
  "learning-paths",
]);
const REQUIRED_ROOT_DIRECTORIES = Object.freeze(["ontology", "methods"]);

const AXIS_DIRECTORY = join("ontology", "axes");
const YAML_FILE = /^.+\.yaml$/u;

function asPath(value) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }

  return isAbsolute(value) ? value : resolve(value);
}

function sortBytewise(values) {
  return [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function relativeContentPath(contentRoot, absolutePath) {
  const relativePath = relative(contentRoot, absolutePath).split("\\").join("/");
  return relativePath ? `content/${relativePath}` : "content";
}

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function addUnknownEntry(diagnostics, contentRoot, absolutePath, entryName, kind) {
  diagnostics.push(
    diagnostic({
      code: "STRUCTURE_UNKNOWN_ENTRY",
      file: relativeContentPath(contentRoot, absolutePath),
      message: `Unknown ${kind} in the closed canonical content layout: ${entryName}.`,
    }),
  );
}

async function inspectRoot(contentRoot, result) {
  const entries = await directoryEntries(contentRoot);
  if (!entries) {
    result.diagnostics.push(
      diagnostic({
        code: "STRUCTURE_CONTENT_ROOT_MISSING",
        file: "content",
        message: "The canonical content root does not exist.",
      }),
    );
    return;
  }

  const entryMap = new Map(entries.map((entry) => [entry.name, entry]));
  for (const entry of entries) {
    if (!ROOT_FILES.includes(entry.name) && !ROOT_DIRECTORIES.includes(entry.name)) {
      addUnknownEntry(
        result.diagnostics,
        contentRoot,
        join(contentRoot, entry.name),
        entry.name,
        entry.isDirectory() ? "directory" : "file",
      );
    }
  }

  for (const fileName of ROOT_FILES) {
    const entry = entryMap.get(fileName);
    if (!entry) {
      result.diagnostics.push(
        diagnostic({
          code: "STRUCTURE_REQUIRED_FILE_MISSING",
          file: `content/${fileName}`,
          message: `Required canonical file is missing: ${fileName}.`,
        }),
      );
    } else if (!entry.isFile()) {
      result.diagnostics.push(
        diagnostic({
          code: "STRUCTURE_EXPECTED_FILE",
          file: `content/${fileName}`,
          message: `Expected a regular file at ${fileName}.`,
        }),
      );
    } else {
      result.files.push(`content/${fileName}`);
      result.rootFiles[fileName] = join(contentRoot, fileName);
    }
  }

  for (const directoryName of ROOT_DIRECTORIES) {
    const entry = entryMap.get(directoryName);
    if (!entry) {
      if (REQUIRED_ROOT_DIRECTORIES.includes(directoryName)) {
        result.diagnostics.push(
          diagnostic({
            code: "STRUCTURE_REQUIRED_DIRECTORY_MISSING",
            file: `content/${directoryName}`,
            message: `Required canonical directory is missing: ${directoryName}.`,
          }),
        );
      }
      continue;
    }
    if (!entry.isDirectory()) {
      result.diagnostics.push(
        diagnostic({
          code: "STRUCTURE_EXPECTED_DIRECTORY",
          file: `content/${directoryName}`,
          message: `Expected a canonical directory at ${directoryName}.`,
        }),
      );
      continue;
    }

    await inspectKnownDirectory(contentRoot, directoryName, result);
  }
}

async function inspectKnownDirectory(contentRoot, directoryName, result) {
  const directory = join(contentRoot, directoryName);
  if (directoryName === "works") {
    await inspectWorkBundles(contentRoot, directory, result);
    return;
  }
  if (directoryName === "scientific-edges") {
    await inspectScientificEdges(contentRoot, directory, result);
    return;
  }
  if (directoryName === "ontology") {
    await inspectOntology(contentRoot, directory, result);
    return;
  }
  if (directoryName === "methods") {
    await inspectMethods(contentRoot, directory, result);
    return;
  }
  if (directoryName === "research-lines") {
    await inspectEditorialBundles(contentRoot, directory, "line.yaml", "researchLines", result);
    return;
  }
  if (directoryName === "learning-paths") {
    await inspectEditorialBundles(contentRoot, directory, "path.yaml", "learningPaths", result);
  }
}

async function inspectWorkBundles(contentRoot, directory, result) {
  const entries = await directoryEntries(directory);
  if (!entries) {
    return;
  }

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (!entry.isDirectory()) {
      addUnknownEntry(result.diagnostics, contentRoot, absolutePath, entry.name, "Work collection entry");
      continue;
    }

    const files = await directoryEntries(absolutePath);
    const names = files?.map(({ name }) => name) ?? [];
    for (const name of names) {
      const child = files.find((entry) => entry.name === name);
      const childPath = join(absolutePath, name);
      if (child.isFile()) {
        if (WORK_CONCERN_FILES.includes(name)) {
          result.files.push(relativeContentPath(contentRoot, childPath));
        }
      } else {
        addUnknownEntry(result.diagnostics, contentRoot, childPath, name, "Work bundle entry");
      }
    }

    const missing = WORK_CONCERN_FILES.filter((name) => !names.includes(name));
    const unknown = names.filter((name) => !WORK_CONCERN_FILES.includes(name));
    if (missing.length > 0 || unknown.length > 0) {
      result.diagnostics.push(
        diagnostic({
          code: "STRUCTURE_WORK_BUNDLE_INCOMPLETE",
          file: relativeContentPath(contentRoot, absolutePath),
          recordId: entry.name,
          message: "Every Work bundle must contain exactly the seven declared concern files.",
          relatedIds: WORK_CONCERN_FILES,
        }),
      );
    }
    result.workBundles.push({
      id: entry.name,
      directory: absolutePath,
      files: Object.fromEntries(
        WORK_CONCERN_FILES.filter((name) => names.includes(name)).map((name) => [
          name,
          join(absolutePath, name),
        ]),
      ),
    });
  }
}

async function inspectScientificEdges(contentRoot, directory, result) {
  const entries = await directoryEntries(directory);
  if (!entries) {
    return;
  }

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (!entry.isFile() || extname(entry.name) !== ".yaml" || !YAML_FILE.test(entry.name)) {
      addUnknownEntry(result.diagnostics, contentRoot, absolutePath, entry.name, "Scientific Edge entry");
      continue;
    }
    result.files.push(relativeContentPath(contentRoot, absolutePath));
    result.scientificEdges.push({
      id: basename(entry.name, ".yaml"),
      path: absolutePath,
    });
  }
}

async function inspectOntology(contentRoot, directory, result) {
  const entries = await directoryEntries(directory);
  if (!entries) {
    return;
  }
  const axesEntry = entries.find((entry) => entry.name === "axes");
  for (const entry of entries) {
    if (entry.name !== "axes") {
      addUnknownEntry(result.diagnostics, contentRoot, join(directory, entry.name), entry.name, "ontology entry");
    }
  }
  if (!axesEntry) {
    result.diagnostics.push(
      diagnostic({
        code: "STRUCTURE_AXIS_DIRECTORY_MISSING",
        file: "content/ontology/axes",
        message: "The ontology axes directory is missing.",
      }),
    );
    return;
  }
  if (!axesEntry.isDirectory()) {
    result.diagnostics.push(
      diagnostic({
        code: "STRUCTURE_EXPECTED_DIRECTORY",
        file: "content/ontology/axes",
        message: "Expected ontology/axes to be a directory.",
      }),
    );
    return;
  }

  const axesDirectory = join(directory, "axes");
  const axisEntries = await directoryEntries(axesDirectory);
  const names = axisEntries?.map(({ name }) => name) ?? [];
  for (const entry of axisEntries ?? []) {
    const absolutePath = join(axesDirectory, entry.name);
    if (!entry.isFile() || !AXIS_IDS.includes(basename(entry.name, ".yaml")) || extname(entry.name) !== ".yaml") {
      addUnknownEntry(result.diagnostics, contentRoot, absolutePath, entry.name, "Physics Ontology axis entry");
    } else {
      result.files.push(relativeContentPath(contentRoot, absolutePath));
      result.axes.push({ id: basename(entry.name, ".yaml"), path: absolutePath });
    }
  }
  for (const axisId of AXIS_IDS) {
    const name = `${axisId}.yaml`;
    if (!names.includes(name)) {
      result.diagnostics.push(
        diagnostic({
          code: "STRUCTURE_AXIS_FILE_MISSING",
          file: `content/${AXIS_DIRECTORY}/${name}`,
          recordId: axisId,
          message: `Required Physics Ontology axis file is missing: ${axisId}.yaml.`,
        }),
      );
    }
  }
}

async function inspectMethods(contentRoot, directory, result) {
  const entries = await directoryEntries(directory);
  if (!entries) {
    return;
  }
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.name !== "taxonomy.yaml" || !entry.isFile()) {
      addUnknownEntry(result.diagnostics, contentRoot, absolutePath, entry.name, "Method Taxonomy entry");
    } else {
      result.files.push(relativeContentPath(contentRoot, absolutePath));
      result.methodsPath = absolutePath;
    }
  }
  if (!result.methodsPath) {
    result.diagnostics.push(
      diagnostic({
        code: "STRUCTURE_METHOD_TAXONOMY_MISSING",
        file: "content/methods/taxonomy.yaml",
        message: "The V0.1 Method Taxonomy must have one taxonomy.yaml file.",
      }),
    );
  }
}

async function inspectEditorialBundles(contentRoot, directory, metadataFile, property, result) {
  const entries = await directoryEntries(directory);
  if (!entries) {
    return;
  }
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (!entry.isDirectory()) {
      addUnknownEntry(result.diagnostics, contentRoot, absolutePath, entry.name, "editorial collection entry");
      continue;
    }
    const bundleEntries = await directoryEntries(absolutePath);
    const names = bundleEntries?.map(({ name }) => name) ?? [];
    for (const child of bundleEntries ?? []) {
      const childPath = join(absolutePath, child.name);
      if (child.isFile() && [metadataFile, "reading.md"].includes(child.name)) {
        result.files.push(relativeContentPath(contentRoot, childPath));
      } else if (child.name !== metadataFile && child.name !== "reading.md") {
        addUnknownEntry(
          result.diagnostics,
          contentRoot,
          childPath,
          child.name,
          "editorial bundle entry",
        );
      }
    }
    for (const name of [metadataFile, "reading.md"]) {
      const entry = bundleEntries?.find((candidate) => candidate.name === name);
      if (entry && !entry.isFile()) {
        result.diagnostics.push(
          diagnostic({
            code: "STRUCTURE_EDITORIAL_EXPECTED_FILE",
            file: relativeContentPath(contentRoot, join(absolutePath, name)),
            recordId: entry.name,
            message: `Editorial bundle entry ${name} must be a regular file.`,
          }),
        );
      }
    }
    if (!names.includes(metadataFile) || !names.includes("reading.md") || names.length !== 2) {
      result.diagnostics.push(
        diagnostic({
          code: "STRUCTURE_EDITORIAL_BUNDLE_INCOMPLETE",
          file: relativeContentPath(contentRoot, absolutePath),
          recordId: entry.name,
          message: `Editorial bundles must contain exactly ${metadataFile} and reading.md.`,
          relatedIds: [metadataFile, "reading.md"],
        }),
      );
    }
    result[property].push({
      id: entry.name,
      directory: absolutePath,
      files: Object.fromEntries(
        [metadataFile, "reading.md"]
          .filter(
            (name) =>
              bundleEntries?.some(
                (entry) => entry.name === name && entry.isFile(),
              ),
          )
          .map((name) => [name, join(absolutePath, name)]),
      ),
    });
  }
}

export async function discoverCanonicalContent(contentRoot = new URL("../content/", import.meta.url)) {
  const root = asPath(contentRoot);
  const result = {
    root,
    files: [],
    rootFiles: {},
    workBundles: [],
    scientificEdges: [],
    axes: [],
    methodsPath: null,
    researchLines: [],
    learningPaths: [],
    diagnostics: [],
  };

  await inspectRoot(root, result);
  result.files = sortBytewise([...new Set(result.files)]);
  result.axes.sort((left, right) => AXIS_IDS.indexOf(left.id) - AXIS_IDS.indexOf(right.id));
  const compareById = (left, right) => Buffer.from(left.id).compare(Buffer.from(right.id));
  result.workBundles.sort(compareById);
  result.scientificEdges.sort(compareById);
  result.researchLines.sort(compareById);
  result.learningPaths.sort(compareById);
  return result;
}

async function readYaml(path, file, diagnostics, fallback) {
  try {
    return parse(await readFile(path, "utf8"));
  } catch (error) {
    diagnostics.push(
      diagnostic({
        code: "STRUCTURE_YAML_PARSE_ERROR",
        file,
        recordId: basename(path, extname(path)),
        message: `Could not parse canonical YAML: ${error.message}`,
      }),
    );
    return fallback;
  }
}

async function readText(path, diagnostics, file, recordId, fallback = undefined) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    diagnostics.push(
      diagnostic({
        code: "STRUCTURE_CANONICAL_READ_ERROR",
        file,
        recordId,
        message: `Could not read canonical content: ${error.message}`,
      }),
    );
    return fallback;
  }
}

/**
 * @param {URL|string} contentRoot
 */
export async function loadCanonicalContent(contentRoot = new URL("../content/", import.meta.url)) {
  const discovery = await discoverCanonicalContent(contentRoot);
  const manifestPath = discovery.rootFiles["manifest.yaml"];
  const actorsPath = discovery.rootFiles["actors.yaml"];
  const manifest = manifestPath
    ? await readYaml(
        manifestPath,
        "content/manifest.yaml",
        discovery.diagnostics,
        {},
      )
    : {};
  const actors = actorsPath
    ? await readYaml(actorsPath, "content/actors.yaml", discovery.diagnostics, {})
    : {};
  const axes = [];
  for (const axis of discovery.axes) {
    axes.push(
      {
        id: axis.id,
        value: await readYaml(
          axis.path,
          `content/ontology/axes/${axis.id}.yaml`,
          discovery.diagnostics,
          {},
        ),
      },
    );
  }
  const methods = discovery.methodsPath
    ? await readYaml(
        discovery.methodsPath,
        "content/methods/taxonomy.yaml",
        discovery.diagnostics,
        {},
      )
    : {};

  const works = [];
  for (const bundle of discovery.workBundles) {
    const files = {};
    for (const fileName of WORK_CONCERN_FILES) {
      const path = bundle.files[fileName];
      if (!path) {
        continue;
      }
      if (fileName.endsWith(".md")) {
        const text = await readText(
          path,
          discovery.diagnostics,
          relativeContentPath(discovery.root, path),
          bundle.id,
        );
        if (text !== undefined) {
          files[fileName] = text;
        }
      } else {
        files[fileName] = await readYaml(
          path,
          relativeContentPath(discovery.root, path),
          discovery.diagnostics,
          {},
        );
      }
    }
    works.push({ id: bundle.id, files });
  }

  const scientificEdges = [];
  for (const edge of discovery.scientificEdges) {
    scientificEdges.push({
      id: edge.id,
      value: await readYaml(
        edge.path,
        relativeContentPath(discovery.root, edge.path),
        discovery.diagnostics,
        {},
      ),
    });
  }

  const researchLines = [];
  for (const bundle of discovery.researchLines) {
    const readingPath = bundle.files["reading.md"];
    const reading = readingPath
      ? await readText(
          readingPath,
          discovery.diagnostics,
          relativeContentPath(discovery.root, readingPath),
          bundle.id,
        )
      : undefined;
    const researchLine = {
      id: bundle.id,
      line: bundle.files["line.yaml"]
        ? await readYaml(
            bundle.files["line.yaml"],
            relativeContentPath(discovery.root, bundle.files["line.yaml"]),
            discovery.diagnostics,
            {},
          )
        : {},
    };
    if (reading !== undefined) {
      researchLine.reading = reading;
    }
    researchLines.push(researchLine);
  }

  const learningPaths = [];
  for (const bundle of discovery.learningPaths) {
    const readingPath = bundle.files["reading.md"];
    const reading = readingPath
      ? await readText(
          readingPath,
          discovery.diagnostics,
          relativeContentPath(discovery.root, readingPath),
          bundle.id,
        )
      : undefined;
    const learningPath = {
      id: bundle.id,
      path: bundle.files["path.yaml"]
        ? await readYaml(
            bundle.files["path.yaml"],
            relativeContentPath(discovery.root, bundle.files["path.yaml"]),
            discovery.diagnostics,
            {},
          )
        : {},
    };
    if (reading !== undefined) {
      learningPath.reading = reading;
    }
    learningPaths.push(learningPath);
  }

  return {
    discovery,
    manifest: manifest && typeof manifest === "object" ? manifest : {},
    actors: actors && typeof actors === "object" ? actors : {},
    axes,
    methods: methods && typeof methods === "object" ? methods : {},
    works,
    scientificEdges,
    researchLines,
    learningPaths,
  };
}
