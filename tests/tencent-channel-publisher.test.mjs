import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateDailyMarkdown, generateWeeklyMarkdown, publishDailyFeed, publishWeeklyFeed, publishHistoricalFeeds, provisionTopicChannels, publishEventRanking, paperMarkdown, extractPaperTopic, deriveDailyContentTitle, deriveWeeklyContentTitle, derivePaperContentTitle, resolveReviewedFigure } from "../scripts/tencent-channel-publisher.mjs";
import { TOPICS, TOPIC_LABELS, routePaper, hashBody, markerFor } from "../scripts/channel-publication.mjs";
import { buildOpeningBrief } from "../scripts/daily-radar.mjs";
import { createTemporaryWorkspace } from "./helpers/temporary-workspace.mjs";
import { approvedDailyTitleFixture } from "./helpers/approved-daily-title-fixture.mjs";

function fixtureBinding({ weekly = "", archives = {} } = {}) {
  const daily = { generation_id: "fixture-generation", hash: "0".repeat(64) };
  const data = { daily, weekly: { hash: hashBody(weekly) }, archives };
  return { ...data, id: hashBody(JSON.stringify(data)) };
}

test("generateDailyMarkdown emits a source-bound progress title without a duplicate body heading", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const daily = await generateDailyMarkdown({ feed: archive.feed, radar: archive.radar });
  assert.equal(daily.batchDate, "2026-09-28");
  assert.ok(daily.highlights.length >= 5);
  assert.equal(daily.postTitle, "「09-28」FRB等离子体透镜预言的重复时延为数周至数月");
  const titleCandidates = daily.highlights.flatMap(paper => {
    try { return [derivePaperContentTitle(paper)]; }
    catch (error) {
      assert.equal(error.message, "CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED");
      return [];
    }
  });
  assert.ok(!titleCandidates.includes("FRB等离子体透镜预言的重复时延为数周至数月"));
  assert.throws(() => derivePaperContentTitle(daily.highlights.find(paper => paper.arxiv_id === "2609.31886")), /CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED/u);
  assert.ok(daily.md.startsWith("发布日期：2026-09-28\n"));
  assert.doesNotMatch(daily.md, /^# /mu);
  assert.match(daily.md, /发布日期：2026-09-28/u);
  assert.ok(daily.md.includes(archive.opening_brief.intro));
  for (const sentence of archive.opening_brief.must_read) assert.ok(daily.md.includes(sentence.text));
  const summary = archive.opening_brief.worth_knowing_summary;
  assert.ok(daily.md.includes(summary.replace(/；其余见下方卡片[。.]?$/u, "。")));
  assert.doesNotMatch(daily.md, /；其余见下方卡片[。.]?$/mu);
  assert.match(daily.md, /## 本期导读/u);
  assert.match(daily.md, /## 其他值得关注/u);
  assert.doesNotMatch(daily.md, /AI 研判筛选|官方共发布|#paper-/u);
  assert.match(daily.md, /arxiv\.org\/abs\/2609\.31842v1/u);
  assert.match(daily.md, /arxiv\.org\/abs\/2609\.31844v1/u);
  // Ensure valid site URLs
  assert.match(daily.md, /\/arxiv-daily\/2026-09-28/u);
});

test("daily title overrides cannot replace the source-derived candidate", async () => {
  const archive = await approvedDailyTitleFixture();
  const generated = await generateDailyMarkdown({ feed: archive.feed, radar: archive.radar });
  assert.equal(generated.postTitle, "「10-04」GRB 220627A两段亮期之间静默约600秒");
  assert.equal(
    (await generateDailyMarkdown({ feed: archive.feed, radar: archive.radar, titleOverride: generated.postTitle })).postTitle,
    generated.postTitle,
  );
  await assert.rejects(
    generateDailyMarkdown({ feed: archive.feed, radar: archive.radar, titleOverride: "「10-04」GRB 220627A发现外星文明" }),
    /CHANNEL_TITLE_OVERRIDE_SOURCE_MISMATCH/u,
  );
});

test("weekly title overrides cannot replace the source-derived candidate", async () => {
  const weekly = {
    week_id: "2026-W40",
    executive_summary: "前兆非探测限制了超新星前身星失质量。",
    thematic_highlights: [],
  };
  const generated = await generateWeeklyMarkdown({ weekly });
  assert.equal(
    (await generateWeeklyMarkdown({ weekly, titleOverride: generated.postTitle })).postTitle,
    generated.postTitle,
  );
  await assert.rejects(
    generateWeeklyMarkdown({ weekly, titleOverride: "W40周报：FRB发现外星文明" }),
    /CHANNEL_TITLE_OVERRIDE_SOURCE_MISMATCH/u,
  );
});

test("daily title generation refuses missing or stale source-bound opening claims", () => {
  assert.throws(() => deriveDailyContentTitle("2026-10-04", []), /CHANNEL_TITLE_DAILY_SOURCE_REQUIRED/u);
  const item = { arxiv_id: "2610.02889", revision: 1, title: "Study of GRB 220627A", priority: "must_read" };
  const staleBrief = { status: "ready", must_read: [{ arxiv_id: item.arxiv_id, revision: 2, text: "GRB 220627A静默约600秒。" }] };
  assert.throws(() => deriveDailyContentTitle("2026-10-04", [item], staleBrief), /CHANNEL_TITLE_DAILY_SOURCE_IDENTITY_MISMATCH/u);
});

test("individual-paper headline candidates use the matching source results", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const daily = await generateDailyMarkdown({ feed: archive.feed, radar: archive.radar });
  assert.deepEqual(daily.highlights.slice(0, 3).map(derivePaperContentTitle), [
    "如何利用重复FRB检验等离子体透镜解释？",
    "SN 2024ggi的爆前光变中是否存在显著前兆发射？",
    "该游走如何限制连续引力波搜索的相干时长、灵敏度和候选信号的物理一致性检验？",
  ]);
});

test("daily title generation requires a ready, revision-matched opening brief", () => {
  const item = { arxiv_id: "2610.02889", revision: 1, title: "Study of GRB 220627A", priority: "must_read" };
  assert.throws(() => deriveDailyContentTitle("2026-10-04", [item]), /CHANNEL_TITLE_DAILY_SOURCE_REQUIRED/u);
  const staleBrief = { status: "ready", must_read: [{ arxiv_id: item.arxiv_id, revision: 2, text: "GRB 220627A静默约600秒。" }] };
  assert.throws(() => deriveDailyContentTitle("2026-10-04", [item], staleBrief), /CHANNEL_TITLE_DAILY_SOURCE_IDENTITY_MISMATCH/u);
});

test("readable titles retain a complete physical question beyond the old 24-character cap", () => {
  const item = { arxiv_id: "2609.12345", revision: 1, title: "A Search for Precursor Emission from SN 2024ggi",
    analysis: { priority: "must_read", coverage: {}, analysis: { problem: "搜索SN 2024ggi爆发之前是否存在可检出的光学活动，并比较不同分析窗口和核宽下的观测限制。", result: "在所有测试核宽下均未发现显著前兆，不能排除更微弱的活动。" } } };
  const before = JSON.stringify(item);
  const markdown = paperMarkdown(item, "2026-10-02", { primary: "R3", related: [] });
  assert.equal(derivePaperContentTitle(item), `${item.analysis.analysis.problem.replace(/。$/u, "")}？`);
  assert.doesNotMatch(markdown, /^# /mu);
  assert.ok(markdown.includes(item.analysis.analysis.problem));
  assert.ok(markdown.includes(item.analysis.analysis.result));
  assert.equal(JSON.stringify(item), before);
});

test("overlong neutron-star problem titles keep the complete central question instead of topic-only labels", () => {
  const problem = "研究第三代引力波探测器观测双中子星并合时，事件数量、双中子星质量分布以及亚太阳质量中子星的存在如何影响中子星状态方程、潮汐形变、半径和核物质参数的约束。";
  const item = { arxiv_id: "2609.06369", revision: 1,
    title: "Third-generation gravitational-wave constraints on the neutron star equation of state",
    analysis: { priority: "must_read", coverage: {}, analysis: { problem, result: "事件率与质量分布会影响联合参数约束。" } } };
  const markdown = paperMarkdown(item, "2026-09-10", {});
  const title = derivePaperContentTitle(item);

  assert.equal(title, "事件数量、双中子星质量分布以及亚太阳质量中子星的存在如何影响中子星状态方程、潮汐形变、半径和核物质参数的约束？");
  assert.ok(Array.from(title).length <= 60);
  assert.ok(markdown.includes(problem));
});

test("long mixed-script IceCube questions fit after normalizing only Chinese-English boundary spaces", () => {
  const problem = "检验 KM3-230213A 方向是否存在与该 KM3NeT 超高能事件相关的 IceCube 中微子点源、短时瞬变或长期耀发信号，并据此约束其通量。";
  const item = { arxiv_id: "2609.10931", revision: 1,
    title: "IceCube neutrino point-source searches in the direction of the KM3NeT ultra-high-energy event",
    analysis: { priority: "must_read", coverage: {}, analysis: { problem, result: "未发现相对于背景预期的显著偏离，并给出中微子通量上限。" } } };
  const title = derivePaperContentTitle(item);

  assert.equal(title, "KM3-230213A方向是否存在与该KM3NeT超高能事件相关的IceCube中微子点源、短时瞬变或长期耀发信号？");
  assert.ok(Array.from(title).length <= 60);
});

test("paper titles keep the central physical question instead of falling back to topic tags", () => {
  const cases = [
    {
      title: "Search for Long-Transient Gravitational Waves from Supernova SN2023ixf using GFH-v2 Pipeline",
      problem: "SN 2023ixf若形成快速旋转、非轴对称的新生磁星，是否会在爆发附近产生可由ER15数据检出的、随自转减慢而频率和振幅下降的长暂态连续引力波？",
      expected: "SN 2023ixf：新生磁星能否留下可探测的长暂态连续引力波？",
    },
    {
      title: "Physics-Informed Neural Networks and Data-Driven Models for GRB X-ray Light-Curve Gap Reconstruction",
      problem: "Swift-XRT GRB X射线余辉的不规则采样和观测时间缺口会影响平台结束时间Ta、平台通量Fa及平台后衰减指数α的测量。论文研究如何在缺口内重建光变，并比较物理先验约束与数据驱动方法对平台参数不确定度和离群风险的影响。",
      expected: "GRB X射线余辉的观测缺口如何影响平台参数测量？",
    },
    {
      title: "A Census of Stellar-mass Black Holes in the Milky Way with POPKIN. I. Isolated Black Holes",
      problem: "研究超新星处方、回落比例、质量转移和共同包层演化如何塑造银河系孤立恒星级黑洞的数量、质量、形成通道、空间分布、速度分布以及X射线吸积和微引力透镜可探测性，并评估这些观测量对黑洞形成和超新星机制的约束能力。",
      expected: "银河系孤立恒星级黑洞如何形成并被探测？",
    },
    {
      title: "High-energy neutrinos from shocked circumnuclear material around optically-bright and infrared-only tidal disruption events",
      problem: "研究非喷流TDE的亚相对论外流冲击CNM时，激波动力学、辐射冷却与压缩、宇宙线质子加速及pp相互作用如何决定高能中微子产额、弥散通量和基于电磁确认TDE样本的堆叠探测前景。",
      expected: "非喷流TDE激波如何决定高能中微子产额？",
    },
    {
      title: "Fast Dynamical Modelling of Milky Way Globular Clusters -- II. Impacts of Black Hole Prescriptions",
      problem: "黑洞初始—最终质量关系、超新星回落机制与诞生踢速处方，会如何改变银河系球状星团初始条件、初始质量函数及现今黑洞族群的推断，并进一步影响双黑洞并合与中等质量黑洞形成预言？",
      expected: "黑洞形成处方如何影响球状星团的黑洞族群与并合预言？",
    },
    {
      title: "NICER neutron stars with dark energy and dark matter: effects on the inferred equation of state",
      problem: "中子星内部若存在非对称暗物质核心或修正Chaplygin暗流体核心，会如何改变由NICER质量—半径测量推断的重子及总状态方程、中子星最大质量和半径？现有观测能否辨认这些核心并限制暗部门参数？",
      expected: "暗物质核心如何改变NICER推断的中子星状态方程与最大质量？",
    },
    {
      title: "Population synthesis of low-mass binaries with wind-accreting neutron stars",
      problem: "银河系中有多少含未充满洛希瓣的低质量主序伴星的中子星双星，以及其中的中子星何时能够从抛射器、推进器阶段进入恒星风吸积阶段；这些预测如何受双星形成、恒星风和中子星磁旋转演化模型影响。",
      expected: "低质量双星中的中子星何时进入恒星风吸积阶段？",
    },
    {
      title: "Toward Autonomous Radio Follow-up of Multi-messenger Transients with RADAR: From Alert Parsing to Inference and Observation Scheduling",
      problem: "如何在原始数据保留于各观测站点的条件下，自动解析多信使告警、进行射电余辉和结构化喷流推断，并生成可提交且符合约束的VLA射电随访调度块，从而在瞬变射电辐射衰减前支持喷流结构和能量约束。",
      expected: "多信使告警如何转化为可执行的VLA射电随访计划？",
    },
    {
      title: "Extragalactic Multi-Band Exploration of Red Supergiants (EMBERS): Pipeline, Source Classification, and Bolometric Properties",
      problem: "如何在不同滤镜覆盖、拥挤程度及宿主环境下，可靠区分RSG、AGB和其他污染源，统一恢复RSG温度、热光度及周星尘埃性质；进一步检验其温度尺度、光度函数和质量损失与宿主环境的关系。",
      expected: "JWST多波段观测如何区分红超巨星与污染源？",
    },
    {
      title: "Lepto-hadronic modeling of blazars associated with well-reconstructed high-energy neutrino events",
      problem: "这些与高能中微子事件空间一致的耀变体是否能够在物理上产生观测到的中微子，以及其多波段辐射和中微子产额需要怎样的喷流、发射区和外部光子场参数。",
      expected: "与高能中微子事件相关的耀变体能否产生观测到的中微子？",
    },
    {
      title: "Investigating the influence of the full-kinematics treatment for charged-current processes in binary neutron star mergers",
      problem: "带电流反应采用弹性近似、改进的 NuLib 处理或完整运动学 HAO 处理，会如何改变双中子星并合中的中微子输运、遗迹和盘演化、抛射物组成，以及引力波和核合成预测？",
      expected: "带电流反应的完整运动学处理会如何改变双中子星并合？",
    },
    {
      title: "Origin of the high-energy spectral cutoff in gamma-ray pulsar halos",
      problem: "Geminga 脉冲星晕的高能伽马射线谱截止究竟反映 PWN 的电子加速上限，还是高能电子快速传播导致观测孔径内通量减少；以及如何通过后续观测区分这两种解释。",
      expected: "Geminga脉冲星晕的高能截止来自加速上限还是电子快速传播？",
    },
    {
      title: "Hierarchical Bayesian Inference on the intrinsic event rate of Type I gamma-ray bursts from the Fermi/GBM catalogue",
      problem: "如何从红移信息稀缺、受仪器选择效应影响的Fermi/GBM短暴样本中，联合推断Type I GRB的本征事件率随红移的演化、结构化喷流参数分布、光度分布及并合延迟时间，并评估这些结果作为双中子星并合历史探针的可靠性。",
      expected: "Fermi/GBM短暴样本如何约束I型伽马暴的本征率演化？",
    },
    {
      title: "X-ray Through Radio Observations and Modeling of the Soft X-ray Flash GRB 250419A",
      problem: "软X射线闪GRB 250419A的软瞬时辐射与非标准余辉究竟源于低洛伦兹因子脏火球、略偏轴喷流、喷流结构，还是轴上喷流的能量注入；多波段余辉能否约束其喷流能量、洛伦兹因子及观测几何。",
      expected: "GRB 250419A软X射线闪与余辉能否区分不同喷流结构和能量注入？",
    },
    {
      title: "Extended gamma-ray emission in the vicinity of the Westerlund 1 massive star cluster and Kes 41 supernova remnant seen by the Fermi Large Area Telescope",
      problem: "Westerlund 1星团和Kes 41超新星遗迹附近的未关联LAT点源群，是否实际上属于与星际气体结构相关的延展伽马射线发射；这些成分的空间形态、能谱及粒子起源能否与背景建模残差区分。",
      expected: "Westerlund 1与Kes 41附近的伽马射线源是否属于延展辐射？",
    },
  ];

  for (const { title, problem, expected } of cases) {
    const item = { arxiv_id: "2609.12345", revision: 1, title,
      analysis: { priority: "must_read", coverage: {}, analysis: { problem, result: "作者报告了模型结果。" } } };
    const actual = derivePaperContentTitle(item);
    assert.equal(actual, expected, title);
    assert.ok(Array.from(actual).length <= 60, title);
  }
});

test("question titles do not begin with a dangling conjunction from the source problem", () => {
  const problem = "寻找第一LHAASO目录高能伽马射线源的低频射电对应体，辨别可能的SNR、PWN及其他环境结构，并检验高能源与SNR的空间重叠是否超出随机巧合预期。";
  const item = { arxiv_id: "2609.07119", revision: 1, title: "Low-frequency counterparts to first-catalog LHAASO sources",
    analysis: { priority: "must_read", coverage: {}, analysis: { problem, result: "评估空间重叠相对于随机巧合的显著性。" } } };
  const title = derivePaperContentTitle(item);

  assert.equal(title, "高能源与SNR的空间重叠是否超出随机巧合预期？");
  assert.ok(Array.from(title).length <= 60);
});

test("how-to questions retain the stated research target when the sentence continues after a comma", () => {
  const problem = "如何利用深度、多波段、跨年时域观测，探索高红移微弱瞬变和超新星此前未充分覆盖的参数空间，并服务于高红移宇宙学、高质量端初始质量函数约束及Pair-instability/Pop-III超新星可能性的检验。";
  const item = { arxiv_id: "2609.08145", revision: 1, title: "Roman Time-Domain Surveys of High-Redshift Transients",
    analysis: { priority: "must_read", coverage: {}, analysis: { problem, result: "该观测计划将扩展高红移瞬变的搜寻范围。" } } };
  const markdown = paperMarkdown(item, "2026-09-10", {});
  const title = derivePaperContentTitle(item);

  assert.equal(title, "如何利用深度、多波段、跨年时域观测，探索高红移微弱瞬变和超新星此前未充分覆盖的参数空间？");
  assert.ok(markdown.includes(problem));
});

test("an unknown subject retains its complete qualified question instead of becoming an ID-only title", () => {
  const make = arxiv_id => ({ arxiv_id, revision: 1, title: "A previously unclassified physical process with a complete technical name",
    analysis: { priority: "must_read", coverage: {}, analysis: { problem: "只有在局域密度高于临界值时，等离子体过程是否会改变FRB色散量？", result: "尚不能确认。", reason: "与FRB有关" } } });
  const titles = ["2609.12345", "2609.12346"].map(id => derivePaperContentTitle(make(id)));
  assert.deepEqual(titles, Array(2).fill("只有在局域密度高于临界值时，等离子体过程是否会改变FRB色散量？"));
});

test("weekly title generation uses a source-backed progress claim and refuses theme lists", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  assert.equal(deriveWeeklyContentTitle(archive.week_id, archive), "W40周报：等离子体透镜研究给出放大率分布与重复时延的可检验预言");
  assert.throws(() => deriveWeeklyContentTitle("2026-W40", { thematic_highlights: [{ summary: "一个过长的主题列表。" }] }), /CHANNEL_TITLE_WEEKLY_PROGRESS_UNSUPPORTED/u);
});

test("short titles do not relabel every dark-matter work as white-dwarf research", () => {
  const item = { arxiv_id: "2609.12345", revision: 1, title: "Neutron Stars with Dark Matter and Quark Equations of State",
    analysis: { priority: "must_read", coverage: {}, analysis: { problem: { bluf: "暗物质和夸克物质如何影响中子星的状态方程、半径及不同核物质参数的约束？" }, result: "作者报告的条件性结果。" } } };
  const title = derivePaperContentTitle(item);
  assert.match(title, /暗物质和夸克物质如何影响中子星的状态方程/u);
  assert.doesNotMatch(title, /白矮星/u);
  assert.ok(Array.from(title).length <= 60);
});

test("readable-title limits include full named objects and date suffixes", () => {
  for (const source of ["Swift J1727.8-1613 afterglow polarization", "FRB 20250901A precursor searches", "SN\\,2024ggi shock breakout", "未知技术名称".repeat(12)]) {
    const item = { arxiv_id: "2609.12345", revision: 1, title: source, priority: "must_read",
      analysis: { priority: "must_read", coverage: {}, analysis: { problem: "在完整且未经独立验证的适用条件下，该磁场效应是否会改变脉冲轮廓？", result: "尚待验证。" } } };
    const paperTitle = derivePaperContentTitle(item);
    assert.ok(paperTitle && Array.from(paperTitle).length <= 60);
    assert.doesNotMatch(paperTitle, /\.\.\.|…|undefined/u);
  }
});

test("paper titles preserve content without inventing mechanisms from reading reasons or clipping terms", () => {
  assert.equal(extractPaperTopic({ title: "Dispersion Measure Variability in Fast Radio Bursts" }), "FRB色散量变化");
  assert.equal(extractPaperTopic({ title: "FRB host environments" }), "FRB环境");
  assert.equal(extractPaperTopic({ title: "A study of accretion", analysis: { reason: "与组内FRB方向相关" } }), "A study of accretion");
  const title = "A previously unclassified physical process with a complete technical name";
  assert.equal(extractPaperTopic({ title }), title);
  const item = { arxiv_id: "2609.12345", revision: 1, title: "Shock breakout in circumstellar material", analysis: { priority: "must_read", coverage: {}, analysis: { problem: "致密星周介质中的激波突破如何改变峰值光度？", result: "作者报告的结果", reason: "与组内研究相关" } } };
  const before = JSON.stringify(item);
  const markdown = paperMarkdown(item, "2026-10-02", { primary: "R3", related: [] });
  assert.equal(derivePaperContentTitle(item), "致密星周介质中的激波突破如何改变峰值光度？");
  assert.equal(markdown.split("\n")[0], "**必读**");
  assert.doesNotMatch(markdown, /^# /mu);
  assert.ok(markdown.includes(`原标题：${item.title}`));
  assert.equal(JSON.stringify(item), before);
});

test("a separate follow-up stays in the body while the headline asks the complete leading question", () => {
  const problem = "重复FRB的局域DM为何能够先升后降，以及这种搜索能否限制中心引擎的性质。";
  const item = { title: "Dispersion Measure Variability in Fast Radio Bursts", arxiv_id: "2609.09285", revision: 1,
    analysis: { priority: "must_read", analysis: { problem, result: "仅为模型解释，尚未确认。" } } };
  const body = paperMarkdown(item, "2026-10-02", {});
  assert.equal(derivePaperContentTitle(item), "重复FRB的局域DM为何能够先升后降？");
  assert.equal(body.split("\n")[0], "**必读**");
  assert.doesNotMatch(body, /^# /mu);
  assert.ok(body.includes(problem));
  assert.ok(body.includes("尚未确认"));
});

test("readable titles preserve model conditions, negative alternatives and uncertainty", () => {
  const problem = "在弱电离薄壳模型下，FRB色散量是否可能先升后降，而非仅由膨胀决定？";
  const item = { title: "Photoionization in Fast Radio Bursts", arxiv_id: "2609.09285", revision: 1,
    analysis: { priority: "must_read", analysis: { problem, result: "作者提出一种解释。" } } };
  assert.equal(derivePaperContentTitle(item), problem);
  assert.doesNotMatch(paperMarkdown(item, "2026-10-02", {}), /^# /mu);
  assert.throws(() => deriveDailyContentTitle("2026-10-02", [item]), /CHANNEL_TITLE_DAILY_SOURCE_REQUIRED/u);
});

test("papers in the same section have work-specific titles rather than a shared category name", () => {
  const make = (problem, title) => ({ arxiv_id: "2609.12345", revision: 1, title,
    analysis: { priority: "must_read", coverage: {}, analysis: { problem, result: "作者报告的结果。" } } });
  const first = make("重复FRB的色散量变化是否来自光致电离？", "Dispersion measure changes in fast radio bursts");
  const second = make("如何利用重复FRB检验等离子体透镜模型？", "Plasma lensing in fast radio bursts");
  const titles = [first, second].map(derivePaperContentTitle);
  assert.deepEqual(titles, ["重复FRB的色散量变化是否来自光致电离？", "如何利用重复FRB检验等离子体透镜模型？"]);
  assert.notEqual(titles[0], titles[1]);
  const noProblem = make("", "A specific FRB paper title");
  assert.throws(() => derivePaperContentTitle(noProblem), /CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED/u);
});

test("paper cards separate contextual numerical results and collect links at the end", () => {
  const item = { arxiv_id: "2609.13540", revision: 1, title: "Shock breakout in circumstellar material", authors: ["Example Author"], analysis: { priority: "must_read", coverage: { label: "全文" }, analysis: { problem: "研究受限星周介质中的激波突破。", result: "在受限星周介质模型中，峰值光度为 1.43–3.15 × 10^44 erg/s，持续 4.1–35.4 小时。模型中的辐射前驱体预加速周围介质。", reason: "与组内 R3 的激波突破工作相关。", limits: ["这些数值限于本文采用的模型参数。"], unresolved_checks: ["未独立复算。"] } } };
  const before = JSON.stringify(item);
  const md = paperMarkdown(item, "2026-09-14", { primary: "R3", related: [] });
  assert.match(md, /## 核心结果/u);
  assert.match(md, /## 关键数据/u);
  assert.ok(md.includes("在受限星周介质模型中，峰值光度为 1.43–3.15 × 10^44 erg/s，持续 4.1–35.4 小时。"));
  assert.ok(md.indexOf("核心结果") < md.indexOf("关键数据"));
  assert.ok(md.indexOf("关键数据") < md.indexOf("阅读关联"));
  assert.ok(md.indexOf("这些数值限于本文采用的模型参数。") < md.indexOf("阅读入口"));
  assert.equal((md.match(/https?:\/\//gu) || []).length, 2);
  assert.ok(md.indexOf("https://arxiv.org") > md.indexOf("阅读入口"));
  assert.doesNotMatch(md, /<details|@img|关键图/u);
  assert.equal(JSON.stringify(item), before);
  const shorter = paperMarkdown({ ...item, analysis: { ...item.analysis, priority: "worth_knowing" } }, "2026-09-14", { primary: "R3", related: [] });
  assert.match(shorter, /\*\*关注\*\*/u);
  assert.doesNotMatch(shorter, /## 关键数据/u);
  assert.ok(shorter.length < md.length);
});

test("bibliographic years and figure numbers are not promoted to numerical measurements", () => {
  const item = { arxiv_id: "2609.12345", revision: 1, title: "FRB environments", analysis: { priority: "must_read", coverage: {}, analysis: { problem: "研究FRB环境。", result: "作者对照了 2021 年的模型和图 3。结果不支持这一解释。", reason: "相关研究。" } } };
  const md = paperMarkdown(item, "2026-09-14", { primary: "R5", related: [] });
  assert.doesNotMatch(md, /## 关键数据/u);
  assert.ok(md.includes("结果不支持这一解释。"));
});

test("single-paper cards do not display routing groups in the header or add classification lines", () => {
  const item = { arxiv_id: "2609.12345", revision: 1, title: "Shock breakout", authors: ["Example Author"],
    analysis: { priority: "must_read", coverage: {}, analysis: { problem: "研究激波突破。", result: "作者报告的结果。", reason: "与此前的激波模型相关。" } } };
  const topic = { primary: "R3", related: ["R2"] };
  const original = JSON.stringify({ item, topic });
  const text = paperMarkdown(item, "2026-10-02", topic);
  assert.equal(text.split("\n")[0], "**必读** · Example Author");
  assert.doesNotMatch(text, /所属分组|相关主题：|待分类/u);
  assert.equal(text, paperMarkdown(item, "2026-10-02", { primary: "R1", related: [] }));
  assert.equal(JSON.stringify({ item, topic }), original);
});

function fakeCli() {
  const feeds = [];
  let calls = 0;
  let moves = 0;
  let failNextCreate = false;
  const cli = async (args) => {
    const action = args[1];
    const arg = (flag) => args[args.indexOf(flag) + 1];
    if (action === "get-channel-timeline-feeds") {
      assert.equal(args.includes("--get-type"), false);
      assert.ok(args.includes("--channel-id"));
      return { retCode: 0, data: { feeds: feeds.filter((feed) => feed.channel_id === arg("--channel-id")), has_more: false } };
    }
    if (action === "get-feed-detail") {
      assert.equal(args.includes("--create-time"), false);
      return { retCode: 0, data: feeds.find((feed) => feed.feed_id === arg("--feed-id")) };
    }
    if (action === "publish-feed") {
      calls += 1;
      const imagePaths = [];
      for (let i = 0; i < args.length; i += 1) if (args[i] === "--image") imagePaths.push(args[i + 1]);
      const feed = { feed_id: String(calls), create_time_raw: String(calls + 100), channel_id: arg("--channel-id"), title: arg("--title"), markdown_content: arg("--markdown-content"), image_paths: imagePaths };
      feeds.push(feed);
      if (failNextCreate) { failNextCreate = false; throw new Error("CHANNEL_TIMEOUT"); }
      return { retCode: 0, data: feed };
    }
    if (action === "alter-feed") {
      const feed = feeds.find((entry) => entry.feed_id === arg("--feed-id"));
      feed.markdown_content = arg("--markdown-content"); feed.title = arg("--title");
      return { retCode: 0, data: feed };
    }
    if (action === "move-feed") {
      const feed = feeds.find((entry) => entry.feed_id === arg("--feed-id"));
      assert.equal(feed.channel_id, arg("--original-channel-id"));
      feed.channel_id = arg("--channel-id"); moves += 1;
      return { retCode: 0, data: feed };
    }
    throw new Error(`unexpected ${action}`);
  };
  return { cli, feeds, get moves() { return moves; }, failCreate: () => { failNextCreate = true; } };
}

test("daily publishes once per version, then reconciles an unknown committed create", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const channelIds = Object.fromEntries(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((id) => [id, id]));
  remote.failCreate();
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, channelIds };
  const first = await publishDailyFeed(options);
  assert.equal(first.success, false);
  assert.ok(first.pending >= 1);
  const second = await publishDailyFeed(options);
  assert.equal(second.pending_items.some((entry) => entry.reason === "CHANNEL_UNKNOWN_OUTCOME"), false);
  const publishablePaperCount = [...archive.radar.analyses.filter((analysis) => ["must_read", "worth_knowing"].includes(analysis.priority))]
    .filter(analysis => {
      const item = { ...archive.feed.entries.find(entry => entry.arxiv_id === analysis.arxiv_id), analysis };
      if (!routePaper(item).primary) return false;
      try { derivePaperContentTitle(item); return true; }
      catch { return false; }
    }).length;
  assert.equal(remote.feeds.length, publishablePaperCount);
  const third = await publishDailyFeed(options);
  assert.equal(third.published, 0);
  assert.equal(third.unchanged, remote.feeds.length);
  assert.match(remote.feeds[0].markdown_content, /arXiv:.*v1/u);
  assert.match(remote.feeds[0].markdown_content, /astrolineage-channel/u);
});

test("existing managed bodies require explicit approval before an in-place content edit", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json");
  await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id);
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { weeklyPath, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", channelId: "weekly", cli: remote.cli };
  options.sourceBinding = fixtureBinding({ weekly: JSON.stringify(weekly) });
  const initial = await publishWeeklyFeed(options);
  assert.equal(initial.published, 1);

  const identity = `weekly:${weekly.week_id}`;
  const original = remote.feeds[0];
  const originalBody = original.markdown_content;
  const changed = structuredClone(weekly);
  changed.executive_summary += "\n\n新增一段需要人工批准后才能写入的正文。";
  await writeFile(weeklyPath, JSON.stringify(changed));
  const changedBinding = fixtureBinding({ weekly: JSON.stringify(changed) });

  const blocked = await publishWeeklyFeed({ ...options, sourceBinding: changedBinding });
  assert.ok(blocked.pending_items.some((item) => item.identity === identity && item.reason === "CHANNEL_EXISTING_BODY_EDIT_REQUIRES_APPROVAL"), JSON.stringify(blocked));
  assert.equal(remote.feeds[0].markdown_content, originalBody);

  const approved = await publishWeeklyFeed({ ...options, sourceBinding: changedBinding, allowExistingBodyEdits: true });
  assert.equal(approved.updated, 1);
  assert.equal(remote.feeds.length, 1);
  assert.equal(remote.feeds[0].feed_id, original.feed_id);
});

test("invalid source, missing built page, and unmatched topics never publish", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const remote = fakeCli();
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, channelIds: { R5: "R5" } };
  assert.equal((await publishDailyFeed(options)).success, false);
  assert.equal(remote.feeds.length, 0);
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  assert.equal((await publishDailyFeed({ ...options, source: { feed: archive.feed, radar: {} } })).success, false);
  assert.equal(routePaper({ title: "Unrelated material", analysis: { analysis: { problem: "Unknown" } } }).primary, null);
  const partial = await publishDailyFeed(options);
  assert.equal(partial.success, false);
  assert.ok(partial.pending_items.some((item) => item.reason === "CHANNEL_SECTION_MISSING"));
});

test("a paper without a complete title is pending without blocking valid papers in the same daily batch", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-21.json", import.meta.url), "utf8"));
  const badPaper = archive.radar.analyses.find((item) => item.arxiv_id === "2609.22559");
  if (badPaper) {
    badPaper.analysis.problem = "论文研究";
    badPaper.analysis.result = "论文研究";
    badPaper.analysis.research_progress = "论文研究";
  }
  archive.radar.opening_brief = { status: "unavailable", reason: "pending title test" };
  const page = join(path, "dist", "arxiv-daily", archive.date);
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const channelIds = Object.fromEntries(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((id) => [id, id]));

  const result = await publishDailyFeed({
    source: archive,
    distRoot: join(path, "dist"),
    cacheRoot: join(path, "cache"),
    guildId: "test",
    cli: remote.cli,
    channelIds,
  });

  assert.ok(result.pending_items.some((item) => item.identity === "daily:2609.22559v1" && item.reason === "CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED"));
  assert.ok(result.published > 0);
  assert.equal(remote.feeds.some((feed) => feed.title.includes("2609.22559")), false);
});

test("weekly unchanged reentry is a no-op and changed text edits same feed", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id);
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { weeklyPath, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, guildId: "test", channelId: "weekly", sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }), allowExistingBodyEdits: true };
  assert.equal((await publishWeeklyFeed(options)).published, 1);
  assert.equal((await publishWeeklyFeed(options)).unchanged, 1);
  const rejectedOverride = await publishWeeklyFeed({ ...options, titleOverride: "Revised W40" });
  assert.equal(rejectedOverride.success, false);
  assert.ok(rejectedOverride.errors.includes("CHANNEL_TITLE_OVERRIDE_IDENTITY_MISMATCH"));
  assert.equal(remote.feeds.length, 1);
});

test("backfill is capped and dry run uses validated built archives", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archiveRoot = join(path, "archive"); await mkdir(archiveRoot);
  const source = await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url));
  await writeFile(join(archiveRoot, "2026-09-28.json"), source);
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const sourceBinding = fixtureBinding({ archives: { "2026-09-28": hashBody(source) } });
  const result = await publishHistoricalFeeds({ archiveRoot, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", dryRun: true, limit: 2, sourceBinding, channelIds: Object.fromEntries(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((id) => [id, id])) });
  assert.equal(result.remaining, 8);
  assert.equal(result.pending_items.length, 2);
  assert.equal((await publishHistoricalFeeds({ archiveRoot, distRoot: join(path, "dist"), limit: 51, sourceBinding })).success, false);
});

test("corrupt ledger and repeated remote page stop publication", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id);
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const cacheRoot = join(path, "cache"); await mkdir(cacheRoot);
  const options = { weeklyPath, distRoot: join(path, "dist"), cacheRoot, guildId: "test", channelId: "weekly", sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) };
  await writeFile(join(cacheRoot, "guild-test.json"), "not json");
  assert.match((await publishWeeklyFeed(options)).errors[0], /CHANNEL_LEDGER_CORRUPT/u);
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: {} }));
  let publishes = 0;
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { retCode: 0, data: { channels: [{ channel_id: "weekly", channel_name: "Weekly" }] } };
    if (args[1] === "get-guild-feeds") return { retCode: 0, data: { feeds: [], has_more: true } };
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [{ feed_id: "old", create_time_raw: "100", channel_id: "weekly" }], has_more: true, feed_attach_info: "same" } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { markdown_content: "unrelated" } };
    if (args[1] === "publish-feed") publishes += 1;
    throw new Error("unexpected");
  };
  const result = await publishWeeklyFeed({ ...options, cli });
  assert.equal(result.success, false);
  assert.equal(result.pending_items[0].reason, "CHANNEL_PAGINATION_INCOMPLETE");
  assert.equal(publishes, 0);
});

