import { execFile } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { previewCurrentTitleHistory, readOnlyTitleInventory } from "./channel-title-history-preview.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function saveNewPreview(path, preview) {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(preview, null, 2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}

export async function runTitleAudit({ cli, liveRead = false, outputPath,
  ledgerPath = resolve(root, `.cache/channel-publication/guild-${process.env.TENCENT_GUILD_ID || "default"}.json`),
  websitePath = resolve(root, ".cache/notebooklm/website.json"),
  archiveRoot = resolve(root, "src/data/arxiv-archives/daily"),
  distRoot = resolve(root, "dist"), weeklyPath = resolve(root, "src/data/arxiv-weekly.json") } = {}) {
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const { listInventory, getDetail } = liveRead
    ? readOnlyTitleInventory(cli, ledger.guild_id)
    : { listInventory: async () => ({ complete: false, feeds: [] }), getDetail: async () => { throw new Error("offline"); } };
  const preview = await previewCurrentTitleHistory({ ledgerPath, websitePath, archiveRoot, distRoot,
    weeklyPath, listInventory, getDetail });
  if (outputPath) await saveNewPreview(outputPath, preview);
  return preview;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error("--output requires a path");
  if (args.some(arg => !["--live-read", "--output", ...(outputIndex >= 0 ? [args[outputIndex + 1]] : [])].includes(arg))) throw new Error("Unknown argument");
  const liveRead = args.includes("--live-read");
  const cli = liveRead ? async command => execFileAsync("tencent-channel-cli", command, { timeout: 120_000, maxBuffer: 2_000_000 }) : undefined;
  const preview = await runTitleAudit({ cli, liveRead, outputPath: outputIndex >= 0 ? resolve(args[outputIndex + 1]) : undefined });
  console.log(JSON.stringify({ total: preview.total, counts: preview.counts, inventory_complete: preview.inventory_complete,
    ...(outputIndex >= 0 ? { report: resolve(args[outputIndex + 1]) } : { rows: preview.rows }) }));
}
