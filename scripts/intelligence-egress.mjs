/**
 * AstroLineage IntelligenceEgress Deep Module
 *
 * 统一多渠道情报分发深模块（支持腾讯频道社区与官方 QQ 机器人）。
 * 遵循 Matt Pocock 契约规范与深模块原则：小表面、深实现、严格接缝与故障隔离。
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const SUPPORTED_PAYLOAD_KINDS = new Set(["daily", "weekly", "paper", "alert"]);

export function hashString(content) {
  return createHash("sha256")
    .update(String(content || ""))
    .digest("hex");
}

export function validateIntelligencePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("INVALID_PAYLOAD: Payload must be a non-null object");
  }
  if (!payload.id || typeof payload.id !== "string" || !payload.id.trim()) {
    throw new Error("INVALID_PAYLOAD_ID: Payload requires a non-empty string 'id'");
  }
  if (
    !payload.kind ||
    typeof payload.kind !== "string" ||
    !SUPPORTED_PAYLOAD_KINDS.has(payload.kind)
  ) {
    throw new Error(
      `INVALID_PAYLOAD_KIND: Payload kind must be one of ${[...SUPPORTED_PAYLOAD_KINDS].join(", ")}`
    );
  }
  if (!payload.title || typeof payload.title !== "string" || !payload.title.trim()) {
    throw new Error("INVALID_PAYLOAD_TITLE: Payload requires a non-empty string 'title'");
  }
  if (
    payload.body_markdown === undefined ||
    payload.body_markdown === null ||
    typeof payload.body_markdown !== "string"
  ) {
    throw new Error("INVALID_PAYLOAD_BODY: Payload requires a string 'body_markdown'");
  }

  return {
    id: payload.id.trim(),
    kind: payload.kind,
    title: payload.title.trim(),
    summary: typeof payload.summary === "string" ? payload.summary.trim() : "",
    body_markdown: payload.body_markdown,
    source_version: typeof payload.source_version === "string" ? payload.source_version.trim() : "",
    url: typeof payload.url === "string" ? payload.url.trim() : "",
    topic: typeof payload.topic === "string" ? payload.topic.trim() : "",
    figures: Array.isArray(payload.figures) ? payload.figures : [],
    metadata:
      typeof payload.metadata === "object" && payload.metadata !== null ? payload.metadata : {},
  };
}

export class PublicationLedger {
  constructor({
    cacheDir = resolve(fileURLToPath(new URL("../.cache/intelligence-egress", import.meta.url))),
  } = {}) {
    this.cacheDir = cacheDir;
    this.ledgerPath = join(this.cacheDir, "ledger.json");
    this.lockQueue = Promise.resolve();
  }

  async readLedger() {
    try {
      const data = await readFile(this.ledgerPath, "utf8");
      const parsed = JSON.parse(data);
      if (parsed?.version === 1 && typeof parsed.items === "object") {
        return parsed;
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn(`[PublicationLedger] Failed to read ledger: ${err.message}`);
      }
    }
    return { version: 1, items: {} };
  }

  async writeLedger(ledger) {
    await mkdir(this.cacheDir, { recursive: true });
    const tmp = `${this.ledgerPath}.tmp.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(ledger, null, 2), "utf8");
    await writeFile(this.ledgerPath, JSON.stringify(ledger, null, 2), "utf8");
  }

  async getRecord(key) {
    const ledger = await this.readLedger();
    return ledger.items[key] || null;
  }

  async setRecord(key, record) {
    this.lockQueue = this.lockQueue.then(async () => {
      const ledger = await this.readLedger();
      ledger.items[key] = {
        ...record,
        updated_at: new Date().toISOString(),
      };
      await this.writeLedger(ledger);
    });
    return this.lockQueue;
  }

  async isPublished(key) {
    const record = await this.getRecord(key);
    return record?.status === "sent" || record?.status === "success";
  }
}

export class TencentGuildAdapter {
  constructor({
    guildId = process.env.TENCENT_GUILD_ID || "",
    channelMap = {},
    cliRunner = TencentGuildAdapter.defaultCliRunner,
  } = {}) {
    this.guildId = guildId;
    this.channelMap = channelMap;
    this.cliRunner = cliRunner;
  }

  static async defaultCliRunner(args) {
    return new Promise((resolvePromise, reject) => {
      const proc = spawn("tencent-channel-cli", args, {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      const stop = () => {
        try {
          if (process.platform !== "win32") process.kill(-proc.pid, "SIGKILL");
          else proc.kill("SIGKILL");
        } catch {}
      };
      const timer = setTimeout(() => {
        stop();
        reject(new Error("CHANNEL_TIMEOUT"));
      }, 120_000);
      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      const append = (chunk, target) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 1_000_000) {
          stop();
          reject(new Error("CHANNEL_OUTPUT_LIMIT"));
          return;
        }
        if (target === "stdout") stdout += chunk;
        else stderr += chunk;
      };
      proc.stdout.on("data", (chunk) => append(chunk, "stdout"));
      proc.stderr.on("data", (chunk) => append(chunk, "stderr"));
      proc.on("error", () => {
        clearTimeout(timer);
        reject(new Error("CHANNEL_RUNTIME_UNAVAILABLE"));
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          try {
            const response = JSON.parse(stdout);
            if (Number(response?.retCode) === 153) {
              reject(new Error("CHANNEL_RATE_LIMIT"));
              return;
            }
            if (
              !(response?.success === true || Number(response?.retCode) === 0) ||
              response?.success === false ||
              response?.error
            ) {
              reject(new Error("CHANNEL_REMOTE_REJECTED"));
              return;
            }
            resolvePromise(response);
          } catch {
            reject(new Error("CHANNEL_RESPONSE_INVALID"));
          }
        } else {
          try {
            if (Number(JSON.parse(stdout).retCode) === 153) {
              reject(new Error("CHANNEL_RATE_LIMIT"));
              return;
            }
          } catch {}
          reject(new Error(`CHANNEL_CLI_EXIT_${code}`));
        }
      });
    });
  }

  resolveChannelId(payload) {
    if (payload.topic && this.channelMap[payload.topic]) {
      return this.channelMap[payload.topic];
    }
    if (this.channelMap[payload.kind]) {
      return this.channelMap[payload.kind];
    }
    if (this.channelMap.default) {
      return this.channelMap.default;
    }
    return Object.values(this.channelMap)[0] || "";
  }

  formatContent(payload) {
    let content = payload.body_markdown;
    if (payload.summary && !content.includes(payload.summary)) {
      content = `> ${payload.summary}\n\n${content}`;
    }
    if (payload.url && !content.includes(payload.url)) {
      content = `${content}\n\n[查看网页完整导读](${payload.url})`;
    }
    // Respect Tencent Guild 5000 character limit
    if (content.length > 4900) {
      content = content.slice(0, 4850) + "\n\n...(内容过长，请访问网页阅读完整正文)";
    }
    return content;
  }

  async publish(payload) {
    const validated = validateIntelligencePayload(payload);
    const channelId = this.resolveChannelId(validated);
    const content = this.formatContent(validated);

    const args = [
      "post",
      "create",
      "--channel-id",
      channelId || "default",
      "--title",
      validated.title,
      "--content",
      content,
    ];

    if (this.guildId) {
      args.push("--guild-id", this.guildId);
    }

    try {
      const resp = await this.cliRunner(args);
      const messageId =
        resp?.data?.thread_id || resp?.data?.post_id || resp?.data?.id || resp?.id || "posted";
      return {
        channel: "tencent_guild",
        status: "success",
        messageId: String(messageId),
      };
    } catch (err) {
      if (err.message === "CHANNEL_RATE_LIMIT") {
        return {
          channel: "tencent_guild",
          status: "blocked",
          code: "CHANNEL_RATE_LIMIT",
          reason: "Tencent Guild rate limit triggered",
        };
      }
      throw err;
    }
  }
}

export class OfficialQqBotAdapter {
  constructor({
    groupOpenid = process.env.QQ_GROUP_OPENID || "",
    adminOpenid = process.env.QQ_ADMIN_OPENID || "",
    ledger,
    sender,
    enabled = true,
  } = {}) {
    this.groupOpenid = groupOpenid;
    this.adminOpenid = adminOpenid;
    this.ledger = ledger || new PublicationLedger();
    this.sender = sender || (async () => ({ id: "sent" }));
    this.enabled = enabled;
  }

  formatGroupBrief(payload) {
    const parts = [payload.title];
    if (payload.summary) {
      parts.push(payload.summary);
    }
    if (payload.url) {
      parts.push(`完整导读：${payload.url}`);
    }
    let brief = parts.join("\n\n");
    // Ensure brevity for QQ group push
    if (brief.length > 450) {
      brief = brief.slice(0, 430) + "...";
    }
    return brief;
  }

  formatAlertContent(payload) {
    const timestamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    return [
      `⚠️ 【AstroLineage 运维告警】`,
      `时间：${timestamp}`,
      `主题：${payload.title}`,
      `详情：${payload.body_markdown}`,
    ].join("\n");
  }

  async publish(payload) {
    const validated = validateIntelligencePayload(payload);
    if (!this.enabled) {
      return {
        channel: "qq_bot",
        status: "waiting_permission",
        reason: "QQ bot broadcast is disabled by configuration",
      };
    }

    const versionKey = validated.source_version || hashString(validated.body_markdown);
    const targetId = validated.kind === "alert" ? this.adminOpenid : this.groupOpenid;
    const ledgerKey = `qq:${validated.id}:${hashString(targetId)}:${versionKey}`;

    if (await this.ledger.isPublished(ledgerKey)) {
      return {
        channel: "qq_bot",
        status: "unchanged",
        reason: "Already published in ledger",
      };
    }

    let content;
    if (validated.kind === "alert") {
      content = this.formatAlertContent(validated);
    } else {
      content = this.formatGroupBrief(validated);
    }

    try {
      await this.ledger.setRecord(ledgerKey, {
        status: "intent",
        content_hash: hashString(content),
      });
      const receipt = await this.sender({
        groupOpenid: this.groupOpenid,
        userOpenid: this.adminOpenid,
        content,
      });

      const messageId = receipt?.id || receipt?.messageId || "sent";
      await this.ledger.setRecord(ledgerKey, {
        status: "sent",
        message_id: messageId,
        content_hash: hashString(content),
      });

      return {
        channel: "qq_bot",
        status: "success",
        messageId: String(messageId),
      };
    } catch (err) {
      await this.ledger.setRecord(ledgerKey, { status: "failed", error: err.message });
      throw err;
    }
  }
}

export async function dispatchIntelligence(payload, options = {}) {
  const validated = validateIntelligencePayload(payload);
  const adapters = options.adapters || {
    tencent_guild: new TencentGuildAdapter(options.guildOptions),
    qq_bot: new OfficialQqBotAdapter(options.qqOptions),
  };

  const channelNames = Object.keys(adapters);
  const results = {};

  const settled = await Promise.allSettled(
    channelNames.map(async (name) => {
      const adapter = adapters[name];
      if (!adapter || typeof adapter.publish !== "function") {
        throw new Error(`Adapter ${name} does not implement publish()`);
      }
      return { name, result: await adapter.publish(validated) };
    })
  );

  for (let i = 0; i < settled.length; i++) {
    const item = settled[i];
    const name = channelNames[i];
    if (item.status === "fulfilled") {
      results[name] = item.value.result;
    } else {
      results[name] = {
        channel: name,
        status: "failed",
        reason: item.reason?.message || "Unknown adapter error",
      };
    }
  }

  const statuses = Object.values(results).map((r) => r.status);
  let overallStatus = "success";

  if (statuses.every((s) => s === "success")) {
    overallStatus = "success";
  } else if (statuses.every((s) => s === "unchanged")) {
    overallStatus = "unchanged";
  } else if (statuses.every((s) => s === "failed")) {
    overallStatus = "failed";
  } else if (statuses.every((s) => s === "waiting_permission")) {
    overallStatus = "waiting_permission";
  } else if (statuses.some((s) => s === "success" || s === "unchanged")) {
    overallStatus = "partial";
  } else {
    overallStatus = "failed";
  }

  return {
    payload_id: validated.id,
    status: overallStatus,
    channels: results,
    dispatched_at: new Date().toISOString(),
  };
}
