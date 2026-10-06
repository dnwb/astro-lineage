import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  deriveTitleDecision,
  deriveDailyTitleCandidate,
  derivePaperTitleCandidate,
  deriveWeeklyTitleCandidate,
  formatDailyTitle,
  formatPaperTitle,
  formatWeeklyTitle,
  validateTitleOverride,
} from "../scripts/channel-title-policy.mjs";
import { alterDailyFeed, alterWeeklyFeed } from "../scripts/tencent-channel-publisher.mjs";

test("the shared decision API returns a title, source identity and diagnostics", () => {
  const item = {
    arxiv_id: "2610.02889",
    revision: 1,
    title: "The blue supergiant collapsar progenitor of GRB 220627A",
    analysis: { analysis: { problem: "判断GRB 220627A是否来自蓝超巨星坍缩。", result: "模型支持该情景。" } },
  };
  assert.deepEqual(deriveTitleDecision({ kind: "paper", item }), {
    title: "GRB 220627A是否来自蓝超巨星坍缩？",
    sourceIdentity: { kind: "paper", arxivId: "2610.02889", revision: 1 },
    reason: "source_bound",
    diagnostics: [],
  });
  const brief = {
    status: "ready",
    must_read: [{ arxiv_id: item.arxiv_id, revision: item.revision, text: "GRB 220627A两段亮期之间静默约600秒。" }],
  };
  assert.deepEqual(deriveTitleDecision({ kind: "daily", date: "2026-10-04", highlights: [item], brief }), {
    title: "「10-04」GRB 220627A两段亮期之间静默约600秒",
    sourceIdentity: { kind: "daily", date: "2026-10-04", leadPaper: { arxivId: item.arxiv_id, revision: item.revision } },
    reason: "source_bound",
    diagnostics: [],
  });
  const weekly = {
    week_id: "2026-W40",
    executive_summary: "前兆非探测限制了超新星前身星失质量。",
    thematic_highlights: [],
  };
  assert.deepEqual(deriveTitleDecision({ kind: "weekly", weekId: weekly.week_id, weekly }), {
    title: "W40周报：前兆非探测限制了超新星前身星失质量",
    sourceIdentity: { kind: "weekly", weekId: weekly.week_id },
    reason: "source_bound",
    diagnostics: [],
  });
  const unsupportedItem = {
    ...item,
    title: "Unknown subject",
    analysis: { analysis: { problem: "研究某个问题。", result: "后续仍需分析。" } },
  };
  assert.deepEqual(deriveTitleDecision({ kind: "paper", item: unsupportedItem }), {
    title: null,
    sourceIdentity: { kind: "paper", arxivId: "2610.02889", revision: 1 },
    reason: "CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED",
    diagnostics: ["CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED"],
  });
});

test("the shared policy derives a paper title from its source record", () => {
  const item = {
    arxiv_id: "2610.02889",
    revision: 1,
    title: "The blue supergiant collapsar progenitor of GRB 220627A",
    analysis: {
      analysis: {
        problem: "判断GRB 220627A是否来自蓝超巨星坍缩。",
        result: "模型支持蓝超巨星坍缩情景。",
      },
    },
  };

  assert.equal(derivePaperTitleCandidate(item), "GRB 220627A是否来自蓝超巨星坍缩？");
});

test("the shared policy derives a date-bound daily progress title", () => {
  const paper = {
    arxiv_id: "2610.02889",
    revision: 1,
    title: "The blue supergiant collapsar progenitor of GRB 220627A",
    analysis: { analysis: { problem: "判断GRB 220627A是否来自蓝超巨星坍缩。", result: "模型支持蓝超巨星坍缩情景。" } },
  };
  const brief = {
    status: "ready",
    must_read: [{ arxiv_id: paper.arxiv_id, revision: paper.revision, text: "GRB 220627A两段亮期之间静默约600秒。" }],
  };

  assert.equal(deriveDailyTitleCandidate("2026-10-04", [paper], brief), "「10-04」GRB 220627A两段亮期之间静默约600秒");
});