test("global ledger lock prevents concurrent duplicate publication", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id);
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { weeklyPath, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", channelId: "weekly", cli: remote.cli, sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) };
  const results = await Promise.all([publishWeeklyFeed(options), publishWeeklyFeed(options)]);
  assert.ok(results.some((result) => result.success));
  assert.equal(remote.feeds.length, 1);
});

test("verified managed section allows a fresh key despite repeated pages, but not unknown intent", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const items = [...archive.radar.analyses.filter((a) => ["must_read", "worth_knowing"].includes(a.priority))];
  const selected = items.map((analysis) => ({ analysis, entry: archive.feed.entries.find((entry) => entry.arxiv_id === analysis.arxiv_id) })).filter(({ analysis, entry }) => routePaper({ ...entry, analysis }).primary);
  const first = selected[0]; const second = selected[1];
  const firstTopic = routePaper({ ...first.entry, analysis: first.analysis }).primary;
  const secondTopic = routePaper({ ...second.entry, analysis: second.analysis }).primary;
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const cacheRoot = join(path, "cache"); await mkdir(cacheRoot);
  const itemsLedger = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`previous-${i}`, { status: "published", hash: "x" }]));
  itemsLedger[`daily:${second.entry.arxiv_id}v${second.entry.revision}`] = { status: "intent", hash: "unknown", channel_id: "two" };
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: itemsLedger, managed_sections: { one: { verified_empty: true, topic: firstTopic }, two: { verified_empty: true, topic: secondTopic } } }));
  let creates = 0;
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { retCode: 0, data: { channels: [{ channel_id: "one", channel_name: "One" }, { channel_id: "two", channel_name: "Two" }] } };
    if (args[1] === "get-guild-feeds") return { retCode: 0, data: { feeds: [], has_more: true } };
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [{ feed_id: "repeat", create_time_raw: "1", channel_id: "two" }], has_more: true, feed_attach_info: "repeat" } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { content: "unrelated" } };
    if (args[1] === "publish-feed") { creates += 1; return { retCode: 0, data: { feed_id: String(creates), create_time_raw: String(creates + 20) } }; }
    throw new Error("unexpected");
  };
  const result = await publishDailyFeed({ source: archive, distRoot: join(path, "dist"), cacheRoot, guildId: "test", cli, channelIds: Object.fromEntries(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((id) => [id, id === firstTopic ? "one" : "two"])) });
  assert.ok(creates >= 1);
  assert.ok(result.pending_items.some((entry) => entry.identity === `daily:${second.entry.arxiv_id}v${second.entry.revision}` && entry.reason === "CHANNEL_UNKNOWN_OUTCOME"));
});

