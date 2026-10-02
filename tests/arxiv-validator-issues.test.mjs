import test from "node:test";
import assert from "node:assert/strict";
import { validateScientificOutput } from "../scripts/arxiv-ai-analyzer.mjs";

const BASE_ENTRY = {
  arxiv_id: "2609.99999",
  revision: 1,
  title: "Test Paper on Relativistic Jets",
  abstract: "We investigate relativistic jets in active galactic nuclei.",
};

test("Issue 1: Section titles with TeX label macro (e.g. labelsec:intro) should match clean model section names", () => {
  const sections = [
    { title: "labelsec:intro", text: "Relativistic jets are observed in active galactic nuclei across the spectrum." },
    { title: "Observations and Methods", text: "We perform numerical simulation of jet propagation." },
    { title: "Results", text: "The jet maintains collimation up to kiloparsec scales." },
    { title: "Discussion", text: "Our findings agree with Chandra observations." },
    { title: "labelsec:summary", text: "We conclude that magnetic fields collimate the jet." },
  ];
  const sectionMap = new Map(sections.map((s) => [s.title, s.text]));

  const modelOutput = {
    priority: "worth_knowing",
    reason: "高能喷流磁流体动力学演化与准直机制新模拟",
    result: "数值模拟证实强环向磁场在千秒差距尺度维持喷流准直",
    problem: "活动星系核相对论喷流在星际介质中的减速机制不明",
    method: "三维相对论磁流体数值模拟",
    reading_entry: "Introduction",
    research_progress: "相比此前二维模拟，三维不稳定性没有破坏整体准直",
    assumptions: ["理想磁流体近似"],
    limits: ["未考虑非热辐射冷却"],
    inspected_sections: ["Introduction", "Observations and Methods", "Results", "Discussion", "Summary"],
    evidence: [
      {
        section: "Introduction",
        quote: "Relativistic jets are observed in active galactic nuclei across the spectrum.",
        supports: ["reason", "result", "problem", "method", "research_progress"],
      },
    ],
  };

  // Must not throw "Body reading names a missing or duplicate section" or "evidence section Introduction is not an actual body heading"
  assert.doesNotThrow(() => {
    validateScientificOutput(modelOutput, {
      entry: BASE_ENTRY,
      sourceSections: sections,
      sourceSectionMap: sectionMap,
      abstract: false,
    });
  });
});

test("Issue 2: PDF hyphenated line break (e.g. multiwave-\\nlength) should match unbroken quote", () => {
  const sections = [
    {
      title: "Introduction",
      text: "In this work we reanalyze the multiwave-\nlength light curves of YZ Ret with optical and X-ray data.",
    },
    { title: "Observations", text: "Observations were taken from Swift and Fermi." },
    { title: "Results", text: "The nova exhibits unexpected synchrotron emission." },
  ];
  const sectionMap = new Map(sections.map((s) => [s.title, s.text]));

  const modelOutput = {
    priority: "worth_knowing",
    reason: "经典新星YZ Ret多波段光变再分析",
    result: "发现光学与X射线同步爆发证据",
    problem: "经典新星光变机制不明",
    method: "多波段联合测光与能谱分析",
    reading_entry: "Introduction",
    research_progress: "首次在经典新星中确认同步辐射分量",
    assumptions: ["激波绝热膨胀"],
    limits: ["数据仅覆盖早期爆发"],
    inspected_sections: ["Introduction", "Observations", "Results"],
    evidence: [
      {
        section: "Introduction",
        quote: "we reanalyze the multiwavelength light curves of YZ Ret with optical and X-ray data.",
        supports: ["reason", "result", "problem", "method", "research_progress"],
      },
    ],
  };

  // Must not throw "is not verbatim in section Introduction" due to hyphenated linebreak
  assert.doesNotThrow(() => {
    validateScientificOutput(modelOutput, {
      entry: BASE_ENTRY,
      sourceSections: sections,
      sourceSectionMap: sectionMap,
      abstract: false,
    });
  });
});

test("Issue 3: Papers without explicit Introduction section heading allow opening text evidence", () => {
  const sections = [
    {
      title: "Spectral correlations in the GW signals",
      text: "Gravitational waves from binary neutron star mergers provide unique insights into nuclear matter.",
    },
    { title: "EOS ensemble construction", text: "We construct equation of state ensembles using chiral effective field theory." },
    { title: "Discussion and Outlook", text: "Future detectors will constrain the speed of sound in neutron stars." },
  ];
  const sectionMap = new Map(sections.map((s) => [s.title, s.text]));

  const modelOutput = {
    priority: "worth_knowing",
    reason: "双中子星并合引力波信号能谱关联约束核物质状态方程",
    result: "成功在90%置信度约束千赫兹引力波峰值频率",
    problem: "超高密度核物质物态方程未知",
    method: "贝叶斯参数估计与手征有效场论模型",
    reading_entry: "Spectral correlations in the GW signals",
    research_progress: "比单探测器灵敏度提升一倍",
    assumptions: ["广义相对论正确"],
    limits: ["仅适用于高信噪比事件"],
    inspected_sections: ["Spectral correlations in the GW signals", "EOS ensemble construction", "Discussion and Outlook"],
    evidence: [
      {
        section: "Introduction", // Model designated "Introduction", but text is in first section
        quote: "Gravitational waves from binary neutron star mergers provide unique insights into nuclear matter.",
        supports: ["reason", "result", "problem", "method", "research_progress"],
      },
    ],
  };

  // Must not throw "evidence section Introduction is not an actual body heading" if quote is present in body
  assert.doesNotThrow(() => {
    validateScientificOutput(modelOutput, {
      entry: BASE_ENTRY,
      sourceSections: sections,
      sourceSectionMap: sectionMap,
      abstract: false,
    });
  });
});

