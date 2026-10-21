import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPROVED_MEDIA_DOMAINS,
  MAX_MEDIA_BYTES,
  DEFAULT_MEDIA_TIMEOUT_MS,
  validateMediaUrl,
  isWhitelistedMediaDomain,
  fetchMediaAsDataUri,
  fetchMediaAttachment,
  VisionConcurrencySemaphore,
  VisionCongestionError,
  defaultVisionSemaphore,
} from "../scripts/qq-media.mjs";

test("isWhitelistedMediaDomain accepts approved Tencent CDN domains and rejects others", () => {
  assert.ok(APPROVED_MEDIA_DOMAINS.includes("qpic.cn"));
  assert.equal(MAX_MEDIA_BYTES, 8 * 1024 * 1024);
  assert.equal(DEFAULT_MEDIA_TIMEOUT_MS, 15_000);
  assert.ok(defaultVisionSemaphore instanceof VisionConcurrencySemaphore);

  for (const host of [
    "multimedia.qpic.cn",
    "c2cpicdw.qpic.cn",
    "gchat.qpic.cn",
    "qpic.cn",
    "im.qq.com",
    "v2.api.sgroup.qq.com",
    "qq.com",
    "cdn.tencent.com",
    "tencent.com",
  ]) {
    assert.equal(isWhitelistedMediaDomain(host), true, `Expected ${host} to be allowed`);
  }

  for (const host of [
    "evil-qpic.cn",
    "notqq.com",
    "qq.com.evil.com",
    "evil-tencent.com",
    "example.com",
    "localhost",
    "127.0.0.1",
    "169.254.169.254",
    "",
    null,
    undefined,
  ]) {
    assert.equal(isWhitelistedMediaDomain(host), false, `Expected ${host} to be rejected`);
  }
});

test("validateMediaUrl accepts valid HTTPS URLs on approved domains and normalizes protocol-relative URLs", () => {
  const url1 = validateMediaUrl("https://multimedia.qpic.cn/gchat/abc.png");
  assert.equal(url1.protocol, "https:");
  assert.equal(url1.hostname, "multimedia.qpic.cn");

  // Protocol-relative // should be normalized to https:
  const url2 = validateMediaUrl("//c2cpicdw.qpic.cn/offpic/123.jpg");
  assert.equal(url2.protocol, "https:");
  assert.equal(url2.hostname, "c2cpicdw.qpic.cn");
});

test("validateMediaUrl rejects non-HTTPS protocols immediately without network requests", () => {
  for (const badUrl of [
    "http://multimedia.qpic.cn/image.png",
    "ftp://im.qq.com/image.png",
    "file:///etc/passwd",
    "data:image/png;base64,abc",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => validateMediaUrl(badUrl), /protocol must be https/i);
  }
});

test("validateMediaUrl rejects non-whitelisted domains, SSRF attempts, loopback IPs, and URLs with credentials", () => {
  for (const badUrl of [
    "https://evil.com/pic.png",
    "https://attacker-qq.com/test.jpg",
    "https://qq.com.attacker.com/test.jpg",
    "https://127.0.0.1/test.png",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/image.png",
    "https://user:password@multimedia.qpic.cn/pic.jpg",
    "not-a-url",
    "",
    null,
  ]) {
    assert.throws(() => validateMediaUrl(badUrl), /unapproved|invalid/i);
  }
});

test("fetchMediaAsDataUri successfully downloads media stream and returns base64 Data URI", async (t) => {
  const sampleBytes = Buffer.from("fake-png-binary-data-123456");
  let fetchCalled = false;

  t.mock.method(globalThis, "fetch", async (_url, options) => {
    fetchCalled = true;
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);

    return new Response(sampleBytes, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(sampleBytes.length),
      },
    });
  });

  const dataUri = await fetchMediaAsDataUri("https://multimedia.qpic.cn/sample.png");
  assert.ok(fetchCalled);
  assert.ok(dataUri.startsWith("data:image/png;base64,"));
  const payloadBase64 = dataUri.slice("data:image/png;base64,".length);
  assert.equal(Buffer.from(payloadBase64, "base64").toString(), "fake-png-binary-data-123456");
});

test("fetchMediaAttachment works with attachment object having url property", async (t) => {
  const sampleBytes = Buffer.from("jpeg-bytes");
  t.mock.method(globalThis, "fetch", async () => {
    return new Response(sampleBytes, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  });

  const dataUri = await fetchMediaAttachment({
    url: "https://c2cpicdw.qpic.cn/offpic_new/0/abc",
    content_type: "image/jpeg",
  });
  assert.ok(dataUri.startsWith("data:image/jpeg;base64,"));
});

test("fetchMediaAsDataUri immediately rejects non-whitelisted URLs without calling fetch", async (t) => {
  let fetchCalled = false;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalled = true;
    return new Response("ok");
  });

  await assert.rejects(
    () => fetchMediaAsDataUri("http://multimedia.qpic.cn/insecure.jpg"),
    /protocol must be https/i
  );
  await assert.rejects(
    () => fetchMediaAsDataUri("https://evil.attacker.org/ssrf.jpg"),
    /unapproved/i
  );
  assert.equal(fetchCalled, false, "Network fetch must never be invoked for unapproved URLs");
});

