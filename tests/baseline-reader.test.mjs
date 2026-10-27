import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { ensureDistBuilt } from "./helpers/ensure-dist.mjs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import { projectBaselineSnapshot } from "../scripts/reader-projection.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const distRoot = new URL("../dist/", import.meta.url);

function buildReader() {
  ensureDistBuilt();
}

test("the baseline projection includes only the marked candidate catalogue", async () => {
  const snapshot = await loadCanonicalContent(new URL("../content/", import.meta.url));
  const reader = projectBaselineSnapshot(snapshot);

  assert.equal(reader.works.length, 41);
  assert.equal(reader.works.filter((work) => work.reader_status === "published").length, 6);
  assert.equal(reader.works.filter((work) => work.reader_status === "candidate").length, 35);
  assert.equal(reader.research_lines.length, 7);
  assert.equal(
    reader.research_lines.filter((line) => line.reader_status === "candidate").length,
    4
  );
  assert.equal(reader.learning_paths.length, 5);
  assert.equal(
    reader.learning_paths.filter((path) => path.reader_status === "candidate").length,
    4
  );
  assert.equal(
    reader.works.find((work) => work.work_id === "work:zhu-2021").reader_status,
    "published"
  );
  assert.equal(
    reader.works.find((work) => work.work_id === "work:zhang-agn-jet-2024").reader_status,
    "published"
  );
  assert.equal(
    reader.works.find((work) => work.work_id === "work:blandford-mckee-1976").reader_status,
    "candidate"
  );
});

test("the reader exposes the complete baseline with candidate status and navigation", async () => {
  buildReader();
  const home = await readFile(new URL("index.html", distRoot), "utf8");
  const papers = await readFile(new URL("papers/index.html", distRoot), "utf8");
  const lines = await readFile(new URL("research-lines/index.html", distRoot), "utf8");
  const paths = await readFile(new URL("learning-paths/index.html", distRoot), "utf8");

  assert.match(home, /41 Foundational Papers/u);
  assert.match(home, /7 Research Lines/u);
  assert.match(home, /5 Learning Paths/u);
  assert.doesNotMatch(home, /5 篇可见论文/u);
  assert.match(home, /href="\/papers\/blandford-mckee-1976\/"/u);
  assert.match(home, /href="\/research-lines\/baseline-jet-multimessenger\/"/u);
  assert.match(home, /href="\/learning-paths\/baseline-jet-foundations\/"/u);

  assert.match(papers, /41 benchmark works/u);
  assert.match(papers, /35 candidates/u);
  assert.match(papers, /Candidate/u);
  assert.match(papers, /Read it to connect self-similar relativistic blast-wave dynamics/u);
  assert.match(papers, /href="\/papers\/blandford-mckee-1976\/"/u);
  assert.equal((papers.match(/>Read paper →<\/a>/gu) ?? []).length, 41);

  assert.match(lines, /7 research lines/iu);
  assert.match(lines, /Candidate/u);
  for (const slug of [
    "baseline-jet-multimessenger",
    "baseline-central-engine-transients",
    "baseline-csm-radiative-transients",
    "baseline-binaries-frb",
  ]) {
    assert.match(lines, new RegExp(`href="/research-lines/${slug}/"`, "u"));
    assert.equal(existsSync(new URL(`research-lines/${slug}/index.html`, distRoot)), true, slug);
  }

  assert.match(paths, /5 learning paths/iu);
  assert.match(paths, /4 candidates/iu);
  for (const slug of [
    "baseline-jet-foundations",
    "baseline-engine-powered-transients",
    "baseline-csm-light-curves",
    "baseline-binary-multimessenger",
  ]) {
    assert.match(paths, new RegExp(`href="/learning-paths/${slug}/"`, "u"));
    assert.equal(existsSync(new URL(`learning-paths/${slug}/index.html`, distRoot)), true, slug);
  }

  const candidatePaper = await readFile(
    new URL("papers/blandford-mckee-1976/index.html", distRoot),
    "utf8"
  );
  assert.match(candidatePaper, /<title>Fluid dynamics of relativistic blast waves/u);
  assert.match(candidatePaper, /Candidate/u);
  assert.match(candidatePaper, /<math\b/u);

  const candidateLine = await readFile(
    new URL("research-lines/baseline-csm-radiative-transients/index.html", distRoot),
    "utf8"
  );
  assert.match(candidateLine, /Circumstellar Interaction and Transient Light Curves/u);
  assert.match(candidateLine, /Candidate/u);
  assert.match(candidateLine, /TransFit-CSM/u);

  const candidatePath = await readFile(
    new URL("learning-paths/baseline-engine-powered-transients/index.html", distRoot),
    "utf8"
  );
  assert.match(candidatePath, /<title>From Radioactive Heating to Engine-powered Transients/u);
  assert.match(candidatePath, /From Radioactive Heating to Engine-powered Transients/u);
  assert.match(candidatePath, /Candidate/u);
  assert.match(candidatePath, /Reading Order/u);
});
