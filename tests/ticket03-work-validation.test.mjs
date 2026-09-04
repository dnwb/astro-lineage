import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parse, stringify } from "yaml";

import { WORK_CONCERN_FILES, loadCanonicalContent } from "../scripts/content-loader.mjs";
import {
  deriveBibliographicDiscrepancyState,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";

const productionContent = new URL("../content/", import.meta.url);

async function copyContent() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "axvdaily-ticket03-"));
  const contentRoot = join(temporaryRoot, "content");
  await cp(productionContent, contentRoot, { recursive: true });
  return { temporaryRoot, contentRoot };
}

async function readWork(contentRoot) {
  const workRoot = join(contentRoot, "works", "work:arnett-1982");
  const work = parse(await readFile(join(workRoot, "work.yaml"), "utf8"));
  const versions = parse(await readFile(join(workRoot, "versions.yaml"), "utf8"));
  return { workRoot, work, versions };
}

test("Arnett is stored as one complete draft Work with a provenance-bearing Preferred Version", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const result = await validateCanonicalContent(productionContent);
  const work = snapshot.works.find(({ id }) => id === "work:arnett-1982");

  assert(work);
  assert.deepEqual(Object.keys(work.files).sort(), [...WORK_CONCERN_FILES].sort());
  assert.equal(result.valid, true);
  assert.equal(work.files["work.yaml"].work_id, "work:arnett-1982");
  assert.equal(work.files["work.yaml"].reader_state, "draft");
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

test("bibliographic discrepancy state is derived from append-only resolution events", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, versions } = await readWork(contentRoot);
  const [adsSource, secondAdsSource] = versions.bibliographic_sources;
  const discrepancy = {
    id: "discrepancy:arnett-title",
    version_id: "version:arnett-1982-journal",
    field_path: "/title",
    conflicting_source_ids: [adsSource.id, secondAdsSource.id],
    conflicting_values: [
      { source_id: adsSource.id, value: "Type I supernovae. I - Analytic solutions for the early part of the light curve" },
      { source_id: secondAdsSource.id, value: "Type I supernovae. I - Analytic solutions for the early part of the light curve" },
    ],
    reader_relevant: true,
    resolution_events: [],
  };
  versions.bibliographic_discrepancies = [discrepancy];
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

test("an unresolved reader-relevant discrepancy blocks visibility but remains valid draft curation", async () => {
  const { contentRoot } = await copyContent();
  const { workRoot, work, versions } = await readWork(contentRoot);
  versions.bibliographic_discrepancies = [
    {
      id: "discrepancy:arnett-title",
      version_id: "version:arnett-1982-journal",
      field_path: "/title",
      conflicting_source_ids: versions.bibliographic_sources.slice(0, 2).map(({ id }) => id),
      conflicting_values: versions.bibliographic_sources.slice(0, 2).map((source) => ({
        source_id: source.id,
        value: "A conflicting title retained for an isolated validator fixture",
      })),
      reader_relevant: true,
      resolution_events: [],
    },
  ];
  await writeFile(join(workRoot, "versions.yaml"), stringify(versions), "utf8");

  const draftResult = await validateCanonicalContent(contentRoot);
  assert.equal(draftResult.valid, true);

  work.reader_state = "visible";
  await writeFile(join(workRoot, "work.yaml"), stringify(work), "utf8");
  const visibleResult = await validateCanonicalContent(contentRoot);
  assert(visibleResult.diagnostics.some(({ code }) => code === "BIB_DISCREPANCY_BLOCKS_VISIBILITY"));
});

test("draft Works are absent from the ordinary Paper index", async () => {
  const snapshot = await loadCanonicalContent(productionContent);
  const visibleWorks = snapshot.works.filter(
    ({ files }) => files["work.yaml"]?.reader_state === "visible",
  );
  assert.deepEqual(visibleWorks, []);
  assert(snapshot.works.some(({ id }) => id === "work:arnett-1982"));
});