test("fetchMediaAsDataUri aborts stream immediately via AbortController when byte count exceeds 8 MB", async (t) => {
  let abortSignalObserved = null;

  t.mock.method(globalThis, "fetch", async (_url, options) => {
    abortSignalObserved = options.signal;

    // Create an async stream of 9 chunks, each 1 MB (total 9 MB > 8 MB)
    let closed = false;
    let timer = null;
    const stream = new ReadableStream({
      start(controller) {
        const chunkSize = 1024 * 1024; // 1 MB
        const chunk = new Uint8Array(chunkSize);
        let count = 0;
        const pushNext = () => {
          if (closed) return;
          try {
            if (count < 9) {
              controller.enqueue(chunk);
              count++;
              timer = setTimeout(pushNext, 1);
            } else {
              controller.close();
            }
          } catch {
            closed = true;
          }
        };
        pushNext();
      },
      cancel() {
        closed = true;
        if (timer) clearTimeout(timer);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  });

  await assert.rejects(
    () =>
      fetchMediaAsDataUri("https://multimedia.qpic.cn/large.png", { maxBytes: 8 * 1024 * 1024 }),
    /exceeds limit/i
  );
  assert.ok(abortSignalObserved);
  assert.equal(
    abortSignalObserved.aborted,
    true,
    "AbortSignal must be aborted when payload exceeds 8 MB"
  );
});

test("fetchMediaAsDataUri fast-aborts early when Content-Length header exceeds 8 MB", async (t) => {
  let abortSignalObserved = null;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    abortSignalObserved = options.signal;
    return new Response("dummy", {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(10 * 1024 * 1024), // 10 MB
      },
    });
  });

  await assert.rejects(
    () =>
      fetchMediaAsDataUri("https://multimedia.qpic.cn/large-header.png", {
        maxBytes: 8 * 1024 * 1024,
      }),
    /exceeds limit/i
  );
  assert.ok(abortSignalObserved?.aborted);
});

test("fetchMediaAsDataUri aborts when request times out", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    return new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(new Error("Request aborted due to timeout"));
      });
    });
  });

  await assert.rejects(
    () => fetchMediaAsDataUri("https://multimedia.qpic.cn/hang.png", { timeoutMs: 50 }),
    /timed out|aborted/i
  );
});

test("fetchMediaAsDataUri rejects unsupported non-image content-type", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    return new Response("<html>evil</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });

  await assert.rejects(
    () => fetchMediaAsDataUri("https://multimedia.qpic.cn/file.html"),
    /unsupported media type/i
  );
});

test("VisionConcurrencySemaphore limits concurrent visual operations and immediately fast-fails with congestion message when capacity is reached", async () => {
  const sem = new VisionConcurrencySemaphore(3);
  let resolve1, resolve2, resolve3;
  const p1 = new Promise((res) => {
    resolve1 = res;
  });
  const p2 = new Promise((res) => {
    resolve2 = res;
  });
  const p3 = new Promise((res) => {
    resolve3 = res;
  });

  let ran1 = false,
    ran2 = false,
    ran3 = false;

  const t1 = sem.run(async () => {
    ran1 = true;
    await p1;
    return "res1";
  });
  const t2 = sem.run(async () => {
    ran2 = true;
    await p2;
    return "res2";
  });
  const t3 = sem.run(async () => {
    ran3 = true;
    await p3;
    return "res3";
  });

  // Allow promises to start
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ran1, true);
  assert.equal(ran2, true);
  assert.equal(ran3, true);
  assert.equal(sem.activeCount, 3);

  // 4th request must immediately fast-fail with congestion error
  let caughtError = null;
  try {
    await sem.run(async () => "res4");
  } catch (err) {
    caughtError = err;
  }

  assert.ok(
    caughtError instanceof VisionCongestionError,
    "Excess request must throw VisionCongestionError"
  );
  assert.match(caughtError.message, /vision analysis congested, please try again shortly/i);

  // Complete one task
  resolve1();
  const res1 = await t1;
  assert.equal(res1, "res1");
  assert.equal(sem.activeCount, 2);

  // Now a subsequent task can enter
  const res4 = await sem.run(async () => "res4-success");
  assert.equal(res4, "res4-success");

  // Complete rest
  resolve2();
  resolve3();
  await Promise.all([t2, t3]);
  assert.equal(sem.activeCount, 0);
});

test("VisionConcurrencySemaphore releases slot after task failure or success", async () => {
  const sem = new VisionConcurrencySemaphore(1);
  assert.equal(sem.activeCount, 0);

  await assert.rejects(
    () =>
      sem.run(async () => {
        throw new Error("task failed");
      }),
    /task failed/
  );
  assert.equal(sem.activeCount, 0, "Slot must be released even when task throws");

  const result = await sem.run(async () => "ok");
  assert.equal(result, "ok");
  assert.equal(sem.activeCount, 0);
});
