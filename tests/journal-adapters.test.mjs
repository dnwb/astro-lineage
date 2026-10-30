import test from "node:test";
import assert from "node:assert/strict";
import {
  isHighEnergyAstrophysicsPaper,
  normalizePaperIdentifier,
  parseJournalFeedXml,
  formatSourceBadge,
  formatPaperCitation,
  shouldPollSource,
  JOURNAL_SOURCES,
} from "../src/domain/journal-adapter.mjs";

test("journal-adapter: JOURNAL_SOURCES defines supported journals and publication cadences", () => {
  assert.ok(JOURNAL_SOURCES.nature);
  assert.equal(JOURNAL_SOURCES.nature.cadence, "weekly");
  assert.ok(JOURNAL_SOURCES["nature-astronomy"]);
  assert.ok(JOURNAL_SOURCES.science);
});

test("journal-adapter: normalizePaperIdentifier standardizes arXiv IDs and DOIs", () => {
  assert.equal(normalizePaperIdentifier("2609.12345"), "2609.12345");
  assert.equal(normalizePaperIdentifier("arxiv:2609.12345v2"), "2609.12345");
  assert.equal(
    normalizePaperIdentifier("10.1038/s41586-026-00001-2"),
    "doi:10.1038/s41586-026-00001-2"
  );
  assert.equal(
    normalizePaperIdentifier("doi:10.1038/s41586-026-00001-2"),
    "doi:10.1038/s41586-026-00001-2"
  );
});

test("journal-adapter: formatSourceBadge returns canonical display labels", () => {
  assert.equal(formatSourceBadge("arxiv"), "arXiv");
  assert.equal(formatSourceBadge("nature"), "Nature");
  assert.equal(formatSourceBadge("nature-astronomy"), "Nat Astron");
  assert.equal(formatSourceBadge("science"), "Science");
  assert.equal(formatSourceBadge("unknown"), "unknown");
  assert.equal(formatSourceBadge(undefined), "arXiv");
});

test("journal-adapter: formatPaperCitation formats concise volume/issue or short ref", () => {
  assert.equal(
    formatPaperCitation({ source: "nature", volume: "630", issue: "8015" }),
    "Vol. 630, No. 8015"
  );
  assert.equal(formatPaperCitation({ source: "science", volume: "385" }), "Vol. 385");
  assert.equal(
    formatPaperCitation({ source: "nature", doi: "10.1038/s41586-026-00001-2" }),
    "s41586-026-00001-2"
  );
  assert.equal(
    formatPaperCitation({ source: "arxiv", arxiv_id: "2609.12345" }),
    "arXiv:2609.12345"
  );
});

test("journal-adapter: shouldPollSource checks publication cadence alignment", () => {
  // 2026-10-29 is Thursday (UTC+8) -> Nature & Science publication day
  const thursdayDate = new Date("2026-10-29T10:00:00+08:00");
  assert.equal(shouldPollSource("nature", thursdayDate), true);
  assert.equal(shouldPollSource("science", thursdayDate), true);

  // 2026-10-30 is Friday (UTC+8) -> Science publication day
  const fridayDate = new Date("2026-10-30T10:00:00+08:00");
  assert.equal(shouldPollSource("science", fridayDate), true);
  assert.equal(shouldPollSource("nature", fridayDate), false);

  // 2026-10-27 is Tuesday (UTC+8) -> Not a standard weekly journal release day
  const tuesdayDate = new Date("2026-10-27T10:00:00+08:00");
  assert.equal(shouldPollSource("nature", tuesdayDate), false);
  assert.equal(shouldPollSource("science", tuesdayDate), false);

  // arXiv polls daily on weekdays (Mon-Fri)
  assert.equal(shouldPollSource("arxiv", tuesdayDate), true);
  assert.equal(shouldPollSource("arxiv", thursdayDate), true);

  // arXiv does not announce on Sunday (Beijing time)
  const sundayDate = new Date("2026-10-25T10:00:00+08:00");
  assert.equal(shouldPollSource("arxiv", sundayDate), false);
});

test("journal-adapter: isHighEnergyAstrophysicsPaper filters out non-astrophysics multidisciplinary papers", () => {
  const bioPaper = {
    title: "Structural basis of CRISPR-Cas9 activation in mammalian cells",
    abstract: "Here we report the cryo-EM structure of Cas9 ribonucleoprotein complex...",
    categories: ["Biochemistry", "Molecular Biology"],
  };
  assert.equal(isHighEnergyAstrophysicsPaper(bioPaper), false);

  const materialsPaper = {
    title: "Room-temperature superconductivity in compressed hydrides",
    abstract: "High-pressure synthesis reveals zero electrical resistance up to 280 K...",
  };
  assert.equal(isHighEnergyAstrophysicsPaper(materialsPaper), false);

  const grbPaper = {
    title: "A magnetar-powered kilonova following long gamma-ray burst GRB 250314A",
    abstract:
      "Optical and near-infrared observations reveal r-process nucleosynthesis driven by a millisecond magnetar engine.",
  };
  assert.equal(isHighEnergyAstrophysicsPaper(grbPaper), true);

  const frbPaper = {
    title: "Sub-millisecond periodic microstructure in a repeating fast radio burst",
    abstract:
      "High time-resolution polarimetric tracking with FAST reveals emission from neutron star magnetosphere.",
  };
  assert.equal(isHighEnergyAstrophysicsPaper(frbPaper), true);
});

test("journal-adapter: parseJournalFeedXml extracts clean paper candidates from RSS/Atom XML", () => {
  const sampleRss = `<?xml version="1.0" encoding="utf-8"?>
  <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/1.2/basic/">
    <channel>
      <title>Nature Latest Research</title>
      <item>
        <title>A magnetar-powered kilonova following long gamma-ray burst GRB 250314A</title>
        <link>https://www.nature.com/articles/s41586-026-00001-2</link>
        <description><![CDATA[<p>Optical and near-infrared observations reveal r-process nucleosynthesis driven by a millisecond magnetar engine.</p>]]></description>
        <dc:creator>Jane Doe, John Smith, Alice Brown</dc:creator>
        <dc:date>2026-10-29</dc:date>
        <prism:doi>10.1038/s41586-026-00001-2</prism:doi>
      </item>
      <item>
        <title>Cryo-EM structure of human hemoglobin variant</title>
        <link>https://www.nature.com/articles/s41586-026-00002-3</link>
        <description>Biomedical findings regarding blood protein folding.</description>
        <dc:creator>Bob Lee</dc:creator>
        <dc:date>2026-10-29</dc:date>
        <prism:doi>10.1038/s41586-026-00002-3</prism:doi>
      </item>
    </channel>
  </rss>`;

  const candidates = parseJournalFeedXml(sampleRss, "nature");
  assert.equal(candidates.length, 1, "Only the high-energy astrophysics paper should pass");

  const paper = candidates[0];
  assert.equal(paper.id, "doi:10.1038/s41586-026-00001-2");
  assert.equal(paper.source, "nature");
  assert.equal(
    paper.title,
    "A magnetar-powered kilonova following long gamma-ray burst GRB 250314A"
  );
  assert.equal(paper.doi, "10.1038/s41586-026-00001-2");
  assert.deepEqual(paper.authors, ["Jane Doe", "John Smith", "Alice Brown"]);
  assert.ok(paper.summary.includes("r-process nucleosynthesis"));
});
