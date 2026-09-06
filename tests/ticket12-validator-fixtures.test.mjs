import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

import {
  discoverCanonicalContent,
  loadCanonicalContent,
} from "../scripts/content-loader.mjs";
import {
  computeReaderVisibilityDigest,
  learningPathSemanticDigest,
  runValidation,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";
import {
  projectVisibleSnapshot,
} from "../scripts/reader-projection.mjs";
import {
  buildWorkResearchLineIndex,
  writeEditorialIndexes,
} from "../scripts/editorial-index.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const productionContent = join(projectRoot, "content");
const validFixtureRoot = join(projectRoot, "tests", "fixtures", "valid");
const invalidFixtureRoot = join(projectRoot, "tests", "fixtures", "invalid");

const ARNETT_WORK_SLUG = "arnett-1982";
const BROMBERG_WORK = "work:bromberg-2011";
const BROMBERG_WORK_SLUG = "bromberg-2011";
const LONG_YU_WORK = "work:long-yu-2026";
const LONG_YU_WORK_SLUG = "long-yu-2026";
const CENTRAL_ENGINES_LINE = "research-line:central-engines";
const CENTRAL_ENGINES_LINE_SLUG = "central-engines";
const EMBEDDED_JET_PATH = "learning-path:embedded-jet-dynamics";
const EMBEDDED_JET_PATH_SLUG = "embedded-jet-dynamics";

const expectedDiagnosticFields = [
  "severity",
  "code",
  "file",
  "record_id",
  "field_path",
  "related_ids",
];

function bytewiseCompare(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

async function readYaml(path) {
  return parse(await readFile(path, "utf8"));
}

async function writeYaml(path, value) {
  await writeFile(path, stringify(value), "utf8");
}

async function sortedEntries(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.sort((left, right) => bytewiseCompare(left.name, right.name));
}

async function loadFixtureDescriptors() {
  const valid = [];
  for (const entry of await sortedEntries(validFixtureRoot)) {
    if (entry.isFile() && entry.name.endsWith(".yaml")) {
      valid.push({
        kind: "valid",
        name: entry.name,
        path: join(validFixtureRoot, entry.name),
        descriptor: await readYaml(join(validFixtureRoot, entry.name)),
      });
    }
  }

  const invalid = [];
  for (const entry of await sortedEntries(invalidFixtureRoot)) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = join(invalidFixtureRoot, entry.name, "fixture.yaml");
    invalid.push({
      kind: "invalid",
      name: entry.name,
      path,
      descriptor: await readYaml(path),
    });
  }
  return [...valid, ...invalid];
}

async function copyProduction(contentRoot) {
  await cp(productionContent, contentRoot, { recursive: true });
}

async function copyTree(source, destination, reverse = false) {
  await mkdir(destination, { recursive: true });
  const entries = await sortedEntries(source);
  if (reverse) {
    entries.reverse();
  }
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTree(sourcePath, destinationPath, reverse);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
}

async function materializeFixture(descriptor) {
  assert.equal(descriptor.base, "canonical-production");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket12-"));
  const contentRoot = join(temporaryRoot, "content");
  await copyProduction(contentRoot);
  const mutate = mutations[descriptor.mutation];
  assert.equal(typeof mutate, "function", `unknown fixture mutation: ${descriptor.mutation}`);
  await mutate(contentRoot);
  return { temporaryRoot, contentRoot };
}

async function withFixture(descriptor, callback) {
  const fixture = await materializeFixture(descriptor);
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
}

async function updateRecord(contentRoot, relativePath, mutate) {
  const path = join(contentRoot, relativePath);
  const record = await readYaml(path);
  mutate(record);
  await writeYaml(path, record);
  return record;
}

async function refreshVisibilityApproval(contentRoot, entityType, entityId, relativePath) {
  const snapshot = await loadCanonicalContent(contentRoot);
  const digest = computeReaderVisibilityDigest(snapshot, entityType, entityId);
  assert.match(digest, /^[0-9a-f]{64}$/u);
  await updateRecord(contentRoot, relativePath, (record) => {
    const approvals = Array.isArray(record.visibility_approvals)
      ? record.visibility_approvals
      : [];
    const approval = approvals.at(-1);
    assert(approval, `${relativePath} needs an existing approval for fixture isolation`);
    approval.visibility_digest = digest;
    record.visibility_approvals = approvals;
  });
}

const mutations = Object.freeze({
  none: async () => {},

  "add-malformed-scientific-edge": async (contentRoot) => {
    await writeYaml(
      join(contentRoot, "scientific-edges", "t12-malformed.yaml"),
      null,
    );
  },

  "null-actor-child": async (contentRoot) => {
    await updateRecord(contentRoot, "actors.yaml", (actors) => {
      actors.actors[0] = null;
    });
  },

  "add-evidence-with-missing-version": async (contentRoot) => {
    await updateRecord(contentRoot, `works/${ARNETT_WORK_SLUG}/evidence.yaml`, (record) => {
      const evidence = structuredClone(record.evidence.at(-1));
      evidence.id = "evidence:t12-missing-version";
      evidence.version_id = "version:missing";
      record.evidence.push(evidence);
    });
  },

  "add-method-with-missing-technique": async (contentRoot) => {
    await updateRecord(contentRoot, `works/${ARNETT_WORK_SLUG}/annotations.yaml`, (record) => {
      const annotation = structuredClone(record.method_annotations[0]);
      annotation.id = "annotation:t12-missing-technique";
      annotation.technique_id = "technique:missing";
      annotation.review_state = "unreviewed";
      delete annotation.review_provenance;
      delete annotation.review_binding;
      record.method_annotations.push(annotation);
    });
  },

  "add-membership-with-missing-work": async (contentRoot) => {
    await updateRecord(
      contentRoot,
      `research-lines/${CENTRAL_ENGINES_LINE_SLUG}/line.yaml`,
      (record) => {
        const membership = structuredClone(record.memberships.at(-1));
        membership.id = "membership:t12-missing-work";
        membership.work_id = "work:missing";
        membership.review_state = "unreviewed";
        delete membership.review_provenance;
        delete membership.review_binding;
        record.memberships.push(membership);
      },
    );
  },

  "add-path-entry-with-missing-work": async (contentRoot) => {
    await updateRecord(
      contentRoot,
      `learning-paths/${EMBEDDED_JET_PATH_SLUG}/path.yaml`,
      (record) => {
        record.entries.push({ work_id: "work:missing" });
        const transition = structuredClone(record.transitions.at(-1));
        transition.source_work_id = LONG_YU_WORK;
        transition.target_work_id = "work:missing";
        record.transitions.push(transition);
        record.review_binding.semantic_digest = learningPathSemanticDigest(record);
      },
    );
  },

  "add-statement-with-invalid-lifecycle": async (contentRoot) => {
    await updateRecord(contentRoot, `works/${ARNETT_WORK_SLUG}/statements.yaml`, (record) => {
      const statement = structuredClone(record.statements.at(-1));
      statement.id = "statement:t12-invalid-lifecycle";
      statement.lifecycle = "drafted";
      statement.review_state = "unreviewed";
      delete statement.review_provenance;
      delete statement.review_binding;
      record.statements.push(statement);
    });
  },

  "add-cycle-link": async (contentRoot) => {
    await updateRecord(contentRoot, `works/${ARNETT_WORK_SLUG}/physical-account.yaml`, (record) => {
      const link = structuredClone(record.links[0]);
      link.id = "causal-link:t12-cycle";
      link.source_stage_id = "stage:arnett-modeled-optical-light";
      link.target_stage_id = "stage:arnett-radioactive-decay";
      link.review_state = "unreviewed";
      delete link.review_provenance;
      delete link.review_binding;
      record.links.push(link);
    });
  },

  "add-method-physics-risk": async (contentRoot) => {
    await updateRecord(contentRoot, `works/${ARNETT_WORK_SLUG}/annotations.yaml`, (record) => {
      const annotation = structuredClone(record.method_annotations[0]);
      annotation.id = "annotation:t12-method-risk";
      annotation.interpretive_risk = "interpretive";
      annotation.review_state = "unreviewed";
      delete annotation.review_provenance;
      delete annotation.review_binding;
      record.method_annotations.push(annotation);
    });
  },

  "grant-agent-review-capability": async (contentRoot) => {
    await updateRecord(contentRoot, "actors.yaml", (record) => {
      const agent = record.actors.find(({ id }) => id === "actor:agent-curator");
      assert(agent);
      agent.capability_events[0].capability = "review_records";
    });
  },

  "edit-reviewed-statement": async (contentRoot) => {
    await updateRecord(contentRoot, `works/${ARNETT_WORK_SLUG}/statements.yaml`, (record) => {
      record.statements[0].canonical_text += " The fixture changes its semantic claim.";
    });
    await updateRecord(contentRoot, `works/${ARNETT_WORK_SLUG}/work.yaml`, (record) => {
      record.reader_state = "draft";
      record.visibility_approvals = [];
    });
    await refreshVisibilityApproval(
      contentRoot,
      "research_line",
      CENTRAL_ENGINES_LINE,
      `research-lines/${CENTRAL_ENGINES_LINE_SLUG}/line.yaml`,
    );
    // Hiding Arnett removes the cross-Work Scientific Edge from TransFit's
    // reader projection in the final snapshot. Refresh that dependent Work's
    // approval so this fixture isolates the intended Statement binding reset.
    await refreshVisibilityApproval(
      contentRoot,
      "work",
      "work:transfit-2025",
      "works/transfit-2025/work.yaml",
    );
  },

  "edit-reviewed-membership": async (contentRoot) => {
    await updateRecord(
      contentRoot,
      `research-lines/${CENTRAL_ENGINES_LINE_SLUG}/line.yaml`,
      (record) => {
        record.memberships[1].reading_roles = ["foundation", "review"];
      },
    );
    await refreshVisibilityApproval(
      contentRoot,
      "research_line",
      CENTRAL_ENGINES_LINE,
      `research-lines/${CENTRAL_ENGINES_LINE_SLUG}/line.yaml`,
    );
    await refreshVisibilityApproval(
      contentRoot,
      "work",
      BROMBERG_WORK,
      `works/${BROMBERG_WORK_SLUG}/work.yaml`,
    );
  },

  "edit-reviewed-learning-path": async (contentRoot) => {
    await updateRecord(
      contentRoot,
      `learning-paths/${EMBEDDED_JET_PATH_SLUG}/path.yaml`,
      (record) => {
        record.transitions[0].reason = `${record.transitions[0].reason} The fixture changes the pedagogical transition.`;
      },
    );
    await refreshVisibilityApproval(
      contentRoot,
      "learning_path",
      EMBEDDED_JET_PATH,
      `learning-paths/${EMBEDDED_JET_PATH_SLUG}/path.yaml`,
    );
  },

  "duplicate-published-as-relation": async (contentRoot) => {
    await updateRecord(contentRoot, `works/${BROMBERG_WORK_SLUG}/versions.yaml`, (record) => {
      const relation = structuredClone(record.publication_relations[0]);
      relation.id = "publication-relation:t12-duplicate-journal";
      record.publication_relations.push(relation);
    });
    await refreshVisibilityApproval(
      contentRoot,
      "work",
      BROMBERG_WORK,
      `works/${BROMBERG_WORK_SLUG}/work.yaml`,
    );
  },

  "draft-path-work": async (contentRoot) => {
    await updateRecord(contentRoot, `works/${LONG_YU_WORK_SLUG}/work.yaml`, (record) => {
      record.reader_state = "draft";
      record.visibility_approvals = [];
    });
    await refreshVisibilityApproval(
      contentRoot,
      "learning_path",
      EMBEDDED_JET_PATH,
      `learning-paths/${EMBEDDED_JET_PATH_SLUG}/path.yaml`,
    );
    // Hiding Long & Yu also removes its reviewed Edge from Zhu's reader
    // projection; refresh that dependent Work so the fixture isolates the
    // intended final-snapshot path visibility failure.
    await refreshVisibilityApproval(
      contentRoot,
      "work",
      "work:zhu-2021",
      "works/zhu-2021/work.yaml",
    );
  },

  "stale-work-approval": async (contentRoot) => {
    await updateRecord(contentRoot, `works/${ARNETT_WORK_SLUG}/work.yaml`, (record) => {
      record.preferred_version.reason += " The fixture changes the release rationale.";
    });
  },
});

function projectedDiagnostics(report) {
  return report.diagnostics.map((diagnostic) =>
    Object.fromEntries(expectedDiagnosticFields.map((field) => [field, diagnostic[field]])));
}

function assertReportMetadata(report, dataset) {
  assert.equal(report.dataset, dataset);
  assert.equal(report.validator_version, "v0.1");
  assert.equal(report.schema_version, "v0.1");
  assert.equal(report.canonicalization_version, "v1");
  assert.equal(report.visibility_profile_id, "v0.1-default");
  assert.match(report.canonical_content_digest, /^[0-9a-f]{64}$/u);
  for (const diagnostic of report.diagnostics) {
    assert.deepEqual(Object.keys(diagnostic).sort(), [
      "code",
      "dataset",
      "field_path",
      "file",
      "message",
      "record_id",
      "related_ids",
      "severity",
    ]);
    assert.equal(diagnostic.dataset, dataset);
  }
}

test("descriptor-driven valid and adversarial fixtures assert exact diagnostics and pass quarantine", async () => {
  const descriptors = await loadFixtureDescriptors();
  assert.equal(descriptors.length, 18);
  assert.equal(descriptors.filter(({ kind }) => kind === "valid").length, 2);
  assert.equal(descriptors.filter(({ kind }) => kind === "invalid").length, 16);

  for (const { kind, name, descriptor } of descriptors) {
    await withFixture(descriptor, async ({ contentRoot }) => {
      const report = await validateCanonicalContent(contentRoot, {
        dataset: descriptor.dataset,
      });
      assertReportMetadata(report, descriptor.dataset);
      assert.equal(report.valid, descriptor.expected.valid, name);
      assert.deepEqual(
        projectedDiagnostics(report),
        kind === "valid" && descriptor.additional_diagnostics
          ? []
          : descriptor.expected.diagnostics ?? [],
        name,
      );

      for (const [pass, status] of Object.entries(descriptor.expected.passes ?? {})) {
        assert.equal(report.passes[pass].status, status, `${name}: ${pass}`);
      }
      const codes = new Set(report.diagnostics.map(({ code }) => code));
      for (const code of descriptor.forbidden_codes ?? []) {
        assert.equal(codes.has(code), false, `${name}: forbidden ${code}`);
      }
      for (const prefix of descriptor.forbidden_code_prefixes ?? []) {
        assert.equal(
          [...codes].some((code) => code.startsWith(prefix)),
          false,
          `${name}: forbidden prefix ${prefix}`,
        );
      }

      if (kind === "valid" && descriptor.expected.works !== undefined) {
        assert.equal(report.statistics.works, descriptor.expected.works);
        assert.deepEqual(
          Object.fromEntries(
            Object.entries(descriptor.expected.metadata).map(([key]) => [key, report[key]]),
          ),
          descriptor.expected.metadata,
        );
        assert.equal(report.work_inventory.length, descriptor.expected.works);
      }
    });
  }
});

test("valid warning and info diagnostics are emitted without invalidating a fixture report", async () => {
  const descriptor = (await loadFixtureDescriptors()).find(
    ({ name }) => name === "warning-info.yaml",
  ).descriptor;
  await withFixture(descriptor, async ({ temporaryRoot, contentRoot }) => {
    const additionalDiagnostics = descriptor.additional_diagnostics.map((diagnostic) => ({
      ...diagnostic,
      dataset: descriptor.dataset,
    }));
    const report = await runValidation({
      contentRoot,
      outputRoot: temporaryRoot,
      dataset: descriptor.dataset,
      additionalDiagnostics,
    });
    assertReportMetadata(report, descriptor.dataset);
    assert.equal(report.valid, true);
    assert.deepEqual(projectedDiagnostics(report), descriptor.expected.diagnostics);
    assert.equal(
      JSON.parse(await readFile(join(temporaryRoot, "validation", "report.json"), "utf8")).valid,
      true,
    );
    assert.match(
      await readFile(join(temporaryRoot, "validation", "report.md"), "utf8"),
      /\| warning \| FIXTURE_CURATOR_FOLLOWUP \|/u,
    );
    assert.match(
      await readFile(join(temporaryRoot, "validation", "report.md"), "utf8"),
      /\| info \| FIXTURE_COUNTS_RECORDED \|/u,
    );
  });
});

test("canonical reports and digests are deterministic across filesystem creation order", async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket12-order-a-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket12-order-b-"));
  try {
    const firstContent = join(firstRoot, "content");
    const secondContent = join(secondRoot, "content");
    await copyTree(productionContent, firstContent, false);
    await copyTree(productionContent, secondContent, true);

    const firstReport = await runValidation({
      contentRoot: firstContent,
      outputRoot: firstRoot,
      dataset: "fixture:determinism",
    });
    const secondReport = await runValidation({
      contentRoot: secondContent,
      outputRoot: secondRoot,
      dataset: "fixture:determinism",
    });

    assert.equal(firstReport.canonical_content_digest, secondReport.canonical_content_digest);
    assert.deepEqual(firstReport, secondReport);
    assert.equal(
      await readFile(join(firstRoot, "validation", "report.json"), "utf8"),
      await readFile(join(secondRoot, "validation", "report.json"), "utf8"),
    );
    assert.equal(
      await readFile(join(firstRoot, "validation", "report.md"), "utf8"),
      await readFile(join(secondRoot, "validation", "report.md"), "utf8"),
    );
  } finally {
    await Promise.all([
      rm(firstRoot, { recursive: true, force: true }),
      rm(secondRoot, { recursive: true, force: true }),
    ]);
  }
});

