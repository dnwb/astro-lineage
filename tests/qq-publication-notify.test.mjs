import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateGroupBrief, notifyGroupPublication } from "../scripts/qq-send.mjs";
import { validateDailyRadarPayload } from "../scripts/daily-radar.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";
import { hashBody } from "../scripts/channel-publication.mjs";

const channelUrl = "https://pd.qq.com/s/example";
const websiteBase = "https://reader.example";
const sourceBinding = { daily: { hash: "a".repeat(64) }, weekly: { hash: "b".repeat(64) } };

test("group daily summary places original links with papers and separates discussion from full reading", async () => {
  const archive = JSON.parse(
    await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url))
  );
  const { model } = validateDailyRadarPayload(archive.feed, archive.radar);
  const text = await generateGroupBrief("daily", {
    dailyModel: model,
    date: archive.date,
    channelUrl,
    websiteBase,
  });
  assert.ok(
    text.startsWith(
      "「09-28」一维高斯透镜模型预言，高放大主要由焦散B主导，折叠概率随平均总放大率按μ⁻²变化\n"
    )
  );
  assert.ok(text.includes(archive.opening_brief.intro));
  const first = model.groups.must_read[0];
  assert.ok(text.includes(`https://arxiv.org/abs/${first.arxiv_id}v${first.revision}`));
  assert.ok(text.indexOf("原文：") < text.indexOf("频道讨论"));
  assert.ok(text.indexOf("频道讨论") < text.indexOf("完整导读"));
  assert.ok(text.includes(`${websiteBase}/arxiv-daily/${archive.date}/`));
  assert.doesNotMatch(text, /候选\)|研判分布|\.\.\.|突破：/u);
});

test("group weekly summary preserves source picks and labels partial channel delivery", async () => {
  const weekly = {
    week_id: "2026-W40",
    date_range: "2026-09-28 ~ 2026-10-04",
    executive_summary:
      "SN 2024ggi的前兆非探测限制了指定时长和亮度范围内的显著爆发式失质量。本周其他详细结果。",
    thematic_highlights: [{ theme_name: "喷流传播" }],
    top_picks: [
      {
        arxiv_id: "2609.12345",
        title: "Jet propagation",
        priority: "must_read",
        reason: "与喷流动力学相关。",
      },
    ],
  };
  const text = await generateGroupBrief("weekly", {
    weekly,
    channelUrl,
    websiteBase,
    delivery: { channel: { weekly: { status: "failed" } } },
  });
  assert.ok(
    text.startsWith(
      "[2026-W40] 前沿周报 ｜ SN 2024ggi的前兆非探测限制了指定时长和亮度范围内的显著爆发式失质量\n"
    )
  );
  assert.ok(text.includes("https://arxiv.org/abs/2609.12345"));
  assert.ok(text.includes(`${websiteBase}/arxiv-weekly/2026-W40/`));
  assert.match(text, /频道部分内容待同步/u);
  assert.doesNotMatch(text, /全部完成|突破：/u);
});

test("group notifier prepares summaries while permission-disabled and never falls back to private messages", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-notify-", t);
  let sends = 0;
  const result = await notifyGroupPublication({
    kinds: ["daily", "weekly"],
    cache: path,
    enabled: false,
    groupOpenid: "test-group",
    brief: async (kind) => `${kind} summary`,
    send: async () => {
      sends++;
    },
  });
  assert.equal(result.status, "waiting_permission");
  assert.equal(result.targets.daily.status, "waiting_permission");
  assert.equal(result.targets.weekly.status, "waiting_permission");
  assert.equal(sends, 0);
  const outbox = JSON.parse(await readFile(join(path, "outbox.json")));
  assert.equal(outbox.daily.content, "daily summary");
  assert.equal(outbox.weekly.content, "weekly summary");
});

test("enabled group notifications are idempotent and target failures are independent", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-notify-", t);
  let sends = 0;
  const options = {
    sourceBinding,
    kinds: ["daily", "weekly"],
    cache: path,
    enabled: true,
    groupOpenid: "test-group",
    brief: async (kind) => `${kind} summary`,
    send: async ({ content }) => {
      sends++;
      if (content.startsWith("weekly")) throw new Error("secret provider diagnostic");
      return { id: "message-1" };
    },
  };
  const first = await notifyGroupPublication(options);
  assert.equal(first.targets.daily.status, "success");
  assert.equal(first.targets.weekly.code, "QQ_NOTIFY_UNKNOWN_OUTCOME");
  assert.doesNotMatch(JSON.stringify(first), /secret provider/);
  const second = await notifyGroupPublication(options);
  assert.equal(second.targets.daily.status, "unchanged");
  assert.equal(second.targets.weekly.code, "QQ_NOTIFY_UNKNOWN_OUTCOME");
  assert.equal(sends, 2);
});

