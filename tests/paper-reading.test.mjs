import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { computeCanonicalContentDigest } from "../scripts/content-digest.mjs";
import {
  computeReaderVisibilityDigest,
  validateCanonicalContent,
} from "../scripts/content-validator.mjs";
import { loadCanonicalContent } from "../scripts/content-loader.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const productionContent = join(projectRoot, "content");
const workIds = [
  "work:arnett-1982",
  "work:bromberg-2011",
  "work:long-yu-2026",
  "work:transfit-2025",
  "work:zhu-2021",
];

function buildReader() {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(build.status, 0, build.stderr || build.stdout);
}

function assertInOrder(source, markers, label) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${label}: missing ${marker}`);
    assert(next > cursor, `${label}: ${marker} is out of order`);
    cursor = next;
  }
}

test.before(buildReader);

test("Papers index lets readers choose every projected Paper with scientific context", async () => {
  const html = await readFile(join(projectRoot, "dist", "papers", "index.html"), "utf8");

  assert.match(html, /5 curated Papers/u);
  for (const expected of [
    "Type I supernovae. I - Analytic solutions for the early part of the light curve",
    "The Propagation of Relativistic Jets in External Media",
    "High-energy neutrino signatures of embedded GRB jets in AGN disks: a dynamic jet-propagation framework",
    "TransFit: An Efficient Framework for Transient Light-Curve Fitting with Time-Dependent Radiative Diffusion",
    "High-energy Neutrinos from Choked Gamma-Ray Bursts in Active Galactic Nucleus Accretion Disks",
    "Arnett, W. D.",
    "1982",
    "Its historical “Type I” language should not be silently rewritten as a modern subtype classification.",
  ]) {
    assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")), expected);
  }

  for (const href of [
    "/papers/arnett-1982/",
    "/papers/bromberg-2011/",
    "/papers/long-yu-2026/",
    "/papers/transfit-2025/",
    "/papers/zhu-2021/",
    "/research-lines/central-engines/",
    "/research-lines/dense-environment-multimessenger/",
    "/research-lines/explosive-transients-csm/",
  ]) {
    assert.match(html, new RegExp(`href="${href}"`, "u"), href);
    assert.equal(
      existsSync(join(projectRoot, "dist", href.slice(1), "index.html")),
      true,
      `missing generated destination for ${href}`,
    );
  }
  assert.equal((html.match(/>Read paper<\/a>/gu) ?? []).length, 5);
});

test("the reader build preserves canonical and per-Work visibility digests", async () => {
  const beforeSnapshot = await loadCanonicalContent(productionContent);
  const beforeCanonicalDigest = await computeCanonicalContentDigest(productionContent);
  const beforeVisibilityDigests = new Map(
    workIds.map((workId) => [
      workId,
      computeReaderVisibilityDigest(beforeSnapshot, "work", workId),
    ]),
  );
  const validation = await validateCanonicalContent(productionContent);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics, null, 2));

  const afterSnapshot = await loadCanonicalContent(productionContent);
  assert.equal(await computeCanonicalContentDigest(productionContent), beforeCanonicalDigest);
  for (const workId of workIds) {
    assert.equal(
      computeReaderVisibilityDigest(afterSnapshot, "work", workId),
      beforeVisibilityDigests.get(workId),
      workId,
    );
  }
});

test("Paper Detail presents the complete scientific reading loop before on-demand evidence", async () => {
  const papers = [
    ["arnett-1982", "https://doi.org/10.1086/159681"],
    ["bromberg-2011", "https://doi.org/10.1088/0004-637x/740/2/100"],
    ["long-yu-2026", "https://arxiv.org/abs/2608.12217v1"],
    ["transfit-2025", "https://arxiv.org/abs/2505.13825v1"],
    ["zhu-2021", "https://arxiv.org/abs/2103.00789v3"],
  ];

  for (const [slug, publicUrl] of papers) {
    const html = await readFile(join(projectRoot, "dist", "papers", slug, "index.html"), "utf8");
    assertInOrder(html, [
      "reader-header",
      "Why This Work Matters</h2>",
      "Problem</h2>",
      "Scientific Takeaway</h2>",
      "Assumptions</h2>",
      "Scientific Delta</h2>",
      "Connections</h2>",
      "Research Context</h2>",
      "Provenance &amp; scientific evidence</summary>",
    ], slug);
    assert.match(html, new RegExp(`href="${publicUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"`, "u"));
    assert.match(html, /<details class="panel provenance-detail">/u, slug);
    assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/u, slug);
    assert.doesNotMatch(html, /(?:visibility_approvals|reader_state)/u, slug);
  }

  const arnett = await readFile(join(projectRoot, "dist", "papers", "arnett-1982", "index.html"), "utf8");
  assert.match(arnett, /Read this Work to see how a compact physical model connects an energy source to transport and a measurable light curve\./u);
  assert.match(arnett, /Its historical “Type I” language should not be silently rewritten as a modern subtype classification\./u);
  assert.equal((arnett.match(/Type I supernovae: early light-curve solutions/gu) ?? []).length, 0);

  const longYu = await readFile(join(projectRoot, "dist", "papers", "long-yu-2026", "index.html"), "utf8");
  assert.match(longYu, /about 14 percent in the reported comparison/u);
  assert.match(longYu, /breakout cases can be overpredicted by single-state estimates/u);
});

test("Paper connections preserve canonical direction while linking both endpoints", async () => {
  const expectations = [
    ["arnett-1982", "CHALLENGED BY", "/papers/transfit-2025/"],
    ["transfit-2025", "CHALLENGES", "/papers/arnett-1982/"],
    ["zhu-2021", "EXTENDED BY", "/papers/long-yu-2026/"],
    ["long-yu-2026", "EXTENDS", "/papers/zhu-2021/"],
  ];

  for (const [slug, relation, href] of expectations) {
    const html = await readFile(join(projectRoot, "dist", "papers", slug, "index.html"), "utf8");
    const connections = html.slice(
      html.indexOf('<section class="panel" aria-labelledby="connections-heading">'),
      html.indexOf('<section class="panel" aria-labelledby="research-context-heading">'),
    );
    assert.match(connections, new RegExp(`<span class="tag">${relation}</span>`, "u"), slug);
    assert.match(connections, new RegExp(`href="${href}"`, "u"), slug);
  }
});
