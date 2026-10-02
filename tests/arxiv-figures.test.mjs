import test from "node:test";
import assert from "node:assert/strict";
import { classifyScientificFigure, cleanCaption } from "../scripts/arxiv-figures.mjs";

test("arxiv-figures: classifyScientificFigure detects theoretical schematic", () => {
  const caption = "Figure 1: Schematic illustration of the jet interaction geometry with the dense circumstellar envelope.";
  const result = classifyScientificFigure(caption);
  assert.ok(result);
  assert.equal(result.type, "theoretical");
  assert.equal(result.badge, "物理模型示意图");
  assert.equal(result.score, 30);
});

test("arxiv-figures: classifyScientificFigure detects observational multi-wavelength light curve", () => {
  const caption = "Figure 2: Multi-wavelength light curve of AT2018cow from radio to gamma-rays, showing rapid temporal decay.";
  const result = classifyScientificFigure(caption);
  assert.ok(result);
  assert.equal(result.type, "observational");
  assert.equal(result.badge, "观测总体曲线/能谱");
  assert.equal(result.score, 25);
});

test("arxiv-figures: classifyScientificFigure detects model vs data fitting comparison", () => {
  const caption = "Figure 4: Best-fit synchrotron self-absorption model compared with observed radio flux densities. Bottom panel shows residuals.";
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
