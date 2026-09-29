import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanMessageContent } from "../scripts/qq-official-bot.mjs";
import { loadAcademicKnowledge } from "../scripts/agent-core.mjs";

test("cleanMessageContent strips QQ bot mentions and whitespace", () => {
  assert.equal(cleanMessageContent("<@!12345678> 你好，喷流机制是什么？"), "你好，喷流机制是什么？");
  assert.equal(cleanMessageContent("@astrolineage 喷流破茧模型"), "喷流破茧模型");
  assert.equal(cleanMessageContent(""), "");
  assert.equal(cleanMessageContent(null), "");
});

test("loadAcademicKnowledge embeds schedule cadence and representative papers", async () => {
  const knowledge = await loadAcademicKnowledge();
  assert(knowledge.includes("自动化调度与运行机制"));
  assert(knowledge.includes("周一至周五北京时间上午 10:00"));
  assert(knowledge.includes("七大核心研究主线"));
  assert(knowledge.includes("AstroLineage"));
});

test("sessionStore maintains sliding-window memory and respects TTL", () => {
  import("../scripts/qq-official-bot.mjs").then(({ appendSessionHistory, getSessionHistory }) => {
    const key = `test_session_${Date.now()}`;
    for (let i = 1; i <= 12; i++) {
      appendSessionHistory(key, i % 2 === 1 ? "user" : "assistant", `msg_${i}`);
    }
    const history = getSessionHistory(key);
    assert.equal(history.length, 10);
    assert.equal(history[0].content, "msg_3");
    assert.equal(history[history.length - 1].content, "msg_12");
  });
});

