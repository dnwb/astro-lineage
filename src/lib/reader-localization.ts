export type ReaderBlock =
  | { kind: "heading"; depth: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

const paragraph = (text: string): ReaderBlock => ({ kind: "paragraph", text });
const heading = (depth: number, text: string): ReaderBlock => ({ kind: "heading", depth, text });
const list = (...items: string[]): ReaderBlock => ({ kind: "list", items });

const workTitles: Record<string, string> = {
  "work:arnett-1982": "I 型超新星：早期光变曲线的解析解",
  "work:bromberg-2011": "相对论喷流在外部介质中的传播",
  "work:long-yu-2026": "嵌入 AGN 吸积盘的 GRB 喷流高能中微子信号：动态喷流传播框架",
  "work:transfit-2025": "TransFit：具有时间依赖辐射扩散的瞬变光变曲线高效拟合框架",
  "work:zhu-2021": "活动星系核吸积盘中受阻伽马射线暴产生的高能中微子",
};

const workBlocks: Record<string, Record<string, ReaderBlock[]>> = {
  "work:arnett-1982": {
    why: [paragraph("阅读这项工作，可以看到一个紧凑的物理模型如何把能量源连接到输运和可测光变曲线。文中的历史性“Type I”表述不应被不加说明地改写为现代亚型分类。")],
    problem: [paragraph("紧凑的物理模型如何把放射性能源和膨胀抛射物连接到演化中的光学光变曲线、有效温度和宽带颜色？")],
    takeaway: [paragraph("Arnett 建立了早期 I 型超新星光变曲线的解析描述，其中放射性加热、膨胀和辐射扩散共同塑造可观测的光学演化。")],
    assumptions: [list("抛射物进行同速膨胀。", "抛射物质中含有放射性镍。", "使用黑体超新星模型表示逸出的热辐射谱。")],
    delta: [paragraph("这项工作给出了光变曲线、有效温度和宽带颜色的解析解，使放射性加热与扩散之间的平衡变得明确。它是工作层面的物理描述，并不是对历史“Type I”标签进行现代亚型重分类。")],
  },
  "work:bromberg-2011": {
    why: [paragraph("Bromberg 等人把相对论喷流传播转化为一个耦合的物理描述：喷流头部向茧状体沉积能量，茧状体压力可以使喷流准直，而改变后的喷流几何又会反馈到头部运动和能量沉积。由此可以用一套紧凑框架理解 GRB、微类星体和 AGN 环境中的准直与非准直状态。")],
    problem: [paragraph("相对论喷流、受激波作用的头部和茧状体如何在外部介质中共同演化？茧状体压力何时会使喷流准直？")],
    takeaway: [paragraph("喷流能量密度与环境静质量能量密度的无量纲比值，以及注入角，共同控制茧状体压力是否使喷流准直。对于 GRB 应用，模型预测喷流在恒星内部发生准直，并在突破后失去这种约束。")],
    assumptions: [list("在所建模的准直区域内，磁场在动力学上不重要。", "喷流、头部、茧状体和环境介质被视为同一解析传播描述中的耦合组成部分。")],
    delta: [paragraph("这项工作使喷流传播与茧状体反馈在准直和非准直状态之间保持自洽。它的贡献是传播物理模型；独立的 `published_as` 记录表示出版对应关系，而不是科学脉络。")],
  },
  "work:long-yu-2026": {
    why: [paragraph("Long 和 Yu 沿着 AGN 吸积盘中的嵌入式 GRB 喷流，追踪随时间变化的喷流头部轨迹。头部状态的演化控制反向激波耗散、无碰撞加速窗口以及产生中微子的相互作用历史，直到喷流在盘内受阻或突破。")],
    problem: [paragraph("喷流头部传播、反向激波耗散、粒子冷却和有限发动机持续时间如何共同决定中微子产生，并决定喷流在 AGN 吸积盘中受阻还是突破？")],
    takeaway: [paragraph("这项工作解析传播历史，而不是用一个代表性喷流状态替代它。在受阻情形中，停滞状态在所报告的比较中可以捕捉约 14% 的耗散主导阶段；当头部穿过陡峭密度梯度并加速时，单状态估计可能高估突破情形。盘外层密度较低的情形可以在接近 100 PeV 处形成较硬的中微子尾部。")],
    assumptions: [list("只有在轨迹中存在无碰撞反向激波的阶段才计入中微子产生。", "探测器产额投影使用按赤纬平均的 IC86 缪子径迹有效面积。", "计算包含反向激波中微子，但不包含独立的茧状体贡献。")],
    delta: [paragraph("这项工作把代表性状态的传播估计替换为轨迹解析的描述。停滞状态比较作为受阻情形的限定基准保留，而突破和快速演化情形仍被视为不同结果。")],
  },
  "work:transfit-2025": {
    why: [paragraph("TransFit 在高度简化的瞬变光变曲线公式与昂贵的辐射输运模拟之间搭起了一座实用桥梁。它演化时间依赖的扩散模型，速度足以拟合观测光变曲线，同时保留抛射物膨胀以及灵活的放射性或中心引擎加热。")],
    problem: [paragraph("如何用时间依赖的扩散模型拟合瞬变光变曲线，同时保留膨胀抛射物和灵活加热，并使模型足够快速以支持实际探索？")],
    takeaway: [paragraph("这项工作把测量信号形式与模型推导的物理量分开。观测到的全波段光变曲线是可观测量；展示的多波段星等是模型输出；而抛射物、前身星半径、不透明度和加热参数是推断目标。Crank–Nicolson 求解器和拟合流程是具体技术，论文的半解析描述则属于模型特征而非技术本身。拟合出的参数选择并不自动意味着完整的后验推断或不确定性分析。"), paragraph("这项工作还区分了三种因果效应。分布式放射性加热和内边界中心引擎输入共同汇入抛射物的辐射/内能场。同速膨胀改变密度和光学深度，从而调制扩散。除此之外，膨胀功把内能或辐射能转移到机械能和动能预算中。")],
    assumptions: [list("模型把观测到的全波段光变曲线视为可观测量，把拟合得到的抛射物、前身星半径、不透明度和加热参数视为推断目标。", "一个拟合参数选择本身并不是完整的后验推断或不确定性分析。")],
    delta: [paragraph("这项工作为简化的瞬变光变曲线建模增加了时间依赖的扩散与拟合层，同时保持数值技术、物理参数解释和测量信号形式彼此分离。")],
  },
  "work:zhu-2021": {
    why: [paragraph("Zhu 等人把致密 AGN 吸积盘与多信使瞬变描述连接起来。GRB 喷流在盘内停滞，反向激波加速质子，两条强子相互作用分支最终汇聚到介子衰变和高能中微子信号。")],
    problem: [paragraph("当周围物质在 GRB 喷流穿过吸积盘尺度高度之前将其阻塞时，嵌入致密 AGN 吸积盘的 GRB 喷流能否产生可探测的多信使信号？")],
    takeaway: [paragraph("物理描述把信使与测量分开。中微子、光子和预测的短 GRB 引力波对应体是信使；软伽马射线是一个光子波段；注量和探测器计数是可观测形式；喷流受阻和预期产额仍是模型推导的推断目标。")],
    assumptions: [list("反向激波加速的质子在盘环境中通过质子–质子和光介子通道发生相互作用。", "注量和探测器计数是模型推导的输出，而不是对某个已观测事件的测量。")],
    delta: [paragraph("这项工作把嵌入式喷流问题从盘内约束推进到强子相互作用分支，再到中微子、光子和短 GRB 引力波对应体的预测。它在不同研究方向中的位置属于编辑背景，不能替代科学关联。")],
  },
};

const lineTitles: Record<string, string> = {
  "research-line:central-engines": "中心引擎与引擎驱动的瞬变",
  "research-line:dense-environment-multimessenger": "致密环境与多信使瞬变",
  "research-line:explosive-transients-csm": "爆发性瞬变与星周介质相互作用",
  "research-line:baseline-jet-multimessenger": "相对论喷流与多信使瞬变",
  "research-line:baseline-central-engine-transients": "中心引擎与快速高亮瞬变",
  "research-line:baseline-csm-radiative-transients": "星周介质相互作用与瞬变光变",
  "research-line:baseline-binaries-frb": "致密双星、脉冲星与快速射电暴",
};

const lineQuestions: Record<string, string> = {
  "research-line:central-engines": "什么驱动高光度瞬变？储存的能量如何转移为可观测辐射？",
  "research-line:dense-environment-multimessenger": "致密环境如何重塑瞬变外流，并将能量重新分配到中微子、光子和引力波通道？",
  "research-line:explosive-transients-csm": "爆发性抛射物的能量如何转移为辐射，包括膨胀、扩散以及与星周介质相互作用的过程？",
  "research-line:baseline-jet-multimessenger": "相对论外流如何穿过变化的环境，并在电磁、中微子和引力波通道中形成可观测信号？",
  "research-line:baseline-central-engine-transients": "致密中心引擎如何向抛射物注入能量，并塑造快速高亮瞬变？",
  "research-line:baseline-csm-radiative-transients": "抛射物、星周介质、激波和辐射输运如何共同塑造瞬变光变？",
  "research-line:baseline-binaries-frb": "双星几何、脉冲星风、磁化伴星和致密遗迹如何产生或调制多波段瞬变信号？",
};

const lineBlocks: Record<string, ReaderBlock[]> = {
  "research-line:central-engines": [
    paragraph("这个研究方向追踪一条因果路径：从物理能量储库出发，经由能量转移和输运，最终形成可以测量的瞬变信号。"),
    paragraph("Arnett 1982 是这里的基础条目，因为它提供了一个紧凑例子：放射性衰变把能量沉积到膨胀抛射物中，辐射扩散输运这部分能量，模型再把整个描述连接到光学光变曲线。编辑锚点用于组织这一阅读背景；这并不意味着该工作只有一个唯一的首要科学分类。"),
  ],
  "research-line:dense-environment-multimessenger": [
    paragraph("这个研究方向追踪周围介质如何在信号到达观测者之前改变外流。它保持物理链条清晰：环境约束改变喷流动力学，激波加速粒子，微观相互作用产生信使，而面向探测器的可观测量仍与模型推导的推断目标分开。"),
    paragraph("Zhu 等人 2021 是这一背景中的编辑锚点，因为其受阻的 AGN 吸积盘喷流分化出中微子和光子信号，同时为短 GRB 通道保留了预测的引力波对应体。锚点只负责组织本页，不表示一个首要科学类别。"),
  ],
  "research-line:explosive-transients-csm": [
    paragraph("这个研究方向追踪爆发性抛射物、内部加热、膨胀、辐射扩散以及与周围物质相互作用如何共同塑造瞬变辐射。一项工作可以向该方向贡献方法，而不意味着每个应用都包含星周介质相互作用。"),
    heading(2, "为什么 TransFit 在此作为锚点"),
    paragraph("TransFit 建立了时间依赖的扩散和模型–数据比较层，用于把爆发性抛射物物理连接到观测到的全波段光变曲线。它的中心引擎加热选项也支持在中心引擎研究方向中的次级阅读背景。"),
  ],
};

const pathTitles: Record<string, string> = {
  "learning-path:embedded-jet-dynamics": "从喷流传播到动态多信使产额",
  "learning-path:baseline-jet-foundations": "从相对论爆炸波到动态喷流传播",
  "learning-path:baseline-engine-powered-transients": "从放射性加热到引擎驱动瞬变",
  "learning-path:baseline-csm-light-curves": "从星周介质激波到时间依赖光变",
  "learning-path:baseline-binary-multimessenger": "从双星激波到快速射电暴环境",
};

const pathBlocks: Record<string, ReaderBlock[]> = {
  "learning-path:embedded-jet-dynamics": [
    paragraph("这条路径从相对论喷流传播的紧凑描述开始，进入嵌入 AGN 吸积盘的多信使应用，最后考察该应用的轨迹解析扩展。"),
    paragraph("先阅读 Bromberg 等人 2011，建立喷流头部运动、茧状体准直和突破这套基本传播词汇。接着阅读 Zhu 等人 2021，把这套词汇带入具有受阻喷流、强子相互作用分支和中微子信使的致密 AGN 吸积盘环境。最后阅读 Long 和 Yu 2026，考察如何沿完整的喷流头部轨迹追踪激波和冷却条件的演化，以及喷流受阻或突破的不同结果。"),
    paragraph("两段过渡理由是局部于本学习路径的教学依据。它们不主张科学谱系，不新增论文图谱关联，也不在工作之间建立全局的下一篇阅读关系。"),
  ],
};

const pathTransitionReasons: Record<string, string> = {
  "work:bromberg-2011>work:zhu-2021": "先用 Bromberg 等人的工作建立喷流头部传播、茧状体准直和突破这套紧凑的动力学词汇，再把它应用到 Zhu 等人的嵌入式 AGN 吸积盘多信使案例中。",
  "work:zhu-2021>work:long-yu-2026": "在理解 Zhu 等人关于受阻喷流特征状态和强子中微子的描述后，继续研究 Long 和 Yu 对激波及冷却演化的轨迹解析处理，包括受阻和突破两种结果。",
  "work:blandford-mckee-1976>work:sari-piran-narayan-1998": "先从相对论爆炸波解出发，再用它阅读激波动力学如何形成余辉光谱和光变曲线。",
  "work:sari-piran-narayan-1998>work:bromberg-2011": "从膨胀激波进入准直喷流，学习喷流头部和茧状体如何与外部介质交换能量。",
  "work:bromberg-2011>work:zhang-agn-jet-2024": "把喷流传播词汇带入活动星系核吸积盘的致密有限几何。",
  "work:zhang-agn-jet-2024>work:zhu-2021": "接着阅读受阻喷流，理解吸积盘约束如何把喷流能量重新分配到多信使通道。",
  "work:arnett-1982>work:yu-zhang-gao-2013": "在放射性加热基线之后，考察新生磁星如何改变并合抛射物的动力学和电磁信号。",
  "work:yu-zhang-gao-2013>work:yu-li-dai-2015": "把并合新星例子推广到更广泛的新生中子星驱动快速瞬变。",
  "work:yu-li-dai-2015>work:kasen-bildsten-2010": "将快速瞬变模型与磁星驱动超新星光变及其扩散时标进行比较。",
  "work:kasen-bildsten-2010>work:transfit-mag-2026": "最后学习把磁星注能、激波加热和辐射扩散耦合起来的时间依赖框架。",
  "work:chevalier-1982>work:liu-csm-formalism-2020": "先从自相似抛射物—介质相互作用开始，再把质量、动量和辐射标度写清楚。",
  "work:liu-csm-formalism-2020>work:transfit-2025": "从相互作用标度进入可以拟合瞬变光变的数值扩散框架。",
  "work:transfit-2025>work:transfit-csm-2025": "在一般扩散处理中加入移动激波加热边界和不断变化的光子逃逸路径。",
  "work:transfit-csm-2025>work:ni-dense-csm-2026": "最后阅读把致密星周环境作为推断目标的跨类别群体比较。",
  "work:dubus-2013>work:chen-psr-b1259-2019": "先用双星综述建立地图，再阅读具体的脉冲星风激波和多波段计算。",
  "work:chen-psr-b1259-2019>work:zhang-frb-2023": "从具体双星激波进入快速射电暴更广泛的等离子体和辐射约束。",
  "work:zhang-frb-2023>work:metzger-2017": "读完 FRB 现象学和开放问题后，再研究一个具体的年轻磁星情景。",
  "work:metzger-2017>work:du-frb-2026": "沿着年轻磁星情景进入双星环境中长时标旋转量变化的模型。",
  "work:du-frb-2026>work:xie-sgr-j1935-2025": "最后将环境推断与掩食磁星 X 射线爆发的测量进行比较。",
};

const edgeReasons: Record<string, string> = {
  "edge:long-yu-extends-zhu-dynamic-trajectory": "Long 和 Yu 保留了 Zhu 等人关于嵌入式 GRB 反向激波和强子中微子的框架，同时把计算从特征停滞状态的评估扩展到完整喷流头部轨迹上的激波和冷却条件演化，并包含受阻和突破两种结果。",
  "edge:transfit-challenges-arnett-maximum-light": "在中心集中的加热或空间分层的加热下，TransFit 发现，目标峰值光度平衡所依赖的自相似内能分布假设会失效，Arnett 定律会系统性低估峰值光度；这一挑战仅限于这些加热几何。",
};

const membershipReasons: Record<string, string> = {
  "membership:central-engines-bromberg-2011": "这项工作提供了用于组织引擎驱动瞬变阅读的基础性喷流头部和茧状体动力学。",
  "membership:central-engines-zhu-2021": "这项工作把中心引擎阅读延伸到嵌入式致密环境，其中喷流能量被重新导向多个信使通道。",
  "membership:central-engines-transfit-2025": "这项工作提供了把中心引擎加热连接到瞬变光变曲线的具体数值流程，而更广义的爆发性瞬变方法背景仍由编辑锚点组织。",
  "membership:dense-environment-multimessenger-zhu-2021": "这项工作提供了从嵌入式受阻喷流追踪到中微子、光子和引力波分支的 V0.1 基础。",
  "membership:dense-environment-multimessenger-long-yu-2026": "这项工作提供了在致密 AGN 吸积盘环境中描述喷流传播和中微子产生的动态模型前沿。",
  "membership:explosive-transients-csm-transfit-2025": "这项工作提供了可复用的时间依赖扩散和光变曲线拟合方法，不要求每个应用都包含星周介质相互作用。",
};

export function localizedWorkTitle(workId: string, fallback: string) {
  return workTitles[workId] ?? fallback;
}

export function localizedLineTitle(lineId: string, fallback: string) {
  return lineTitles[lineId] ?? fallback;
}

export function localizedLineQuestion(lineId: string, fallback: string) {
  return lineQuestions[lineId] ?? fallback;
}

export function localizedPathTitle(pathId: string, fallback: string) {
  return pathTitles[pathId] ?? fallback;
}

export function localizedEdgeReason(edgeId: string | undefined, fallback: string) {
  return (edgeId && edgeReasons[edgeId]) ?? fallback;
}

export function localizedMembershipReason(membershipId: string | undefined, fallback: string) {
  return (membershipId && membershipReasons[membershipId]) ?? fallback;
}

export function localizedPathTransition(
  sourceWorkId: string,
  targetWorkId: string,
  fallback: string,
) {
  return pathTransitionReasons[`${sourceWorkId}>${targetWorkId}`] ?? fallback;
}

export function localizedBlocks(entityId: string, section: string, blocks: ReaderBlock[]) {
  const translation = entityId.startsWith("work:")
    ? workBlocks[entityId]?.[section]
    : entityId.startsWith("research-line:")
      ? section === "reading" ? lineBlocks[entityId] : undefined
      : entityId.startsWith("learning-path:")
        ? section === "reading" ? pathBlocks[entityId] : undefined
        : undefined;
  if (!translation) return blocks;
  if (translation.length !== blocks.length || translation.some((block, index) => block.kind !== blocks[index]?.kind)) {
    throw new Error(`Chinese reader translation shape mismatch for ${entityId}:${section}.`);
  }
  return translation;
}

function bilingualMarker(text: string) {
  const normalized = String(text).trim().toLocaleLowerCase("en-US");
  if (normalized === "中文导读" || normalized === "中文") return "primary";
  if (normalized === "english reading note" || normalized === "english") return "english";
  return null;
}

/**
 * Select one language from the paired sub-sections used by newly ingested
 * reading bundles. The marker headings are structural and are not rendered.
 * Older visible bundles have no markers and continue through the localization
 * map above, so this remains a backwards-compatible boundary.
 */
export function selectBilingualBlocks(blocks: ReaderBlock[], language: "primary" | "english") {
  const hasMarkers = blocks.some((block) => block.kind === "heading" && bilingualMarker(block.text) !== null);
  if (!hasMarkers) return blocks;

  let activeLanguage: "primary" | "english" | null = null;
  const selected: ReaderBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      const marker = bilingualMarker(block.text);
      if (marker) {
        activeLanguage = marker;
        continue;
      }
    }
    if (activeLanguage === language) selected.push(block);
  }
  return selected;
}

export function localizedRole(role: string) {
  return {
    foundation: "基础",
    frontier: "前沿",
    method: "方法",
    group_lineage: "组内脉络",
  }[role] ?? role;
}

export function localizedAccessKind(kind: string) {
  return { ads: "ADS", arxiv: "arXiv", doi: "DOI" }[kind] ?? kind;
}

export function localizedReviewStatus(status: string) {
  return {
    reviewed: "已审核",
    active: "有效",
    contested: "有争议",
    unreviewed: "未审核",
    unavailable: "不可用",
  }[status] ?? status;
}

export function localizedRelation(relation: string) {
  return {
    builds_on: "建立在其上",
    extends: "扩展",
    tests: "检验",
    constrains: "约束",
    challenges: "挑战",
    replaces_assumption: "替代假设",
    corrects: "修正",
    published_as: "对应出版版本",
  }[relation] ?? relation;
}

export function localizedLocatorType(type: string) {
  return {
    section: "章节",
    equation: "方程",
    table: "表格",
    figure: "图",
    paragraph: "段落",
  }[type] ?? type;
}