test("daily titles reject a normalized duplicate of any paper published that day", () => {
  const lead = {
    arxiv_id: "2610.00001", revision: 1, title: "The jet structure of GRB 220627A",
    analysis: { analysis: { problem: "GRB 220627A的喷流结构是否保持对称？", result: "观测显示喷流存在横向结构。" } },
  };
  const other = {
    arxiv_id: "2610.00002", revision: 1, title: "The blue supergiant collapsar progenitor of GRB 220627A",
    analysis: { analysis: { problem: "判断GRB 220627A是否来自蓝超巨星坍缩。", result: "模型支持该情景。" } },
  };
  const brief = { status: "ready", must_read: [{ arxiv_id: lead.arxiv_id, revision: lead.revision,
    text: "GRB 220627A是否来自蓝超巨星坍缩？" }] };

  assert.throws(() => deriveDailyTitleCandidate("2026-10-04", [lead, other], brief), /CHANNEL_TITLE_DAILY_DUPLICATES_PAPER/u);
  assert.throws(() => formatDailyTitle("2026-10-04", "GRB 220627A是否来自蓝超巨星坍缩",
    ["GRB220627A 是否来自蓝超巨星坍缩"]), /CHANNEL_TITLE_DAILY_DUPLICATES_PAPER/u);
});

test("the shared policy derives a weekly title only from source-supported progress", () => {
  const weekly = {
    executive_summary: "前兆非探测限制了超新星前身星失质量。",
    thematic_highlights: [],
  };

  assert.equal(deriveWeeklyTitleCandidate("2026-W40", weekly), "W40周报：前兆非探测限制了超新星前身星失质量");
  assert.throws(() => deriveWeeklyTitleCandidate("2026-W40", { thematic_highlights: [] }), /CHANNEL_TITLE_WEEKLY_PROGRESS_UNSUPPORTED/u);
});

test("weekly title generation accepts complete source-backed progress outside the W40 supernova theme", () => {
  assert.equal(
    deriveWeeklyTitleCandidate("2026-W41", {
      week_id: "2026-W41",
      executive_summary: "本周磁星模型显示喷流的能量注入发生转变。",
      thematic_highlights: [],
    }),
    "W41周报：磁星模型显示喷流的能量注入发生转变",
  );
});

test("weekly titles select the concrete scientific claim after a thematic framing colon", () => {
  assert.equal(
    deriveWeeklyTitleCandidate("2026-W41", {
      week_id: "2026-W41",
      executive_summary: "FRB工作形成了互补的两条路径：等离子体透镜研究给出放大率分布与重复时延的可检验预言。",
      thematic_highlights: [],
    }),
    "W41周报：等离子体透镜研究给出放大率分布与重复时延的可检验预言",
  );
});

test("current W40 title selection ignores the thematic frame and multi-item topic list", async () => {
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-weekly.json", import.meta.url), "utf8"));
  assert.equal(
    deriveWeeklyTitleCandidate(weekly.week_id, weekly),
    "W40周报：等离子体透镜研究给出放大率分布与重复时延的可检验预言",
  );
});

test("weekly titles keep a scoped condition attached to the result", () => {
  assert.equal(
    deriveWeeklyTitleCandidate("2026-W41", {
      week_id: "2026-W41",
      executive_summary: "本周磁星工作给出结果：在低信噪比样本中，发现辐射增强。",
      thematic_highlights: [],
    }),
    "W41周报：在低信噪比样本中，发现辐射增强",
  );
  assert.equal(
    deriveWeeklyTitleCandidate("2026-W41", {
      week_id: "2026-W41",
      executive_summary: "本周磁星工作给出结果：仅在模型A成立时，发现辐射增强。",
      thematic_highlights: [],
    }),
    "W41周报：仅在模型A成立时，发现辐射增强",
  );
});

test("weekly titles retain a limiting clause after the main result", () => {
  assert.equal(
    deriveWeeklyTitleCandidate("2026-W41", {
      week_id: "2026-W41",
      executive_summary: "本周结果：超新星光度提高约20%，但仅在低信噪比样本中成立。",
      thematic_highlights: [],
    }),
    "W41周报：超新星光度提高约20%，但仅在低信噪比样本中成立",
  );
});

test("paper result extraction skips reporting lead-ins and keeps a qualified claim", () => {
  assert.equal(
    derivePaperTitleCandidate({
      title: "A supernova luminosity model",
      analysis: { analysis: { problem: "研究超新星光度。", result: "三维模拟显示，在模型A成立时，超新星光度提高约20%。" } },
    }),
    "在模型A成立时，超新星光度提高约20%",
  );
  assert.throws(
    () => derivePaperTitleCandidate({
      title: "A supernova luminosity model",
      analysis: { analysis: { problem: "研究超新星光度。", result: "三维模拟显示。" } },
    }),
    /CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED/u,
  );
});

