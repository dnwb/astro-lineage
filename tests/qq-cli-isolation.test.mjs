import test from "node:test";
import assert from "node:assert/strict";
import { resolveGroupTargets, dispatchGroupProactiveSend } from "../scripts/qq-send.mjs";

test("resolveGroupTargets: defaults to test group when QQ_TEST_GROUP_OPENID is set without broadcast", () => {
  const env = { QQ_TEST_GROUP_OPENID: "TEST_GROUP_1" };
  const mockUserManager = {
    getLatestGroupOpenid: () => "PROD_GROUP_2",
    getNotificationGroupOpenids: () => ["TEST_GROUP_1", "PROD_GROUP_2"],
  };

  const result = resolveGroupTargets({
    args: ["--group", "hello world"],
    env,
    userManager: mockUserManager,
  });

  assert.equal(result.isBroadcast, false);
  assert.deepEqual(result.targets, ["TEST_GROUP_1"]);
  assert.equal(result.guarded, true);
});

test("resolveGroupTargets: blocks sending to non-test group when test guard is active and no --force", () => {
  const env = { QQ_TEST_GROUP_OPENID: "TEST_GROUP_1" };
  const mockUserManager = {
    getLatestGroupOpenid: () => "TEST_GROUP_1",
    getNotificationGroupOpenids: () => ["TEST_GROUP_1", "PROD_GROUP_2"],
  };

  assert.throws(
    () => {
      resolveGroupTargets({
        args: ["--group", "PROD_GROUP_2", "hello world"],
        specifiedGroup: "PROD_GROUP_2",
        env,
        userManager: mockUserManager,
      });
    },
    (err) => {
      return err.message.includes("QQ_TEST_GUARD_BLOCKED");
    }
  );
});

test("resolveGroupTargets: permits sending to non-test group when --force is supplied", () => {
  const env = { QQ_TEST_GROUP_OPENID: "TEST_GROUP_1" };
  const mockUserManager = {
    getLatestGroupOpenid: () => "TEST_GROUP_1",
    getNotificationGroupOpenids: () => ["TEST_GROUP_1", "PROD_GROUP_2"],
  };

  const result = resolveGroupTargets({
    args: ["--group", "PROD_GROUP_2", "hello world", "--force"],
    specifiedGroup: "PROD_GROUP_2",
    env,
    userManager: mockUserManager,
  });

  assert.equal(result.isBroadcast, false);
  assert.deepEqual(result.targets, ["PROD_GROUP_2"]);
  assert.equal(result.forced, true);
});

test("resolveGroupTargets: returns all notification groups when --broadcast is specified", () => {
  const env = { QQ_TEST_GROUP_OPENID: "TEST_GROUP_1" };
  const mockUserManager = {
    getLatestGroupOpenid: () => "TEST_GROUP_1",
    getNotificationGroupOpenids: () => ["TEST_GROUP_1", "PROD_GROUP_2", "PROD_GROUP_3"],
  };

  const result = resolveGroupTargets({
    args: ["--group", "--brief", "weekly", "--broadcast"],
    env,
    userManager: mockUserManager,
  });

  assert.equal(result.isBroadcast, true);
  assert.deepEqual(result.targets, ["TEST_GROUP_1", "PROD_GROUP_2", "PROD_GROUP_3"]);
});

test("dispatchGroupProactiveSend: loops through targets and collects results independently", async () => {
  const sent = [];
  const mockSender = async ({ groupOpenid, content }) => {
    sent.push({ groupOpenid, content });
    if (groupOpenid === "FAILING_GROUP") {
      throw new Error("HTTP 400: permission denied");
    }
    return { id: `msg_${groupOpenid}` };
  };

  const outcomes = await dispatchGroupProactiveSend({
    targets: ["GROUP_A", "FAILING_GROUP", "GROUP_B"],
    content: "Astronomy brief content",
    sender: mockSender,
  });

  assert.equal(sent.length, 3);
  assert.equal(outcomes.success.length, 2);
  assert.equal(outcomes.failed.length, 1);
  assert.equal(outcomes.failed[0].groupOpenid, "FAILING_GROUP");
  assert.equal(outcomes.failed[0].error.includes("400"), true);
});
