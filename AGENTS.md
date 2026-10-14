## Agent skills

技术文档和回复参考 `~/STE.md`
系统核心架构与规范以 `ARCHITECTURE.md` 为唯一蓝图，`docs/adr/` 为历史归档决策（日常开发无需阅读）。

对于页面 UI，严禁编写任何落地页风格的产品介绍段落（Hero Decks）；
功能标题使用最简日常词汇。

所有发布的时间一律以北京时间 UTC+8 为准。
代码审查与差异检查优先使用 `git diff --stat`，严禁对 `src/data/` 等大规模数据目录运行无约束的裸 `git diff`。

### Architecture blueprint

see `ARCHITECTURE.md`

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
