import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeDateInput,
  matchBotCommand,
  executeBotCommand,
  handleBotCommand,
  getAvailableDailyDates,
  getAvailableWeeklyIds,
  formatDailyList,
  formatWeeklyList,
} from "../scripts/bot-commands.mjs";

test("normalizeDateInput parses various date formats cleanly", () => {
  assert.equal(normalizeDateInput("2026-10-05"), "2026-10-05");
  assert.equal(normalizeDateInput("2026/10/05"), "2026-10-05");
  assert.equal(normalizeDateInput("2026.10.05"), "2026-10-05");
  assert.equal(normalizeDateInput("20261005"), "2026-10-05");
  assert.equal(normalizeDateInput("10-05", 2026), "2026-10-05");
  assert.equal(normalizeDateInput("10/05", 2026), "2026-10-05");
  assert.equal(normalizeDateInput("10.05", 2026), "2026-10-05");
  assert.equal(normalizeDateInput("10月5日", 2026), "2026-10-05");
  assert.equal(normalizeDateInput("10月05日", 2026), "2026-10-05");
  assert.equal(normalizeDateInput("invalid"), null);
  assert.equal(normalizeDateInput(""), null);
  assert.equal(normalizeDateInput(null), null);
});

test("matchBotCommand correctly classifies all regular commands with \\ and / and Chinese aliases", () => {
  // 1. \start
  assert.deepEqual(matchBotCommand("\\start")?.type, "start");
  assert.deepEqual(matchBotCommand("/start")?.type, "start");
  assert.deepEqual(matchBotCommand("\\help")?.type, "start");
  assert.deepEqual(matchBotCommand("帮助")?.type, "start");
  assert.deepEqual(matchBotCommand("指南")?.type, "start");

  // 2. \today
  assert.deepEqual(matchBotCommand("\\today")?.type, "today");
  assert.deepEqual(matchBotCommand("/today")?.type, "today");
  assert.deepEqual(matchBotCommand("\\daily")?.type, "today");
  assert.deepEqual(matchBotCommand("今日导读")?.type, "today");
  assert.deepEqual(matchBotCommand("今日")?.type, "today");

  // 3. \yesterday
  assert.deepEqual(matchBotCommand("\\yesterday")?.type, "yesterday");
  assert.deepEqual(matchBotCommand("/yesterday")?.type, "yesterday");
  assert.deepEqual(matchBotCommand("\\last_day")?.type, "yesterday");
  assert.deepEqual(matchBotCommand("昨日导读")?.type, "yesterday");
  assert.deepEqual(matchBotCommand("昨天")?.type, "yesterday");

  // 4. \day <date>
  assert.deepEqual(matchBotCommand("\\day 2026-10-05"), {
    type: "day",
    arg: "2026-10-05",
    query: "\\day 2026-10-05",
  });
  assert.deepEqual(matchBotCommand("/day 10-05"), {
    type: "day",
    arg: "10-05",
    query: "/day 10-05",
  });
  assert.deepEqual(matchBotCommand("导读 2026-10-05"), {
    type: "day",
    arg: "2026-10-05",
    query: "导读 2026-10-05",
  });
  assert.deepEqual(matchBotCommand("\\day")?.type, "day_help");
  assert.deepEqual(matchBotCommand("/day")?.type, "day_help");

  // 5. \week
  assert.deepEqual(matchBotCommand("\\week")?.type, "week");
  assert.deepEqual(matchBotCommand("/week")?.type, "week");
  assert.deepEqual(matchBotCommand("\\weekly")?.type, "week");
  assert.deepEqual(matchBotCommand("本周周报")?.type, "week");
  assert.deepEqual(matchBotCommand("周报")?.type, "week");

  // 6. \last_week
  assert.deepEqual(matchBotCommand("\\last_week")?.type, "last_week");
  assert.deepEqual(matchBotCommand("/last_week")?.type, "last_week");
  assert.deepEqual(matchBotCommand("\\lastweek")?.type, "last_week");
  assert.deepEqual(matchBotCommand("上周周报")?.type, "last_week");
  assert.deepEqual(matchBotCommand("上周")?.type, "last_week");

  // 7. \list_day
  assert.deepEqual(matchBotCommand("\\list_day")?.type, "list_day");
  assert.deepEqual(matchBotCommand("/list_day")?.type, "list_day");
  assert.deepEqual(matchBotCommand("\\listday")?.type, "list_day");
  assert.deepEqual(matchBotCommand("每日导读列表")?.type, "list_day");
  assert.deepEqual(matchBotCommand("历史导读")?.type, "list_day");

  // 8. \list_week
  assert.deepEqual(matchBotCommand("\\list_week")?.type, "list_week");
  assert.deepEqual(matchBotCommand("/list_week")?.type, "list_week");
  assert.deepEqual(matchBotCommand("\\listweek")?.type, "list_week");
  assert.deepEqual(matchBotCommand("周报列表")?.type, "list_week");
  assert.deepEqual(matchBotCommand("历史周报")?.type, "list_week");

  // 9. Non-command academic questions
  assert.equal(matchBotCommand("总结今天的必读论文"), null);
  assert.equal(matchBotCommand("GRB 221009A 物理机制"), null);
  assert.equal(matchBotCommand("2610.05773v1 主要讲了什么"), null);
  assert.equal(matchBotCommand(""), null);
  assert.equal(matchBotCommand(null), null);
});

