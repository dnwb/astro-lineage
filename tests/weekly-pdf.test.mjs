import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";
import {
  generateWeeklyMarkdownDocument,
  generatePublicationWeeklyHtml,
  generateWeeklyPdf,
  findChromiumPath,
} from "../scripts/weekly-pdf.mjs";

test("findChromiumPath detects chromium on host environment", () => {
  const binary = findChromiumPath();
  assert.ok(binary === null || typeof binary === "string");
  if (binary) {
    assert.ok(existsSync(binary));
  }
});

test("generateWeeklyMarkdownDocument produces bilingual titles, expands must_read, and does not expand worth_knowing", async () => {
  const websiteBase = "https://astro.example.com";
  const md = await generateWeeklyMarkdownDocument({
    weekId: "2026-W42",
    websiteBase,
  });

  // 1. Header & masthead
  assert.match(md, /# 高能天体物理 arXiv 每周学术脉络 · 2026 年第 42 周 \(2026-W42\)/u);
  assert.match(md, /https:\/\/astro\.example\.com\/arxiv-weekly\/2026-W42\//u);

  // 2. Sections
  assert.match(md, /## 1\. 本周综述与宏观脉络/u);
  assert.match(md, /## 2\. 前沿专题动态与交叉脉络/u);
  assert.match(md, /## 3\. ⭐ 核心必读文献深度解析/u);
  assert.match(md, /## 4\. 📌 本周重点关注文献/u);

  // 3. Must-read deep dive expansion
  assert.match(md, /### \[arXiv:2610\.13062\]/u);
  assert.match(md, /#### 科学问题/u);
  assert.match(md, /#### 观测与研究方法/u);
  assert.match(md, /#### 物理模型与关键假设/u);
  assert.match(md, /#### 关键结论与定量测量/u);

  // 4. Worth-knowing compact items (not expanded)
  assert.match(md, /### \[arXiv:2610\.13011\]/u);
  assert.match(md, /- \*\*推荐理由\*\*：/u);
  assert.match(md, /- \*\*核心要点\*\*：/u);

  // Verify that worth-knowing section does not have deep dive expansion
  const worthKnowingSection = md.split("## 4. 📌 本周重点关注文献")[1];
  assert.ok(worthKnowingSection);
  assert.doesNotMatch(worthKnowingSection, /#### 科学问题/u);
  assert.doesNotMatch(worthKnowingSection, /#### 观测与研究方法/u);
  assert.doesNotMatch(worthKnowingSection, /#### 物理模型与关键假设/u);
});

test("generatePublicationWeeklyHtml creates dedicated academic layout with Base64 figures and links", async () => {
  const websiteBase = "https://astro.example.com";
  const html = await generatePublicationWeeklyHtml({
    weekId: "2026-W42",
    websiteBase,
  });

  // 1. Document title & masthead
  assert.match(html, /高能天体物理 arXiv 每周学术脉络 · 2026 年第 42 周/u);
  assert.match(html, /class="masthead"/u);

  // 2. Print styles
  assert.match(html, /@page\s*\{\s*size:\s*A4/u);
  assert.match(html, /break-inside:\s*avoid/u);

  // 3. Base64 inlined figures for must-read papers
  assert.match(html, /data:image\/(?:png|jpeg|svg\+xml);base64,/u);
  assert.doesNotMatch(html, /<img [^>]*src="\/arxiv-figures\//u);

  // 4. Must-read deep dive sections
  assert.match(html, /class="badge-must"/u);
  assert.match(html, /🔍 科学问题/u);
  assert.match(html, /🛠️ 观测与研究方法/u);
  assert.match(html, /📐 物理模型与关键假设/u);

  // 5. Worth-knowing compact cards (not expanded)
  assert.match(html, /class="badge-worth"/u);
  assert.match(html, /class="worth-card"/u);

  // 6. Hyperlinks
  assert.match(html, /href="https:\/\/arxiv\.org\/abs\//u);
  assert.match(html, /href="https:\/\/ui\.adsabs\.harvard\.edu\/abs\/arXiv:/u);

  // 7. Formula & Markdown rendering
  assert.match(html, /class="katex"/u);
  assert.match(html, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/u);
  assert.match(html, /<strong>/u);
  // 8. Compact layout & zero localhost leaks
  assert.match(html, /class="worth-grid"/u);
  assert.doesNotMatch(html, /localhost/u);
  assert.doesNotMatch(html, /127\.0\.0\.1/u);
});

test("sanitizeWebsiteBase strictly replaces localhost and loopback with canonical host", async () => {
  const { sanitizeWebsiteBase } = await import("../src/domain/academic-domain.mjs");
  assert.equal(sanitizeWebsiteBase("http://localhost:4321"), "http://10.131.43.83:4321");
  assert.equal(sanitizeWebsiteBase("http://127.0.0.1:4321/"), "http://10.131.43.83:4321");
  assert.equal(sanitizeWebsiteBase(""), "http://10.131.43.83:4321");
});

test("generateWeeklyPdf produces valid PDF and Markdown files with caching", async (t) => {
  const binary = findChromiumPath();
  if (!binary) {
    return;
  }

  const ws = await createTemporaryWorkspace("astro-lineage-weekly-pdf-test-", t);
  const publicDir = ws.path;
  const distDir = join(ws.path, "dist");

  const websiteBase = "https://astro.example.com";
  const weekId = "2026-W42";

  // First call: generates PDF
  const result = await generateWeeklyPdf({
    weekId,
    websiteBase,
    publicDir,
    distDir,
    force: false,
  });

  assert.equal(result.weekId, weekId);
  assert.ok(existsSync(result.pdfPath));
  assert.ok(existsSync(result.mdPath));
  assert.equal(result.pdfUrl, `${websiteBase}/arxiv-weekly/${weekId}/weekly-${weekId}.pdf`);
  assert.ok(result.fileSize > 50000);

  // Second call: hits cache
  const cachedResult = await generateWeeklyPdf({
    weekId,
    websiteBase,
    publicDir,
    distDir,
    force: false,
  });
  assert.equal(cachedResult.cached, true);
  assert.equal(cachedResult.pdfPath, result.pdfPath);
});
