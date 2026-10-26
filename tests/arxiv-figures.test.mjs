import test from "node:test";
import assert from "node:assert/strict";
import { classifyScientificFigure, cleanCaption } from "../scripts/arxiv-figures.mjs";

test("arxiv-figures: classifyScientificFigure detects theoretical schematic", () => {
  const caption =
    "Figure 1: Schematic illustration of the jet interaction geometry with the dense circumstellar envelope.";
  const result = classifyScientificFigure(caption);
  assert.ok(result);
  assert.equal(result.type, "theoretical");
  assert.equal(result.badge, "物理模型示意图");
  assert.equal(result.score, 30);
});

test("arxiv-figures: classifyScientificFigure detects observational multi-wavelength light curve", () => {
  const caption =
    "Figure 2: Multi-wavelength light curve of AT2018cow from radio to gamma-rays, showing rapid temporal decay.";
  const result = classifyScientificFigure(caption);
  assert.ok(result);
  assert.equal(result.type, "observational");
  assert.equal(result.badge, "观测总体曲线/能谱");
  assert.equal(result.score, 25);
});

test("arxiv-figures: classifyScientificFigure detects model vs data fitting comparison", () => {
  const caption =
    "Figure 4: Best-fit synchrotron self-absorption model compared with observed radio flux densities. Bottom panel shows residuals.";
  const result = classifyScientificFigure(caption);
  assert.ok(result);
  assert.equal(result.type, "fitting");
  assert.equal(result.badge, "数据拟合与模型对比");
  assert.equal(result.score, 20);
});

test("arxiv-figures: classifyScientificFigure rejects ambiguous or unclassified figures (fail-closed)", () => {
  const randomCaptions = [
    "Figure 1: Coordinates of targets in Galactic longitude and latitude.",
    "Figure 3: Distribution of exposure times across the survey field.",
    "Figure 5: Histogram of stellar ages.",
    "",
    null,
  ];

  for (const cap of randomCaptions) {
    const result = classifyScientificFigure(cap);
    assert.equal(result, null, `Should reject unclassified caption: ${cap}`);
  }
});

test("arxiv-figures: classifyScientificFigure rejects negative figures (flowchart, software, calibration)", () => {
  const negativeCaptions = [
    "Figure 1: Flowchart of data reduction pipeline and software architecture.",
    "Figure 2: Training loss and validation loss over 100 epochs.",
    "Figure 3: Detector calibration curve and camera response function.",
  ];

  for (const cap of negativeCaptions) {
    const result = classifyScientificFigure(cap);
    assert.equal(result, null, `Should reject negative caption: ${cap}`);
  }
});

test("arxiv-figures: classifyScientificFigure detects broadened physical and observational figures", () => {
  const captions = [
    {
      caption:
        "Figure 1: A diagram illustrating host galaxy inclination, demonstrating the increasing path length with inclination.",
      expectedType: "theoretical",
    },
    {
      caption:
        "Figure 6: Adiabatic loss power, total funnel leakage L_fun, and isotropic-equivalent luminosity as functions of time.",
      expectedType: "theoretical",
    },
    {
      caption:
        "Figure 8: Correlation between host galaxy axis ratio and DMHost with empirical linear fit.",
      expectedType: "observational",
    },
  ];

  for (const { caption, expectedType } of captions) {
    const result = classifyScientificFigure(caption);
    assert.ok(result, `Should classify caption: ${caption}`);
    assert.equal(result.type, expectedType);
  }
});

test("arxiv-figures: cleanCaption extracts math from MathML annotations and alttext", () => {
  const htmlWithAnnotation = `
    <figcaption class="ltx_caption">
      <span class="ltx_tag">Figure 1: </span>
      Evolution of spin (<math class="ltx_Math" alttext="a^{*}=-0.9375" display="inline"><semantics><mrow><msup><mi>a</mi><mo>∗</mo></msup><mo>=</mo><mrow><mo>−</mo><mn>0.9375</mn></mrow></mrow><annotation encoding="application/x-tex">a^{*}=-0.9375</annotation></semantics></math>)
      and tilt (<math class="ltx_Math" alttext="0^{\circ}" display="inline"><semantics><msup><mn>0</mn><mo>∘</mo></msup><annotation encoding="application/x-tex">0^{\circ}</annotation></semantics></math>).
    </figcaption>
  `;
  const cleaned = cleanCaption(htmlWithAnnotation);
  assert.equal(cleaned, "Figure 1: Evolution of spin ($a^{*}=-0.9375$) and tilt ($0^{\circ}$).");

  const htmlWithAlttext = `
    <figcaption>Energy <math alttext="E &lt; 10^{48}\\,\\mathrm{erg}"></math> for model.</figcaption>
  `;
  const cleanedAlt = cleanCaption(htmlWithAlttext);
  assert.equal(cleanedAlt, "Energy $E < 10^{48}\\,\\mathrm{erg}$ for model.");

  const htmlWithDisplayMath = `
    <figcaption>Continuity equation: <math display="block" alttext="\\nabla \\cdot v = 0"></math></figcaption>
  `;
  const cleanedDisplay = cleanCaption(htmlWithDisplayMath);
  assert.equal(cleanedDisplay, "Continuity equation: $$\\nabla \\cdot v = 0$$");
});

test("arxiv-figures: extractPaperFigures prioritizes model selection when modelSelector is provided", async (t) => {
  const { createTemporaryWorkspace } = await import("./helpers/temporary-workspace.mjs");
  const ws = await createTemporaryWorkspace("astro-lineage-figures-", t);

  const { extractPaperFigures } = await import("../scripts/arxiv-figures.mjs");
  const fakeHtml = `
    <html>
      <body>
        <figure id="fig1"><img src="fig1.png"><figcaption>Figure 1: A diagram illustrating host galaxy geometry.</figcaption></figure>
        <figure id="fig2"><img src="fig2.png"><figcaption>Figure 2: Flowchart of code.</figcaption></figure>
        <figure id="fig3"><img src="fig3.png"><figcaption>Figure 3: Key luminosity evolution curve.</figcaption></figure>
      </body>
    </html>
  `;

  const mockFetch = async (url) => {
    if (url.endsWith(".png")) {
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    return { ok: true, text: async () => fakeHtml };
  };

  const modelSelector = async ({ candidates }) => {
    return [
      {
        index: 2, // fig3
        category: "theoretical",
        categoryBadge: "核心物理演化图",
        physical_core: "展示黑洞喷流动力学演化与中心引擎光度曲线",
        reason: "展示中心引擎光度随时间演化",
      },
    ];
  };

  const results = await extractPaperFigures("2610.99999", 1, {
    fetchImpl: mockFetch,
    modelSelector,
    figuresDir: ws.path,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].category, "theoretical");
  assert.equal(results[0].category_badge, "核心物理演化图");
  assert.equal(results[0].physical_core, "展示黑洞喷流动力学演化与中心引擎光度曲线");
  assert.match(results[0].caption, /Figure 3/);
});