test("paper titles keep the result after an intervening reporting-only clause and its scope", () => {
  assert.equal(
    derivePaperTitleCandidate({
      title: "A supernova luminosity model",
      analysis: { analysis: { problem: "研究超新星光度。", result: "仅在模型A成立时，模拟表明，超新星光度提高约20%。" } },
    }),
    "仅在模型A成立时，超新星光度提高约20%",
  );
});

test("paper titles keep a limiting condition that follows the result clause", () => {
  assert.equal(
    derivePaperTitleCandidate({
      title: "A supernova luminosity model",
      analysis: { analysis: { problem: "研究超新星光度。", result: "超新星光度提高约20%，但仅在低信噪比样本中成立。" } },
    }),
    "超新星光度提高约20%，但仅在低信噪比样本中成立",
  );
});

test("paper result extraction rejects an orphaned contrast clause", () => {
  assert.throws(
    () => derivePaperTitleCandidate({
      title: "SN 2025aico observations",
      analysis: { analysis: { problem: "", result: "而非直接测得混合量。" } },
    }),
    /CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED/u,
  );
});

test("paper result titles preserve long scoped conditions and request human review", () => {
  const scopedCondition = `仅在${"极端条件".repeat(12)}下`;
  const item = {
    arxiv_id: "2609.12345",
    revision: 1,
    title: "A supernova luminosity model",
    analysis: { analysis: { problem: "研究超新星光度。", result: `${scopedCondition}，超新星光度提高约20%。` } },
  };
  const expected = `${scopedCondition}，超新星光度提高约20%`;
  assert.ok(Array.from(expected).length > 60 && Array.from(expected).length <= 200);
  assert.equal(derivePaperTitleCandidate(item), expected);
  assert.deepEqual(deriveTitleDecision({ kind: "paper", item }).diagnostics, ["CHANNEL_TITLE_HUMAN_REVIEW_RECOMMENDED"]);
  assert.throws(() => formatPaperTitle(`${"超新星".repeat(67)}提高`), /CHANNEL_TITLE_TOO_LONG/u);
});

test("paper question titles retain a long leading condition before a comma", () => {
  const condition = `仅在${"极端条件".repeat(14)}下`;
  const expected = `${condition}，超新星光度是否提高？`;
  const item = { title: "A supernova luminosity model", analysis: { analysis: {
    problem: expected, result: "模型显示超新星光度提高。",
  } } };

  assert.ok(Array.from(expected).length > 60 && Array.from(expected).length <= 200);
  assert.equal(derivePaperTitleCandidate(item), expected);
  assert.deepEqual(deriveTitleDecision({ kind: "paper", item }).diagnostics, ["CHANNEL_TITLE_HUMAN_REVIEW_RECOMMENDED"]);
});

test("the 35-Han review reminder applies to daily, paper and weekly titles", () => {
  const condition = `仅在${"极端条件".repeat(9)}下`;
  const paper = { arxiv_id: "2610.00001", revision: 1, title: "The blue supergiant collapsar progenitor of GRB 220627A", analysis: { analysis: {
    problem: "GRB 220627A的辐射强度如何变化？", result: "辐射强度提高。",
  } } };
  const brief = { status: "ready", must_read: [{ arxiv_id: paper.arxiv_id, revision: paper.revision,
    text: `GRB 220627A${condition}，辐射强度提高。` }] };
  const daily = deriveTitleDecision({ kind: "daily", date: "2026-10-04", highlights: [paper], brief });
  const weekly = deriveTitleDecision({ kind: "weekly", weekId: "2026-W41", weekly: {
    week_id: "2026-W41", executive_summary: `${condition}，超新星光度提高。`, thematic_highlights: [],
  } });

  assert.deepEqual(daily.diagnostics, ["CHANNEL_TITLE_HUMAN_REVIEW_RECOMMENDED"]);
  assert.deepEqual(weekly.diagnostics, ["CHANNEL_TITLE_HUMAN_REVIEW_RECOMMENDED"]);
});

test("weekly titles block when preserving the scoped condition exceeds the title limit", () => {
  const scopedCondition = `仅在${"极端条件".repeat(50)}下`;
  const weekly = {
    week_id: "2026-W41",
    executive_summary: `本周结果：${scopedCondition}，发现辐射增强。`,
    thematic_highlights: [],
  };
  assert.throws(() => deriveWeeklyTitleCandidate("2026-W41", weekly), /CHANNEL_TITLE_WEEKLY_PROGRESS_UNSUPPORTED/u);
});

