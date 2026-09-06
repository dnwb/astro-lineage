function withoutFrontmatter(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "");
}

function normalizeLine(value) {
  return value.trim().replace(/\s+/gu, " ");
}

/**
 * Parse the intentionally small Markdown subset used by canonical reading
 * prose. Keeping this parser local means the reader remains static HTML and
 * does not turn Markdown into a client-side concern. Raw text is returned to
 * Astro expressions, which escape it at render time.
 */
export function parseReadingMarkdown(source, { skipTitle = true } = {}) {
  const lines = withoutFrontmatter(String(source))
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let titleSkipped = false;

  const flushParagraph = () => {
    const text = normalizeLine(paragraph.join(" "));
    if (text) {
      blocks.push({ kind: "paragraph", text });
    }
    paragraph = [];
  };

  const flushList = () => {
    if (list.length > 0) {
      blocks.push({ kind: "list", items: [...list] });
    }
    list = [];
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/u);
    if (heading) {
      flushParagraph();
      flushList();
      if (skipTitle && !titleSkipped && heading[1].length === 1) {
        titleSkipped = true;
        continue;
      }
      blocks.push({
        kind: "heading",
        depth: heading[1].length,
        text: normalizeLine(heading[2]),
      });
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+?)\s*$/u);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/u);
    if (unordered || ordered) {
      flushParagraph();
      const item = unordered?.[1] ?? ordered?.[1];
      if (item) {
        list.push(normalizeLine(item));
      }
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    // Canonical prose wraps long list items across physical lines. Markdown
    // treats those lines as continuation text until a blank line or a new
    // block starts, so preserve the item as one readable sentence.
    if (list.length > 0 && paragraph.length === 0) {
      list[list.length - 1] = normalizeLine(`${list[list.length - 1]} ${line}`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function sectionKey(value) {
  return String(value).trim().toLocaleLowerCase("en-US");
}

export function parseReadingDocument(source) {
  const blocks = parseReadingMarkdown(source, { skipTitle: false });
  const sections = new Map();
  let introductoryBlocks = [];
  let currentSection = null;
  let firstHeading = null;

  for (const block of blocks) {
    if (block.kind === "heading" && block.depth === 1 && firstHeading === null) {
      firstHeading = block.text;
      continue;
    }
    if (block.kind === "heading" && block.depth === 2) {
      currentSection = sectionKey(block.text);
      if (!sections.has(currentSection)) {
        sections.set(currentSection, []);
      }
      continue;
    }
    if (currentSection === null) {
      introductoryBlocks.push(block);
    } else {
      sections.get(currentSection).push(block);
    }
  }

  if (sectionKey(firstHeading ?? "") !== "why this work matters") {
    introductoryBlocks = [];
  }

  return { introductoryBlocks, sections };
}

export function requiredReadingSection(document, heading, workId) {
  const blocks = document.sections.get(sectionKey(heading)) ?? [];
  if (blocks.length === 0) {
    throw new Error(`Missing required reading section "${heading}" for ${workId}.`);
  }
  return blocks;
}

export function whyThisWorkMatters(document, workId) {
  return document.introductoryBlocks.length > 0
    ? document.introductoryBlocks
    : requiredReadingSection(document, "Reason to read", workId);
}

export function firstCompleteReadingItem(blocks, workId) {
  for (const block of blocks) {
    if (block.kind === "paragraph" && block.text) {
      return block.text;
    }
    if (block.kind === "list" && block.items.length > 0) {
      return block.items[0];
    }
  }
  throw new Error(`Missing readable Why read content for ${workId}.`);
}
