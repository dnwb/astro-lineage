# 稳健双阶段发布、周一学术周报群广播与全历史归档补齐

## Goal

为杜绝因 arXiv 官方 API 分批索引延迟（Indexing Lag）导致当天论文遗漏（如 `2610.12359`），并构建稳定高效的学术分发管道，实施双阶段发布与兜底策略、周一上午 8 点群周报主动广播、QQ 机器人 `/today` 动态对齐最新 SSOT，以及历史全归档审查与补齐。

## Requirements

1. **双阶段发布机制 (UTC+8)**:
   - **阶段一 (每日 10:00 预运行)**:
     - 抓取当期批次并热更新 Astro 网页；
     - 遇到 `must_read` 单篇论文，AI 研判完成后**即时向 QQ 频道发帖讨论**；
     - **禁止向 QQ 频道发布整期日报总帖（Daily Brief）和周报帖**；
     - 禁止向 QQ 群主动广播；
     - 调度账本标记为 `provisional` 预备态。
   - **阶段二 (次日 02:00 兜底扫描)**:
     - 对前一日任务执行 `--reconcile-previous` 重新扫描探测与对账；
     - 若上游增量释放新论文，合并抓取并执行 AI 雷达研判；
     - 清空失败分析队列（Durable Retry Queue），标记账本为 `final` 封板；
     - 执行连续区间断言检查（No-Gap Assertion，时间无缝、无异常大空洞、论文数基线正常）；
     - 发布 QQ 频道正式整期日报导读总帖（`daily-summary:${date}`）；
     - 若为周五批次次日（周六 02:00），生成并封板最终周报。
2. **QQ 群周报定时广播**:
   - 定在**每周一上午 08:00 (北京时间 UTC+8)**；
   - 自动向已授权 QQ 群广播**前一周**（Previous Academic Week）的学术周报。
3. **QQ 机器人交互动态实时对齐**:
   - 响应 `/today`、`今日导读` 时，优先读取最新的运行时数据（`daily-radar.json` 和 `arxiv-daily.json`）；
   - 即使处于预运行阶段或无 `website.json`，也能即时呈现刚研判出的 `must_read` 核心突破与证据链卡片。
4. **全历史归档审查与补齐**:
   - 补齐 `2026-10-08` 遗漏的 30 篇论文（包含千新星重要论文 `2610.12359`）；
   - 更新今日归档与 `2026-W41` 周报；
   - 审查 24 个历史 Daily 归档与 5 期周报，修复周五空缺；
   - 全量重新构建静态站点并同步频道。

## Acceptance Criteria

- [ ] `scripts/arxiv-daily-scheduler.mjs` 支持 `--reconcile-previous` 增量对账与 No-Gap 连续区间断言。
- [ ] `scripts/tencent-channel-publisher.mjs` 支持在预运行阶段仅发布 `must_read` 单篇，跳过整期导读总帖。
- [ ] `scripts/cron-runner.sh` 增加 `group-weekly` 与 `reconcile` 任务入口，crontab 配置周一 08:00 广播和次日 02:00 兜底。
- [ ] `scripts/bot-commands.mjs` `/today` 命令实现与最新 SSOT 毫秒级动态对齐。
- [ ] `2610.12359` 等 30 篇论文成功合并入库并完成研判，`2026-W41` 周报更新。
- [ ] 历史 24 个归档与 5 期周报完成全量审查，无时间裂缝。
- [ ] 自动化测试全部通过，全站 `npm run build` 成功。
