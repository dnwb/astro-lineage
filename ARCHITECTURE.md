# AstroLineage 架构与系统蓝图 (Architecture Blueprint)

> **版本**：v1.0 (2026-10)  
> **语言与规范**：参考 `~/STE.md`，所有时间发布一律以北京时间（UTC+8）为准。  
> **对外访问地址**：`http://10.131.43.83:4321`（严禁输出 192 内网路由器 IP）。  
> **AI 开发须知**：`docs/adr/` 为历史决策归档，**日常开发严禁全量读取 ADR 目录**；系统架构与契约以本文件为唯一顶层蓝图。

---

## 1. 系统边界与双生命周期模型 (Dual-Lifecycle Architecture)

本项目由两个生命周期与演进节奏截然不同的子系统构成，在工程与物理存储上严格物理隔离：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   AstroLineage 知识与自动化体系                          │
└────────────────────────────────────────────────────────────────────────┘
          │                                              │
          ▼ 慢变系统（强校验、人工把关）                       ▼ 快变系统（定时自动化、高容错）
┌──────────────────────────────────┐           ┌──────────────────────────────────┐
│ 静态学术图谱与站点 (Content/Web)   │           │ 运营与自动化管线 (Ops Pipeline)    │
│  - content/works/ (文献脉络)     │           │  - scripts/ (arXiv 抓取/分诊/研读)│
│  - content/ontology/ (物理本体)   │           │  - scripts/arxiv-figures (插图)   │
│  - content/scientific-edges/     │           │  - scripts/qq-* (QQ 机器人)       │
│  - src/pages/ & src/components/  │           │  - scripts/tencent-channel-*      │
│  - Astro 静态构建 (npm run build) │           │  - scripts/cron-runner.sh (调度)  │
└──────────────────────────────────┘           └──────────────────────────────────┘
                 ▲                                              ▲
                 │                     共享领域层                │
                 └───────────────┬──────────────────────────────┘
                                 │
                 ┌────────────────────────────────┐
                 │ 统一核心领域层 (Domain SSOT)    │
                 │  - src/domain/scientific-text/ │
                 │  - src/domain/scientific-claim │
                 │  - scripts/notification-egress │
                 └────────────────────────────────┘