test("bound archive regression candidates are claims or blocked, never reporting fragments", async () => {
  const byId = new Map();
  for (const date of ["2026-09-14", "2026-09-21", "2026-09-23", "2026-09-24", "2026-09-28"]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    for (const item of archive.radar.analyses || []) {
      if (["2609.28667", "2609.15108", "2609.22806", "2609.26935", "2609.31836"].includes(item.arxiv_id)) byId.set(item.arxiv_id, item);
    }
  }
  assert.equal(byId.size, 5);
  assert.equal(derivePaperTitleCandidate(byId.get("2609.31836")), "PKS 1510-089在2024年5月3—4日的光学观测中，偏振角在0.056天、约80分钟内旋转约136°");
  for (const item of byId.values()) {
    try {
      const title = derivePaperTitleCandidate(item);
      assert.doesNotMatch(title, /^(?:三维模拟显示|正文报告|研究表明|而非直接测得混合量)$/u);
      assert.doesNotMatch(title, /^(?:而非|并非|但|不过)/u);
    } catch (error) {
      assert.match(error.message, /CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED/u);
    }
  }
});

test("daily titles use the issue date and one source-bound progress sentence", () => {
  assert.equal(
    formatDailyTitle("2026-10-04", "GRB 220627A两段亮期之间静默约600秒"),
    "「10-04」GRB 220627A两段亮期之间静默约600秒",
  );
});

test("daily titles reject empty, list-like, and paper-title-duplicate progress", () => {
  assert.throws(() => formatDailyTitle("2026-10-04", ""), /CHANNEL_TITLE_DAILY_PROGRESS_REQUIRED/u);
  assert.throws(() => formatDailyTitle("2026-10-04", "GRB进展、V4641 Sgr喷流"), /CHANNEL_TITLE_DAILY_SINGLE_PROGRESS_REQUIRED/u);
  assert.throws(() => formatDailyTitle("2026-10-04", "发现候选X射线弥散结构", ["发现候选X射线弥散结构"]), /CHANNEL_TITLE_DAILY_DUPLICATES_PAPER/u);
});

test("daily titles preserve an intervening contrast condition", () => {
  const paper = {
    arxiv_id: "2610.02889",
    revision: 1,
    title: "The blue supergiant collapsar progenitor of GRB 220627A",
    analysis: { analysis: { problem: "判断GRB 220627A是否来自蓝超巨星坍缩。", result: "模型支持该情景。" } },
  };
  const brief = {
    status: "ready",
    must_read: [{ arxiv_id: paper.arxiv_id, revision: paper.revision,
      text: "仅在模型A成立时，而非模型B，亮期增加约20%。" }],
  };

  assert.equal(
    deriveDailyTitleCandidate("2026-10-04", [paper], brief),
    "「10-04」GRB 220627A仅在模型A成立时，而非模型B，亮期增加约20%",
  );
});

test("paper titles keep a complete candidate and reject unsupported fallbacks or dangling text", () => {
  assert.equal(formatPaperTitle("GRB 220627A是否来自蓝超巨星坍缩？"), "GRB 220627A是否来自蓝超巨星坍缩？");
  assert.throws(() => formatPaperTitle("如何在保留解析计算效率的同时？"), /CHANNEL_TITLE_INCOMPLETE/u);
  assert.throws(() => formatPaperTitle("arXiv:2610.02653"), /CHANNEL_TITLE_UNINFORMATIVE/u);
  assert.throws(() => formatPaperTitle("GRB喷流等进展"), /CHANNEL_TITLE_UNINFORMATIVE/u);
});

test("paper title generation refuses a bare subject plus topic when no complete claim is available", () => {
  const item = {
    arxiv_id: "2609.20795",
    revision: 1,
    title: "Systematic Effects of Hydrogen and Helium Atmosphere Mismatch on Radius Inference in PSR J0740+6620-like Synthetic NICER Data",
    analysis: { analysis: { problem: "", result: "", reason: "研究组关注这篇致密天体论文。" } },
  };

  assert.throws(() => derivePaperTitleCandidate(item), /CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED/u);
});

test("paper title generation never turns a bare event-plus-topic source title into a claim", () => {
  const item = {
    arxiv_id: "2610.09999",
    revision: 1,
    title: "GRB 220627A jet",
    analysis: { analysis: { problem: "", result: "", reason: "与组内研究相关。" } },
  };

  assert.throws(() => derivePaperTitleCandidate(item), /CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED/u);
});

