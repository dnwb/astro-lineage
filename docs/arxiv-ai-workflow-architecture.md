# AstroLineage arXiv AI 定时自动总结分析工作流架构说明

> **文档状态**：已确立架构规范（Normative Architecture Specification）  
> **关联模块**：`scripts/arxiv-daily-scheduler.mjs`、`scripts/arxiv-daily.mjs`、`scripts/arxiv-ai-analyzer.mjs`、`scripts/daily-radar.mjs`、`src/pages/arxiv-daily/index.astro`

---

## 1. 背景与问题定义

### 1.1 现状与痛点
1. **抓取与展示脱节**：项目已具备从 arXiv 官方 API 定时拉取最新论文批次（例如每次 50+ 篇）的能力，并存储在 `src/data/arxiv-daily.json`。
2. **“空截面”现象**：现有前端 Daily Radar（每日雷达）页面仅展示具有专家级结构化导读（`analyses`）的精选文章；所有新抓取但未经分析的条目默认被标记为 `pending`（待分析），并被折叠在底部的调试框内，导致用户每次定时拉取后打开页面呈现为空态。
3. **缺乏自动化学术评估**：人工撰写高能天体物理论文导读成本高、时效慢，急需引入大语言模型（LLM）进行自动化结构化提炼与优先级分流。

### 1.2 架构目标
* **端到端闭环**：实现 `定时抓取 -> AI 增量分析与分类 -> 结构化数据校验 -> 前端自动渲染` 的全自动流程。
* **严格科研边界**：保持 AstroLineage 一贯的证据链与科研严谨性，明确标注来源与指纹，区分摘要级分析（`abstract_only`）与全文分析（`full_body`）。
* **高性价比与稳定性**：接入 `ccnulaowu` 提供的 OpenAI 兼容接口（支持 `Deepseek-V4.1-Flash` 与 `gpt-5.5`），内置并发控制、指数退避重试和增量指纹跳过。

---

## 2. 总体架构与数据流图

```text
[ 定时触发层 (Systemd Timer / CLI) ]
             │ (Sun-Thu 20:30 EST)
             ▼
[ 定时调度层 (scripts/arxiv-daily-scheduler.mjs) ]
             │ (计算批次、检查上次抓取状态)
             ▼
[ 数据抓取与归档层 (scripts/arxiv-daily.mjs) ]
             │ (拉取 Atom API，写入 raw 快照到 .cache/arxiv-daily/)
             ▼ 产出 src/data/arxiv-daily.json
[ AI 自动总结分析引擎 (scripts/arxiv-ai-analyzer.mjs) ]
             │
             ├── 1. 增量筛选：比对已分析条目指纹，过滤已处理论文
             ├── 2. 并发调用池 (3-5 req/s) 访问 ccnulaowu API
             │      (Deepseek-V4.1-Flash / gpt-5.5)
             ├── 3. 阶段 A：学术优先级评估 (must_read / worth_knowing / skip)
             ├── 4. 阶段 B：科研要素提取 (result, problem, method, limits, assumptions)
             └── 5. 阶段 C：全局开篇导读生成 (Opening Brief)
             │
             ▼
[ 校验与数据装配层 (scripts/daily-radar.mjs) ]
             │ (执行 reconcile & validate，生成版本指纹)
             ▼ 写入 src/data/daily-radar.json
[ 前端展现层 (src/pages/arxiv-daily/index.astro) ]
             │
             ▼ 立即渲染“今天先读”、“值得知道”、“快速浏览”丰富卡片
```

---

## 3. 核心组件与职责划分

| 模块文件 | 核心职责 | 关键输入与输出 |
| :--- | :--- | :--- |
| `scripts/arxiv-daily-scheduler.mjs` | 定时调度、时区计算、发榜窗口判定、自动化全链路编排 | 检查上次运行状态；编排触发抓取与 AI 分析 |
| `scripts/arxiv-daily.mjs` | arXiv API 交互、分页抓取、Rate Limit、原始快照归档 | 输出规范的 `arxiv-daily.json` 及快照文件 |
| `scripts/arxiv-ai-analyzer.mjs` | **[核心新增]** 增量筛选、并发调度、Prompt 组装、JSON 清洗与结构化分析 | 读取未分析论文，调用 LLM，生成符合雷达规范的分析记录 |
| `scripts/daily-radar.mjs` | 雷达领域模型校验、版本指纹核验（Fingerprint）、历史分析流转 | 校验并装配输出 `daily-radar.json` |
| `src/pages/arxiv-daily/index.astro` | Astro 页面组件，负责双语科研导读卡片、分类折叠与交互渲染 | 将雷达分析直观呈现给组内研究人员 |

---

## 4. API 规范与通讯协议

* **协议标准**：OpenAI 兼容 RESTful API（`POST /v1/chat/completions`）
* **接口基址 (Base URL)**：`https://api.ccnulaowu.online/v1`（通过环境变量 `OPENAI_BASE_URL` 或 `CCNU_API_BASE` 读取）
* **鉴权密钥 (API Key)**：通过 `$WU_API_KEY`（回退 `$OPENAI_API_KEY`）传递 `Authorization: Bearer <KEY>`
* **模型选择**：
  * **主选推荐**：`Deepseek-V4.1-Flash`（极速响应、长上下文理解力强、JSON 结构遵循度极佳、低 Token 成本）
  * **备选支持**：`gpt-5.5`（可在命令行参数或环境变量配置一键切换）

