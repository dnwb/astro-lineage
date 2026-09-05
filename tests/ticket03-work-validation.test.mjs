import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { WORK_CONCERN_FILES, loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  deriveBibliographicDiscrepancyState,
  runValidation,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";

const productionContent = new URL("../content/", import.meta.url);

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket03-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  await rm(join(contentRoot, "learning-paths"), { recursive: true, force: true });
  const workPath = join(contentRoot, "works", "work:arnett-1982", "work.yaml");
  const brombergWorkPath = join(contentRoot, "works", "work:bromberg-2011", "work.yaml");
  const zhuWorkPath = join(contentRoot, "works", "work:zhu-2021", "work.yaml");
  const transfitWorkPath = join(contentRoot, "works", "work:transfit-2025", "work.yaml");
  const longYuWorkPath = join(contentRoot, "works", "work:long-yu-2026", "work.yaml");
  const linePath = join(contentRoot, "research-lines", "research-line:central-engines", "line.yaml");
  const denseLinePath = join(
    contentRoot,
    "research-lines",
    "research-line:dense-environment-multimessenger",
    "line.yaml",
  );
  const explosiveLinePath = join(
    contentRoot,
    "research-lines",
    "research-line:explosive-transients-csm",
    "line.yaml",
  );
  const work = parse(await readFile(workPath, "utf8"));
  const brombergWork = parse(await readFile(brombergWorkPath, "utf8"));
  const zhuWork = parse(await readFile(zhuWorkPath, "utf8"));
  const transfitWork = parse(await readFile(transfitWorkPath, "utf8"));
  const longYuWork = parse(await readFile(longYuWorkPath, "utf8"));
  const line = parse(await readFile(linePath, "utf8"));
  const denseLine = parse(await readFile(denseLinePath, "utf8"));
  const explosiveLine = parse(await readFile(explosiveLinePath, "utf8"));
  work.reader_state = "draft";
  work.visibility_approvals = [];
  brombergWork.reader_state = "draft";
  brombergWork.visibility_approvals = [];
  zhuWork.reader_state = "draft";
  zhuWork.visibility_approvals = [];
  transfitWork.reader_state = "draft";
  transfitWork.visibility_approvals = [];
  longYuWork.reader_state = "draft";
  longYuWork.visibility_approvals = [];
  line.reader_state = "draft";
  line.visibility_approvals = [];
  denseLine.reader_state = "draft";
  denseLine.visibility_approvals = [];
  explosiveLine.reader_state = "draft";
  explosiveLine.visibility_approvals = [];
  await Promise.all([
    writeFile(workPath, stringify(work), "utf8"),
    writeFile(brombergWorkPath, stringify(brombergWork), "utf8"),
    writeFile(zhuWorkPath, stringify(zhuWork), "utf8"),
    writeFile(transfitWorkPath, stringify(transfitWork), "utf8"),
    writeFile(longYuWorkPath, stringify(longYuWork), "utf8"),
    writeFile(linePath, stringify(line), "utf8"),
    writeFile(denseLinePath, stringify(denseLine), "utf8"),
    writeFile(explosiveLinePath, stringify(explosiveLine), "utf8"),
  ]);
  return { temporaryRoot, contentRoot };
}

async function readWork(contentRoot) {
  const workRoot = join(contentRoot, "works", "work:arnett-1982");
  const work = parse(await readFile(join(workRoot, "work.yaml"), "utf8"));
  const versions = parse(await readFile(join(workRoot, "versions.yaml"), "utf8"));
  return { workRoot, work, versions };
}

test("Arnett is stored as one complete Work with a provenance-bearing Preferred Version", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === "work:arnett-1982");

  assert(work);
  assert.deepEqual(Object.keys(work.files).sort(), [...WORK_CONCERN_FILES].sort());
  assert.equal(result.valid, true);
  assert.equal(work.files["work.yaml"].work_id, "work:arnett-1982");
  assert.equal(work.files["work.yaml"].reader_state, "visible");
  assert.equal(
    work.files["work.yaml"].preferred_version.version_id,
    "version:arnett-1982-journal",
  );

  const version = work.files["versions.yaml"].versions[0];
  assert.equal(version.kind, "journal_manifestation");
  assert.equal(version.doi, "10.1086/159681");
  assert.deepEqual(version.release_date, { value: "1982-02", precision: "month" });
  assert.deepEqual(version.authors.map(({ display_name }) => display_name), ["Arnett, W. D."]);
});

