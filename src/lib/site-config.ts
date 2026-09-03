import { parse } from "yaml";
import siteConfigSource from "../config/site.yaml?raw";

export interface SiteConfig {
  title: string;
  eyebrow: string;
}

export function loadSiteConfig(): SiteConfig {
  const value: unknown = parse(siteConfigSource);

  if (
    typeof value !== "object" ||
    value === null ||
    !("title" in value) ||
    typeof value.title !== "string" ||
    !("eyebrow" in value) ||
    typeof value.eyebrow !== "string"
  ) {
    throw new Error("Invalid site configuration.");
  }

  return {
    title: value.title,
    eyebrow: value.eyebrow,
  };
}