---

## 5. 结构化 Prompt 与输出 Schema 规范

### 5.1 单篇论文导读输出契约 (JSON)
为了与 AstroLineage 的 `daily-radar.mjs` 数据模型完全兼容，大模型单篇分析返回如下结构化 JSON：

```json
{
  "priority": "must_read | worth_knowing | skip",
  "reason": "推荐理由：说明为何该论文属于此优先级，以及与高能天体物理/瞬变源研究的关系（中文 1-2 句）",
  "result": "核心发现：论文得出的主要观测或理论结果（中文 1-2 句）",
  "problem": "核心问题：论文致力于解决的具体物理或观测疑难（中文 1-2 句）",
  "method": "研究方法：所用观测设备、数据拟合模型或数值模拟代码（中文 1-2 句）",
  "reading_entry": "阅读切入建议：建议读者从哪个章节、核心公式或关键图表切入（中文 1 句）",
  "assumptions": [
    "关键物理或模型假设 1",
    "关键物理或模型假设 2"
  ],
  "limits": [
    "结论所受参数区间或简化假设的限制 1",
    "结论所受参数区间或简化假设的限制 2"
  ],
  "research_progress": "相对同类工作的增量价值（中文 1 句）"
}
```

### 5.2 全局开篇导读 (Opening Brief) 契约
在处理完当批次所有重点论文后，触发一次全局提炼，生成当日开篇导读：
* `intro`：今日发榜整体科学脉络速览（1-2 段中文）。
* `worth_knowing_summary`：“值得知道”组别的一句话串联概括。
* `skim_summary`：“快速浏览”组别的一句话概括。

---

## 6. 健壮性与防失效设计

1. **增量跳过与幂等性 (Fingerprint Cache)**：
   * 严格校验 `sourceFingerprint(entry) === sha256(title + abstract + authors + ...)`;
   * 已存在匹配指纹的论文绝不重复发送 API 请求，节省调用额度。
2. **并发池限流 (Concurrency Control)**：
   * 默认设定并发上限为 3~5 个 Worker，防止触发上游网关的 429 请求频率限制。
3. **指数退避重试 (Exponential Backoff)**：
   * 遭遇网络波动、超时或 429/5xx 错误时，按照 1s, 2s, 4s 间隔最多重试 3 次。
4. **Markdown 格式防御与容错修复**：
   * 自动过滤模型返回中可能夹带的 ` ```json ` 或前后多余文本，确保 `JSON.parse` 绝对安全。
5. **降级保障**：
   * 若某篇论文分析失败，仅该条目保持 `pending` 或标记失败，不阻断整批其他条目的发布，确保系统高可用。

---

## 7. CLI 与操作工作流

### 7.1 手动按需触发
```bash
# 对当前已抓取的未分析条目执行 AI 总结分析
npm run arxiv:analyze

# 指定分析模型与并发度
node scripts/arxiv-ai-analyzer.mjs --model=Deepseek-V4.1-Flash --concurrency=4
```

### 7.2 定时自动串联
在 `scripts/arxiv-daily-scheduler.mjs` 中接入 AI 分析阶段：
```bash
npm run arxiv:schedule
```
执行链路：`计算批次 -> 抓取最新元数据 -> 自动触发 AI 分析 -> 更新 Daily Radar -> 发布静态数据`。

### 7.3 每周学术脉络总结
```bash
# 生成本周学术脉络综述、专题分类与精选必读
npm run arxiv:weekly

# 在调度器中附带生成周报
node scripts/arxiv-daily-scheduler.mjs --weekly
```

---

## 8. 每周总结系统架构 (Weekly Synthesis)

1. **宏观脉络聚合与因果动力学建模**：
   * 收集本周 Daily Radar 的全部已分析论文（Must Read、Worth Knowing、Skim）；
   * 通过 `scripts/arxiv-weekly-summary.mjs` 提取精读与值得注意的论文要点，调用高能天体物理系统 Prompt；
   * 生成包含**宏观学术脉络综述 (Executive Summary)**、**前沿专题动态 (Thematic Highlights)**、**精选重点必读 (Weekly Top Picks)** 与**统计分析**的结构化周报。
2. **数据落盘与历史归档**：
   * 生产数据输出至 `src/data/arxiv-weekly.json`；
   * 历史周期自动归档至 `.cache/arxiv-weekly/archives/{YYYY-Www}.json`。
3. **前端渲染与无缝互联**：
   * 页面路由：`/arxiv-weekly/`（`src/pages/arxiv-weekly/index.astro`）；
   * 全站主导航（`SiteNav.astro`）以及每日雷达顶部均设置互联入口；
   * 所有关联论文均提供精确带版本号的 `arXiv:xxxx.yyyyy` 超链接。

