import { mkdtemp, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const activeWorkspaces = new Set();

process.on("beforeExit", () => {
  for (const dir of activeWorkspaces) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  activeWorkspaces.clear();
});

export async function createTemporaryWorkspace(prefix = "astro-lineage-test-", t = null) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  activeWorkspaces.add(dir);

  const cleanup = async () => {
    activeWorkspaces.delete(dir);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {}
  };

  if (t && typeof t.after === "function") {
    t.after(cleanup);
  }

  return { path: dir, cleanup };
}
