# PRD: arXiv 每日与每周定时更新调度设计

## Goal

设计并交付高可用、符合天文学术发文周期的**每日 arXiv 导读与每周学术脉络定时更新系统**，支持本地 Linux (Systemd Timer / Crontab) 与云端 (GitHub Actions) 双模部署。

## arXiv 发文与调度时刻表设计

- **官方结算周期**：美东时间 (America/New_York) 14:00 截稿，20:00 正式发布公告。
- **发文工作日**：周日至周四晚间公告（周五、周六无发文，周日无提交递延至周一批次）。
- **调度时刻**：
  1. **每日导读 (Daily Radar)**：
     - 美东时间：周日至周四 20:30:00（`Sun..Thu 20:30:00 America/New_York`）。
     - 北京时间：周一至周五 08:30:00（夏令时）/ 09:30:00（冬令时）。
     - 策略：配置 15 分钟随机抖动（`RandomizedDelaySec=15m`），避免瞬时冲击 arXiv API；幂等性检查防止重复抓取。
  2. **每周脉络 (Weekly Synthesis)**：
     - 执行时刻：每周五上午（美东时间周五 09:00，北京时间周五 21:00，或当周最后一批公告归档后）。
     - 策略：聚合当周全部每日批次（周一至周四），调用 LLM 生成宏观学术脉络、核心因果专题与 Top Picks 推荐。

## Deliverables

1. **调度脚本增强 (`scripts/arxiv-daily-scheduler.mjs`)**：
   - 增加 `--auto-weekly` 选项：当检测到当前批次为当周最后一个公告日（周四批次）时自动触发周报生成。
   - 自动加载项目根目录 `.env`（若存在），确保 API Key 在后台定时任务中不丢失。
2. **Systemd User Units (`deploy/systemd/`)**：
   - 保留原 `astrolineage-arxiv-daily.service` 和 `.timer`（严格遵守现有测试断言不变式）。
   - 新增 `astrolineage-arxiv-weekly.service` 和 `astrolineage-arxiv-weekly.timer`。
   - 新增 `deploy/systemd/install.sh` 一键安装/卸载脚本。
3. **Linux Crontab 模板 (`deploy/crontab/crontab.example`)**：
   - 提供基于北京时间（Asia/Shanghai）与 UTC 两个版本的精简 crontab 配置。
4. **GitHub Actions 定时工作流 (`.github/workflows/arxiv-scheduled-sync.yml`)**：
   - 提供无服务器环境下的云端定时更新与自动同步。
5. **详细运维文档 (`docs/scheduled-tasks-guide.md`)**：
   - 包含原理、架构图、环境配置、测试命令及常见排查手册。

## Acceptance Criteria

- [ ] `deploy/systemd/` 包含每日与每周的双 timer/service。
- [ ] `tests/arxiv-scheduler.test.mjs` 测试 100% 通过。
- [ ] 全套自动化验证 `npm run verify` 全部通过。
- [ ] 具备完备且可操作的文档。