test("Arnett preserves two immutable ADS retrieval attestations for one upstream record", async () => {
  const { versions } = await readWork(fileURLToPath(productionContent));
  const adsSources = versions.bibliographic_sources.filter(({ provider }) => provider === "ads");

  assert.equal(adsSources.length, 2);
  assert.equal(new Set(adsSources.map(({ id }) => id)).size, 2);
  assert.equal(new Set(adsSources.map(({ record_id }) => record_id)).size, 1);
  assert.deepEqual(
    adsSources.map(({ retrieved_at }) => retrieved_at).sort(),
    ["2026-09-04T03:21:18Z", "2026-09-04T03:23:02Z"],
  );
  assert(adsSources.every(({ source_url }) => source_url.includes("ui.adsabs.harvard.edu/abs/")));
  assert(adsSources.every(({ checksum, snapshot }) => checksum === undefined && snapshot === undefined));
});

test("field-level bibliographic provenance rejects a normalized metadata field without a source", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, versions } = await readWork(contentRoot);
  delete versions.versions[0].field_sources["/title"];
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  const diagnostic = result.diagnostics.find(
    ({ code, field_path }) => code === "BIB_FIELD_PROVENANCE_MISSING" && field_path === "/title",
  );

  assert(diagnostic);
  assert.equal(diagnostic.record_id, "version:arnett-1982-journal");
});

test("ownership, DOI normalization, and date precision are validated as independent invariants", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, work, versions } = await readWork(contentRoot);
  work.work_id = "work:other";
  versions.versions[0].doi = "DOI:10.1086/159681 ";
  versions.versions[0].release_date = { value: "1982-02-31", precision: "month" };
  await writeFile(join(workRoot, "work.yaml"), stringify(work), "utf8");
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  const codes = new Set(result.diagnostics.map(({ code }) => code));

  assert(codes.has("WORK_ID_DIRECTORY_MISMATCH"));
  assert(codes.has("BIB_DOI_NOT_NORMALIZED"));
  assert(codes.has("BIB_RELEASE_DATE_INVALID"));
});

test("unsupported release-date precision is diagnosed and reports remain writable", async () => {
  const { temporaryRoot, contentRoot } = await copyContent();
  const { workRoot, versions } = await readWork(contentRoot);
  versions.versions[0].release_date = { value: "1982", precision: "season" };
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const result = await runValidation({ contentRoot, outputRoot: temporaryRoot });
  assert(result.diagnostics.some(({ code }) => code === "BIB_RELEASE_DATE_INVALID"));
  assert.equal(result.valid, false);
  assert.match(await readFile(join(temporaryRoot, "validation/report.json"), "utf8"), /BIB_RELEASE_DATE_INVALID/);
  assert.equal(result.work_inventory[0].validation_status, "invalid");
});

test("UTC RFC 3339 timestamps reject impossible Gregorian dates", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, versions } = await readWork(contentRoot);
  versions.bibliographic_sources[0].retrieved_at = "2026-02-31T00:00:00Z";
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  assert(result.diagnostics.some(({ code }) => code === "BIB_SOURCE_RETRIEVED_AT_INVALID"));
});

test("Version-local ORCID values use the ISO 7064 MOD 11-2 checksum", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, versions } = await readWork(contentRoot);
  const version = versions.versions[0];
  version.authors[0].orcid = "0000-0002-1825-0097";
  version.field_sources["/authors/0/orcid"] = [versions.bibliographic_sources[0].id];
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const valid = await validateCanonicalContent(contentRoot);
  assert(!valid.diagnostics.some(({ code }) => code === "BIB_ORCID_INVALID"));

  version.authors[0].orcid = "0000-0002-1825-0098";
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");
  const invalid = await validateCanonicalContent(contentRoot);
  assert(invalid.diagnostics.some(({ code }) => code === "BIB_ORCID_INVALID"));
});

test("bibliographic discrepancy state is derived from append-only resolution events", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, work, versions } = await readWork(contentRoot);
  const [adsSource, secondAdsSource] = versions.bibliographic_sources;
  const discrepancy = {
    id: "discrepancy:arnett-title",
    version_id: "version:arnett-1982-journal",
    field_path: "/title",
    conflicting_source_ids: [adsSource.id, secondAdsSource.id],
    conflicting_values: [
      { source_id: adsSource.id, value: "Type I supernovae. I - Analytic solutions for the early part of the light curve" },
      { source_id: secondAdsSource.id, value: "Type I supernovae. I - Analytic solutions for the early light curve" },
    ],
    reader_relevant: true,
    resolution_events: [],
  };
  versions.bibliographic_discrepancies = [discrepancy];
  work.reader_state = "draft";
  work.visibility_approvals = [];
  await writeFile(join(workRoot, "work.yaml"), stringify(work), "utf8");
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const unresolved = await validateCanonicalContent(contentRoot);
  assert.equal(unresolved.valid, true);
  assert.deepEqual(deriveBibliographicDiscrepancyState(discrepancy), {
    status: "unresolved",
    selected_value: null,
    resolution_event: null,
  });

  discrepancy.resolution_events.push({
    selected_value:
      "Type I supernovae. I - Analytic solutions for the early part of the light curve",
    reason: "ADS retrieval attestations agree on the canonical title.",
    provenance: {
      actor_id: "actor:human-curator",
      recorded_at: "2026-09-04T03:30:00Z",
    },
  });
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");
  const resolved = await validateCanonicalContent(contentRoot);
  assert.equal(resolved.valid, true);
  assert.equal(deriveBibliographicDiscrepancyState(discrepancy).status, "resolved");
  assert.equal(deriveBibliographicDiscrepancyState(discrepancy).selected_value, discrepancy.resolution_events[0].selected_value);
});

