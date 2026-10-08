import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pinFeed } from "../scripts/tencent-channel-publisher.mjs";
import { manageHotEventPin } from "../scripts/channel-pin-events.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";

test("pinFeed properly formats CLI flags and validates required fields", async () => {
  await assert.rejects(
    () => pinFeed({ guildId: "", feedId: "feed-1", userId: "u-1", createTime: "123" }),
    /pinFeed requires guildId, feedId, userId, and createTime/u
  );

  const dry = await pinFeed({
    guildId: "test-guild",
    feedId: "feed-1",
    userId: "u-1",
    createTime: "123",
    action: 1,
    dryRun: true,
  });
  assert.equal(dry.success, true);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.action, 1);

  let executedArgs = null;
  const mockCli = async (args) => {
    executedArgs = args;
    return { stdout: JSON.stringify({ retCode: 0, success: true }) };
  };

  const res = await pinFeed({
    guildId: "test-guild",
    channelId: "ch-1",
    feedId: "feed-100",
    userId: "user-200",
    createTime: "1790000000",
    action: 1,
    topType: 1,
    cli: mockCli,
  });
  assert.ok(executedArgs);
  assert.equal(executedArgs[0], "feed");
  assert.equal(executedArgs[1], "top-feed");
  assert.ok(
    executedArgs.includes("--feed-id") &&
      executedArgs[executedArgs.indexOf("--feed-id") + 1] === "feed-100"
  );
  assert.ok(
    executedArgs.includes("--user-id") &&
      executedArgs[executedArgs.indexOf("--user-id") + 1] === "user-200"
  );
  assert.ok(
    executedArgs.includes("--action") && executedArgs[executedArgs.indexOf("--action") + 1] === "1"
  );
  assert.ok(
    executedArgs.includes("--top-type") &&
      executedArgs[executedArgs.indexOf("--top-type") + 1] === "1"
  );
});

test("manageHotEventPin reads ledger, pins feed and updates ledger state", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-pin-", t);
  const cacheRoot = join(path, "cache");
  await mkdir(cacheRoot, { recursive: true });

  const initialLedger = {
    version: 1,
    guild_id: "guild-test",
    items: {
      "events:top5": {
        status: "published",
        feed_id: "feed-top5-xyz",
        create_time: "1790111111",
        channel_id: "ch-daily",
        hash: "a".repeat(64),
      },
    },
  };
  await writeFile(join(cacheRoot, "guild-guild-test.json"), JSON.stringify(initialLedger));

  const mockCli = async (args) => {
    if (args[1] === "get-feed-detail") {
      return { stdout: JSON.stringify({ data: { feed: { author_id: "author-999" } } }) };
    }
    if (args[1] === "top-feed") {
      return { stdout: JSON.stringify({ retCode: 0, success: true }) };
    }
    return { stdout: "{}" };
  };

  // 1. Dry run
  const dry = await manageHotEventPin({
    guildId: "guild-test",
    cacheRoot,
    dryRun: true,
    cli: mockCli,
  });
  assert.equal(dry.dryRun, true);

  // 2. Live pin
  const live = await manageHotEventPin({
    guildId: "guild-test",
    cacheRoot,
    unpin: false,
    dryRun: false,
    cli: mockCli,
  });
  assert.equal(live.success, true);
  assert.equal(live.action, 1);

  const updatedLedger = JSON.parse(
    await readFile(join(cacheRoot, "guild-guild-test.json"), "utf8")
  );
  assert.equal(updatedLedger.items["events:top5"].pinned, true);
  assert.ok(updatedLedger.items["events:top5"].pinned_at);

  // 3. Unpin
  const unpinResult = await manageHotEventPin({
    guildId: "guild-test",
    cacheRoot,
    unpin: true,
    dryRun: false,
    cli: mockCli,
  });
  assert.equal(unpinResult.success, true);
  assert.equal(unpinResult.action, 2);

  const unpinnedLedger = JSON.parse(
    await readFile(join(cacheRoot, "guild-guild-test.json"), "utf8")
  );
  assert.equal(unpinnedLedger.items["events:top5"].pinned, false);
});