test("production discovery, indexes, and reader projections stay isolated from fixture descriptors", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const discovery = await discoverCanonicalContent(productionContent);
  assert.equal(snapshot.works.length, 5);
  assert.equal(snapshot.researchLines.length, 3);
  assert.equal(snapshot.learningPaths.length, 1);
  assert.equal(discovery.diagnostics.length, 0);
  assert.equal(discovery.files.some((file) => file.includes("tests/fixtures")), false);
  assert.equal(discovery.files.some((file) => file.startsWith("generated/")), false);

  const generatedRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket12-index-"));
  try {
    const index = await writeEditorialIndexes(snapshot, generatedRoot);
    assert.deepEqual(index, buildWorkResearchLineIndex(snapshot));
    assert.equal(JSON.stringify(index).includes("fixture"), false);
    const visible = projectVisibleSnapshot(snapshot);
    assert.equal(JSON.stringify(visible).includes("fixture"), false);
    assert.equal(Object.keys(index).length, snapshot.works.length);
  } finally {
    await rm(generatedRoot, { recursive: true, force: true });
  }
});

test("validation is offline and does not call fetch or HTTP(S) clients", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket12-offline-"));
  const networkCalls = [];
  const originalFetch = globalThis.fetch;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const denyNetwork = (...args) => {
    networkCalls.push(args);
    throw new Error("Ticket 12 validation must remain offline");
  };
  try {
    globalThis.fetch = denyNetwork;
    http.request = denyNetwork;
    http.get = denyNetwork;
    https.request = denyNetwork;
    https.get = denyNetwork;
    const report = await runValidation({
      contentRoot: productionContent,
      outputRoot: temporaryRoot,
      dataset: "fixture:offline",
    });
    assert.equal(report.valid, true);
    assert.deepEqual(networkCalls, []);
  } finally {
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("validator and render entry points contain no direct network client calls", async () => {
  const sourcePaths = [
    "scripts/content-loader.mjs",
    "scripts/content-validator.mjs",
    "scripts/editorial-index.mjs",
    "scripts/reader-projection.mjs",
    "src/pages/index.astro",
    "src/pages/papers/index.astro",
    "src/pages/papers/[workId].astro",
    "src/pages/research-lines/[id].astro",
    "src/pages/learning-paths/[id].astro",
  ];
  for (const relativePath of sourcePaths) {
    const source = await readFile(join(projectRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/u, relativePath);
    assert.doesNotMatch(source, /\bhttps?\.(?:request|get)\s*\(/u, relativePath);
  }
});
