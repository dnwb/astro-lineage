import {
  DEFAULT_WEBSITE_BASE,
  DEFAULT_PUBLIC_SITE_URL,
  sanitizeWebsiteBase,
} from "./academic-domain.mjs";

/**
 * Resolve the base URL for agent-facing egress endpoints.
 *
 * Precedence rules:
 * 1. Explicit public site URL environment variables: PUBLIC_SITE_URL, ASTRO_SITE_URL.
 * 2. Cloudflare Pages build detection: CF_PAGES=1 / CF_PAGES=true falls back to DEFAULT_PUBLIC_SITE_URL (https://astro-lineage.pages.dev).
 * 3. Intranet / LAN override: LOCAL_SITE_URL (e.g. custom host/port).
 * 4. Default fallback: DEFAULT_WEBSITE_BASE (http://10.131.43.83:4321), preserving campus intranet accessibility.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function getAgentEgressBaseUrl(env = typeof process !== "undefined" ? process.env : {}) {
  const explicit = env?.PUBLIC_SITE_URL || env?.ASTRO_SITE_URL;
  if (explicit) {
    return sanitizeWebsiteBase(explicit);
  }
  if (env?.CF_PAGES === "1" || env?.CF_PAGES === "true") {
    return sanitizeWebsiteBase(DEFAULT_PUBLIC_SITE_URL);
  }
  const local = env?.LOCAL_SITE_URL;
  if (local) {
    return sanitizeWebsiteBase(local);
  }
  return sanitizeWebsiteBase(DEFAULT_WEBSITE_BASE);
}

/**
 * Generate standard /llms.txt content following the LLMs.txt specification.
 *
 * @param {{ baseUrl?: string }} [options]
 * @returns {string}
 */
export function generateLlmsTxt(options = {}) {
  const baseUrl = options.baseUrl || getAgentEgressBaseUrl();
  return `# AstroLineage (axvdaily)

> High-Energy Astrophysics & Transient Intelligence Feed for Autonomous Agents and Researchers.
> Tracking Fast Radio Bursts (FRB), Supernovae & CSM Shock Interactions, Relativistic Jets (GRB), Gravitational Waves (GW), Magnetars, and Compact Binaries with Fail-Closed Scientific Evidence.

## Overview
AstroLineage is an automated academic intelligence platform for high-energy astrophysics. It continuously monitors arXiv preprints (astro-ph.HE, astro-ph.SR, astro-ph.GA), ingests full TeX source packages, and generates verifiable, fail-closed reading guides with verbatim evidence quotes and physical boundary conditions.

## Machine-Readable Endpoints (Base Server: ${baseUrl})
- Daily Radar JSON: \`${baseUrl}/api/v1/daily.json\` (Today's prioritized papers, BLUF summaries, and verbatim evidence chains)
- Weekly Synthesis JSON: \`${baseUrl}/api/v1/weekly.json\` (Structured weekly synthesis, thematic highlights, and domain matrix)
- Transient Events Feed: \`${baseUrl}/api/v1/events.json\` (Clustered observational transient events: GRBs, SNe, FRBs, GWs with heat decay scores)
- Full Machine Context: \`${baseUrl}/llms-full.txt\` (Comprehensive taxonomy, research lines, and recent intelligence)
- OpenAPI Specification: \`${baseUrl}/openapi.yaml\` (OpenAPI 3.1 schema for API consumers)
- Agent Documentation: \`${baseUrl}/agent/\` (Interactive developer and agent onboarding guide)

## Research Directions
1. Central Engines & Energy Injection (中央引擎与能量注入 - R1)
2. Relativistic Jets & GRB Physics (相对论喷流与伽马暴 - R2)
3. Explosive Transients & Circumstellar Medium (爆发瞬变与星周介质 - R3)
4. Pulsar Wind & High-Energy Binaries (脉冲星风与高能双星 - R4)
5. Magnetar Bursts & FRB Environment (磁星爆发与FRB环境 - R5)
6. Compact Environments & Multi-Messenger (致密环境与多信使 - R6)
7. High-Energy X-ray Timing & Accretion (高能X射线观测与致密双星 - R7)

## Priority Definitions
- \`must_read\`: Fundamental empirical or theoretical breakthrough directly impacting core research lines; requires full TeX body verification.
- \`worth_knowing\`: Important incremental observation, methodology constraint, or physical model; requires body partial verification.
- \`skip\`: Purely out-of-scope (e.g. planetary science, solar corona, pure instrumentation) or peripheral material.

## Guidance for AI Agents & LLMs
When summarizing or answering questions using AstroLineage intelligence:
1. Always cite the arXiv ID and specific version (e.g. \`arXiv:2609.38682v1\`).
2. Cite the exact observational transient identifier if applicable (e.g. \`GRB 250419A\`, \`SN 2024ggi\`).
3. Preserve the distinction between verified full-body evidence and abstract-only initial screening.
4. Distinguish between empirical constraints and theoretical model assumptions.
`;
}

/**
 * Generate comprehensive /llms-full.txt context for deep reasoning agent ingestion.
 *
 * @param {{ baseUrl?: string }} [options]
 * @returns {string}
 */
