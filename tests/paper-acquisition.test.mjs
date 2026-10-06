import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquirePaper,
  cleanupStaleWorkspaces,
  DeepxivCircuitBreaker,
  ACQUISITION_ERROR_CODES
} from "../scripts/paper-acquisition.mjs";

test("acquirePaper returns standardized Result pattern on successful acquisition", async () => {
  const fakeEntry = {
    arxiv_id: "2609.99991",
    revision: 1,
    title: "GRB Jet Structure",
    abstract: "We explore the relativistic jet structure."
  };

  // Mock adapter providing dummy markdown
  const mockAdapters = {
    deepxiv: async () => ({
      success: true,
      data: {
        paperId: "2609.99991v1",
        sourceKind: "deepxiv",
        text: "# Introduction\nJet dynamics.\n# Results\nLorentz factor > 100.",
        sections: [
          { title: "Introduction", file: "source.md" },
          { title: "Results", file: "source.md" }
        ],
        figures: [],
        metadata: { url: "https://export.arxiv.org/src/2609.99991v1" },
        sha256: "fakehash123"
      }
    })
  };

  const result = await acquirePaper(fakeEntry, { adapters: mockAdapters });
  assert.equal(result.success, true);
  assert.equal(result.data.paperId, "2609.99991v1");
  assert.equal(result.data.sourceKind, "deepxiv");
  assert.equal(result.data.sections.length, 2);
  assert.equal(typeof result.data.sha256, "string");
});

test("acquirePaper classifies errors into standardized enum codes when adapters fail", async () => {
  const fakeEntry = {
    arxiv_id: "2609.99992",
    revision: 1,
    title: "Magnetar Flare",
    abstract: "Giant flare analysis."
  };

  const breaker = new DeepxivCircuitBreaker({ cooldownMs: 60000 });

  const mockAdapters = {
    deepxiv: async () => {
      breaker.trip("quota exceeded 429");
      return {
        success: false,
        error: {
          code: ACQUISITION_ERROR_CODES.RATE_LIMIT,
          message: "HTTP 429 quota exceeded"
        }
      };
    },
    arxivTex: async () => {
      return {
        success: false,
        error: {
          code: ACQUISITION_ERROR_CODES.NOT_FOUND,
          message: "TeX package not found on arXiv"
        }
      };
    },
    pdf: async () => {
      return {
        success: false,
        error: {
          code: ACQUISITION_ERROR_CODES.PARSING_FAILED,
          message: "pdftotext produced empty text"
        }
      };
    }
  };

  const result = await acquirePaper(fakeEntry, {
    adapters: mockAdapters,
    deepxivBreaker: breaker
  });

  assert.equal(result.success, false);
  assert.ok(result.error);
  assert.ok(Object.values(ACQUISITION_ERROR_CODES).includes(result.error.code));
  assert.equal(breaker.isAvailable(), false);
});

test("acquirePaper cascades from deepxiv rate-limit to TeX source adapter", async () => {
  const fakeEntry = {
    arxiv_id: "2609.99993",
    revision: 1,
    title: "Supernova Remnant",
    abstract: "Cas A shockwave."
  };

  let texCalled = false;
  const mockAdapters = {
    deepxiv: async () => ({
      success: false,
      error: { code: ACQUISITION_ERROR_CODES.RATE_LIMIT, message: "Rate limit" }
    }),
    arxivTex: async () => {
      texCalled = true;
      return {
        success: true,
        data: {
          paperId: "2609.99993v1",
          sourceKind: "arxiv_source_package",
          text: "\\section{Introduction}\nCas A remnant.",
          sections: [{ title: "Introduction", file: "main.tex" }],
          figures: [],
          metadata: { url: "https://export.arxiv.org/src/2609.99993v1" },
          sha256: "texhash999"
        }
      };
    }
  };

  const result = await acquirePaper(fakeEntry, { adapters: mockAdapters });
  assert.equal(result.success, true);
  assert.equal(texCalled, true);
  assert.equal(result.data.sourceKind, "arxiv_source_package");
});

test("cleanupStaleWorkspaces removes orphaned temporary workspace directories", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "axv-test-paper-workspaces-"));
  try {
    const staleDir = join(baseDir, "axv-paper-stale-12345");
    const freshDir = join(baseDir, "axv-paper-fresh-67890");
    await mkdtemp(staleDir);
    await mkdtemp(freshDir);

    // Mock cleaning dirs older than 0ms
    const cleaned = await cleanupStaleWorkspaces({
      baseDir,
      maxAgeMs: -1,
      prefix: "axv-paper-"
    });

    assert.ok(cleaned >= 2);
    const remaining = await readdir(baseDir);
    assert.equal(remaining.length, 0);
  } finally {
    await rm(baseDir, { recursive: true, force: true }).catch(() => {});
  }
});