test("explicit old-paper binding moves and edits the same remote ID", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-21.json", import.meta.url), "utf8"));
  const paper = archive.feed.entries.find((entry) => entry.arxiv_id === "2609.22426");
  const topic = routePaper({ ...paper, analysis: archive.radar.analyses.find((entry) => entry.arxiv_id === paper.arxiv_id) }).primary;
  const page = join(path, "dist", "arxiv-daily", "2026-09-21");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const binding = { guild_id: "test", feed_id: "original", create_time: "100", channel_id: "old", title: "Original paper", content: `# ${paper.title}\n\narXiv:${paper.arxiv_id}v${paper.revision}`, owner_verified: true };
  const remote = { ...binding, markdown_content: binding.content };
  let moves = 0; let edits = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [], has_more: false } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { ...remote, create_time_raw: remote.create_time } };
    if (args[1] === "move-feed") { moves += 1; remote.channel_id = get("--channel-id"); return { success: true, data: { feed_id: remote.feed_id } }; }
    if (args[1] === "alter-feed") { edits += 1; remote.markdown_content = get("--markdown-content"); remote.title = get("--title"); return { retCode: 0, data: remote }; }
    if (args[1] === "publish-feed") throw new Error("duplicate create");
    throw new Error("unexpected");
  };
  const result = await publishDailyFeed({ source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", cli, channelIds: { [topic]: "new" }, legacyBindings: { [`daily:${paper.arxiv_id}v${paper.revision}`]: binding }, allowExistingBodyEdits: true });
  assert.equal(moves, 1);
  assert.equal(edits, 1);
  assert.equal(remote.feed_id, "original");
  assert.equal(remote.channel_id, "new");
  assert.ok(result.updated >= 1);
});