test("notification preparation errors do not attempt sends or expose diagnostics", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-notify-", t);
  let sends = 0;
  const result = await notifyGroupPublication({
    sourceBinding,
    kinds: ["daily", "weekly"],
    cache: path,
    enabled: true,
    groupOpenid: "test-group",
    brief: async (kind) => {
      if (kind === "daily") throw new Error("QQ_SOURCE_BUILD_MISMATCH");
      return "weekly summary";
    },
    send: async () => {
      sends++;
      return { id: "message-1" };
    },
  });
  assert.equal(result.targets.daily.code, "QQ_SOURCE_BUILD_MISMATCH");
  assert.equal(result.targets.weekly.status, "success");
  assert.equal(sends, 1);
});

test("missing group target and malformed ledger fail closed", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-notify-", t);
  let sends = 0;
  const options = {
    kinds: ["daily"],
    cache: path,
    enabled: true,
    groupOpenid: "",
    brief: async () => "summary",
    send: async () => {
      sends++;
    },
  };
  assert.equal(
    (await notifyGroupPublication(options)).targets.daily.code,
    "QQ_GROUP_TARGET_REQUIRED"
  );
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "ledger.json"), "bad ledger");
  const result = await notifyGroupPublication({ ...options, groupOpenid: "test-group" });
  assert.equal(result.code, "QQ_NOTIFY_LEDGER_INVALID");
  assert.equal(await readFile(join(path, "ledger.json"), "utf8"), "bad ledger");
  assert.equal(sends, 0);
});

test("source changes fail closed without a mutable-file fallback", async () => {
  const binding = {
    daily: { generation_id: "old", hash: "a".repeat(64) },
    weekly: { hash: "b".repeat(64) },
    archives: {},
  };
  binding.id = hashBody(JSON.stringify(binding));
  await assert.rejects(
    generateGroupBrief("daily", {
      sourceBinding: binding,
      channelUrl,
      readEdition: async () => ({ generation_id: "new", feed: {}, radar: {} }),
    }),
    /QQ_SOURCE_BUILD_MISMATCH/u
  );
});

test("definite remote rejection can recover later without exposing account diagnostics", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-notify-", t);
  let calls = 0;
  const options = {
    sourceBinding,
    kinds: ["daily"],
    cache: path,
    enabled: true,
    groupOpenid: "test-group",
    brief: async () => "summary",
    send: async () => {
      calls++;
      if (calls === 1) throw new Error("发送主动群消息失败 HTTP 403: private diagnostic");
      return { id: "message-1" };
    },
  };
  const first = await notifyGroupPublication(options);
  assert.equal(first.targets.daily.code, "QQ_NOTIFY_REMOTE_REJECTED");
  assert.doesNotMatch(JSON.stringify(first), /private diagnostic/);
  assert.equal((await notifyGroupPublication(options)).targets.daily.status, "success");
  assert.equal((await notifyGroupPublication(options)).targets.daily.status, "unchanged");
  assert.equal(calls, 2);
});

test("summary links cannot embed credentials or an unrelated channel host", async () => {
  const weekly = { week_id: "2026-W40", executive_summary: "本周关注喷流传播。" };
  await assert.rejects(
    generateGroupBrief("weekly", { weekly, channelUrl: "https://attacker.example/", websiteBase }),
    /QQ_CHANNEL_LINK_REQUIRED/u
  );
  await assert.rejects(
    generateGroupBrief("weekly", {
      weekly,
      channelUrl,
      websiteBase: "https://user:password@reader.example",
    }),
    /QQ_SOURCE_INVALID/u
  );
});

test("same publication stays deduplicated when delivery warning text changes", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-notify-", t);
  for (const outcome of ["sent", "unknown"]) {
    let sends = 0;
    const options = {
      kinds: ["daily"],
      cache: join(path, outcome),
      enabled: true,
      groupOpenid: "test-group",
      sourceBinding: { daily: { hash: "a".repeat(64) } },
      brief: async () => (sends ? "summary" : "summary, channel pending"),
      send: async () => {
        sends++;
        if (outcome === "unknown") throw new Error("transport timeout");
        return { id: "message-1" };
      },
    };
    await notifyGroupPublication(options);
    const again = await notifyGroupPublication(options);
    assert.equal(sends, 1);
    assert.equal(again.targets.daily.status, outcome === "sent" ? "unchanged" : "blocked");
    if (outcome === "unknown") assert.equal(again.targets.daily.code, "QQ_NOTIFY_UNKNOWN_OUTCOME");
  }
});