test("paper title generation preserves the complete first question in the 2609.20795 failure sample", () => {
  const item = {
    arxiv_id: "2609.20795",
    revision: 1,
    title: "Systematic Effects of Hydrogen and Helium Atmosphere Mismatch on Radius Inference in PSR J0740+6620-like Synthetic NICER Data",
    analysis: {
      analysis: {
        problem: "全电离氢与氦大气成分误配是否会在通过常规拟合优度检验的同时，使NICER脉冲轮廓推断的中子星半径出现系统偏差；两种误配方向是否对称，以及贝叶斯证据能否补充χ²诊断。",
        result: "在实际J0740+6620类计数与背景比例下，两种大气误配均未产生显著半径偏差。提高热点/背景计数比后，氢数据用氦模型拟合可将半径推向更大值，使注入半径落在错误模型后验的2σ可信区间之外，但χ²仍可接受；反向误配在所检验波形中的半径偏移仍处于2σ范围内。",
      },
    },
  };

  assert.equal(
    derivePaperTitleCandidate(item),
    "全电离氢与氦大气成分误配是否会在通过常规拟合优度检验的同时，使NICER脉冲轮廓推断的中子星半径出现系统偏差？",
  );
});

test("paper title generation keeps the qualified localization result from the 2609.38344 failure sample", () => {
  const item = {
    arxiv_id: "2609.38344",
    revision: 1,
    title: "VLBI Astrometric Procedure and Performance with CHIME/FRB Outriggers",
    analysis: {
      analysis: {
        problem: "如何利用400–800 MHz宽视场CHIME/FRB Outriggers网络，为位置事先未知、只能短时观测的一次性FRB提供可靠的毫角秒级定位，并处理远距离校准源、站址误差、电离层与几何延迟简并、低信噪比振幅估计及多校准源共享噪声带来的误差。",
        result: "摘要报告阵列通常可达到、部分条件下超过约50 mas定位目标。正文摘要记录了约千次端到端测试，包括20颗脉冲星的逾200次单历元定位及波束内连续谱源测试；定位精度从最弱窄带事件约0.9角秒到最亮宽带事件约20 mas，特别明亮观测可达约10×30 mas。",
      },
    },
  };

  assert.equal(derivePaperTitleCandidate(item), "阵列通常可达到、部分条件下超过约50 mas定位目标");
});

test("paper result titles preserve a leading sample condition across a comma", () => {
  assert.equal(
    derivePaperTitleCandidate({
      title: "Magnetar radius study",
      analysis: {
        analysis: {
          problem: "研究中子星半径。",
          result: "在低信噪比样本中，发现中子星半径增大。",
        },
      },
    }),
    "在低信噪比样本中，发现中子星半径增大",
  );
});

test("V4641 Sgr's fixed headline preserves a scoped low-background condition", () => {
  const title = "Diffuse X-ray emission around V4641 Sgr";
  const problem = "搜索V4641 Sgr附近的X射线弥散结构。";
  assert.equal(
    derivePaperTitleCandidate({
      title,
      analysis: { analysis: {
        problem,
        result: "仅在低背景模型下，发现三个候选弥散结构。",
      } },
    }),
    "V4641 Sgr附近仅在低背景模型下，发现三处候选X射线弥散结构",
  );
  assert.equal(
    derivePaperTitleCandidate({
      title,
      analysis: { analysis: { problem, result: "作者报告，仅在低背景模型下，发现三个候选弥散结构。" } },
    }),
    "V4641 Sgr附近仅在低背景模型下，发现三处候选X射线弥散结构",
  );
  assert.equal(
    derivePaperTitleCandidate({
      title,
      analysis: { analysis: { problem, result: "发现三个候选弥散结构，这一发现仅在低背景模型下成立。" } },
    }),
    "V4641 Sgr附近发现三处候选X射线弥散结构，这一发现仅在低背景模型下成立",
  );
  assert.equal(
    derivePaperTitleCandidate({
      title,
      analysis: { analysis: { problem, result: "发现三个候选弥散结构。这一发现仅在低背景模型下成立。" } },
    }),
    "V4641 Sgr附近发现三处候选X射线弥散结构，这一发现仅在低背景模型下成立",
  );
});

test("V4641 Sgr headline does not carry a condition across a semicolon", () => {
  assert.equal(
    derivePaperTitleCandidate({
      title: "Diffuse X-ray emission around V4641 Sgr",
      analysis: { analysis: {
        problem: "搜索V4641 Sgr附近的X射线弥散结构。",
        result: "仅在高背景模型下，未见显著信号；发现三个候选弥散结构。",
      } },
    }),
    "V4641 Sgr附近发现三处候选X射线弥散结构",
  );
});

