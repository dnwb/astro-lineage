import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChannelPostDraft,
  attachReviewedFigure,
  stripReviewedFigure,
  renderChannelMarkdown,
  findReadingAnchor,
  READING_ANCHORS,
} from "../src/domain/channel-document.mjs";

const sampleItem = {
  arxiv_id: "2610.12345",
  revision: 2,
  title: "Relativistic Shock Acceleration in Extreme Jets",
  paper_title: "Relativistic Shock Acceleration in Extreme Jets",
  authors: ["A. Einstein", "N. Bohr", "P. Dirac", "M. Curie"],
  analysis: {
    priority: "must_read",
    coverage: { label: "Full body text" },
    analysis: {
      problem: {
        detailed_text: "Origin of non-thermal power-law electrons in relativistic shocks.",
      },
      result: {
        detailed_text:
          "PIC simulations reveal magnetic reconnection injects electrons into Fermi acceleration.",
      },
      reason: "Directly constrains microphysics relevant to R2.",
      limits: ["Assumes 2D geometry.", "Pair plasma only."],
    },
  },
};

test("buildChannelPostDraft builds explicit section AST for post-cutover English date", () => {
  const draft = buildChannelPostDraft(sampleItem, "2026-10-28", "GRB Jets");
  assert.equal(draft.arxiv_id, "2610.12345");
  assert.equal(draft.revision, 2);
  assert.equal(draft.date, "2026-10-28");
  assert.equal(draft.isLegacy, false);

  const sectionTypes = draft.sections.map((s) => s.type);
  assert.deepEqual(sectionTypes, ["header", "problem", "result", "reason", "limits", "reading"]);

  const md = renderChannelMarkdown(draft);
  assert.ok(md.includes("**Must Read** · A. Einstein, N. Bohr, P. Dirac 等"));
  assert.ok(md.includes("## Problem & Background"));
  assert.ok(md.includes("## Key Result & Physical Mechanism"));
  assert.ok(md.includes("## Why It Matters"));
  assert.ok(md.includes("## Limitations & Boundaries"));
  assert.ok(md.includes("## Reading Access"));
  assert.ok(md.includes("Online Reading (Cloudflare)"));
  assert.ok(!md.includes("## 课题背景"));
});

test("buildChannelPostDraft builds explicit section AST for legacy Chinese date", () => {
  const draft = buildChannelPostDraft(sampleItem, "2026-10-20", "伽马射线暴与相对论喷流");
  assert.equal(draft.isLegacy, true);

  const md = renderChannelMarkdown(draft);
  assert.ok(md.includes("**必读** · A. Einstein, N. Bohr, P. Dirac 等"));
  assert.ok(md.includes("## 课题背景"));
  assert.ok(md.includes("## 核心突破"));
  assert.ok(md.includes("## 研读价值"));
  assert.ok(md.includes("## 限制与边界"));
  assert.ok(md.includes("## 阅读入口"));
  assert.ok(md.includes("公网在线阅读 (Cloudflare)"));
  assert.ok(!md.includes("## Reading Access"));
});

test("attachReviewedFigure and stripReviewedFigure manipulate draft sections deterministically", () => {
  const draft = buildChannelPostDraft(sampleItem, "2026-10-28", "GRB Jets");
  assert.equal(
    draft.sections.some((s) => s.type === "figure"),
    false
  );

  const figure = {
    label: "Fig. 3",
    caption: "Phase-space distribution of accelerated leptons.",
    category_badge: "核心物理演化图",
    physical_core: "Magnetic reconnection profile and particle spectrum.",
  };

  const withFig = attachReviewedFigure(draft, figure, sampleItem);
  assert.equal(
    withFig.sections.some((s) => s.type === "figure"),
    true
  );

  // Figure section must appear before reading section
  const figIdx = withFig.sections.findIndex((s) => s.type === "figure");
  const readIdx = withFig.sections.findIndex((s) => s.type === "reading");
  assert.ok(figIdx < readIdx);

  const md = renderChannelMarkdown(withFig);
  assert.ok(md.includes("## Key Figure"));
  assert.ok(md.includes("[(0,0)](@img)"));
  assert.ok(md.includes("> **Physical Core (Physical Evolution)**:"));
  assert.ok(md.includes("Original Fig. 3 Caption (author-reported):"));
  assert.ok(md.includes("## Reading Access"));

  const stripped = stripReviewedFigure(withFig);
  assert.equal(
    stripped.sections.some((s) => s.type === "figure"),
    false
  );
  const strippedMd = renderChannelMarkdown(stripped);
  assert.ok(!strippedMd.includes("## Key Figure"));
  assert.ok(!strippedMd.includes("[(0,0)](@img)"));
  assert.ok(strippedMd.includes("## Reading Access"));
});

test("findReadingAnchor resolves both Chinese and English anchors in text", () => {
  assert.ok(READING_ANCHORS.includes("\n---\n\n## Reading Access"));
  assert.ok(READING_ANCHORS.includes("\n---\n\n## 阅读入口"));

  const enText = "Some body\n---\n\n## Reading Access\n\nLink";
  const enMatch = findReadingAnchor(enText);
  assert.ok(enMatch);
  assert.equal(enMatch.isEn, true);
  assert.equal(enMatch.anchor, "\n---\n\n## Reading Access");

  const zhText = "Some body\n---\n\n## 阅读入口\n\nLink";
  const zhMatch = findReadingAnchor(zhText);
  assert.ok(zhMatch);
  assert.equal(zhMatch.isEn, false);
  assert.equal(zhMatch.anchor, "\n---\n\n## 阅读入口");
});