```

### 1.1 慢变系统：学术脉络知识图谱 (Core Academic Lineage)

- **职责**：高能天体物理爆发（GRB、SLSN、FBOT、FRB、磁星、双致密星并合等）学术论文脉络图谱。
- **存储**：`content/works/`、`content/ontology/`、`content/scientific-edges/`。
- **校验门禁**：`npm run validate`，严格保证图谱引用完整性与物理概念连续性。
- **渲染端**：Astro 6 纯静态构建，编译为 90+ 静态页面。

### 1.2 快变系统：每日追踪与多端推送 (Automated Ops Pipeline)

- **职责**：每日自动拉取 arXiv `astro-ph.HE/GA/SR` 最新公布文献，执行二阶段 AI 分诊与研读，提取高清矢量插图，发布到腾讯频道与 QQ 学术交流群。
- **调度**：`scripts/cron-runner.sh` 定时执行（每日 18:00 / 02:00 等北京时间窗口）。
- **状态物理隔离**：
  - 动态运行时状态保存在 `.local-state/`（如 `.local-state/tencent-bot-state.json`），受 `.gitignore` 保护，**严禁提交入 Git**。
  - 沉淀的不可变快照与归档数据存放于 `src/data/arxiv-archives/`（每日归档每文件约 200~400KB）。
  - `src/data/daily-radar.json` 为当天活跃窗口快照（严格控制在 2,500 行 / 100KB 以内，杜绝无界历史累积）。

---

## 2. 核心领域模块单点真理源 (Domain SSOT)

为避免面条化脚本与跨文件规则漂移，以下核心能力收拢在唯一的领域模块中：

| 领域能力           | 唯一真理源模块                          | 职责与保证                                                                                                                                                                                       |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **科学文本与公式** | `src/domain/scientific-text/index.mjs`  | 状态机分词、KaTeX 静态 HTML 渲染、天体物理作者宏表（`\Msun`, `\MBH`, `\teff`, `\lpisl`, `\bb` 等）、以及向 QQ 频道/Bot 降级的 Unicode 纯文本渲染。`scripts/reader-math.mjs` 必须全面委托本模块。 |
| **科学命题主标题** | `src/domain/scientific-claim-title.mjs` | 清洗提炼论文核心物理问题/突破命题，防止长公式截断、括号失配、破折号截断与多余标点。                                                                                                              |
| **消息多端外发**   | `scripts/notification-egress.mjs`       | 统一管理 QQ 官方机器人、群广播、腾讯频道通知出口，支持多群轮询与 OpenID 脱敏安全。                                                                                                               |
| **插图提取与评估** | `scripts/arxiv-figures.mjs`             | 从 arXiv HTML5/ar5iv 提取候选插图，过滤软件流程图等无关图，筛选物理模型与核心光变图。                                                                                                            |

---

## 3. 核心目录规范 (Directory Layout)

```text
/home/long/axvdaily/
├── content/                     # 核心学术图谱（Works / Ontology / Edges）
├── src/
│   ├── components/              # 前端 UI 组件（严禁落地页风格 Hero Decks）
│   ├── data/                    # 静态真理源与已归档学术数据
│   │   ├── arxiv-archives/      # 历史每日归档（daily/）与周报（weekly/）
│   │   ├── arxiv-daily.json     # 当前批次抓取的原始 arXiv 列表
│   │   ├── daily-radar.json     # 当前活跃批次的 AI 研读雷达数据（轻量化）
│   │   └── scientific-events.json
│   ├── domain/                  # 核心领域层（数学/文本/标题规则）
│   └── pages/                   # Astro 静态路由页面
├── scripts/                     # 自动化管线脚本
│   ├── cron-runner.sh           # 定时任务统一外层调度器
│   ├── arxiv-ai-analyzer.mjs    # AI 二阶段分诊与研读主控
│   ├── arxiv-archive.mjs        # 每日与每周归档同步引擎
│   ├── tencent-channel-bot.mjs  # 腾讯频道机器人
│   └── qq-official-bot.mjs      # QQ 官方群机器人服务
├── tests/                       # 测试套件（保持 100% 绿灯）
└── .local-state/                # (Git Ignored) 本地运行时状态、缓存与会话
```

---

## 4. 验证门禁与日常工作流 (Verification Gates)

任何修改提交前必须依次满足以下门禁：

1. **快速测试门禁**：
   ```bash
   npm run test:fast
   ```
   耗时约 2 秒，覆盖核心领域逻辑、标题策略、公式渲染、频道发帖、机器人指令以及**归档与周报一致性诊断（Consistency Diagnostics）**。
2. **统一 CLI 校验门禁**：
   ```bash
   node scripts/cli.mjs validate
   ```
   集成执行学术图谱引用校验（41+ Works 校验）与全量归档/周报/雷达一致性诊断（覆盖 25+ 每日归档、全部周报、顶尖精读 top_picks 引用完整性与文件体积预算）。
3. **知识图谱与静态构建验证**：
   ```bash
   npm run build
   ```
   执行 `scripts/validate.mjs` 校验学术图谱，并由 Astro 构建全站静态 HTML（90+ 页面全绿）。
4. **安全与 Git 卫生规范**：
   - 差异审查**优先使用 `git diff --stat`**，严禁对 `src/data/` 目录运行无约束的裸 `git diff`，避免 Token 与上下文被海量数据污染。
   - 绝不硬编码内网 192 IP，统一使用 `10.131.43.83:4321`。
   - 绝不把临时状态写入 `src/data/`，运行时状态仅限 `.local-state/`。
