# Implementation Plan: 稳健双阶段发布、周一学术周报群广播与全历史归档补齐

## Execution Steps

### Step 1: 调度器与发布器代码改造

1. 修改 `scripts/arxiv-daily-scheduler.mjs`：
   - 增加 `--reconcile-previous` 选项与 `reconcilePreviousEdition`。
   - 增加连续区间断言 `assertContinuousBatchIntervals`。
   - 维护 `status: "provisional"` 与 `status: "final"`。
2. 修改 `scripts/tencent-channel-publisher.mjs` 与 `scripts/notebooklm-sync.mjs`：
   - 支持 `mustReadOnly` 过滤选项，预运行阶段仅发布必读单篇。
3. 修改 `scripts/cron-runner.sh` 与 crontab：
   - 增加 `group-weekly` 和 `reconcile`。
   - 配置周一 08:00 与次日 02:00。
4. 修改 `scripts/bot-commands.mjs`：
   - 改造 `/today` 支持动态回退直读运行时 `daily-radar.json` + `arxiv-daily.json`。

### Step 2: 测试驱动与自动化验证

1. 编写与运行单元测试验证调度器增量重试与断言。
2. 运行 `node --test tests/arxiv-scheduler.test.mjs tests/bot-commands.test.mjs tests/qq-publication-notify.test.mjs tests/tencent-channel-publisher.test.mjs`。

### Step 3: 补齐今日 10-08 数据 (包含 2610.12359)

1. 抓取 2026-10-08 剩余 30 篇论文并合并至 `src/data/arxiv-daily.json` 与归档。
2. 运行 AI 研判生成分析结果，写入 `src/data/daily-radar.json`。
3. 更新 `src/data/arxiv-weekly.json` 与 `2026-W41.json`。

### Step 4: 全历史归档审查与全站构建

1. 运行审计检查 24 个历史归档。
2. 检查 10-06 与 10-07 零必读论文。
3. 执行 `npm run build`，同步网页与频道。
