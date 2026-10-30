import test from "node:test";
import assert from "node:assert/strict";
import { pollActiveJournalCandidates } from "../src/domain/journal-feed-service.mjs";

test("pollActiveJournalCandidates: polls eligible sources on publication day and extracts candidates", async () => {
  // 2026-10-29 is Thursday (UTC+8) -> Nature and Science release window
  const thursday = new Date("2026-10-29T10:00:00+08:00");

  const sampleNatureXml = `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/1.2/basic/">
    <channel>
      <title>Nature Latest Research</title>
      <item>
        <title>Discovery of an ultra-long gamma-ray burst from a magnetar giant flare</title>
        <link>https://www.nature.com/articles/s41586-026-00099-1</link>
        <description>High-energy observations reveal unusual prompt emission characteristics.</description>
        <dc:creator>Alice Doe, Bob Smith</dc:creator>
        <dc:date>2026-10-29</dc:date>
        <prism:doi>10.1038/s41586-026-00099-1</prism:doi>
      </item>
      <item>
        <title>Structural insights into ribosomal subunit recycling</title>
        <link>https://www.nature.com/articles/s41586-026-00099-2</link>
        <description>Cryo-EM reconstructions of bacterial ribosomes.</description>
        <dc:creator>Charlie Brown</dc:creator>
        <dc:date>2026-10-29</dc:date>
        <prism:doi>10.1038/s41586-026-00099-2</prism:doi>
      </item>
    </channel>
  </rss>`;

  const mockFetch = async (url) => {
    if (url.includes("nature.com/nature.rss")) {
      return {
        ok: true,
        text: async () => sampleNatureXml,
      };
    }
    return {
      ok: false,
      status: 404,
      text: async () => "Not Found",
    };
  };

  const results = await pollActiveJournalCandidates({
    date: thursday,
    sources: ["nature"],
    fetchFn: mockFetch,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, "doi:10.1038/s41586-026-00099-1");
  assert.equal(results[0].source, "nature");
  assert.equal(
    results[0].title,
    "Discovery of an ultra-long gamma-ray burst from a magnetar giant flare"
  );
});

test("pollActiveJournalCandidates: skips polling when cadence does not match target date", async () => {
  // 2026-10-27 is Tuesday (UTC+8) -> not weekly journal day
  const tuesday = new Date("2026-10-27T10:00:00+08:00");
  let fetchCalled = false;

  const mockFetch = async () => {
    fetchCalled = true;
    return { ok: true, text: async () => "" };
  };

  const results = await pollActiveJournalCandidates({
    date: tuesday,
    sources: ["nature", "science"],
    fetchFn: mockFetch,
  });

  assert.equal(fetchCalled, false, "fetchFn should not be called on off-schedule dates");
  assert.deepEqual(results, []);
});

test("pollActiveJournalCandidates: gracefully handles network errors without throwing", async () => {
  const thursday = new Date("2026-10-29T10:00:00+08:00");

  const mockFailingFetch = async () => {
    throw new Error("Network timeout");
  };

  const results = await pollActiveJournalCandidates({
    date: thursday,
    sources: ["nature"],
    fetchFn: mockFailingFetch,
  });

  assert.deepEqual(results, []);
});
