#!/usr/bin/env node
/**
 * AstroLineage QQ Bot 安全媒体获取与并发控制模块 (Secure Media Fetcher & Vision Semaphore)
 *
 * 核心职责：
 * 1. 严格域名白名单验证与 SSRF 防护（仅允许腾讯 CDN 域名 *.qpic.cn, *.qq.com, *.tencent.com 且协议必须为 https:）
 * 2. 流式字节统计与 8 MB 超限熔断中断（触发 AbortController.abort() 并立即断开流）
 * 3. 图像二进制转标准 base64 Data URI (data:image/...;base64,...)
 * 4. 全局视觉分析并发信号量控制（默认并发度 = 3），超出时快速失败并返回友好排队提示
 */

export const APPROVED_MEDIA_DOMAINS = Object.freeze(["qpic.cn", "qq.com", "tencent.com"]);

export const MAX_MEDIA_BYTES = 8 * 1024 * 1024; // 8 MB
export const DEFAULT_MEDIA_TIMEOUT_MS = 15_000; // 15 seconds

/**
 * 校验域名是否在腾讯 CDN 白名单中
 */
export function isWhitelistedMediaDomain(hostname) {
  if (!hostname || typeof hostname !== "string") return false;
  const lower = hostname.trim().toLowerCase();
  if (!lower || lower.includes(" ") || lower.includes(":")) return false;
  return APPROVED_MEDIA_DOMAINS.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
}

/**
 * 严格校验媒体 URL，防御 SSRF
 */
export function validateMediaUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") {
    throw new Error("Invalid media URL: input must be a non-empty string");
  }
  let normalized = urlStr.trim();
  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  }
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch (err) {
    throw new Error(`Invalid media URL format: ${err.message}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Invalid media protocol: protocol must be https: (received ${parsed.protocol})`
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error("Invalid media URL: credentials in URL are prohibited");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new Error(`Invalid media URL: non-standard HTTPS port ${parsed.port} is prohibited`);
  }
  if (!isWhitelistedMediaDomain(parsed.hostname)) {
    throw new Error(
      `Unapproved media domain: ${parsed.hostname} is not in approved Tencent CDN whitelist`
    );
  }
  return parsed;
}

/**
 * 解析并确认图像 MIME 类型
 */
export function resolveImageMimeType(contentType = "", pathname = "") {
  const raw = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (raw.startsWith("image/")) {
    return raw;
  }
  const ext = (pathname.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "svg") return "image/svg+xml";

  if (!raw || raw === "application/octet-stream") {
    return "image/jpeg"; // default fallback for CDN images without explicit content-type
  }
  throw new Error(`Unsupported media type: expected image MIME type, received "${contentType}"`);
}

/**
 * 下载远程多媒体图片并转换为标准 Base64 Data URI
 */
export async function fetchMediaAsDataUri(
  urlStr,
  {
    maxBytes = MAX_MEDIA_BYTES,
    timeoutMs = DEFAULT_MEDIA_TIMEOUT_MS,
    fetchFn = globalThis.fetch,
  } = {}
) {
  const parsedUrl = validateMediaUrl(urlStr);
  const controller = new AbortController();
  let timeoutFired = false;
  const timeoutId = setTimeout(() => {
    timeoutFired = true;
    controller.abort(new Error(`Media download timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const response = await fetchFn(parsedUrl, {
      signal: controller.signal,
      redirect: "error",
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Media download HTTP error: ${response.status}`);
    }

    const contentLength = Number(response.headers?.get?.("content-length"));
    if (contentLength && contentLength > maxBytes) {
      controller.abort(
        new Error(
          `Media payload exceeds ${maxBytes} bytes limit (Content-Length: ${contentLength})`
        )
      );
      throw new Error(`Media payload exceeds limit of ${maxBytes} bytes`);
    }

    const mimeType = resolveImageMimeType(
      response.headers?.get?.("content-type"),
      parsedUrl.pathname
    );

    if (!response.body) {
      throw new Error("Empty response body from media endpoint");
    }

    const chunks = [];
    let receivedBytes = 0;

    for await (const chunk of response.body) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        controller.abort(new Error(`Media payload stream exceeded ${maxBytes} bytes limit`));
        throw new Error(`Media payload exceeds limit of ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }

    if (receivedBytes === 0) {
      throw new Error("Received empty media payload (0 bytes)");
    }

    const buffer = Buffer.concat(chunks);
    const base64 = buffer.toString("base64");
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    if (timeoutFired || (controller.signal.aborted && /timeout/i.test(err.message))) {
      throw new Error(`Media download timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 包装函数：支持字符串 URL 或 attachment 对象 ({ url: "..." })
 */
export async function fetchMediaAttachment(attachmentOrUrl, options = {}) {
  const url = typeof attachmentOrUrl === "string" ? attachmentOrUrl : attachmentOrUrl?.url;
  if (!url) {
    throw new Error("Missing or invalid media URL in attachment");
  }
  return await fetchMediaAsDataUri(url, options);
}

/**
 * 视觉分析拥堵异常
 */
export class VisionCongestionError extends Error {
  constructor(
    message = "视觉分析通道繁忙，请稍后重试。(vision analysis congested, please try again shortly)"
  ) {
    super(message);
    this.name = "VisionCongestionError";
    this.userMessage = message;
  }
}

/**
 * 视觉分析并发信号量管理器
 */
export class VisionConcurrencySemaphore {
  constructor(maxConcurrency = 3) {
    this.maxConcurrency = maxConcurrency;
    this.current = 0;
  }

  get activeCount() {
    return this.current;
  }

  tryAcquire() {
    if (this.current >= this.maxConcurrency) {
      return false;
    }
    this.current++;
    return true;
  }

  release() {
    if (this.current > 0) {
      this.current--;
    }
  }

  async run(task) {
    if (!this.tryAcquire()) {
      throw new VisionCongestionError();
    }
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

export const defaultVisionSemaphore = new VisionConcurrencySemaphore(3);