test("Issue 4: Must Read does not fail closed if supplementary/appendix sections are omitted from inspected_sections", () => {
  const sections = [
    { title: "Introduction", text: "We study core-collapse supernovae." },
    { title: "Methods", text: "Hydrodynamic simulation in 3D." },
    { title: "Results", text: "Explosion energy reaches 1e51 erg." },
    { title: "Discussion", text: "Nucleosynthesis matches observations." },
    { title: "Conclusions", text: "Nickel-56 production is consistent." },
    { title: "Acknowledgements", text: "We thank the supercomputing center." },
    { title: "Data Availability", text: "Data available on Zenodo." },
    { title: "Appendix A: Grid convergence", text: "Resolution tests demonstrate convergence." },
    { title: "Appendix B: Microphysics details", text: "Equation of state tables used." },
  ];
  const sectionMap = new Map(sections.map((s) => [s.title, s.text]));

  const modelOutput = {
    priority: "must_read",
    reason: "三维超新星爆发核合成与能量输出自洽模拟突破",
    result: "首次自洽复现典型观测能量1e51 erg",
    problem: "超新星爆炸机制长期受限于二维人造不稳定性",
    method: "全三维高精度流体与中微子辐射输运模拟",
    reading_entry: "Methods",
    research_progress: "无需人工调整即可触发自然爆炸",
    assumptions: ["中微子驱动爆炸机制"],
    limits: ["计算耗时巨大难以做全参数空间扫描"],
    // Only core sections inspected (omitted Acknowledgements, Data Availability, Appendix A, Appendix B)
    inspected_sections: ["Introduction", "Methods", "Results", "Discussion", "Conclusions"],
    evidence: [
      {
        section: "Methods",
        quote: "Hydrodynamic simulation in 3D.",
        supports: ["reason", "result", "problem", "method", "research_progress"],
      },
    ],
  };

  // Must not throw "Must Read must inspect every section in the complete source package" for omitted appendix/acknowledgements
  assert.doesNotThrow(() => {
    validateScientificOutput(modelOutput, {
      entry: BASE_ENTRY,
      sourceSections: sections,
      sourceSectionMap: sectionMap,
      abstract: false,
    });
  });
});

test("Issue 5: LaTeX math font and spacing variations (e.g. \\alpha_{\\rm inj} vs \\alpha_{\\mathrm{inj}})", () => {
  const sections = [
    { title: "Introduction", text: "Observations from HAWC provide gamma-ray spectrum." },
    {
      title: "Results",
      text: "We jointly fit the HAWC gamma-ray spectrum. We fix $\\alpha_{\\mathrm{inj}}=1$, $E_{c,\\mathrm{inj}}=300\\,\\mathrm{TeV}$ based on diffusion.",
    },
    { title: "Discussion", text: "Discussion of cosmic ray propagation." },
  ];
  const sectionMap = new Map(sections.map((s) => [s.title, s.text]));

  const modelOutput = {
    priority: "worth_knowing",
    reason: "HAWC伽马射线能谱与空间轮廓联合拟合",
    result: "成功约束注入能谱指数与截止能量",
    problem: "极端高能宇宙线电子扩散损失机制不明",
    method: "MCMC多参数贝叶斯推断",
    reading_entry: "Results",
    research_progress: "相比此前单能谱拟合，引入空间轮廓打破了简并",
    assumptions: ["稳态扩散模型"],
    limits: ["仅适用于TeV能段"],
    inspected_sections: ["Introduction", "Results", "Discussion"],
    evidence: [
      {
        section: "Results",
        // Model used \rm instead of \mathrm and omitted trailing \mathrm{TeV}
        quote: "We fix $\\alpha_{\\rm inj}=1$, $E_{c,\\rm inj}=300\\,\\mathrm",
        supports: ["reason", "result", "problem", "method", "research_progress"],
      },
    ],
  };

  assert.doesNotThrow(() => {
    validateScientificOutput(modelOutput, {
      entry: BASE_ENTRY,
      sourceSections: sections,
      sourceSectionMap: sectionMap,
      abstract: false,
    });
  });
});