test("legacy move intent reconciles a completed edit after ledger-save loss", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-21.json", import.meta.url), "utf8"));
  const paper = archive.feed.entries.find((entry) => entry.arxiv_id === "2609.22426");
  const topic = routePaper({ ...paper, analysis: archive.radar.analyses.find((entry) => entry.arxiv_id === paper.arxiv_id) }).primary;
  const page = join(path, "dist", "arxiv-daily", "2026-09-21");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const identity = `daily:${paper.arxiv_id}v${paper.revision}`;
  const binding = { guild_id: "test", feed_id: "original", create_time: "100", channel_id: "old", title: "Original paper", content: `# ${paper.title}\n\narXiv:${paper.arxiv_id}v${paper.revision}`, owner_verified: true };
  const remote = { ...binding, markdown_content: binding.content };
  let moves = 0; let edits = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [], has_more: false } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { ...remote, create_time_raw: remote.create_time } };
    if (args[1] === "move-feed") { moves += 1; remote.channel_id = get("--channel-id"); return { success: true }; }
    if (args[1] === "alter-feed") { edits += 1; remote.markdown_content = get("--markdown-content"); remote.title = get("--title"); return { retCode: 0 }; }
    throw new Error("unexpected");
  };
  const cacheRoot = join(path, "cache");
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot, guildId: "test", cli, channelIds: { [topic]: "new" }, legacyBindings: { [identity]: binding }, allowExistingBodyEdits: true };
  assert.ok((await publishDailyFeed(options)).updated >= 1);
  const ledgerPath = join(cacheRoot, "guild-test.json");
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  ledger.items[identity] = { ...ledger.items[identity], status: "intent", operation: "move", channel_id: "old" };
  await writeFile(ledgerPath, JSON.stringify(ledger));
  const retry = await publishDailyFeed(options);
  assert.equal(retry.pending_items.some((entry) => entry.identity === identity), false);
  assert.equal(moves, 1);
  assert.equal(edits, 1);
  assert.equal(JSON.parse(await readFile(ledgerPath, "utf8")).items[identity].status, "published");
});

