import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadCanonicalContent } from "../scripts/content-loader.mjs";
import { validateCanonicalContent } from "../scripts/content-validator.mjs";
import { parseReadingMarkdown } from "../scripts/reader-markdown.mjs";
import { renderMathMarkup, splitMath } from "../scripts/reader-math.mjs";
import { projectVisibleSnapshot } from "../scripts/reader-projection.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const contentRoot = join(projectRoot, "content");

const expectedNewWorks = [
  ["work:yu-zhang-gao-2013", "yu-zhang-gao-2013"],
  ["work:yu-li-dai-2015", "yu-li-dai-2015"],
  ["work:liu-magnetar-2017", "liu-magnetar-2017"],
  ["work:liu-fbot-2022", "liu-fbot-2022"],
  ["work:transfit-mag-2026", "transfit-mag-2026"],
  ["work:wu-magnetar-csm-2026", "wu-magnetar-csm-2026"],
  ["work:tan-yu-2020", "tan-yu-2020"],
  ["work:yu-gw-jet-2020", "yu-gw-jet-2020"],
  ["work:zhang-grb-radio-2022", "zhang-grb-radio-2022"],
  ["work:zhang-agn-jet-2024", "zhang-agn-jet-2024"],
  ["work:liu-multiple-ejecta-csm-2018", "liu-multiple-ejecta-csm-2018"],
  ["work:liu-csm-formalism-2020", "liu-csm-formalism-2020"],
  ["work:transfit-csm-2025", "transfit-csm-2025"],
  ["work:liu-fbot-radio-2026", "liu-fbot-radio-2026"],
  ["work:ni-dense-csm-2026", "ni-dense-csm-2026"],
  ["work:chen-psr-b1259-2019", "chen-psr-b1259-2019"],
  ["work:chen-takata-binaries-2022", "chen-takata-binaries-2022"],
  ["work:du-psr-j1932-2026", "du-psr-j1932-2026"],
  ["work:du-frb-2026", "du-frb-2026"],
  ["work:xie-sgr-j1935-2025", "xie-sgr-j1935-2025"],
  ["work:zhu-bns-agn-2021", "zhu-bns-agn-2021"],
  ["work:blandford-mckee-1976", "blandford-mckee-1976"],
  ["work:sari-piran-narayan-1998", "sari-piran-narayan-1998"],
  ["work:kasen-bildsten-2010", "kasen-bildsten-2010"],
  ["work:chevalier-1982", "chevalier-1982"],
  ["work:weaver-1977", "weaver-1977"],
  ["work:dubus-2013", "dubus-2013"],
  ["work:metzger-2017", "metzger-2017"],
  ["work:zhang-frb-2023", "zhang-frb-2023"],
  ["work:khatami-kasen-2024", "khatami-kasen-2024"],
  ["work:bu-hxmt-1a0535-2022", "bu-hxmt-1a0535-2022"],
  ["work:du-bu-vela-x1-2026", "du-bu-vela-x1-2026"],
  ["work:bu-extp-strong-gravity-2025", "bu-extp-strong-gravity-2025"],
  ["work:dai-lu-1998", "dai-lu-1998"],
  ["work:rhoads-1999", "rhoads-1999"],
  ["work:li-gw170817-2018", "li-gw170817-2018"],
];

const expectedFormulaByWork = new Map([
  ["work:liu-fbot-2022", String.raw`P_{\rm i}\propto M_{\rm ej}^{-0.45}`],
  ["work:xie-sgr-j1935-2025", String.raw`17^\circ\pm10^\circ`],
  ["work:yu-gw-jet-2020", String.raw`h\sim10^{-26}-10^{-23}`],
  ["work:zhang-grb-radio-2022", String.raw`n=A_{\ast}R^{-k}`],
  ["work:zhu-bns-agn-2021", String.raw`10^{46}\,{\rm erg\,s^{-1}}`],
  ["work:bu-hxmt-1a0535-2022", String.raw`\nu_{\rm QPO} \approx \nu_{\rm K}(r_0) - \nu_s`],
  ["work:du-bu-vela-x1-2026", String.raw`E_{\rm CRSF} \approx 11.6\,{\rm keV}\,\left(\frac{B}{10^{12}\,{\rm G}}\right)(1+z)^{-1}`],
  ["work:bu-extp-strong-gravity-2025", String.raw`r_{\rm ISCO} = f(a_*) \frac{GM}{c^2}`],
  ["work:dai-lu-1998", String.raw`L_{\rm dip}(t) = L_0 \left(1 + \frac{t}{\tau}\right)^{-2}`],
  ["work:rhoads-1999", String.raw`\theta(t) \sim \theta_0 + \frac{c_s}{c}\frac{1}{\Gamma(t)}`],
  ["work:li-gw170817-2018", String.raw`E_{\rm rot} = \frac{1}{2} I \Omega_0^2 \approx 3\times 10^{52}\,{\rm erg}\,\left(\frac{P_0}{1\,{\rm ms}}\right)^{-2}`],
]);

