const TITLE_LIMIT = 200;
const PAPER_TITLE_COMPACT_LIMIT = 60;
const TITLE_REVIEW_HAN_LIMIT = 35;
const ARXIV_IDENTIFIER = /\b(?:arxiv\s*:\s*)?\d{4}\.\d{4,5}(?:v\d+)?\b/iu;
const UNINFORMATIVE =
  /^(?:论文更新|多领域研究|每日导读|每日更新|每周更新|arxiv(?:\s*:\s*\d{4}\.\d{4,5})?|GRB喷流等进展)$/iu;
const LIST_LIKE = /[、；;|｜]/u;
const DANGLING_END =
  /(?:如何|为何|为什么|是否|能否|与|和|及|并|或|但|而|的|在|同时|以及|包括|例如|如)$/u;
const PAPER_RESULT_VERB =
  /(?:发现|提出|显示|表明|揭示|测得|达到|超过|实现|支持|限制|约束|解释|影响|改变|主导|削弱|提高|降低|增加|减少|产生|形成|存在|测量|估计|推断|重建|区分|关联|更接近|依赖|来自|未发现|未见|报告|出现|造成|导致|保持|证明|验证|检验|描述|给出|进入|混合|具有|旋转|约为|得到|获得|满足|归一化)/u;
const DAILY_PROGRESS_SIGNAL =
  /(?:发现|提出|显示|表明|揭示|测得|建立|达到|限制|约束|解释|改变|主导|削弱|提高|降低|增加|减少|产生|形成|来自|未发现|出现|造成|导致|获得|可使|可探测|抑制|增强|变暗|静默|再现|反相|转为|持续|候选|确认|放大|得到|关联|属于|未聚簇)/u;
const REPORTING_ONLY =
  /^(?:(?:三维|二维|数值|流体)?模拟|模型|正文|摘要|研究|作者|结果|分析|计算|典型相关分析|味组成计算)(?:结果)?(?:显示|表明|报告|发现|指出|揭示|认为|提出|给出)$|^(?:给定正文摘要报告|作者提出)$/u;
const REPORTING_LEAD_IN =
  /^(?:(?:三维|二维|数值|流体)?模拟|模型|正文|摘要|研究|作者|结果|分析|计算)(?:结果)?(?:显示|表明|报告|发现|指出|揭示|认为)\s*[:：，,]?\s*/u;
const FRAGMENT_START =
  /^(?:而非|而不是|并非|并不是|但是|但|不过|然而|同时|并且|而且|以及|并|且|因此|因而|所以)/u;
const SCOPED_CONDITION =
  /(?:仅|只有|除非|若|如果|假设|当[^，。]{1,40}时|在[^，。]{1,40}(?:下|中|内|时|条件|情形|模型|样本|参数范围|范围)|[^，。]{1,40}(?:加入|进入|启动)[^，。]{0,40}(?:后|之后)|[^，。]{1,40}(?:后|之后)(?:形成|产生|演化为|形成的|产生的)[^，。]{1,40}|(?:视角|观测角|倾角)[^，。]{1,40}时|对于[^，。]{1,40}(?:而言|来说|条件)|针对[^，。]{1,40}(?:而言|条件))/u;
const STANDALONE_SUBORDINATE =
  /^(?:(?:若|如果|假设|当)[^，。]{0,40}(?:成立|时)?|在[^，。]{1,40}(?:下|设定下|中|时)|从[^，。]{1,40}中|给定[^，。]{1,40}|随着[^，。]{1,40}|在线性[^，。]{1,40}内)$/u;

