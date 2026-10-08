import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dispatchIntelligence,
  validateIntelligencePayload,
  TencentGuildAdapter,
  OfficialQqBotAdapter,
  PublicationLedger,
} from "../scripts/intelligence-egress.mjs";

test("validateIntelligencePayload enforces schema and fails closed on invalid fields", () => {
  // Missing id
  assert.throws(
    () =>
      validateIntelligencePayload({
        kind: "daily",
        title: "Test Title",
        body_markdown: "Test Body",
      }),
    /INVALID_PAYLOAD_ID/
  );

  // Invalid kind
  assert.throws(
    () =>
      validateIntelligencePayload({
        id: "test-1",
        kind: "unsupported_kind",
        title: "Test Title",
        body_markdown: "Test Body",
      }),
    /INVALID_PAYLOAD_KIND/
  );

  // Missing body_markdown
  assert.throws(
    () =>
      validateIntelligencePayload({
        id: "test-1",
        kind: "daily",
        title: "Test Title",
      }),
    /INVALID_PAYLOAD_BODY/
  );

  // Valid payload
  const valid = validateIntelligencePayload({
    id: "daily:2026-10-06",
    kind: "daily",
    title: "2026-10-06 Daily Radar",
    summary: "High-energy astrophysics daily brief",
    body_markdown: "# 2026-10-06 Daily\n\nContent...",
    source_version: "a".repeat(64),
    url: "https://example.com/daily/2026-10-06",
    topic: "R1",
    figures: [{ id: "fig1", path: "/tmp/fig1.png", caption: "Light curve" }],
  });
  assert.equal(valid.id, "daily:2026-10-06");
  assert.equal(valid.kind, "daily");
});

test("TencentGuildAdapter transforms payload into guild post markdown and respects channel mapping", async () => {
  const cliCalls = [];
  const mockCliRunner = async (args) => {
    cliCalls.push(args);
    return { success: true, retCode: 0, data: { thread_id: "thread-123", post_id: "post-456" } };
  };

  const adapter = new TencentGuildAdapter({
    guildId: "mock-guild-001",
    channelMap: {
      daily: "channel-daily-101",
      weekly: "channel-weekly-102",
      R1: "channel-r1-103",
    },
    cliRunner: mockCliRunner,
  });

  const payload = {
    id: "daily:2026-10-06",
    kind: "daily",
    title: "「10-06」高能天体物理每日雷达导读",
    summary: "今日收录 5 篇重要论文",
    body_markdown: "## 今日重点\n\n深入研读 1 篇必读突破。",
    source_version: "b".repeat(64),
    url: "https://example.com/daily/2026-10-06",
    topic: "R1",
  };

  const result = await adapter.publish(payload);
  assert.equal(result.status, "success");
  assert.equal(result.messageId, "thread-123");
  assert.equal(cliCalls.length, 1);
  assert.ok(cliCalls[0].includes("channel-daily-101") || cliCalls[0].includes("channel-r1-103"));
});

test("OfficialQqBotAdapter formats group brief within safe limits and logs to ledger", async () => {
  const testDir = await mkdtemp(join(tmpdir(), "axv-test-egress-ledger-"));
  try {
    const sentMessages = [];
    const mockSender = async (msg) => {
      sentMessages.push(msg);
      return { id: "qq-msg-999" };
    };

    const ledger = new PublicationLedger({ cacheDir: testDir });
    const adapter = new OfficialQqBotAdapter({
      groupOpenid: "test-group-openid",
      ledger,
      sender: mockSender,
      enabled: true,
    });

    const payload = {
      id: "daily:2026-10-06",
      kind: "daily",
      title: "「10-06」高能天体物理每日雷达",
      summary: "今日重要突破：GRB 260907A 偏振探测",
      body_markdown: "完整正文与详细模型数据分析...",
      source_version: "c".repeat(64),
      url: "https://example.com/daily/2026-10-06",
    };

    // First send
    const res1 = await adapter.publish(payload);
    assert.equal(res1.status, "success");
    assert.equal(res1.messageId, "qq-msg-999");
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].content.length <= 500);

    // Second send (idempotency check via ledger)
    const res2 = await adapter.publish(payload);
    assert.equal(res2.status, "unchanged");
    assert.equal(sentMessages.length, 1); // No new send
  } finally {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("dispatchIntelligence achieves fault isolation across adapters and returns DispatchReceipt", async () => {
  const mockGuildFail = {
    publish: async () => {
      throw new Error("Tencent Guild network timeout");
    },
  };
  const mockQqSuccess = {
    publish: async () => {
      return { status: "success", messageId: "msg-ok-1" };
    },
  };

  const payload = {
    id: "alert:service-healthy",
    kind: "alert",
    title: "服务健康探测",
    body_markdown: "系统所有守护进程均处于活跃态。",
  };

  const receipt = await dispatchIntelligence(payload, {
    adapters: {
      tencent_guild: mockGuildFail,
      qq_bot: mockQqSuccess,
    },
  });

  assert.equal(receipt.payload_id, "alert:service-healthy");
  assert.equal(receipt.status, "partial");
  assert.equal(receipt.channels.tencent_guild.status, "failed");
  assert.ok(receipt.channels.tencent_guild.reason.includes("timeout"));
  assert.equal(receipt.channels.qq_bot.status, "success");
  assert.equal(receipt.channels.qq_bot.messageId, "msg-ok-1");
});

test("dispatchIntelligence returns success when all adapters succeed", async () => {
  const mockA = { publish: async () => ({ status: "success", messageId: "a-1" }) };
  const mockB = { publish: async () => ({ status: "success", messageId: "b-1" }) };

  const receipt = await dispatchIntelligence(
    {
      id: "daily:2026-10-06",
      kind: "daily",
      title: "Daily Radar",
      body_markdown: "Body...",
    },
    {
      adapters: { channel_a: mockA, channel_b: mockB },
    }
  );

  assert.equal(receipt.status, "success");
  assert.equal(receipt.channels.channel_a.status, "success");
  assert.equal(receipt.channels.channel_b.status, "success");
});