test("published item moves same ID when its target section changes", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", cli: remote.cli };
  const topics = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"];
  assert.ok((await publishDailyFeed({ ...options, channelIds: Object.fromEntries(topics.map((id) => [id, "old"])) })).published > 0);
  const before = remote.feeds.map((feed) => feed.feed_id);
  const changed = await publishDailyFeed({ ...options, channelIds: Object.fromEntries(topics.map((id) => [id, "new"])) });
  assert.equal(changed.pending_items.some((entry) => entry.reason === "CHANNEL_UNKNOWN_OUTCOME"), false);
  assert.equal(remote.moves, before.length);
  assert.deepEqual(remote.feeds.map((feed) => feed.feed_id), before);
  assert.ok(remote.feeds.every((feed) => feed.channel_id === "new"));
});

test("default daily source refuses valid mutable files without a published generation", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const feedPath = join(path, "feed.json"); const radarPath = join(path, "radar.json");
  await writeFile(feedPath, JSON.stringify(archive.feed)); await writeFile(radarPath, JSON.stringify(archive.radar));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const result = await publishDailyFeed({ feedPath, radarPath, artifactRoot: null, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, channelIds: { R5: "R5" }, sourceBinding: fixtureBinding() });
  assert.equal(result.success, false);
  assert.match(result.errors[0], /CHANNEL_SOURCE_UNPUBLISHED/u);
  assert.equal(remote.feeds.length, 0);
});

test("move timeout retries only after target absence and unchanged old body are proven", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-21.json", import.meta.url), "utf8"));
  const paper = archive.feed.entries.find((entry) => entry.arxiv_id === "2609.22426");
  const topic = routePaper({ ...paper, analysis: archive.radar.analyses.find((entry) => entry.arxiv_id === paper.arxiv_id) }).primary;
  const page = join(path, "dist", "arxiv-daily", "2026-09-21"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const identity = `daily:${paper.arxiv_id}v${paper.revision}`;
  const binding = { guild_id: "test", feed_id: "original", create_time: "100", channel_id: "old", title: "Original paper", content: `# ${paper.title}\n\narXiv:${paper.arxiv_id}v${paper.revision}`, owner_verified: true };
  const remote = { ...binding, markdown_content: binding.content };
  let moves = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [], has_more: false } };
    if (args[1] === "get-feed-detail") { if (remote.channel_id !== get("--channel-id")) throw new Error("absent"); return { retCode: 0, data: { ...remote, create_time_raw: remote.create_time } }; }
    if (args[1] === "move-feed") { moves += 1; if (moves === 1) throw new Error("CHANNEL_TIMEOUT"); remote.channel_id = get("--channel-id"); return { retCode: 0 }; }
    if (args[1] === "alter-feed") { remote.markdown_content = get("--markdown-content"); remote.title = get("--title"); return { retCode: 0 }; }
    throw new Error("unexpected");
  };
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", cli, channelIds: { [topic]: "new" }, legacyBindings: { [identity]: binding }, allowExistingBodyEdits: true };
  assert.ok((await publishDailyFeed(options)).pending_items.some((entry) => entry.identity === identity));
  const retry = await publishDailyFeed(options);
  assert.equal(retry.pending_items.some((entry) => entry.identity === identity), false);
  assert.equal(moves, 2);
  assert.equal(remote.channel_id, "new");
});

test("validated PWN and magnetothermal papers follow physical Research Lines", async () => {
  for (const [date, id, expected] of [["2026-09-09", "2609.10041", "R1"], ["2026-09-21", "2609.24918", "R5"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis);
    assert.equal(routePaper({ ...entry, analysis }).primary, expected);
  }
});

test("accreting magnetar spin-down follows the accretion line with engine context", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-10.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.11479");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.11479");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R7", related: ["R1"] });
});

test("archived neutron-star spectra and observations route to R7", async () => {
  for (const [date, id] of [["2026-09-10", "2609.11787"], ["2026-09-13", "2609.12072"], ["2026-09-20", "2609.21732"], ["2026-09-22", "2609.25958"], ["2026-09-24", "2609.29316"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R7", related: [] }, id);
  }
});

test("magnetar magnetosphere and magneto-ionic papers route to R5", async () => {
  for (const [date, id] of [["2026-09-16", "2609.17661"], ["2026-09-21", "2609.23259"], ["2026-09-23", "2609.26897"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R5", related: [] }, id);
  }
});

test("magnetic Reynolds notation alone does not route to R5", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-15.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.17365");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.17365");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: null, related: [] });
});

test("a supernova gravitational-wave paper is not a magnetar-burst route", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-07.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.07774");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.07774");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R3", related: [] });
});

test("IXPE mention alone does not add an R7 route to a magnetic accretion disk", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-08.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.08895");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.08895");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R5", related: [] });
});

test("explicit gravitational-wave and merger observables route to R6", async () => {
  for (const [date, id] of [["2026-09-07", "2609.06369"], ["2026-09-07", "2609.06374"], ["2026-09-10", "2609.10736"], ["2026-09-15", "2609.16330"], ["2026-09-16", "2609.17936"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), { primary: "R6", related: [] }, id);
  }
});

test("method-only resistive GRMHD remains pending without a physical R6 qualifier", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-13.json", import.meta.url), "utf8"));
  const entry = archive.feed.entries.find((paper) => paper.arxiv_id === "2609.12998");
  const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === "2609.12998");
  assert.ok(entry && analysis);
  assert.deepEqual(routePaper({ ...entry, analysis }), { primary: null, related: [] });
});

test("general GRMHD and r-process delay papers remain outside R6", async () => {
  for (const [date, id] of [["2026-09-07", "2609.06150"], ["2026-09-14", "2609.15621"]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), { primary: null, related: [] }, id);
  }
});

test("collapsar and accretion gravitational-wave papers retain their existing routes", async () => {
  for (const [date, id, expected] of [["2026-09-22", "2609.25225", { primary: "R2", related: [] }], ["2026-09-29", "2609.36005", { primary: "R2", related: [] }], ["2026-09-28", "2609.32164", { primary: "R7", related: [] }]]) {
    const archive = JSON.parse(await readFile(new URL(`../src/data/arxiv-archives/daily/${date}.json`, import.meta.url), "utf8"));
    const entry = archive.feed.entries.find((paper) => paper.arxiv_id === id);
    const analysis = archive.radar.analyses.find((paper) => paper.arxiv_id === id);
    assert.ok(entry && analysis, `${id} must remain available in its source archive`);
    assert.deepEqual(routePaper({ ...entry, analysis }), expected, id);
  }
});

test("confirmed CLI rate limit stops the bounded batch before later writes", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  let writes = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [], has_more: false } };
    if (args[1] === "publish-feed") { writes += 1; return { retCode: 153 }; }
    throw new Error("unexpected");
  };
  const cacheRoot = join(path, "cache");
  const options = { source: archive, distRoot: join(path, "dist"), cacheRoot, guildId: "test", cli, channelIds: Object.fromEntries(["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((id) => [id, id])) };
  const result = await publishDailyFeed(options);
  assert.equal(writes, 1);
  assert.equal(result.pending_items[0].reason, "CHANNEL_RATE_LIMIT");
  assert.ok(result.remaining > 0);
  assert.equal(Object.keys(JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8")).items).length, 0);
});

test("unknown intent does not accept a copied marker on altered remote text", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const rendered = await generateWeeklyMarkdown({ weekly });
  const identity = `weekly:${weekly.week_id}`; const hash = hashBody(rendered.md);
  const cacheRoot = join(path, "cache"); await mkdir(cacheRoot);
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: { [identity]: { hash, status: "intent", channel_id: "weekly" } } }));
  let creates = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [{ feed_id: "rogue", create_time_raw: "100", channel_id: "weekly" }], has_more: false } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { markdown_content: `changed\n\n${markerFor(identity, hash)}`, title: rendered.postTitle } };
    if (args[1] === "publish-feed") creates += 1;
    throw new Error("unexpected");
  };
  const result = await publishWeeklyFeed({ weeklyPath, distRoot: join(path, "dist"), cacheRoot, guildId: "test", channelId: "weekly", cli, sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) });
  assert.equal(result.pending_items[0].reason, "CHANNEL_UNKNOWN_OUTCOME");
  assert.equal(creates, 0);
});

test("complete guild inventory does not clear an unknown write intent", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const cacheRoot = join(path, "cache"); await mkdir(cacheRoot);
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: { [`weekly:${weekly.week_id}`]: { hash: "unknown", status: "intent", channel_id: "weekly" } } }));
  let creates = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { has_more: true, feed_attch_info: "next" } };
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels: [{ channel_id: "weekly", channel_name: "Weekly" }] } };
    if (args[1] === "get-guild-feeds") return { success: true, data: { feeds: [], has_more: false } };
    if (args[1] === "publish-feed") creates += 1;
    throw new Error("unexpected CLI command");
  };
  const result = await publishWeeklyFeed({ weeklyPath, distRoot: join(path, "dist"), cacheRoot, guildId: "test", channelId: "weekly", cli, sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) });
  assert.equal(result.pending_items[0].reason, "CHANNEL_UNKNOWN_OUTCOME");
  assert.equal(creates, 0);
});