export function generateLlmsFullTxt(options = {}) {
  const baseUrl = options.baseUrl || getAgentEgressBaseUrl();
  return `# AstroLineage Intelligence Knowledge Base (Full Context)

> Complete domain guide, data schema, research lines, and endpoints for external AI agents (Cursor, Claude Code, NotebookLM, ChatGPT).

## 1. Domain Scope & Mission
AstroLineage is dedicated to high-energy transient astrophysics. We focus on:
- Fast Radio Bursts (FRB): Magnetar engines, plasma lensing, dispersion measures (DM), Faraday rotation measures (RM), persistent radio sources (PRS), host galaxy environments.
- Supernovae (SN): Core-collapse supernovae, circumstellar medium (CSM) interaction, early shock breakout and shock cooling, progenitor mass loss, superluminous supernovae (SLSN).
- Gamma-Ray Bursts (GRB): Prompt emission mechanisms, relativistic jet launching and collimation, deceleration shocks, afterglows, collapsar and binary merger progenitors.
- Gravitational Waves (GW) & Multi-Messenger: Binary neutron star (BNS) mergers, neutron star - black hole (NS-BH) mergers, kilonova emission, high-energy neutrinos (IceCube).
- Magnetars & Pulsars: Giant flares, magnetar spin-down, pulsar wind nebulae (PWN), intra-binary shocks in spider pulsars.

## 2. API Endpoints for Agents (Base Server: ${baseUrl})
All endpoints return JSON and are updated automatically:
- \`GET ${baseUrl}/api/v1/daily.json\`: Current active daily radar payload with priority groupings (must_read, worth_knowing, skip), opening brief, and verified evidence quotes.
- \`GET ${baseUrl}/api/v1/weekly.json\`: Current weekly synthesis including executive summary, thematic highlights, top picks, and domain matrix.
- \`GET ${baseUrl}/api/v1/events.json\`: Transient scientific event clusters (e.g. GW170817, GRB 250419A, AT2018hyz) sorted by heat score with 7-day half-life decay.

## 3. Data Contract: Paper Analysis Record
Each paper analyzed by AstroLineage follows this contract:
\`\`\`json
{
  "arxiv_id": "2609.38682",
  "revision": 1,
  "title": "Paper Title",
  "priority": "must_read | worth_knowing | skip",
  "analysis": {
    "problem": "Specific astrophysical problem investigated",
    "method": "Observational facilities, models, simulation codes used",
    "result": "Principal empirical or theoretical conclusions with boundaries",
    "reason": "Why this paper matters to high-energy transient astrophysics",
    "reading_entry": "Recommended starting section (e.g. 'Section 3.2' or 'Abstract')",
    "assumptions": ["Explicit theoretical or modeling assumptions"],
    "limits": ["Observational limits, systematic uncertainties, parameter degeneracies"],
    "research_progress": "Incremental step relative to prior literature",
    "evidence": [
      {
        "section": "Section title in source TeX",
        "quote": "Verbatim quote from source text (12-240 characters)",
        "supports": ["reason", "result", "problem", "method", "research_progress"]
      }
    ]
  },
  "coverage": {
    "level": "full_body | body_partial | abstract_only",
    "inspected_sections": ["1. Introduction", "2. Observations", "..."]
  }
}
\`\`\`

## 4. Transient Events Schema
\`\`\`json
{
  "event_id": "GRB 250419A",
  "event_type": "GRB",
  "tags": ["GRB"],
  "heat_score": 22.0,
  "paper_count": 1,
  "first_seen": "2026-10-01",
  "last_updated": "2026-10-01",
  "papers": [
    {
      "arxiv_id": "2610.00508",
      "title": "...",
      "priority": "must_read",
      "bluf_result": "..."
    }
  ]
}
\`\`\`
`;
}

/**
 * Generate OpenAPI 3.1.0 schema YAML with environment-aware server URLs.
 *
 * @param {{ baseUrl?: string }} [options]
 * @returns {string}
 */
export function generateOpenApiYaml(options = {}) {
  const baseUrl = options.baseUrl || getAgentEgressBaseUrl();
  return `openapi: 3.1.0
info:
  title: AstroLineage Intelligence API
  description: Machine-readable API for high-energy astrophysics arXiv preprints, transient event clusters, and evidence-backed reading guides.
  version: 1.0.0
servers:
  - url: ${baseUrl}/api/v1
    description: AstroLineage API Server (${baseUrl})
  - url: /api/v1
    description: AstroLineage Static API v1 (Relative)
paths:
  /daily.json:
    get:
      summary: Get Today's Daily Radar Intelligence
      description: Returns the latest daily arXiv preprint screening with priority tiers (must_read, worth_knowing, skip), opening brief, and verified evidence quotes.
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  edition:
                    type: object
                  opening_brief:
                    type: string
                  groups:
                    type: object
                    properties:
                      must_read:
                        type: array
                      worth_knowing:
                        type: array
                      skip:
                        type: array
  /weekly.json:
    get:
      summary: Get Latest Weekly Academic Synthesis
      description: Returns the latest weekly intelligence synthesis, thematic highlights, executive summary, and domain matrix.
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  week_id:
                    type: string
                  date_range:
                    type: string
                  executive_summary:
                    type: string
                  thematic_highlights:
                    type: array
                  top_picks:
                    type: array
  /events.json:
    get:
      summary: Get Transient Scientific Events Feed
      description: Returns clustered observational transient events (GRBs, Supernovae, FRBs, Gravitational Waves) with time-decayed heat scores.
      responses:
        '200':
          description: Successful response
          content:
            application/json:
              schema:
                type: object
                properties:
                  total_events:
                    type: integer
                  events:
                    type: array
                    items:
                      type: object
                      properties:
                        event_id:
                          type: string
                        event_type:
                          type: string
                        heat_score:
                          type: number
                        paper_count:
                          type: integer
                        papers:
                          type: array
`;
}