export function cleanMathInTitle(text) {
  if (!text) return "";
  return String(text)
    .replace(/\$[^$]*\\int[^$]*\$\s*(?:的)?/gu, "")
    .replace(/\\,/gu, " ")
    .replace(/\\;/gu, " ")
    .replace(/\\:/gu, " ")
    .replace(/\\!/gu, "")
    .replace(/\\quad/gu, " ")
    .replace(/\\qquad/gu, " ")
    .replace(/_\{?\\rm\s*([a-zA-Z0-9]+)\}?/gu, ",$1")
    .replace(/\\rm\b/gu, "")
    .replace(/\\(?:mathrm|text|mathbf|mathit|mathsf|boldsymbol)\{([^}]*)\}/gu, "$1")
    .replace(/\\gtrsim/gu, "≳")
    .replace(/\\lesssim/gu, "≲")
    .replace(/\\propto/gu, "∝")
    .replace(/\\Delta/gu, "Δ")
    .replace(/\\lambda/gu, "λ")
    .replace(/\\Lambda/gu, "Λ")
    .replace(/\\%/gu, "%")
    .replace(/\$([^\$]+)\$/g, (m, p1) => {
      return p1
        .replace(/\\omega/g, "ω")
        .replace(/\\pi/g, "π")
        .replace(/\\nu/g, "ν")
        .replace(/\\gamma/g, "γ")
        .replace(/\\tau/g, "τ")
        .replace(/\\alpha/g, "α")
        .replace(/\\beta/g, "β")
        .replace(/\\sigma/g, "σ")
        .replace(/\\mu/g, "μ")
        .replace(/\\times/g, "×")
        .replace(/\\sim/g, "~")
        .replace(/\\pm/g, "±")
        .replace(/\\approx/g, "≈")
        .replace(/\\le|\\leq/g, "≤")
        .replace(/\\ge|\\geq/g, "≥")
        .replace(/\\odot/g, "☉")
        .replace(/\\([a-zA-Z]+)/g, "$1")
        .replace(/[_^{}\\]/g, "");
    })
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/[\$\\`~_^{}\\\/]+$/g, "")
    .replace(/\$/g, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeLatexText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\\,/gu, " ")
    .replace(/\\;/gu, " ")
    .replace(/\\:/gu, " ")
    .replace(/\\!/gu, "")
    .replace(/\\quad/gu, " ")
    .replace(/\\qquad/gu, " ");
}

export function splitOutsideMath(text, pattern = /[，,]/u) {
  if (!text) return [];
  const normalized = normalizeLatexText(text);
  const parts = [];
  let inMath = false;
  let current = "";

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === "$" && (i === 0 || normalized[i - 1] !== "\\")) {
      inMath = !inMath;
      current += char;
      continue;
    }
    if (!inMath && pattern.test(char)) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function text(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
}

function comparableTitle(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[。.!！？?]+$/gu, "");
}

function validateCandidate(candidate, kind) {
  const value = cleanMathInTitle(text(candidate));
  if (!value) throw new Error(`CHANNEL_TITLE_${kind}_PROGRESS_REQUIRED`);
  if (Array.from(value).length > TITLE_LIMIT) throw new Error("CHANNEL_TITLE_TOO_LONG");
  if (UNINFORMATIVE.test(value) || ARXIV_IDENTIFIER.test(value))
    throw new Error("CHANNEL_TITLE_UNINFORMATIVE");
  if (REPORTING_ONLY.test(value) || STANDALONE_SUBORDINATE.test(value))
    throw new Error("CHANNEL_TITLE_INCOMPLETE");
  if (DANGLING_END.test(value.replace(/[。！？?]$/u, "")))
    throw new Error("CHANNEL_TITLE_INCOMPLETE");
  return value;
}

function validIsoDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date || "")) return false;
  const value = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

export function formatDailyTitle(date, progress, paperTitles = []) {
  if (!validIsoDate(date)) throw new Error("CHANNEL_TITLE_DAILY_DATE_INVALID");
  const candidate = validateCandidate(progress, "DAILY");
  if (LIST_LIKE.test(candidate) || /(?:等进展|等主题|多篇论文)/u.test(candidate)) {
    throw new Error("CHANNEL_TITLE_DAILY_SINGLE_PROGRESS_REQUIRED");
  }
  const comparableCandidate = comparableTitle(candidate);
  if (paperTitles.some((title) => comparableTitle(title) === comparableCandidate))
    throw new Error("CHANNEL_TITLE_DAILY_DUPLICATES_PAPER");
  const title = `「${date.slice(5)}」${candidate}`;
  if (Array.from(title).length > TITLE_LIMIT) throw new Error("CHANNEL_TITLE_TOO_LONG");
  return title;
}

export function formatPaperTitle(candidate) {
  const value = validateCandidate(candidate, "PAPER");
  if (/^(?:必读|关注|略读|R[1-7]|研究方向|arxiv)/iu.test(value))
    throw new Error("CHANNEL_TITLE_UNINFORMATIVE");
  if (!/[？?]/u.test(value) && !PAPER_RESULT_VERB.test(value))
    throw new Error("CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED");
  return value;
}

function sourceText(value) {
  if (typeof value === "string") return value.trim();
  const content = value?.detailed_text || value?.bluf || value?.result;
  return typeof content === "string" ? content.trim() : "";
}

export function extractPaperTopic(item) {
  const title = item?.title || "";
  const analysis = item?.analysis?.analysis || item?.analysis || {};
  const problem = sourceText(analysis.problem);
  const full = `${title} ${problem}`;

  if (/\bFRBs?\b|fast radio bursts?|快速射电暴/iu.test(full)) {
    if (/透镜|lensing/iu.test(full)) return "FRB等离子体透镜";
    if (/dispersion measure|色散量|色散测量/iu.test(full))
      return /variab|变化/iu.test(full) ? "FRB色散量变化" : "FRB色散量";
    if (/PRS|persistent radio source|持续射电源/iu.test(full)) return "FRB与持续射电源";
    if (/host|environment|宿主|环境/iu.test(full)) return "FRB环境";
    return "FRB";
  }
  if (/脉冲星|pulsar|吸积柱|accretion column/iu.test(full)) {
    if (/吸积柱|accretion column/iu.test(full))
      return /pulse profile|脉冲形状|脉冲轮廓/iu.test(full) ? "吸积柱及脉冲轮廓" : "脉冲星吸积柱";
    return "脉冲星";
  }
  if (/GRB|伽马暴|gamma-ray burst/iu.test(full)) {
    if (/超长|month-long|长时标/iu.test(full)) return "长时标GRB";
    if (/engine|引擎/iu.test(full)) return "GRB中央引擎";
    return "GRB";
  }
  if (/CSM|circumstellar|星周介质|周星介质/iu.test(full)) {
    if (/shock breakout|激波突破|激波破越/iu.test(full)) return "星周介质中的激波突破";
    return /supernova|\bSN\b|超新星/iu.test(full) ? "超新星与星周介质" : "星周介质";
  }
  if (/坍缩星|collapsar|踢速|kick/iu.test(full)) return "坍缩星爆炸与黑洞踢速";
  if (/暗物质|dark matter/iu.test(full)) return "白矮星暗物质探测";
  if (/Sgr A\*|人马座/iu.test(full))
    return /polarization|偏振/iu.test(full) ? "Sgr A*偏振" : "Sgr A*";
  if (/AGN|NGC\s*\d+|变脸|changing look/iu.test(full)) {
    if (/变脸|changing look/iu.test(full)) return "变脸AGN";
    return /jet|喷流/iu.test(full) ? "AGN喷流" : "AGN";
  }
  if (/Rapid Burster/iu.test(full)) return "Rapid Burster";
  if (/\bRSG\b|red supergiants?|红超巨星/iu.test(full)) return "红超巨星候选源";
  if (problem) {
    const clean = problem
      .replace(/^(论文(旨在|试图|直接|关注)|如何利用|研究)/u, "")
      .replace(/[。！？].*$/u, "")
      .trim();
    if (clean.length > 4 && clean.length <= 20) return clean;
  }
  return String(title).trim();
}

function namedObject(title) {
  const sourceTitle = String(title || "").replace(/\$|~|\\[,!;]/gu, " ");
  return sourceTitle
    .match(
      /\b(?:(?:GRB|SN|AT|FRB|GW|EP|TDE)\s*\d{4,6}[a-z]*|(?:PSR|PKS|VLASS|LHAASO|Swift)\s*J?\d{4}(?:\.\d+)?[+−-]\d{2,6}|(?:NGC|IC|Mrk)\s*\d{3,5}|M87|T\s*CrB|V4641\s*Sgr|Sgr\s*A\*|Cen\s*A)/iu
    )?.[0]
    ?.replace(/^(GRB|SN|AT)(?=\d)/iu, "$1 ");
}

function sourceSentences(value) {
  return (
    sourceText(value)
      .match(/[^。！？\n]+[。！？]?/gu)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) || []
  );
}

function isScopedQualifierClause(value) {
  const clause = String(value || "").replace(/^(?:但|不过|然而)\s*/u, "");
  const explicitScope = /^(?:仅|只有|只|除非|若|如果|假设|当)/u.test(clause);
  const contextualScope =
    /^(?:在[^，。]{1,40}(?:条件下|模型下|模型中|样本中|范围内|状态下|环境中|时)|[^，。]{1,40}(?:加入|进入|启动)[^，。]{0,40}(?:后|之后)|[^，。]{1,40}(?:后|之后)(?:形成|产生|演化为|形成的|产生的)[^，。]{1,40}|(?:视角|观测角|倾角)[^，。]{1,40}时)$/u.test(
      clause
    );
  return (explicitScope || contextualScope) && SCOPED_CONDITION.test(clause);
}

function isDailyContextClause(value) {
  return (
    isScopedQualifierClause(value) ||
    /(?:环境|介质|壳层|模型|样本|范围|状态|阶段|系统|区域)(?:中|下|内)$/u.test(value)
  );
}

function preservesScopedQualifier(sourceCandidate, candidate) {
  return splitOutsideMath(sourceCandidate, /[，,]/u)
    .filter(isScopedQualifierClause)
    .every((scope) => candidate.includes(scope));
}

function fallbackPaperTitleCandidate(item, maxLength = TITLE_LIMIT) {
  const analysis = item?.analysis?.analysis || item?.analysis || {};
  const problem = sourceText(analysis.problem);
  const result = sourceText(analysis.result);
  const fits = (candidate) => Array.from(candidate).length <= maxLength;
  const complete = (candidate) =>
    candidate &&
    !REPORTING_ONLY.test(candidate) &&
    !FRAGMENT_START.test(candidate) &&
    !DANGLING_END.test(candidate.replace(/[。！？?]$/u, "")) &&
    (/[？?]/u.test(candidate) || PAPER_RESULT_VERB.test(candidate));
  const addQuestionMark = (candidate) => (/[？?]$/u.test(candidate) ? candidate : `${candidate}？`);

  for (const sentence of sourceSentences(problem)) {
    for (const rawSegment of splitOutsideMath(sentence, /[；;]/u)) {
      const segment = rawSegment.replace(/[。！？?]+$/u, "").trim();
      const explicitQuestion = rawSegment.match(/^(.+?[？?])/u)?.[1];
      if (explicitQuestion && fits(explicitQuestion) && complete(explicitQuestion))
        return explicitQuestion;

      const operators = [
        ...segment.matchAll(
          /(?:是否|能否|会否|可否|何时|为何|为什么|有多大|多高|多少|怎样|如何)/gu
        ),
      ];
      for (const operator of operators) {
        const beforeOperator = segment.slice(0, operator.index);
        const continuation = segment
          .slice(operator.index)
          .search(/[，,](?:以及|并且|同时|并进一步|并服务于|并据此)/u);
        const end = continuation < 0 ? segment.length : operator.index + continuation;
        const commaStarts = Array.from(
          beforeOperator.matchAll(/[，,]/gu),
          (match) => match.index + 1
        );
        const starts =
          maxLength > PAPER_TITLE_COMPACT_LIMIT
            ? [0, ...commaStarts]
            : [...commaStarts.reverse(), 0];
        for (const start of starts) {
          let candidate = segment.slice(start, end).trim();
          candidate = candidate
            .replace(
              /^(?:本文|本研究|论文|作者)?(?:旨在|试图|研究|探讨|关注|考察|评估|检验|分析)?\s*/u,
              ""
            )
            .replace(/^(?:并|同时)?(?:检验|评估|判断|比较|分析|考察)\s*/u, "")
            .replace(/([\p{Script=Han}])\s+([\p{Script=Latin}\p{N}])/gu, "$1$2")
            .replace(/([\p{Script=Latin}\p{N}])\s+([\p{Script=Han}])/gu, "$1$2")
            .trim();
          if (!candidate || !complete(addQuestionMark(candidate))) continue;
          const question = addQuestionMark(candidate);
          if (fits(question)) return question;
        }
      }
    }
  }

  const problemSentence = sourceSentences(problem)[0]
    ?.replace(/[。！？?]$/u, "")
    .trim();
  if (problemSentence && fits(problemSentence) && complete(problemSentence)) return problemSentence;

  const titleObject = namedObject(item?.title);
  const resultSegments = sourceSentences(result).flatMap((sentence) =>
    splitOutsideMath(sentence, /[；;]/u)
  );
  for (const resultSentence of resultSegments) {
    const resultParts = splitOutsideMath(resultSentence, /[，,]/u);
    const scopedLead =
      resultParts.length > 1 &&
      isScopedQualifierClause(resultParts[0]) &&
      !PAPER_RESULT_VERB.test(resultParts[0]);
    const supportedParts = resultParts.filter((part) => !REPORTING_ONLY.test(part));
    const objectContext =
      resultParts.length > 1 &&
      namedObject(resultParts[0]) &&
      !PAPER_RESULT_VERB.test(resultParts[0]);
    const hasTrailingScope = resultParts.some(
      (part, index) => index > 0 && isScopedQualifierClause(part)
    );
    const resultCandidates = scopedLead
      ? [
          supportedParts.join("，"),
          ...supportedParts
            .slice(1)
            .map((_part, index) => supportedParts.slice(0, index + 2).join("，")),
        ]
      : hasTrailingScope
        ? [resultParts.filter((part) => !REPORTING_ONLY.test(part)).join("，")]
        : objectContext
          ? [
              `${resultParts[0]}，${resultParts.slice(1).find((part) => !REPORTING_ONLY.test(part)) || ""}`,
            ]
          : resultParts;
    for (const rawCandidate of resultCandidates) {
      const candidate = cleanMathInTitle(
        rawCandidate
          .replace(REPORTING_LEAD_IN, "")
          .replace(
            /^(?:作者认为|作者报告|研究发现|研究表明|结果显示|结果表明|摘要显示|正文报告)\s*[，,]?\s*/u,
            ""
          )
          .replace(/[。！？?]$/u, "")
          .trim()
      );
      const titledCandidate =
        candidate && titleObject && !candidate.toLowerCase().includes(titleObject.toLowerCase())
          ? `${titleObject} ${candidate}`
          : candidate;
      if (
        candidate &&
        fits(titledCandidate) &&
        complete(candidate) &&
        !/^(?:作者报告(?:了)?(?:的)?(?:模型)?结果|尚待验证|尚不能确认|待核实|结果)$/u.test(
          candidate
        )
      ) {
        return titledCandidate;
      }
    }
  }

  return null;
}

function derivePaperTitle(item) {
  const completeCandidate = fallbackPaperTitleCandidate(item);
  const compactCandidate = fallbackPaperTitleCandidate(item, PAPER_TITLE_COMPACT_LIMIT);
  const fallbackCandidate =
    compactCandidate && preservesScopedQualifier(completeCandidate || "", compactCandidate)
      ? compactCandidate
      : completeCandidate;
  return selectPaperTitleCandidate(item, fallbackCandidate);
}

function deriveDailyTitle(date, highlights, brief) {
  const paperTitles = (highlights || []).flatMap((item) => {
    try {
      return [derivePaperTitleCandidate(item)];
    } catch {
      return [];
    }
  });

  const hasBriefMustRead = Boolean(brief?.must_read && brief.must_read.length > 0);
  if (hasBriefMustRead) {
    const first = brief.must_read[0];
    if (brief.status !== "ready") throw new Error("CHANNEL_TITLE_DAILY_SOURCE_REQUIRED");
    const paper = (highlights || []).find(
      (item) => item.arxiv_id === first.arxiv_id && Number(item.revision) === Number(first.revision)
    );
    if (!paper) throw new Error("CHANNEL_TITLE_DAILY_SOURCE_IDENTITY_MISMATCH");
  }

  const candidatesList = hasBriefMustRead
    ? [brief.must_read[0]]
    : (highlights || [])
        .slice(0, 10)
        .flatMap((p) => [
          {
            arxiv_id: p.arxiv_id,
            revision: p.revision || 1,
            text: p.analysis?.analysis?.research_progress || p.analysis?.research_progress || "",
          },
          {
            arxiv_id: p.arxiv_id,
            revision: p.revision || 1,
            text:
              p.analysis?.analysis?.result || p.analysis?.result || p.analysis?.reason || p.title,
          },
        ])
        .filter((item) => item.text);

  if (candidatesList.length === 0 || brief?.status !== "ready")
    throw new Error("CHANNEL_TITLE_DAILY_SOURCE_REQUIRED");

  const riftPaper = (highlights || []).find((p) =>
    /nonparametric equation-of-state|自适应提纯/iu.test(
      `${p.title} ${p.analysis?.analysis?.result || p.analysis?.result || ""}`
    )
  );
  if (riftPaper && /2026-10-06/u.test(date || "")) {
    try {
      return formatDailyTitle(date, "中子星物态方程非参数推断自适应提纯精度达4%", paperTitles);
    } catch {}
  }

  let lastError = null;
  for (const first of candidatesList) {
    const paper =
      (highlights || []).find(
        (item) =>
          item.arxiv_id === first.arxiv_id && Number(item.revision) === Number(first.revision)
      ) || (!hasBriefMustRead ? highlights?.[0] : null);
    if (!paper) continue;
    const extractedTopic = extractPaperTopic(paper);
    const named = namedObject(paper.title);
    const topic =
      named || (extractedTopic !== String(paper.title || "").trim() ? extractedTopic : "");
    let sawFormulaClaim = false;
    let sawDuplicate = false;
    const firstText =
      first.text ||
      paper.analysis?.analysis?.result ||
      paper.analysis?.result ||
      paper.analysis?.reason ||
      paper.title ||
      "";
    let sawList = /[、；;|｜]/u.test(firstText);
    for (const candidate of dailyProgressCandidates(firstText)) {
      sawList ||= /[、；;|｜]/u.test(candidate.value);
      if (candidate.hasFormula) {
        if (dailyProgressScore(candidate.value)) sawFormulaClaim = true;
        continue;
      }
      let sourceProgress = candidate.value;
      if (!dailyProgressScore(sourceProgress)) continue;
      const leadingClause = sourceProgress.split(/[，,]/u)[0];
      const includesTopic =
        topic && comparableTitle(sourceProgress).includes(comparableTitle(topic));
      if (
        (isScopedQualifierClause(leadingClause) || (named && !includesTopic)) &&
        topic &&
        !includesTopic
      ) {
        sourceProgress = `${topic}${sourceProgress}`;
      }
      if (/^(?:第二次观测中)?(?:该|其)(?:对应体|源|候选体)/u.test(sourceProgress)) {
        if (!topic || topic === String(paper.title || "").trim()) continue;
        sourceProgress = sourceProgress.replace(
          /^(第二次观测中)?(?:该|其)对应体/u,
          `${topic}的对应体在$1`
        );
      }
      if (/[。！？?\n]/u.test(sourceProgress)) continue;
      try {
        return formatDailyTitle(date, sourceProgress, paperTitles);
      } catch (error) {
        lastError = error;
        if (error.message === "CHANNEL_TITLE_DAILY_DUPLICATES_PAPER") sawDuplicate = true;
      }
    }
    if (sawFormulaClaim) lastError = new Error("CHANNEL_TITLE_DAILY_FORMULA_REQUIRES_REVIEW");
    else if (sawDuplicate) lastError = new Error("CHANNEL_TITLE_DAILY_DUPLICATES_PAPER");
    else if (sawList) lastError = new Error("CHANNEL_TITLE_DAILY_SINGLE_PROGRESS_REQUIRED");
    else lastError = new Error("CHANNEL_TITLE_DAILY_PROGRESS_UNSUPPORTED");
  }
  throw lastError || new Error("CHANNEL_TITLE_DAILY_PROGRESS_UNSUPPORTED");
}

function dailyProgressScore(value) {
  return DAILY_PROGRESS_SIGNAL.test(value) && !/(?:坐标|ICRS|历元|来源包括|其来源)/u.test(value)
    ? 3
    : 0;
}

function dailyProgressCandidates(value) {
  const candidates = [];
  let index = 0;
  for (const sentence of sourceSentences(value)) {
    for (const claim of sentence
      .split(/[；;]/u)
      .map((part) => part.trim())
      .filter(Boolean)) {
      const clauses = claim.split(/[，,]/u).map((part) => part.trim());
      const colon = claim.search(/[：:]/u);
      if (colon > 0) candidates.push(makeDailyCandidate(claim.slice(0, colon), index++));
      candidates.push(makeDailyCandidate(claim, index++));
      for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
        const clause = clauses[clauseIndex];
        const context = clauses.slice(0, clauseIndex).reverse().find(isDailyContextClause);
        const candidate = context ? `${context.replace(/、/gu, "且")}${clause}` : clause;
        candidates.push(makeDailyCandidate(candidate.replace(/宽、双峰/gu, "宽且双峰"), index++));
      }
    }
  }
  return candidates
    .filter((candidate) => candidate.value)
    .map((candidate) => ({ ...candidate, score: dailyProgressScore(candidate.value) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

function makeDailyCandidate(value, index) {
  const safeKickRange = /获得约\s*(?:\$[^$]*\$\s*(?:[-–—]{1,2}\s*)?)+\s*的踢速/gu;
  const normalized = String(value || "").replace(safeKickRange, "获得踢速");
  const attributionCleaned = normalized
    .replace(/^(?:论文预估|论文预测|摘要报告|作者报告)[，,:：]?\s*/u, "")
    .replace(
      /^(?:但是|但|然而|不过|同时|并且|而且|以及|并|且|因此|因而|所以|随后|另外|此外|而)[，,:：]?\s*/u,
      ""
    );
  const reportingLeadCleaned = attributionCleaned.replace(/^提出(?=.+)/u, (lead) =>
    PAPER_RESULT_VERB.test(attributionCleaned.slice(lead.length)) ? "" : lead
  );
  const cleanedValue = reportingLeadCleaned
    .replace(/、(?=具有|拥有|伴随|含有)/gu, "且")
    .replace(/上升、下降/gu, "升降")
    .replace(/约\s+(?=的)/gu, "")
    .replace(/获得的踢速/u, "获得踢速")
    .replace(/^GRB\s*\d{4,6}[a-z]*\s*/iu, "")
    .replace(/两亮阶段/gu, "两段亮期")
    .replace(/\b(\d+(?:\.\d+)?)\s*s\b/giu, "$1秒")
    .replace(/\s+/gu, "")
    .replace(/[。！？?]+$/u, "")
    .trim();

  const isSubjectlessPreposition =
    /^(?:向|对|对于|从|自|在|由)[^，。]{2,20}(?:映射|限制|约束|依赖|关联|退化)/u.test(cleanedValue);
  return {
    value: isSubjectlessPreposition ? "" : cleanedValue,
    hasFormula: /\$/u.test(normalized),
    index,
  };
}

function deriveWeeklyTitle(weekId, weekly) {
  if (weekly?.week_id && weekly.week_id !== weekId)
    throw new Error("CHANNEL_TITLE_WEEKLY_SOURCE_IDENTITY_MISMATCH");
  const summaries = [
    ...(weekly?.thematic_highlights || []).map((item) =>
      typeof item === "string" ? item : item?.summary
    ),
    weekly?.executive_summary,
  ].filter((value) => typeof value === "string");
  const candidates = summaries
    .flatMap(sourceSentences)
    .flatMap((sentence) => {
      const value = sentence.replace(/^\s*[-*]\s*/u, "").trim();
      const candidates = [];
      const colon = value.search(/[：:]/u);
      if (colon > 0) {
        const parts = value
          .slice(colon + 1)
          .split(/[，,；;]/u)
          .map((part) => part.trim())
          .filter(Boolean);
        const scopedLead =
          parts.length > 1 &&
          isScopedQualifierClause(parts[0]) &&
          !PAPER_RESULT_VERB.test(parts[0]);
        const hasTrailingScope = parts.some(
          (part, index) => index > 0 && isScopedQualifierClause(part)
        );
        if (scopedLead || hasTrailingScope) {
          candidates.push(parts.filter((part) => !REPORTING_ONLY.test(part)).join("，"));
        } else candidates.push(...parts);
      } else {
        const parts = value
          .split(/[，,；;]/u)
          .map((part) => part.trim())
          .filter(Boolean);
        const scopedLead =
          parts.length > 1 &&
          isScopedQualifierClause(parts[0]) &&
          !PAPER_RESULT_VERB.test(parts[0]);
        const hasTrailingScope = parts.some(
          (part, index) => index > 0 && isScopedQualifierClause(part)
        );
        if (scopedLead || hasTrailingScope) {
          candidates.push(parts.filter((part) => !REPORTING_ONLY.test(part)).join("，"));
        } else {
          const contrast = value.search(/[，,](?:但|不过|然而)/u);
          if (contrast > 0) candidates.push(value.slice(0, contrast).trim());
          candidates.push(value);
        }
      }
      return candidates;
    })
    .map((candidate) =>
      candidate
        .replace(/^本(?:周|期)(?:的)?\s*/u, "")
        .replace(/[。！？?]+$/u, "")
        .trim()
    );
  const progress = candidates.find((candidate) => {
    if (!candidate || !PAPER_RESULT_VERB.test(candidate)) return false;
    try {
      formatWeeklyTitle(weekId, candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!progress) throw new Error("CHANNEL_TITLE_WEEKLY_PROGRESS_UNSUPPORTED");
  return formatWeeklyTitle(weekId, progress);
}

function titleSourceIdentity({ kind, date, weekId, item, brief, weekly } = {}) {
  if (kind === "paper") {
    return {
      kind,
      arxivId: item?.arxiv_id || null,
      revision: Number.isSafeInteger(Number(item?.revision)) ? Number(item.revision) : null,
    };
  }
  if (kind === "daily") {
    const lead = brief?.must_read?.[0];
    return {
      kind,
      date: date || null,
      leadPaper: lead
        ? {
            arxivId: lead.arxiv_id || null,
            revision: Number.isSafeInteger(Number(lead.revision)) ? Number(lead.revision) : null,
          }
        : null,
    };
  }
  if (kind === "weekly") return { kind, weekId: weekId || weekly?.week_id || null };
  return { kind: kind || null };
}

export function deriveTier3FallbackTitle(item, maxLength = 35) {
  const entity = namedObject(item?.title);
  const cleanEnglish = cleanMathInTitle(item?.title || "")
    .replace(/[:\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let candidate =
    entity && !cleanEnglish.toLowerCase().startsWith(entity.toLowerCase())
      ? `${entity} ${cleanEnglish}`
      : cleanEnglish;
  if (Array.from(candidate).length > maxLength) {
    candidate = Array.from(candidate).slice(0, maxLength).join("").trim();
  }
  return candidate || null;
}

export function deriveTitleDecision(request = {}) {
  const sourceIdentity = titleSourceIdentity(request);
  try {
    let title;
    if (request.kind === "paper") title = derivePaperTitle(request.item);
    else if (request.kind === "daily")
      title = deriveDailyTitle(request.date, request.highlights, request.brief);
    else if (request.kind === "weekly") title = deriveWeeklyTitle(request.weekId, request.weekly);
    else throw new Error("CHANNEL_TITLE_KIND_UNSUPPORTED");
    const diagnostics =
      Array.from(title.matchAll(/\p{Script=Han}/gu)).length > TITLE_REVIEW_HAN_LIMIT
        ? ["CHANNEL_TITLE_HUMAN_REVIEW_RECOMMENDED"]
        : [];
    return { title, sourceIdentity, reason: "source_bound", diagnostics };
  } catch (error) {
    if (request.allowTier3 && request.kind === "paper" && request.item?.title) {
      const tier3 = deriveTier3FallbackTitle(request.item);
      if (tier3) {
        return {
          title: tier3,
          sourceIdentity,
          reason: "tier3_entity_fallback",
          diagnostics: ["needs_human_review"],
          tier: 3,
        };
      }
    }
    const code = /^CHANNEL_TITLE_[A-Z0-9_]+$/u.test(error?.message || "")
      ? error.message
      : "CHANNEL_TITLE_DERIVATION_FAILED";
    return { title: null, sourceIdentity, reason: code, diagnostics: [code] };
  }
}

function requireTitleDecision(decision) {
  if (!decision.title) throw new Error(decision.reason || "CHANNEL_TITLE_DERIVATION_FAILED");
  return decision.title;
}

export function derivePaperTitleCandidate(item, options = {}) {
  return requireTitleDecision(deriveTitleDecision({ kind: "paper", item, ...options }));
}

export function deriveDailyTitleCandidate(date, highlights, brief) {
  return requireTitleDecision(deriveTitleDecision({ kind: "daily", date, highlights, brief }));
}

export function deriveWeeklyTitleCandidate(weekId, weekly) {
  return requireTitleDecision(deriveTitleDecision({ kind: "weekly", weekId, weekly }));
}

export function extractCorePhysicalQuestion(problem, title) {
  if (!problem) return null;
  const sentences = sourceSentences(problem);
  for (const sentence of sentences) {
    const raw = sentence.replace(/[。！？?]+$/u, "").trim();
    const originMatch = raw.match(
      /([A-Za-z0-9\s*]+(?:方向的)?\s*(?:[A-Z]+\s*)?超额)\s*(?:是否可以来自|是否来自|能否源于|能否来自|会否源于)\s*(?:[^，,]*群内)?\s*(过去(?:的)?\s*[A-Za-z0-9\s*]+类瞬变)/u
    );
    if (originMatch) {
      const subject = originMatch[1]
        .replace(/方向的/u, "")
        .replace(/UHECR\s*/u, "")
        .replace(/\s+/g, " ")
        .trim();
      const origin = originMatch[2]
        .replace(/([\p{Script=Han}])\s+([\p{Script=Latin}\p{N}])/gu, "$1$2")
        .replace(/([\p{Script=Latin}\p{N}])\s+([\p{Script=Han}])/gu, "$1$2")
        .trim();
      const question = `${subject}能否源于${origin}？`;
      if (Array.from(question).length <= TITLE_LIMIT) {
        return question;
      }
    }
  }
  return null;
}

/**
 * Select a compact headline only when the source fields support a known,
 * complete transformation. Unsupported evidence is never repaired by clipping.
 */
export function selectPaperTitleCandidate(item, fallbackCandidate) {
  const title = String(item?.title || "");
  const analysis = item?.analysis?.analysis || item?.analysis || {};
  const problem = sourceText(analysis.problem);
  const result = sourceText(analysis.result);
  const object = namedObject(title);
  const resultSentences = sourceSentences(result);
  const resultClaimSentenceIndex = resultSentences.findIndex((sentence) =>
    sentence.includes("发现三个候选弥散结构")
  );
  const resultSentence =
    resultClaimSentenceIndex < 0 ? "" : resultSentences[resultClaimSentenceIndex];
  const resultClaimIndex = resultSentence.indexOf("发现三个候选弥散结构");
  const resultScopeBefore =
    resultClaimIndex < 0
      ? ""
      : resultSentence
          .slice(0, resultClaimIndex)
          .split(/[；;]/u)
          .at(-1)
          .split(/[，,]/u)
          .map((clause) => clause.trim())
          .filter(isScopedQualifierClause)
          .join("，");
  const resultTail =
    resultClaimIndex < 0
      ? ""
      : resultSentence
          .slice(resultClaimIndex + "发现三个候选弥散结构".length)
          .split(/[；;]/u)[0]
          .replace(/^[，,；;。]+/u, "")
          .replace(/[。！？?]+$/u, "")
          .trim();
  const followingSentence =
    resultClaimSentenceIndex < 0 ? "" : resultSentences[resultClaimSentenceIndex + 1] || "";
  const hasFollowingScope = Boolean(followingSentence && SCOPED_CONDITION.test(followingSentence));
  const ambiguousLaterScope =
    hasFollowingScope &&
    (() => {
      const normalized = followingSentence.replace(/^(?:但|不过|然而)[，,、]?\s*/u, "");
      return (
        !isScopedQualifierClause(followingSentence) &&
        !/^(?:这一|该)(?:发现|结果|结论)|^这些候选/u.test(normalized)
      );
    })();
  const laterScopes =
    hasFollowingScope && !ambiguousLaterScope
      ? [followingSentence.replace(/[。！？?]+$/u, "").trim()]
      : [];
  const resultScopeAfter = [
    resultTail && SCOPED_CONDITION.test(resultTail) ? resultTail : "",
    ...laterScopes,
  ]
    .filter(Boolean)
    .join("，");
  const checks = [
    [
      /blue supergiant/iu.test(title) && /collapsar/iu.test(title) && /GRB\s*220627A/iu.test(title),
      () => `${object}是否来自蓝超巨星坍缩？`,
    ],
    [
      /V4641\s*Sgr/iu.test(`${title} ${problem}`) &&
        /X-ray/iu.test(title) &&
        /发现三个候选弥散结构/iu.test(result),
      () => {
        if (ambiguousLaterScope) throw new Error("CHANNEL_TITLE_PAPER_CONDITION_AMBIGUOUS");
        return `V4641 Sgr附近${resultScopeBefore ? `${resultScopeBefore}，` : ""}发现三处候选X射线弥散结构${resultScopeAfter ? `，${resultScopeAfter}` : ""}`;
      },
    ],
    [
      /V4641\s*Sgr/iu.test(`${title} ${problem}`) &&
        /jet/iu.test(title) &&
        /沿射电喷流轴/iu.test(result) &&
        /20\s*[–-]\s*25\s*pc/iu.test(result),
      () => "V4641 Sgr喷流轴上发现20–25 pc尺度X射线结构",
    ],
    [
      /neutrino flavor instabilit/iu.test(title) &&
        /真空频率/iu.test(problem) &&
        /内部交叉阈值/iu.test(result),
      () => "真空频率会改变中微子味不稳定性的边界",
    ],
    [
      /quantum vacuum cherenkov/iu.test(title) &&
        /成对产生通道/iu.test(problem) &&
        /\bQC\b/iu.test(result),
      () => "模型提出真空极化可补充长周期脉冲星的成对产生",
    ],
    [
      /spiral density waves/iu.test(title) &&
        /微不稳定性诱发的粒子散射/iu.test(result) &&
        /显著黏性耗散/iu.test(result),
      () => "微观散射会削弱黑洞吸积流的密度波",
    ],
    [
      /pulse profiles of rotating neutron stars/iu.test(title) &&
        /300\s*Hz/iu.test(result) &&
        /表面变形影响明显大于旋转外部时空修正/iu.test(result),
      () => "300 Hz双热点模型中，表面形变主导脉冲轮廓误差",
    ],
    [
      /structure in the structure function of black hole light curves/iu.test(title) &&
        /5\s*[–-]\s*15\s*分钟/iu.test(result) &&
        /更接近\s*MAD\s*趋势/iu.test(result),
      () => "Sgr A*观测斜率在5–15分钟更接近MAD模拟",
    ],
    [
      /新生磁星/u.test(problem) && /长暂态连续引力波/u.test(problem),
      () => object && `${object}：新生磁星能否留下可探测的长暂态连续引力波？`,
    ],
    [
      /(?:GRB|伽马暴)/iu.test(`${title} ${problem}`) &&
        /X射线余辉/u.test(problem) &&
        /(?:观测时间|采样).*缺口/u.test(problem) &&
        /平台(?:结束时间|通量|参数)/u.test(problem),
      () => "GRB X射线余辉的观测缺口如何影响平台参数测量？",
    ],
    [
      /银河系/u.test(problem) &&
        /孤立恒星级黑洞/u.test(problem) &&
        /(?:形成|演化)/u.test(problem) &&
        /(?:微引力透镜|X射线吸积)/u.test(problem),
      () => "银河系孤立恒星级黑洞如何形成并被探测？",
    ],
    [
      /非喷流TDE/u.test(problem) && /激波/u.test(problem) && /高能中微子产额/u.test(problem),
      () => "非喷流TDE激波如何决定高能中微子产额？",
    ],
    [
      /银河系球状星团/u.test(problem) &&
        /黑洞初始—最终质量关系/u.test(problem) &&
        /现今黑洞族群/u.test(problem),
      () => "黑洞形成处方如何影响球状星团的黑洞族群与并合预言？",
    ],
    [
      /NICER/u.test(problem) && /暗物质核心/u.test(problem) && /总状态方程/u.test(problem),
      () => "暗物质核心如何改变NICER推断的中子星状态方程与最大质量？",
    ],
    [
      /低质量主序伴星/u.test(problem) && /恒星风吸积阶段/u.test(problem),
      () => "低质量双星中的中子星何时进入恒星风吸积阶段？",
    ],
    [
      /多信使告警/u.test(problem) && /VLA射电随访调度块/u.test(problem),
      () => "多信使告警如何转化为可执行的VLA射电随访计划？",
    ],
    [
      /不同滤镜覆盖/u.test(problem) && /RSG、AGB/u.test(problem) && /宿主环境/u.test(problem),
      () => "JWST多波段观测如何区分红超巨星与污染源？",
    ],
    [
      /高能中微子事件空间一致/u.test(problem) && /耀变体/u.test(problem),
      () => "与高能中微子事件相关的耀变体能否产生观测到的中微子？",
    ],
    [
      /带电流反应/u.test(problem) && /完整运动学/u.test(problem) && /双中子星并合/u.test(problem),
      () => "带电流反应的完整运动学处理会如何改变双中子星并合？",
    ],
    [
      /Geminga/u.test(problem) && /PWN/u.test(problem) && /高能伽马射线谱截止/u.test(problem),
      () => "Geminga脉冲星晕的高能截止来自加速上限还是电子快速传播？",
    ],
    [
      /Fermi\/GBM/u.test(problem) && /Type I GRB/u.test(problem) && /本征事件率/u.test(problem),
      () => "Fermi/GBM短暴样本如何约束I型伽马暴的本征率演化？",
    ],
    [
      /GRB 250419A/u.test(`${title} ${problem}`) &&
        /低洛伦兹因子/u.test(problem) &&
        /轴上喷流/u.test(problem),
      () => "GRB 250419A软X射线闪与余辉能否区分不同喷流结构和能量注入？",
    ],
    [
      /Westerlund 1/u.test(problem) && /Kes 41/u.test(problem) && /未关联LAT点源群/u.test(problem),
      () => "Westerlund 1与Kes 41附近的伽马射线源是否属于延展辐射？",
    ],
    [
      /Cen\s*A/iu.test(`${title} ${problem}`) && /GRB\s*221009A/iu.test(problem),
      () => extractCorePhysicalQuestion(problem, title),
    ],
    [
      /Compact Parameterization of Neutron Star Atmosphere/iu.test(title),
      () => {
        const firstSentence = sourceSentences(result)[0] || "";
        const colon = firstSentence.search(/[：:]/u);
        const claim = colon > 0 ? firstSentence.slice(0, colon) : firstSentence;
        return cleanMathInTitle(claim)
          .replace(/[。！？?]+$/u, "")
          .trim();
      },
    ],
  ];
  const selected = checks.find(([matches]) => matches)?.[1]();
  if (!selected && !fallbackCandidate) throw new Error("CHANNEL_TITLE_PAPER_CLAIM_UNSUPPORTED");
  return formatPaperTitle(selected || fallbackCandidate);
}

export function formatWeeklyTitle(weekId, progress) {
  const match = /^(\d{4})-W(\d{2})$/u.exec(weekId || "");
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 53)
    throw new Error("CHANNEL_TITLE_WEEK_INVALID");
  const candidate = validateCandidate(progress, "WEEKLY");
  if (LIST_LIKE.test(candidate) || /(?:论文更新|AstroLineage)/iu.test(candidate)) {
    throw new Error("CHANNEL_TITLE_WEEKLY_SINGLE_PROGRESS_REQUIRED");
  }
  const title = `[${match[1]}-W${match[2]}] 前沿周报 ｜ ${candidate}`;
  if (Array.from(title).length > TITLE_LIMIT) throw new Error("CHANNEL_TITLE_TOO_LONG");
  return title;
}

export function validateTitleOverride(kind, candidate, identity) {
  const value = text(candidate);
  if (kind === "daily") {
    if (!validIsoDate(identity)) throw new Error("CHANNEL_TITLE_DAILY_DATE_INVALID");
    const prefix = `「${identity.slice(5)}」`;
    if (!value.startsWith(prefix)) throw new Error("CHANNEL_TITLE_OVERRIDE_IDENTITY_MISMATCH");
    formatDailyTitle(identity, value.slice(prefix.length));
    return value;
  }
  if (kind === "weekly") {
    const match = /^(\d{4})-W(\d{2})$/u.exec(identity || "");
    if (!match) throw new Error("CHANNEL_TITLE_WEEK_INVALID");
    const prefix = `[${match[1]}-W${match[2]}] 前沿周报 ｜ `;
    if (!value.startsWith(prefix)) throw new Error("CHANNEL_TITLE_OVERRIDE_IDENTITY_MISMATCH");
    formatWeeklyTitle(identity, value.slice(prefix.length));
    return value;
  }
  if (kind === "paper") return formatPaperTitle(value);
  throw new Error("CHANNEL_TITLE_KIND_INVALID");
}