test("weekly changed body edits a positively bound original with same remote ID", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const binding = { guild_id: "test", feed_id: "original", create_time: "100", channel_id: "weekly", title: "Old 2026-W40", content: "# Original 2026-W40 summary", week_id: "2026-W40", owner_verified: true };
  const feed = { ...binding, markdown_content: binding.content };
  let edits = 0; let creates = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-feed-detail") return { retCode: 0, data: feed };
    if (args[1] === "alter-feed") { edits += 1; feed.markdown_content = get("--markdown-content"); feed.title = get("--title"); return { retCode: 0 }; }
    if (args[1] === "publish-feed") creates += 1;
    throw new Error("unexpected");
  };
  const result = await publishWeeklyFeed({ weeklyPath, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", channelId: "weekly", cli, sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }), legacyBindings: { "weekly:2026-W40": binding }, allowExistingBodyEdits: true });
  assert.equal(result.updated, 1);
  assert.equal(edits, 1);
  assert.equal(creates, 0);
  assert.equal(feed.feed_id, "original");
});

test("unbound same-week post stays pending even with complete inventory", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json"); await writeFile(weeklyPath, JSON.stringify(weekly));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  let creates = 0;
  const cli = async (args) => {
    if (args[1] === "get-channel-timeline-feeds") return { retCode: 0, data: { feeds: [{ feed_id: "old", create_time_raw: "100", channel_id: "weekly" }], has_more: false } };
    if (args[1] === "get-feed-detail") return { retCode: 0, data: { title: "Old 2026-W40", markdown_content: "# Previous 2026-W40 content" } };
    if (args[1] === "publish-feed") creates += 1;
    throw new Error("unexpected");
  };
  const result = await publishWeeklyFeed({ weeklyPath, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), guildId: "test", channelId: "weekly", cli, sourceBinding: fixtureBinding({ weekly: JSON.stringify(weekly) }) });
  assert.equal(result.pending_items[0].reason, "CHANNEL_WEEKLY_AMBIGUOUS");
  assert.equal(creates, 0);
});

test("provision reuses escaped R1 and verifies an initially empty timeline before trusting it", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const channels = [{ channel_id: "existing-r1", channel_name: `R1 ${TOPICS[0][1]}`.replace(/&/gu, "&amp;") }];
  let creates = 0; let r1Pages = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[0] === "manage" && args[1] === "get-guild-channel-list") return { retCode: 0, data: { channels } };
    if (args[0] === "manage" && args[1] === "create-channel") {
      creates += 1;
      const channel = { channel_id: `created-${creates}`, channel_name: get("--channel-name") };
      channels.push(channel);
      return { retCode: 0, data: channel };
    }
    if (args[1] === "get-channel-timeline-feeds") {
      assert.equal(args.includes("--get-type"), false);
      assert.ok(args.includes("--guild-id") && args.includes("--channel-id"));
      if (get("--channel-id") === "existing-r1") {
        r1Pages += 1;
        if (r1Pages === 1) return { success: true, data: { feed_attch_info: "pageNum=2&top=", has_more: true } };
        assert.equal(get("--feed-attach-info"), "pageNum=2&top=");
      }
      return { success: true, data: { has_more: false } };
    }
    throw new Error("unexpected CLI command");
  };
  const cacheRoot = join(path, "cache");
  const ids = await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.equal(ids.R1, "existing-r1");
  assert.equal(creates, 6);
  assert.equal(r1Pages, 2);
  const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
  assert.equal(ledger.managed_sections["existing-r1"].verified_empty, true);
  await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.equal(creates, 6);
});

test("endless empty timeline pages stop after two calls per section without trusting absence", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const channels = TOPICS.map(([key, label]) => ({ channel_id: key, channel_name: `${key} ${label}` }));
  const calls = new Map();
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { retCode: 0, data: { channels } };
    if (args[1] === "get-channel-timeline-feeds") {
      const channelId = args[args.indexOf("--channel-id") + 1];
      const page = (calls.get(channelId) ?? 0) + 1;
      calls.set(channelId, page);
      return { retCode: 0, data: { feeds: [], has_more: true, feed_attch_info: `page=${page + 1}` } };
    }
    if (args[1] === "get-guild-feeds") return { retCode: 0, data: { feeds: [], has_more: true } };
    throw new Error("unexpected CLI command");
  };
  const cacheRoot = join(path, "cache");
  const ids = await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.deepEqual(Object.keys(ids), TOPICS.map(([key]) => key));
  assert.deepEqual([...calls.entries()], TOPICS.map(([key]) => [key, 2]));
  await assert.rejects(readFile(join(cacheRoot, "guild-test.json"), "utf8"), { code: "ENOENT" });
  await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.deepEqual([...calls.entries()], TOPICS.map(([key]) => [key, 4]));
});

test("complete guild inventory maps names and verifies only empty sections after timeline stalls", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const channels = TOPICS.map(([key, label]) => ({ channel_id: key, channel_name: `${key} ${label}`.replace(/&/gu, "&amp;") }));
  const calls = new Map();
  let guildScans = 0;
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels } };
    if (args[1] === "get-channel-timeline-feeds") {
      const channelId = args[args.indexOf("--channel-id") + 1];
      const count = (calls.get(channelId) ?? 0) + 1;
      calls.set(channelId, count);
      return { success: true, data: { has_more: true, feed_attch_info: `page=${count + 1}` } };
    }
    if (args[1] === "get-guild-feeds") {
      guildScans += 1;
      assert.equal(args[args.indexOf("--get-type") + 1], "2");
      assert.equal(args[args.indexOf("--count") + 1], "100");
      return { success: true, data: { feeds: [{ feed_id: "existing", create_time_raw: "100", channel_name: `R1 ${TOPICS[0][1]}` }], has_more: false } };
    }
    throw new Error("unexpected CLI command");
  };
  const cacheRoot = join(path, "cache");
  await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.equal(guildScans, 1);
  assert.deepEqual([...calls.entries()], TOPICS.map(([key]) => [key, 2]));
  const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
  assert.equal(ledger.managed_sections.R1, undefined);
  assert.deepEqual(Object.keys(ledger.managed_sections).sort(), TOPICS.slice(1).map(([key]) => key).sort());
});

test("pre-create guild snapshot cannot verify a section created later in provisioning", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const channels = [{ channel_id: "existing-r1", channel_name: `R1 ${TOPICS[0][1]}` }];
  let globalScans = 0;
  const cli = async (args) => {
    const get = (flag) => args[args.indexOf(flag) + 1];
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels } };
    if (args[1] === "create-channel") return { success: true, data: { channel_id: `new-${get("--channel-name").slice(0, 2)}` } };
    if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { has_more: true, feed_attch_info: "next" } };
    if (args[1] === "get-guild-feeds") { globalScans += 1; return { success: true, data: { feeds: [], has_more: false } }; }
    throw new Error("unexpected CLI command");
  };
  const cacheRoot = join(path, "cache");
  const ids = await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
  assert.equal(globalScans, 1);
  const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
  assert.deepEqual(Object.keys(ledger.managed_sections), [ids.R1]);
  assert.ok(TOPICS.slice(1).every(([key]) => !ledger.managed_sections[ids[key]]));
});

test("guild fallback propagates CLI failure during provisioning", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels: [{ channel_id: "R1", channel_name: `R1 ${TOPICS[0][1]}` }] } };
    if (args[1] === "create-channel") return { success: true, data: { channel_id: "created" } };
    if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { has_more: true, feed_attch_info: "next" } };
    if (args[1] === "get-guild-feeds") throw new Error("CHANNEL_CLI_EXIT_1");
    throw new Error("unexpected CLI command");
  };
  await assert.rejects(provisionTopicChannels({ guildId: "test", cacheRoot: join(path, "cache"), cli }), /CHANNEL_CLI_EXIT_1/u);
});

test("incomplete or unmappable guild inventory cannot verify section absence", async (t) => {
  for (const mode of ["incomplete", "ambiguous", "unknown"]) {
    const { path, cleanup } = await createTemporaryWorkspace("astro-lineage-channel-", t);
    const channels = TOPICS.map(([key, label]) => ({ channel_id: key, channel_name: `${key} ${label}` }));
    if (mode === "ambiguous") channels.push({ channel_id: "extra-a", channel_name: "Other" }, { channel_id: "extra-b", channel_name: "Other" });
    let guildScans = 0;
    const cli = async (args) => {
      if (args[1] === "get-guild-channel-list") return { success: true, data: { channels } };
      if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { has_more: true, feed_attch_info: "next" } };
      if (args[1] === "get-guild-feeds") {
        guildScans += 1;
        if (mode === "unknown") return { success: true, data: { feeds: [{ feed_id: "unmapped", create_time_raw: "100", channel_name: "Missing" }], has_more: false } };
        return { success: true, data: { feeds: [], has_more: true, feed_attach_info: `next=${guildScans}` } };
      }
      throw new Error("unexpected CLI command");
    };
    const cacheRoot = join(path, "cache");
    await provisionTopicChannels({ guildId: "test", cacheRoot, cli });
    assert.equal(guildScans, mode === "ambiguous" ? 0 : mode === "unknown" ? 1 : 2);
    await assert.rejects(readFile(join(cacheRoot, "guild-test.json"), "utf8"), { code: "ENOENT" });
    await cleanup();
  }
});

test("daily rejects G2 after a G1 page build before any remote call", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "G1 page");
  const sourceBinding = fixtureBinding();
  let calls = 0;
  const result = await publishDailyFeed({ readEdition: async () => ({ feed: archive.feed, radar: archive.radar, generation_id: "G2", pointer: {} }), sourceBinding, distRoot: join(path, "dist"), cli: async () => { calls += 1; throw new Error("remote"); } });
  assert.equal(result.errors[0], "CHANNEL_SOURCE_BUILD_MISMATCH");
  assert.equal(calls, 0);
});

test("weekly refuses changed source after its built binding", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const weekly = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weeklyPath = join(path, "weekly.json");
  const sourceBinding = fixtureBinding({ weekly: JSON.stringify(weekly) });
  await writeFile(weeklyPath, JSON.stringify({ ...weekly, executive_summary: "changed after build" }));
  const page = join(path, "dist", "arxiv-weekly", weekly.week_id); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "G1 page");
  let calls = 0;
  const result = await publishWeeklyFeed({ weeklyPath, sourceBinding, distRoot: join(path, "dist"), cli: async () => { calls += 1; throw new Error("remote"); } });
  assert.equal(result.errors[0], "CHANNEL_SOURCE_BUILD_MISMATCH");
  assert.equal(calls, 0);
});