test("Bibliographic discrepancies require unique declared sources and one value per distinct source", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, versions } = await readWork(contentRoot);
  const [firstSource, secondSource] = versions.bibliographic_sources;
  versions.bibliographic_discrepancies = [
    {
      id: "discrepancy:arnett-title",
      version_id: "version:arnett-1982-journal",
      field_path: "/title",
      conflicting_source_ids: [firstSource.id, firstSource.id],
      conflicting_values: [
        { source_id: firstSource.id, value: "one" },
        { source_id: secondSource.id, value: "one" },
      ],
      reader_relevant: true,
      resolution_events: [],
    },
  ];
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  const codes = new Set(result.diagnostics.map(({ code }) => code));
  assert(codes.has("BIB_DISCREPANCY_SOURCES_DUPLICATE"));
  assert(codes.has("BIB_DISCREPANCY_VALUES_NOT_DISTINCT"));
  assert(codes.has("BIB_DISCREPANCY_VALUE_SOURCE_MISMATCH"));
});

test("Bibliographic discrepancy resolution requires a Human actor", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, versions } = await readWork(contentRoot);
  const actorsPath = join(contentRoot, "actors.yaml");
  const actors = parse(await readFile(actorsPath, "utf8"));
  actors.actors.push({
    id: "actor:agent-drafter",
    kind: "agent",
    label: "V0.1 Agent Drafter",
    capability_events: [],
  });
  versions.bibliographic_discrepancies = [
    {
      id: "discrepancy:arnett-title",
      version_id: "version:arnett-1982-journal",
      field_path: "/title",
      conflicting_source_ids: versions.bibliographic_sources.slice(0, 2).map(({ id }) => id),
      conflicting_values: versions.bibliographic_sources.slice(0, 2).map((source, index) => ({
        source_id: source.id,
        value: `title-${index}`,
      })),
      reader_relevant: true,
      resolution_events: [
        {
          selected_value: "title-0",
          reason: "Agent draft resolution for an isolated validator fixture.",
          provenance: {
            actor_id: "actor:agent-drafter",
            recorded_at: "2026-09-04T03:30:00Z",
          },
        },
      ],
    },
  ];
  await writeFile(actorsPath, stringify(actors), "utf8");
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const result = await validateCanonicalContent(contentRoot);
  assert(result.diagnostics.some(({ code }) => code === "CURATION_HUMAN_ACTOR_REQUIRED"));
});

test("an unresolved reader-relevant discrepancy blocks visibility but remains valid draft curation", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, work, versions } = await readWork(contentRoot);
  versions.bibliographic_discrepancies = [
    {
      id: "discrepancy:arnett-title",
      version_id: "version:arnett-1982-journal",
      field_path: "/title",
      conflicting_source_ids: versions.bibliographic_sources.slice(0, 2).map(({ id }) => id),
      conflicting_values: versions.bibliographic_sources.slice(0, 2).map((source, index) => ({
        source_id: source.id,
        value: `A conflicting title ${index} retained for an isolated validator fixture`,
      })),
      reader_relevant: true,
      resolution_events: [],
    },
  ];
  work.reader_state = "draft";
  work.visibility_approvals = [];
  await writeFile(join(workRoot, "work.yaml"), stringify(work), "utf8");
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const draftResult = await validateCanonicalContent(contentRoot);
  assert.equal(draftResult.valid, true);

  work.reader_state = "visible";
  await writeFile(join(workRoot, "work.yaml"), stringify(work), "utf8");
  const visibleResult = await validateCanonicalContent(contentRoot);
  assert(visibleResult.diagnostics.some(({ code }) => code === "BIB_DISCREPANCY_BLOCKS_VISIBILITY"));
});

test("validation inventory retains the Arnett Work after its later visibility transition", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  assert(snapshot.works.some(({ id }) => id === "work:arnett-1982"));
  const inventory = result.work_inventory.find(({ work_id }) => work_id === "work:arnett-1982");
  assert(inventory);
  assert.equal(inventory.reader_state, "visible");
  assert.equal(inventory.validation_status, "valid");
  assert.equal(inventory.scientific_statements, 4);
  assert.equal(inventory.causal_stages, 6);
  assert.equal(inventory.causal_links, 6);
  assert.equal(inventory.scientific_account_validation_status, "valid");
});
