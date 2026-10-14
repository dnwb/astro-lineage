#!/usr/bin/env node
/**
 * scripts/cli.mjs
 *
 * AstroLineage Unified Command Line Interface (CLI Toolbelt)
 *
 * Consolidates the 40+ flat scripts into structured domain subcommands:
 * - arxiv: fetch, triage, analyze, archive, weekly
 * - channel: sync, reconcile, pin, audit
 * - bot: start, doctor, probe
 * - validate: validate content graph
 * - diagnostic: run archive and system diagnostics
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COMMAND_MAP = {
  arxiv: {
    description: "arXiv daily & weekly pipeline operations",
    subcommands: {
      fetch: { script: "arxiv-daily.mjs", desc: "Fetch latest arXiv daily announcement feed" },
      triage: { script: "arxiv-triage.mjs", desc: "Run fast heuristic/LLM candidate triage" },
      analyze: {
        script: "arxiv-ai-analyzer.mjs",
        desc: "Run deep two-stage AI analysis & figure selection",
      },
      archive: {
        script: "arxiv-archive.mjs",
        desc: "Sync daily archives and dirty weekly batches",
      },
      weekly: { script: "arxiv-weekly-summary.mjs", desc: "Generate weekly intelligence summary" },
      scheduler: {
        script: "arxiv-daily-scheduler.mjs",
        desc: "Run Beijing time scheduled task daemon",
      },
    },
  },
  channel: {
    description: "Tencent QQ Channel community operations",
    subcommands: {
      sync: { script: "sync-all-channel-posts.mjs", desc: "Sync all channel posts and feeds" },
      reconcile: {
        script: "channel-reconcile.mjs",
        desc: "Reconcile posted papers against remote ledger",
      },
      pin: { script: "channel-pin-events.mjs", desc: "Pin core transient event rankings" },
      audit: { script: "channel-title-audit.mjs", desc: "Audit channel titles and format drift" },
      bot: { script: "tencent-channel-bot.mjs", desc: "Run Tencent Channel bot loop" },
    },
  },
  bot: {
    description: "QQ Official Bot & model operations",
    subcommands: {
      start: { script: "qq-official-bot.mjs", desc: "Start QQ official bot service" },
      doctor: {
        script: "qq-official-bot.mjs",
        extraArgs: ["--doctor"],
        desc: "Run bot health check and self-diagnostics",
      },
      probe: { script: "probe-models.mjs", desc: "Probe available LLM models and latency" },
    },
  },
  validate: {
    description: "Validate academic graph schema and referential integrity",
    directScript: "validate.mjs",
  },
  diagnostic: {
    description: "Run archive health and gatekeeper state diagnostics",
    directScript: "diagnostic.mjs",
  },
};

function printHelp() {
  console.log(`
AstroLineage CLI Toolbelt

Usage:
  node scripts/cli.mjs <domain> [action] [options...]

Domains & Commands:`);

  for (const [domain, config] of Object.entries(COMMAND_MAP)) {
    if (config.subcommands) {
      console.log(`\n  ${domain.padEnd(12)} ${config.description}`);
      for (const [action, sub] of Object.entries(config.subcommands)) {
        console.log(`    ${action.padEnd(10)} ${sub.desc}`);
      }
    } else {
      console.log(`\n  ${domain.padEnd(12)} ${config.description}`);
    }
  }
  console.log(`
Examples:
  node scripts/cli.mjs arxiv archive
  node scripts/cli.mjs arxiv weekly --cascade
  node scripts/cli.mjs channel reconcile
  node scripts/cli.mjs bot doctor
  node scripts/cli.mjs validate
`);
}

function runScript(scriptName, args = []) {
  const scriptPath = resolve(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 0);
}

export function main(argv = process.argv.slice(2)) {
  const [domain, action, ...rest] = argv;

  if (!domain || domain === "--help" || domain === "-h" || domain === "help") {
    printHelp();
    return;
  }

  const domainConfig = COMMAND_MAP[domain];
  if (!domainConfig) {
    console.error(`Unknown domain: "${domain}". Run with --help to see available commands.`);
    process.exit(1);
  }

  if (domainConfig.directScript) {
    const forwardArgs = action ? [action, ...rest] : rest;
    runScript(domainConfig.directScript, forwardArgs);
    return;
  }

  if (!action || action === "--help" || action === "-h") {
    console.log(`\nSubcommands for "${domain}" (${domainConfig.description}):`);
    for (const [subName, subConfig] of Object.entries(domainConfig.subcommands)) {
      console.log(`  ${subName.padEnd(10)} ${subConfig.desc}`);
    }
    return;
  }

  const subConfig = domainConfig.subcommands[action];
  if (!subConfig) {
    console.error(`Unknown action "${action}" for domain "${domain}".`);
    process.exit(1);
  }

  const combinedArgs = [...(subConfig.extraArgs || []), ...rest];
  runScript(subConfig.script, combinedArgs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