test("historical archive changed after build stays pending", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const archiveRoot = join(path, "archive"); await mkdir(archiveRoot);
  const sourceBinding = fixtureBinding({ archives: { "2026-09-28": hashBody(JSON.stringify(archive)) } });
  archive.counts.total += 1;
  await writeFile(join(archiveRoot, "2026-09-28.json"), JSON.stringify(archive));
  const page = join(path, "dist", "arxiv-daily", "2026-09-28"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "G1 page");
  let calls = 0;
  const result = await publishHistoricalFeeds({ archiveRoot, sourceBinding, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), channelIds: {}, cli: async () => { calls += 1; throw new Error("remote"); } });
  assert.equal(result.pending_items[0].reason, "CHANNEL_SOURCE_BUILD_MISMATCH");
  assert.equal(calls, 0);
});

test("generateWeeklyMarkdown generates verified weekly summary aligned with weekly synthesis and content-based title", async () => {
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/weekly/2026-W40.json", import.meta.url), "utf8"));
  const weekly = await generateWeeklyMarkdown({ weekly: archive });
  assert.equal(weekly.weekId, "2026-W40");
  assert.equal(weekly.postTitle, "W40周报：等离子体透镜研究给出放大率分布与重复时延的可检验预言");
  assert.ok(weekly.md.startsWith("2026-09-28 ~ 2026-10-04\n"));
  assert.doesNotMatch(weekly.md, /^# /mu);
  // Enforce content-based title rather than generic filler
  assert.doesNotMatch(weekly.postTitle, /高能天体物理学术脉络总结/u);
  assert.ok(weekly.md.includes(archive.executive_summary));
  assert.match(weekly.md, /## 本周导读/u);
  assert.match(weekly.md, /## 建议优先阅读/u);
  assert.match(weekly.md, /## 各主题进展/u);
  assert.match(weekly.md, /2609\.31842/u);
  assert.match(weekly.md, /2609\.32726/u);
  assert.match(weekly.md, /2609\.31844/u);
  assert.match(weekly.md, /\/arxiv-weekly\//u);
});

test("Chinese labels rename existing sections in place and reject duplicate aliases", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-labels-", t);
  const channels = TOPICS.map(([key, title]) => ({ channel_id: key, channel_name: `${key} ${title}` }));
  let renames = 0;
  const cli = async (args) => {
    if (args[1] === "get-guild-channel-list") return { success: true, data: { channels } };
    if (args[1] === "modify-channel") { renames++; return { success: true }; }
    if (args[1] === "get-channel-timeline-feeds") return { success: true, data: { feeds: [], has_more: false } };
    throw new Error("unexpected write");
  };
  const options = { guildId: "test", cacheRoot: path, cli, rename: true };
  assert.deepEqual(await provisionTopicChannels(options), Object.fromEntries(TOPICS.map(([key]) => [key, key])));
  assert.equal(renames, 7);
  assert.deepEqual(channels.map(c => c.channel_name), Object.values(TOPIC_LABELS));
  await provisionTopicChannels(options);
  assert.equal(renames, 7);
  channels.push({ channel_id: "duplicate", channel_name: `R1 ${TOPICS[0][1]}` });
  await assert.rejects(provisionTopicChannels(options), /CHANNEL_SECTION_AMBIGUOUS/u);
});

test("normal daily update includes one website-aligned brief and readable paper posts", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-brief-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const page = join(path, "dist/arxiv-daily/2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { source: archive, includeBrief: true, dailyChannelId: "brief", distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli, channelIds: Object.fromEntries(TOPICS.map(([key]) => [key, key])) };
  const first = await publishDailyFeed(options);
  assert.ok(first.published > 1);
  const brief = remote.feeds.filter(f => f.channel_id === "brief");
  assert.equal(brief.length, 1);
  assert.ok(brief[0].markdown_content.includes(archive.opening_brief.intro));
  const paper = remote.feeds.find(f => f.channel_id !== "brief");
  assert.match(paper.title, /\p{Script=Han}/u);
  assert.doesNotMatch(paper.markdown_content, /\bR[1-7]\b/u);
  assert.ok(paper.markdown_content.indexOf("研究了什么") < paper.markdown_content.indexOf("实际阅读范围"));
  assert.match(paper.markdown_content, /原标题：/u);
  const reentry = await publishDailyFeed(options);
  assert.equal(reentry.published + reentry.updated, 0);
});

test("a visually reviewed Must Read figure is attached once and remains idempotent", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-figure-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const source = { feed: archive.feed, radar: archive.radar };
  const model = await generateDailyMarkdown({ ...source });
  const selected = model.highlights.find(item => item.analysis.priority === "must_read");
  const figurePath = join(path, "reviewed.png");
  await writeFile(figurePath, "reviewed image fixture");
  const page = join(path, "dist/arxiv-daily/2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  let figureDistRoot;
  const options = { source, distRoot: join(path, "dist"), cacheRoot: join(path, "cache"), cli: remote.cli,
    channelIds: Object.fromEntries(TOPICS.map(([key]) => [key, key])),
    resolveFigure: async (item, resolverOptions) => {
      figureDistRoot = resolverOptions?.distRoot;
      return item.arxiv_id === selected.arxiv_id
      ? { image: { path: figurePath, url: "/arxiv-figures/test/fig1.png", label: "Fig. 1", caption: "Figure 1: reviewed fixture", sha256: "fixture-sha" } }
      : { image: null, diagnostic: "figure_source_missing" };
    },
  };
  const first = await publishDailyFeed(options);
  assert.ok(first.published >= 1);
  assert.equal(figureDistRoot, options.distRoot);
  const figurePost = remote.feeds.find(feed => feed.title === derivePaperContentTitle(selected));
  assert.equal(figurePost.image_paths.length, 1);
  assert.equal(figurePost.image_paths[0], figurePath);
  assert.ok(figurePost.markdown_content.includes("[(0,0)](@img)"));
  assert.ok(figurePost.markdown_content.includes("Figure 1: reviewed fixture"));
  assert.equal(remote.feeds.filter(feed => feed.image_paths.length).length, 1);
  const second = await publishDailyFeed(options);
  assert.equal(second.published + second.updated, 0);
  assert.equal(remote.feeds.filter(feed => feed.image_paths.length).length, 1);

  const retainedBody = figurePost.markdown_content;
  options.resolveFigure = async () => ({ image: null, diagnostic: "figure_review_or_asset_mismatch" });
  const reviewUnavailable = await publishDailyFeed(options);
  assert.equal(reviewUnavailable.pending_items.some(item => item.identity === `daily:${selected.arxiv_id}v${selected.revision}`), false,
    JSON.stringify(reviewUnavailable.pending_items.filter(item => item.identity === `daily:${selected.arxiv_id}v${selected.revision}`)));
  assert.equal(reviewUnavailable.published + reviewUnavailable.updated, 0);
  assert.equal(remote.feeds.find(feed => feed.title === derivePaperContentTitle(selected)).markdown_content, retainedBody);
  assert.equal(remote.feeds.filter(feed => feed.image_paths.length).length, 1);
});

test("historical figure resolution uses the archive's active build root", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-figure-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const paper = archive.radar.analyses.find(item => item.priority === "must_read");
  const caption = "Figure 1: Historical integration fixture.";
  const label = "Fig. 1";
  const url = `/arxiv-figures/${paper.arxiv_id}/fig1.png`;
  paper.analysis.figures = [{ url, label, caption }];
  archive.radar.opening_brief = buildOpeningBrief(archive.feed, archive.radar);
  const archiveBytes = Buffer.from(JSON.stringify(archive));
  const archiveRoot = join(path, "archives");
  const distRoot = join(path, "published-build");
  const cacheRoot = join(path, "cache");
  const publicRoot = join(path, "public");
  const publicAsset = join(publicRoot, url.slice(1));
  const builtAsset = join(distRoot, url.slice(1));
  const figureBytes = Buffer.from("historical figure fixture");
  await mkdir(archiveRoot, { recursive: true });
  await writeFile(join(archiveRoot, "2026-09-28.json"), archiveBytes);
  const page = join(distRoot, "arxiv-daily/2026-09-28");
  await mkdir(page, { recursive: true });
  await writeFile(join(page, "index.html"), "built");
  await mkdir(dirname(publicAsset), { recursive: true });
  await mkdir(dirname(builtAsset), { recursive: true });
  await writeFile(publicAsset, figureBytes);
  await writeFile(builtAsset, figureBytes);
  const manifest = { version: 1, figures: [{ arxiv_id: paper.arxiv_id, revision: paper.revision,
    source_fingerprint: paper.source_fingerprint, url, label, caption_sha256: hashBody(caption),
    visual_match: "confirmed", review_method: "human_visual_comparison", reviewed_by: "fixture-reviewer",
    asset_sha256: hashBody(figureBytes) }] };
  const resolvedRoots = [];
  let selectedFigure;
  const remote = fakeCli();
  const options = {
    archiveRoot,
    distRoot,
    cacheRoot,
    guildId: "test",
    cli: remote.cli,
    channelIds: Object.fromEntries(TOPICS.map(([id]) => [id, id])),
    from: "2026-09-28",
    through: "2026-09-28",
    limit: 50,
    sourceBinding: fixtureBinding({ archives: { "2026-09-28": hashBody(archiveBytes) } }),
    resolveFigure: async (item, options) => {
      resolvedRoots.push(options?.distRoot);
      const resolved = await resolveReviewedFigure(item, { ...options, publicRoot, manifest });
      if (item.arxiv_id === paper.arxiv_id && Number(item.revision) === Number(paper.revision)) selectedFigure = resolved;
      return resolved;
    },
  };
  const result = await publishHistoricalFeeds(options);

  assert.ok(result.published > 0);
  assert.ok(resolvedRoots.length > 0);
  assert.ok(resolvedRoots.every(root => root === distRoot));
  assert.equal(selectedFigure.diagnostic, null);
  assert.equal(selectedFigure.image.path, publicAsset);
  assert.equal(selectedFigure.image.url, url);
  const feedCount = remote.feeds.length;
  const imagePosts = remote.feeds.filter(feed => feed.image_paths.length > 0);
  assert.equal(imagePosts.length, 1);
  assert.deepEqual(imagePosts[0].image_paths, [publicAsset]);
  const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
  assert.equal(ledger.items[`daily:${paper.arxiv_id}v${paper.revision}`].figure_sha256, manifest.figures[0].asset_sha256);

  const reentry = await publishHistoricalFeeds(options);
  assert.equal(reentry.published + reentry.updated, 0);
  assert.equal(remote.feeds.length, feedCount);
  assert.equal(remote.feeds.filter(feed => feed.image_paths.length > 0).length, 1);
});

test("reader expands group direction references only in reading reason, preserving scientific model labels and source", () => {
  const item = { arxiv_id: "2609.22426", revision: 1, title: "Engine", analysis: { priority: "must_read", coverage: {}, analysis: { problem: "研究引擎", result: "高速度遭遇模型R4中的黑洞。", reason: "核心关联 R1 中的引擎和 R2 中的喷流，涉及 R1–R7 核心方向。", unresolved_checks: ["R2 marks the flare"] } } };
  const original = JSON.stringify(item);
  const text = paperMarkdown(item, "2026-09-21", { primary: "R1", related: [] });
  assert.ok(text.includes("核心关联 中央引擎与能量注入 中的引擎和 伽马射线暴与相对论喷流 中的喷流，涉及 课题组各研究方向 核心方向。"));
  assert.ok(text.includes("高速度遭遇模型R4中的黑洞。"));
  assert.ok(text.includes("R2 marks the flare"));
  assert.equal(JSON.stringify(item), original);
});

test("current brief uses its built dated archive so backfill and normal delivery do not oscillate", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-brief-source-", t);
  const archive = JSON.parse(await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url), "utf8"));
  const edition = structuredClone(archive);
  archive.opening_brief.intro += " 本期归档导读。";
  archive.radar.opening_brief.intro = archive.opening_brief.intro;
  const archiveRoot = join(path, "archive"); await mkdir(archiveRoot);
  const bytes = JSON.stringify(archive); await writeFile(join(archiveRoot, "2026-09-28.json"), bytes);
  const distRoot = join(path, "dist");
  const page = join(distRoot, "arxiv-daily/2026-09-28"); await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built dated archive");
  const sourceBinding = fixtureBinding({ archives: { "2026-09-28": hashBody(bytes) } });
  sourceBinding.daily.hash = hashBody(JSON.stringify({ feed: edition.feed, radar: edition.radar }));
  sourceBinding.id = hashBody(JSON.stringify({ daily: sourceBinding.daily, weekly: sourceBinding.weekly, archives: sourceBinding.archives }));
  const remote = fakeCli();
  const options = { archiveRoot, distRoot, cacheRoot: join(path, "cache"), guildId: "test", cli: remote.cli, sourceBinding, channelIds: Object.fromEntries(TOPICS.map(([key]) => [key, key])), channelId: "brief" };
  assert.equal((await publishHistoricalFeeds({ ...options, briefs: true })).published, 1);
  const daily = { ...options, includeBrief: true, dailyChannelId: "brief", readEdition: async () => ({ feed: edition.feed, radar: edition.radar, generation_id: sourceBinding.daily.generation_id, pointer: {} }) };
  const current = await publishDailyFeed(daily);
  assert.equal(current.updated, 0);
  assert.ok(remote.feeds.find(f => f.channel_id === "brief").markdown_content.includes(archive.opening_brief.intro));
  assert.equal((await publishHistoricalFeeds({ ...options, briefs: true })).unchanged, 1);
  await writeFile(join(archiveRoot, "2026-09-28.json"), bytes + "\n");
  const stale = await publishDailyFeed(daily);
  assert.ok(stale.errors.includes("CHANNEL_SOURCE_BUILD_MISMATCH"));
  assert.ok(stale.pending_items.some(x => x.identity === "daily-summary:2026-09-28"));
});

