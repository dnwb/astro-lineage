## Agent skills

技术文档和回复参考 `~/STE.md`
系统核心架构与规范以 `ARCHITECTURE.md` 为唯一蓝图，`docs/adr/` 为历史归档决策（日常开发无需阅读）。

对于页面 UI，严禁编写任何落地页风格的产品介绍段落（Hero Decks）；
功能标题使用最简日常词汇。

所有发布的时间一律以北京时间 UTC+8 为准。
代码审查与差异检查优先使用 `git diff --stat`，严禁对 `src/data/` 等大规模数据目录运行无约束的裸 `git diff`。
部署拓扑：校园网预览服务 (`astrolineage-web.service`, `:4321`) 运行在 `/home/long/astro-lineage-cron` (`master`)；在 `/home/long/astro-lineage` 构建后需同步至 `astro-lineage-cron` 方可在 `:4321` 预览生效。

### Architecture blueprint

see `ARCHITECTURE.md`

### Architecture & Hygiene Guardrails

- 零测试泄漏：任何生成文件或 PDF 的脚本/函数必须支持目标目录注入；测试必须使用沙盒工作区并在 `t.after` 清除，严禁在 `public/` 等工作区遗留未跟踪文件。
- 数学排版统一收敛：数学公式渲染（KaTeX/Markdown）的唯一真实源（SSOT）是 `src/domain/scientific-text/`，外部脚本与页面严禁直接 `import katex`。
- 领域模型单向流动：严禁在 `scripts/` 中二次 re-export 领域函数；调用方一律直接从 `src/domain/` 引用。
- 路由功能对齐：聚合首页/列表页展示最新一期时，核心交互（如 PDF 下载）与文案格式必须与单期详情页保持对齐。
- 模块独立与脚本规范：`scripts/` 核心模块严禁嵌入未声明的离线批处理 `main()` 入口，公共能力仅通过 export 暴露；独立 CLI 脚本必须以 `-cli.mjs`、`cli.mjs` 结尾或在 `package.json` 注册执行命令。
- 审查契约动态提取：执行代码审查时，Spec Reviewer 必须动态从当前会话提取真实需求，严禁继承过往历史会话的过期 spec 上下文。
- 元数据格式化单源（SSOT）：学术作者列表、日期显示等元数据展示格式必须统一引用 `src/domain/academic-domain.mjs` 中的纯函数（如 `formatAuthorList`），严禁在 `.astro` 等组件内部编写内联字符串截断与拼接。
- 实施测试轻量化：单票/单功能实施与 TDD 循环中，严禁运行全量测试套件（如 `npm test` 或 `verify`）；仅允许针对当前改动相关的单一测试文件（如 `node --test tests/xxx.test.mjs`）或轻量套件（`npm run test:fast`）建立紧密反馈循环；全量测试仅在集成分支合流或集成审查前由主编排 Agent 统一执行一次。

### Agent context policy.md

see docs/agent-context-policy.md

### Issue tracker

Issues and specs use GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five canonical label names. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.

<!-- TRELLIS:START -->

# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:

- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