test("handleBotCommand handles \\start and returns command manual", async () => {
  const res = await handleBotCommand("\\start");
  assert.equal(res.matched, true);
  assert.match(res.replyText, /AstroLineage/u);
  assert.match(res.replyText, /\\today/u);
  assert.match(res.replyText, /\\yesterday/u);
  assert.match(res.replyText, /\\day/u);
  assert.match(res.replyText, /\\week/u);
  assert.match(res.replyText, /\\last_week/u);
  assert.match(res.replyText, /\\list_day/u);
  assert.match(res.replyText, /\\list_week/u);
});

test("handleBotCommand handles \\today and returns today brief card", async () => {
  const res = await handleBotCommand("\\today");
  assert.equal(res.matched, true);
  assert.match(res.replyText, /# \[「\d\d-\d\d」/u);
  assert.match(res.replyText, /arXiv:/u);
});

test("handleBotCommand handles \\yesterday and returns previous daily edition", async () => {
  const res = await handleBotCommand("\\yesterday");
  assert.equal(res.matched, true);
  assert.match(res.replyText, /# \[「\d\d-\d\d」/u);
  assert.match(res.replyText, /arXiv:/u);
});

test("handleBotCommand handles \\day with valid date and invalid date fallback", async () => {
  const availableDates = await getAvailableDailyDates();
  assert.ok(availableDates.length > 0);
  const targetDate = availableDates[0];

  // 1. Valid date
  const resValid = await handleBotCommand(`\\day ${targetDate}`);
  assert.equal(resValid.matched, true);
  assert.match(resValid.replyText, /# \[/u);
  assert.match(resValid.replyText, /arXiv:/u);

  // 2. Short date format MM-DD
  const shortDate = targetDate.slice(5);
  const resShort = await handleBotCommand(`\\day ${shortDate}`);
  assert.equal(resShort.matched, true);
  assert.match(resShort.replyText, /# \[/u);

  // 3. Non-existent date
  const resInvalid = await handleBotCommand("\\day 2099-01-01");
  assert.equal(resInvalid.matched, true);
  assert.match(resInvalid.replyText, /未找到/u);
  assert.match(resInvalid.replyText, /最近可用日期/u);

  // 4. Missing date
  const resAlone = await handleBotCommand("\\day");
  assert.equal(resAlone.matched, true);
  assert.match(resAlone.replyText, /请指定查询日期/u);
});

test("handleBotCommand handles \\week and returns latest weekly synthesis", async () => {
  const res = await handleBotCommand("\\week");
  assert.equal(res.matched, true);
  assert.match(res.replyText, /# \[\[\d{4}-W\d\d\] 前沿周报/u);
  assert.match(res.replyText, /研读共 \d+ 篇/u);
});

test("handleBotCommand handles \\last_week and returns previous week", async () => {
  const res = await handleBotCommand("\\last_week");
  assert.equal(res.matched, true);
  assert.match(res.replyText, /# \[\[\d{4}-W\d\d\] 前沿周报/u);
  assert.match(res.replyText, /研读共 \d+ 篇/u);
});

test("handleBotCommand handles \\list_day and returns formatted daily list", async () => {
  const res = await handleBotCommand("\\list_day");
  assert.equal(res.matched, true);
  assert.match(res.replyText, /每日前沿导读归档列表/u);
  assert.match(res.replyText, /\\day 2026-/u);
  assert.match(res.replyText, /关注 \d+ 篇/u);
  assert.doesNotMatch(res.replyText, /重点关注/u);
});

test("handleBotCommand on an edition without must-read includes batch note and canonical 关注 without backend jargon", async () => {
  const res = await handleBotCommand("\\day 2026-10-07");
  assert.equal(res.matched, true);
  assert.match(res.replyText, /【批次说明】\*\* 当期无必读突破，关注以下进展/u);
  assert.match(res.replyText, /### 📌 关注/u);
  assert.doesNotMatch(res.replyText, /重点关注/u);
  assert.doesNotMatch(res.replyText, /Worth Knowing/u);
});

test("handleBotCommand handles \\list_week and returns formatted weekly list", async () => {
  const res = await handleBotCommand("\\list_week");
  assert.equal(res.matched, true);
  assert.match(res.replyText, /前沿周报脉络归档列表/u);
  assert.match(res.replyText, /2026-W/u);
});