test("event chart is source-bound, capped at five and updates one persistent identity", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-events-", t);
  const eventsPath = join(path, "events.json");
  const data = { generated_at: "2026-10-03T00:00:00Z", events: Array.from({ length: 6 }, (_, i) => ({ event_id: `SN 2026${i}`, heat_score: 60 - i, paper_count: 1, last_updated: "2026-10-01", papers: [] })) };
  const save = async () => { const bytes = JSON.stringify(data); await writeFile(eventsPath, bytes); return { hash: hashBody(bytes), generated_at: data.generated_at }; };
  const remote = fakeCli();
  const options = { sourceBinding: fixtureBinding(), eventSnapshot: await save(), eventsPath, channelId: "brief", cacheRoot: join(path, "cache"), guildId: "test", cli: remote.cli };
  assert.equal((await publishEventRanking(options)).published, 1);
  assert.equal(remote.feeds[0].title, "瞬变源 Top 5");
  assert.equal((remote.feeds[0].markdown_content.match(/^## /gmu) || []).length, 5);
  assert.doesNotMatch(remote.feeds[0].markdown_content, /SN 20265/u);
  assert.equal((await publishEventRanking(options)).unchanged, 1);
  data.events[0].heat_score = 70;
  await save();
  assert.deepEqual((await publishEventRanking(options)).errors, ["CHANNEL_EVENTS_BUILD_MISMATCH"]);
  options.eventSnapshot = await save();
  assert.equal((await publishEventRanking(options)).updated, 1);
  assert.equal(remote.feeds.length, 1);
  assert.match(remote.feeds[0].markdown_content, /不等于物理重要性/u);
});

test("persistent chart recovers lost ledger without cloning and refuses duplicate identities", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-events-recovery-", t);
  const eventsPath = join(path, "events.json");
  const cacheRoot = join(path, "cache");
  const data = { generated_at: "2026-10-03T00:00:00Z", events: [] };
  const save = async () => { const bytes = JSON.stringify(data); await writeFile(eventsPath, bytes); return { hash: hashBody(bytes), generated_at: data.generated_at }; };
  const remote = fakeCli();
  const options = { sourceBinding: fixtureBinding(), eventSnapshot: await save(), eventsPath, channelId: "brief", cacheRoot, guildId: "test", cli: remote.cli };
  assert.equal((await publishEventRanking(options)).published, 1);
  const originalId = remote.feeds[0].feed_id;
  const reset = async () => writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: {} }));
  await reset();
  data.generated_at = "2026-10-03T01:00:00Z";
  options.eventSnapshot = await save();
  assert.equal((await publishEventRanking(options)).updated, 1);
  assert.equal(remote.feeds.length, 1);
  assert.equal(remote.feeds[0].feed_id, originalId);
  assert.equal((await publishEventRanking(options)).unchanged, 1);
  remote.feeds.push({ ...remote.feeds[0], feed_id: "duplicate" });
  await reset();
  const result = await publishEventRanking(options);
  assert.equal(result.published + result.updated, 0);
  assert.equal(result.pending_items[0].reason, "CHANNEL_UNKNOWN_OUTCOME");
  remote.feeds.pop();
  remote.feeds[0].markdown_content += "\nExternal correction";
  const externalBody = remote.feeds[0].markdown_content;
  const corrupted = await publishEventRanking(options);
  assert.equal(corrupted.pending_items[0].reason, "CHANNEL_REMOTE_MISMATCH");
  assert.equal(corrupted.published + corrupted.updated, 0);
  assert.equal(remote.feeds.length, 1);
  assert.equal(remote.feeds[0].markdown_content, externalBody);
});

test("chart edit timeout recovers same ID and external edits are preserved", async (t) => {
  for (const committed of [false, true]) {
    const { path } = await createTemporaryWorkspace("astro-lineage-channel-events-edit-", t);
    const eventsPath = join(path, "events.json");
    const cacheRoot = join(path, "cache");
    const data = { generated_at: "2026-10-03T00:00:00Z", events: [] };
    const save = async () => { const bytes = JSON.stringify(data); await writeFile(eventsPath, bytes); return { hash: hashBody(bytes), generated_at: data.generated_at }; };
    const remote = fakeCli();
    let failEdit = false;
    const cli = async (args) => {
      if (args[1] === "alter-feed" && failEdit) {
        failEdit = false;
        if (committed) await remote.cli(args);
        throw new Error("CHANNEL_TIMEOUT");
      }
      return remote.cli(args);
    };
    const options = { sourceBinding: fixtureBinding(), eventSnapshot: await save(), eventsPath, channelId: "brief", cacheRoot, guildId: "test", cli };
    assert.equal((await publishEventRanking(options)).published, 1);
    const priorBody = remote.feeds[0].markdown_content;
    const originalId = remote.feeds[0].feed_id;
    data.generated_at = "2026-10-03T01:00:00Z";
    options.eventSnapshot = await save();
    failEdit = true;
    assert.equal((await publishEventRanking(options)).errors[0], "CHANNEL_TIMEOUT");
    const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
    assert.equal(ledger.items["events:top5"].status, "intent");
    assert.equal(ledger.items["events:top5"].from_hash, priorBody.match(/([a-f0-9]{64}) -->$/u)[1]);
    const recovery = await publishEventRanking(options);
    assert.equal(recovery.pending, 0);
    assert.equal(recovery.updated, committed ? 0 : 1);
    assert.equal(remote.feeds.length, 1);
    assert.equal(remote.feeds[0].feed_id, originalId);
    assert.equal((await publishEventRanking(options)).unchanged, 1);
    remote.feeds[0].markdown_content += "\nExternal correction";
    const externalBody = remote.feeds[0].markdown_content;
    data.generated_at = "2026-10-03T02:00:00Z";
    options.eventSnapshot = await save();
    const result = await publishEventRanking(options);
    assert.equal(result.pending_items[0].reason, "CHANNEL_REMOTE_MISMATCH");
    assert.equal(result.published + result.updated, 0);
    assert.equal(remote.feeds[0].markdown_content, externalBody);
  }
});

test("historical daily briefs use their own cursor and do not republish papers", async (t) => {
  const { path } = await createTemporaryWorkspace("astro-lineage-channel-history-brief-", t);
  const archiveRoot = join(path, "archive");
  const cacheRoot = join(path, "cache");
  await mkdir(archiveRoot); await mkdir(cacheRoot);
  const bytes = await readFile(new URL("../src/data/arxiv-archives/daily/2026-09-28.json", import.meta.url));
  await writeFile(join(archiveRoot, "2026-09-28.json"), bytes);
  await writeFile(join(cacheRoot, "guild-test.json"), JSON.stringify({ version: 1, guild_id: "test", items: {}, backfill_cursor: 7 }));
  const page = join(path, "dist/arxiv-daily/2026-09-28");
  await mkdir(page, { recursive: true }); await writeFile(join(page, "index.html"), "built");
  const remote = fakeCli();
  const options = { briefs: true, archiveRoot, distRoot: join(path, "dist"), cacheRoot, guildId: "test", channelId: "brief", cli: remote.cli, sourceBinding: fixtureBinding({ archives: { "2026-09-28": hashBody(bytes) } }) };
  assert.equal((await publishHistoricalFeeds(options)).published, 1);
  assert.equal((await publishHistoricalFeeds(options)).unchanged, 1);
  const ledger = JSON.parse(await readFile(join(cacheRoot, "guild-test.json"), "utf8"));
  assert.equal(ledger.backfill_cursor, 7);
  assert.deepEqual(Object.keys(ledger.items), ["daily-summary:2026-09-28"]);
  assert.equal(remote.feeds.length, 1);
});