test("daily headline generation keeps source conditions instead of selecting only the final comma clause", () => {
  const paper = {
    arxiv_id: "2610.02889",
    revision: 1,
    title: "GRB 220627A afterglow",
    analysis: { analysis: { problem: "GRB 220627A afterglow", result: "模型给出不同解释。" } },
  };

  assert.equal(
    deriveDailyTitleCandidate("2026-10-04", [paper], {
      status: "ready",
      must_read: [{ arxiv_id: paper.arxiv_id, revision: paper.revision, text: "仅在模型A成立时，亮期之间静默约600秒。" }],
    }),
    "「10-04」GRB 220627A仅在模型A成立时，亮期之间静默约600秒",
  );
});

test("daily headlines preserve a population qualifier before the result clause", () => {
  const paper = {
    arxiv_id: "2610.02889",
    revision: 1,
    title: "GRB 220627A afterglow",
    analysis: { analysis: { problem: "GRB 220627A如何产生？", result: "模型给出静默时长。" } },
  };
  assert.equal(
    deriveDailyTitleCandidate("2026-10-04", [paper], {
      status: "ready",
      must_read: [{ arxiv_id: paper.arxiv_id, revision: paper.revision, text: "在低信噪比样本中，静默约600秒。" }],
    }),
    "「10-04」GRB 220627A在低信噪比样本中，静默约600秒",
  );
});

test("daily headlines preserve a condition embedded before the reported result", () => {
  const paper = {
    arxiv_id: "2610.02889",
    revision: 1,
    title: "GRB 220627A afterglow",
    analysis: { analysis: { problem: "GRB 220627A如何产生？", result: "模型给出静默时长。" } },
  };
  assert.equal(
    deriveDailyTitleCandidate("2026-10-04", [paper], {
      status: "ready",
      must_read: [{ arxiv_id: paper.arxiv_id, revision: paper.revision, text: "GRB 220627A在低信噪比样本中，静默约600秒。" }],
    }),
    "「10-04」GRB 220627A在低信噪比样本中，静默约600秒",
  );
});

test("weekly titles use the current week's supported claim without importing an old theme", () => {
  assert.equal(
    deriveWeeklyTitleCandidate("2026-W41", {
      week_id: "2026-W41",
      executive_summary: "前兆非探测限制了恒星失质量。相关论文不讨论超新星。",
      thematic_highlights: [],
    }),
    "W41周报：前兆非探测限制了恒星失质量",
  );
});

test("weekly headline generation rejects an archive whose source week differs from the requested week", () => {
  assert.throws(
    () => deriveWeeklyTitleCandidate("2026-W41", {
      week_id: "2026-W40",
      executive_summary: "前兆非探测限制了超新星失质量。",
      thematic_highlights: [],
    }),
    /CHANNEL_TITLE_WEEKLY_SOURCE_IDENTITY_MISMATCH/u,
  );
});

test("weekly titles use the week number followed by one concrete progress", () => {
  assert.equal(
    formatWeeklyTitle("2026-W40", "前兆非探测收紧超新星失质量约束"),
    "W40周报：前兆非探测收紧超新星失质量约束",
  );
  assert.throws(() => formatWeeklyTitle("2026-W40", "磁星环境、超新星因果链"), /CHANNEL_TITLE_WEEKLY_SINGLE_PROGRESS_REQUIRED/u);
});

test("title overrides must still satisfy the matching date or week contract", () => {
  assert.equal(validateTitleOverride("daily", "「10-04」GRB 220627A两段亮期之间静默约600秒", "2026-10-04"), "「10-04」GRB 220627A两段亮期之间静默约600秒");
  assert.throws(() => validateTitleOverride("daily", "「10-03」GRB进展", "2026-10-04"), /CHANNEL_TITLE_OVERRIDE_IDENTITY_MISMATCH/u);
  assert.equal(validateTitleOverride("weekly", "W40周报：前兆非探测收紧超新星失质量约束", "2026-W40"), "W40周报：前兆非探测收紧超新星失质量约束");
});

test("legacy direct-edit entry points are disabled in favor of the approved title-only sync", async () => {
  await assert.rejects(alterDailyFeed({ feedId: "feed", createTime: "123", titleOverride: "invalid" }), /CHANNEL_DIRECT_EDIT_DISABLED/u);
  await assert.rejects(alterWeeklyFeed({ feedId: "feed", createTime: "123", titleOverride: "invalid" }), /CHANNEL_DIRECT_EDIT_DISABLED/u);
});
