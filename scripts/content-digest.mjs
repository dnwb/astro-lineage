import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parse, stringify } from "yaml";

import { discoverCanonicalContent } from "./content-loader.mjs";

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function canonicalizeYaml(source) {
  const parsed = typeof source === "string" ? parse(source) : source;
  return stringify(stableValue(parsed), {
    lineWidth: 0,
    sortMapEntries: false,
  });
}

export function canonicalizeMarkdown(source) {
  return String(source).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function canonicalizeText(relativePath, source) {
  if (extname(relativePath) === ".yaml") {
    return canonicalizeYaml(source);
  }
  if (extname(relativePath) === ".md") {
    return canonicalizeMarkdown(source);
  }
  return String(source);
}

export async function computeCanonicalContentDigest(contentRoot) {
  const discovery = await discoverCanonicalContent(contentRoot);
  const hash = createHash("sha256");

  for (const relativePath of discovery.files) {
    const fileName = relativePath.startsWith("content/")
      ? relativePath.slice("content/".length)
      : basename(relativePath);
    const source = await readFile(join(discovery.root, fileName), "utf8");
    let canonical;
    try {
      canonical = canonicalizeText(relativePath, source);
    } catch {
      // Invalid canonical input has no semantic digest. The validator keeps
      // the parse diagnostic and writes a report with a null digest.
      return null;
    }
    const pathBytes = Buffer.from(relativePath, "utf8");
    const contentBytes = Buffer.from(canonical, "utf8");

    hash.update(String(pathBytes.byteLength));
    hash.update(":");
    hash.update(pathBytes);
    hash.update("\0");
    hash.update(String(contentBytes.byteLength));
    hash.update(":");
    hash.update(contentBytes);
    hash.update("\0");
  }

  return hash.digest("hex");
}
