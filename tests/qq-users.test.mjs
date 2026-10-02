import assert from "node:assert/strict";
import { test } from "node:test";
import { createUserManager } from "../scripts/qq-users.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";
import { join } from "node:path";
import { stat } from "node:fs/promises";

test("userManager records userOpenid, increments interaction count and updates last_query", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-users-", t);
  const filePath = join(path, "users.json");
  const manager = createUserManager({ filePath, root: path });

  assert.equal(manager.getLatestUserOpenid(), null);
  assert.deepEqual(manager.getUsers(), {});

  const now1 = 1000;
  const user1 = manager.recordUser("openid_abc123", { last_query: "测试问题1" }, now1);
  assert.equal(user1.user_openid, "openid_abc123");
  assert.equal(user1.first_seen, now1);
  assert.equal(user1.last_seen, now1);
  assert.equal(user1.interaction_count, 1);
  assert.equal(user1.last_query, "测试问题1");

  assert.equal(manager.getLatestUserOpenid(), "openid_abc123");

  const now2 = 2000;
  const user1Again = manager.recordUser("openid_abc123", { last_query: "测试问题2" }, now2);
  assert.equal(user1Again.first_seen, now1);
  assert.equal(user1Again.last_seen, now2);
  assert.equal(user1Again.interaction_count, 2);
  assert.equal(user1Again.last_query, "测试问题2");

  // Second user
  manager.recordUser("openid_xyz789", { last_query: "你好" }, 3000);
  assert.equal(manager.getLatestUserOpenid(), "openid_xyz789");

  const all = manager.getUsers();
  assert.equal(Object.keys(all).length, 2);
  assert.equal(all["openid_abc123"].interaction_count, 2);
  assert.equal(all["openid_xyz789"].interaction_count, 1);

  // File permissions
  const fileStat = await stat(filePath);
  assert.equal(fileStat.mode & 0o777, 0o600);
  const dirStat = await stat(path);
  assert.equal(dirStat.mode & 0o777, 0o700);
});

test("userManager validates invalid openids", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-users-", t);
  const manager = createUserManager({ filePath: join(path, "users.json"), root: path });

  assert.equal(manager.recordUser(null), null);
  assert.equal(manager.recordUser(""), null);
  assert.equal(manager.recordUser("   "), null);
  assert.equal(manager.recordUser(12345), null);
  assert.equal(manager.recordUser("a".repeat(200)), null);
  assert.deepEqual(manager.getUsers(), {});
});