test("the baseline library contains the 36 newly scoped Work bundles as draft candidates", async () => {
  const snapshot = await loadCanonicalContent(contentRoot);
  const report = await validateCanonicalContent(contentRoot, { dataset: "baseline-library" });
  assert.equal(report.valid, true, JSON.stringify(report.diagnostics));
  assert.equal(snapshot.works.length, 41);
  let arxivSources = 0;
  let crossrefSources = 0;
  for (const [workId, slug] of expectedNewWorks) {
    const work = snapshot.works.find(({ id }) => id === workId);
    assert.ok(work, workId);
    assert.equal(work.slug, slug, workId);
    assert.equal(work.files["work.yaml"].reader_state, "draft", workId);
    assert.deepEqual(work.files["work.yaml"].visibility_approvals, [], workId);
    assert.ok(work.files["versions.yaml"].versions.length > 0, `${slug}/versions`);
    assert.ok(work.files["versions.yaml"].bibliographic_sources.length > 0, `${slug}/sources`);
    for (const source of work.files["versions.yaml"].bibliographic_sources) {
      assert.equal(source.source_url.includes("/tmp/"), false, `${slug}/source_url`);
      if (source.provider === "arxiv") arxivSources += 1;
      if (source.provider === "crossref") crossrefSources += 1;
    }
    for (const fileName of ["work.yaml", "versions.yaml", "evidence.yaml", "annotations.yaml", "statements.yaml", "physical-account.yaml", "reading.md"]) {
      assert.ok(work.files[fileName] !== undefined, `${slug}/${fileName}`);
    }
    assert.ok(work.files["evidence.yaml"].evidence.length > 0, `${slug}/evidence`);
    assert.ok(work.files["evidence.yaml"].evidence.every((evidence) => (
      /^https?:\/\/[^\s]+$/u.test(evidence.source_url) &&
      evidence.locator?.type &&
      typeof evidence.excerpt === "string" &&
      evidence.excerpt.trim().length > 0
    )), `${slug}/evidence fields`);
  }
  assert.equal(arxivSources, 30);
  assert.equal(crossrefSources, 6);
});

test("each new baseline reading is bilingual, structurally complete, and contains renderable math", async () => {
  const snapshot = await loadCanonicalContent(contentRoot);
  for (const [workId, slug] of expectedNewWorks) {
    const work = snapshot.works.find(({ id }) => id === workId);
    const reading = work.files["reading.md"];
    assert.doesNotMatch(reading, /[\u0000-\u0008\u000B-\u001F\u007F]/u, `${workId}: reading contains a control character`);
    const blocks = parseReadingMarkdown(reading);
    for (const heading of ["Why This Work Matters", "Problem", "Scientific takeaway", "Assumptions", "Scientific delta", "Reason to read"]) {
      assert.ok(blocks.some((block) => block.kind === "heading" && block.depth === 2 && block.text === heading), `${workId}: ${heading}`);
    }
    assert.ok(blocks.some((block) => block.kind === "heading" && block.text === "中文导读"), workId);
    assert.ok(blocks.some((block) => block.kind === "heading" && block.text === "English reading note"), workId);
    const paragraphs = blocks.filter((block) => block.kind === "paragraph").map((block) => block.text).join(" ");
    const math = splitMath(paragraphs);
    assert.ok(math.some((segment) => segment.kind === "math"), `${workId}: ${slug} has no math`);
    const expectedFormula = expectedFormulaByWork.get(workId);
    if (expectedFormula) {
      assert.ok(math.some((segment) => segment.kind === "math" && segment.value.includes(expectedFormula)), `${workId}: repaired formula is not preserved`);
    }
    const rendered = math.filter((segment) => segment.kind === "math").map((segment) => renderMathMarkup(segment.value, segment.display)).join(" ");
    assert.match(rendered, /<math\b/u, workId);
    assert.match(rendered, /application\/x-tex/u, workId);
  }
});

test("new baseline drafts remain outside the visible reader projection", async () => {
  const snapshot = await loadCanonicalContent(contentRoot);
  const reader = projectVisibleSnapshot(snapshot);
  assert.equal(reader.works.length, 5);
  for (const [workId] of expectedNewWorks) {
    assert.equal(reader.works.some((work) => work.work_id === workId), false, workId);
  }
});