test("blocked preparation outranks permission waiting in aggregate status", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-notify-", t);
  const result = await notifyGroupPublication({
    kinds: ["daily", "weekly"],
    cache: path,
    enabled: false,
    brief: async (kind) => {
      if (kind === "daily") throw new Error("QQ_SOURCE_BUILD_MISMATCH");
      return "weekly summary";
    },
  });
  assert.equal(result.targets.daily.status, "blocked");
  assert.equal(result.targets.weekly.status, "waiting_permission");
  assert.equal(result.status, "blocked");
});

test("weekly introduction preserves the complete thought following a leading colon", async () => {
  const weekly = {
    week_id: "2026-W40",
    executive_summary: "本周进展沿着以下脉络：\n\n- 星周介质影响激波演化。\n- 后续内容。",
    thematic_highlights: [
      { summary: "SN 2024ggi的前兆非探测限制了指定时长和亮度范围内的显著爆发式失质量。" },
    ],
  };
  const text = await generateGroupBrief("weekly", { weekly, channelUrl, websiteBase });
  assert.ok(text.includes("星周介质影响激波演化。"));
});

test("daily notifications key the effective bound archive, including resolved identity on unbound calls", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-notify-", t);
  const archiveBytes = await readFile(
    new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url),
    "utf8"
  );
  const archive = JSON.parse(archiveBytes);
  const archiveRoot = join(path, "archives"),
    distRoot = join(path, "dist");
  await mkdir(archiveRoot);
  await mkdir(join(distRoot, "arxiv-daily", archive.date), { recursive: true });
  await writeFile(join(distRoot, "arxiv-daily", archive.date, "index.html"), "built preview");
  const archivePath = join(archiveRoot, `${archive.date}.json`);
  await writeFile(archivePath, archiveBytes);
  const published = { generation_id: "same-generation", feed: archive.feed, radar: archive.radar };
  const binding = {
    daily: {
      generation_id: published.generation_id,
      hash: hashBody(JSON.stringify({ feed: published.feed, radar: published.radar })),
    },
    weekly: { hash: "b".repeat(64) },
    archives: { [archive.date]: hashBody(archiveBytes) },
  };
  const bind = () => {
    binding.id = hashBody(
      JSON.stringify({ daily: binding.daily, weekly: binding.weekly, archives: binding.archives })
    );
  };
  bind();
  const brief = async (kind, options) =>
    generateGroupBrief(kind, {
      ...options,
      sourceBinding: binding,
      archiveRoot,
      distRoot,
      channelUrl,
      websiteBase,
      readEdition: async () => published,
    });
  let sends = 0;
  const options = {
    kinds: ["daily"],
    cache: join(path, "notify"),
    enabled: true,
    groupOpenid: "test-group",
    brief,
    send: async () => {
      sends++;
      return { id: "message" };
    },
  };
  assert.equal((await notifyGroupPublication(options)).targets.daily.status, "success");
  assert.equal((await notifyGroupPublication(options)).targets.daily.status, "unchanged");
  await writeFile(archivePath, archiveBytes + "\n");
  binding.archives[archive.date] = hashBody(archiveBytes + "\n");
  bind();
  assert.equal((await notifyGroupPublication(options)).targets.daily.status, "success");
  assert.equal(sends, 2);
  options.cache = join(path, "unknown");
  options.send = async () => {
    sends++;
    throw new Error("transport timeout");
  };
  options.delivery = { channel: { daily: { status: "failed" } } };
  assert.equal(
    (await notifyGroupPublication(options)).targets.daily.code,
    "QQ_NOTIFY_UNKNOWN_OUTCOME"
  );
  options.delivery.channel.daily.status = "success";
  assert.equal(
    (await notifyGroupPublication(options)).targets.daily.code,
    "QQ_NOTIFY_UNKNOWN_OUTCOME"
  );
  assert.equal(sends, 3);
});

test("a summary without a stable publication identity cannot be sent", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-qq-notify-", t);
  let sends = 0;
  const result = await notifyGroupPublication({
    kinds: ["daily"],
    cache: path,
    enabled: true,
    groupOpenid: "test-group",
    brief: async () => "unbound text",
    send: async () => {
      sends++;
      return { id: "message" };
    },
  });
  assert.equal(result.targets.daily.code, "QQ_SOURCE_BUILD_REQUIRED");
  assert.equal(sends, 0);
});
