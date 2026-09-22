# AstroLineage arXiv 定时抓取与研判调度指南

本文档介绍 AstroLineage 中关于 **每日导读 (Daily Radar)** 与 **每周脉络 (Weekly Synthesis)** 的自动化定时任务架构、触发时序、部署配置及运维排查指南。

---

## 1. arXiv 官方发文周期与调度时序

arXiv 的高能天体物理与星系天体物理（`astro-ph.HE` / `astro-ph.GA`）遵循固定的发文与截稿结算窗口：

* **官方结算时区**：美东时间（`America/New_York`，夏令时 EDT 为 UTC-4，冬令时 EST 为 UTC-5）。
* **每日截稿时间**：美东时间 **14:00**（此时段前提交的论文归入当日公告批次）。
* **每日发布时间**：美东时间 **20:00**（周日至周四晚发布，周五与周六官方不发文）。

### 🕒 时区换算与调度时刻对照表

| 批次类型 | arXiv 发文周期 (美东) | 建议调度时刻 (美东) | 对应北京时间 (CST, UTC+8) | 对应协调世界时 (UTC) |
| :--- | :--- | :--- | :--- | :--- |
| **周一批次** | 周日 20:00 (含周末积压) | **周日 20:30** | **周一 08:30**（夏令时） | 周一 00:30 |
| **周二批次** | 周一 20:00 | **周一 20:30** | **周二 08:30** | 周二 00:30 |
| **周三批次** | 周二 20:00 | **周二 20:30** | **周三 08:30** | 周三 00:30 |
| **周四批次** | 周三 20:00 | **周三 20:30** | **周四 08:30** | 周四 00:30 |
| **周五批次** | 周四 20:00 (当周最后批次)| **周四 20:30** | **周五 08:30** | 周五 00:30 |
| **学术周报** | 聚合当周全部已研判论文 | **周五 09:00** | **周五 21:00**（或周五上午）| 周五 13:00 |

---

## 2. 调度系统的核心健壮性设计

1. **幂等性保障 (Idempotent Execution)**
   - 调度器记录 `run-state.json` 与已有批次指纹。如果当前批次已被成功抓取并生成导读，再次执行会自动 `skipped: already-processed`，杜绝重复消耗模型 Token。
2. **随机抖动与防限流 (Jitter & Rate-limit Friendly)**
   - Systemd Timer 默认配置了 `RandomizedDelaySec=15m`（15 分钟随机延迟），避免在整点瞬时集中向 arXiv API 发起请求而被封禁 IP。
3. **容错与断点流转**
   - 单篇论文分析失败或超时会自动降级为 `pending_analysis`，不会导致全批次崩溃；已分析条目在下轮运行会自动复用缓存。
4. **环境变量自动发现**
   - 脚本底层支持 Node.js 22 原生 `.env` 自动装载，无论从 crontab 还是 systemd 运行，只要根目录存在 `.env` 即可自动读取 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `AI_MODEL`。

---

## 3. 三种部署与调度方式

### 方案一：Systemd User Timer（本地 Linux / 服务器首选推荐）

适合在长开机的 Linux 工作站、树莓派或 VPS 云服务器上运行，具备持久化计时器与故障重启功能。

#### 1. 一键安装并启用
```bash
./deploy/systemd/install.sh
```

#### 2. 手动查看定时器状态
```bash
systemctl --user list-timers --all | grep astrolineage
```
输出示例：
```text
NEXT                         LEFT          LAST                         PASSED  UNIT                             ACTIVATES
Wed 2026-09-23 08:30:00 CST  19h left      Tue 2026-09-22 08:30:00 CST  4h ago  astrolineage-arxiv-daily.timer   astrolineage-arxiv-daily.service
Fri 2026-09-25 21:00:00 CST  2 days left   -                            -       astrolineage-arxiv-weekly.timer  astrolineage-arxiv-weekly.service
```

#### 3. 运维与日志查看
```bash
# 查看每日抓取服务实时日志
journalctl --user -u astrolineage-arxiv-daily.service -f

# 查看周报服务日志
journalctl --user -u astrolineage-arxiv-weekly.service -n 50

# 手动立即触发一次测试执行
systemctl --user start astrolineage-arxiv-daily.service
```

---

### 方案二：Linux Crontab 调度（轻量免 root 方案）

适合习惯使用传统 crontab 的服务器环境。

1. 打开 crontab 编辑器：
   ```bash
   crontab -e
   ```
2. 参考 [`deploy/crontab/crontab.example`](file:///home/long/axvdaily/deploy/crontab/crontab.example) 添加如下任务条目：

   ```bash
   PROJECT_DIR=/home/long/axvdaily
   
   # 周一至周五上午 08:30 自动执行每日导读更新与分析
   30 8 * * 1-5 cd $PROJECT_DIR && /usr/bin/env node scripts/arxiv-daily-scheduler.mjs >> /tmp/arxiv-daily.log 2>&1
   
   # 每周五上午 09:30 自动执行每周学术脉络总结
   30 9 * * 5 cd $PROJECT_DIR && /usr/bin/env node scripts/arxiv-weekly-summary.mjs >> /tmp/arxiv-weekly.log 2>&1
   ```

---

### 方案三：GitHub Actions 云端定时工作流（全托管免运维）

若项目托管在 GitHub 上，可通过已创建的 [`.github/workflows/arxiv-scheduled-sync.yml`](file:///home/long/axvdaily/.github/workflows/arxiv-scheduled-sync.yml) 实现无服务器全自动运行：

1. **配置 GitHub Secrets**：
   在 GitHub 仓库设置中（`Settings -> Secrets and variables -> Actions`）添加：
   - `OPENAI_API_KEY`（或 `WU_API_KEY`）
   - `OPENAI_BASE_URL`（默认为 `https://api.ccnulaowu.online/v1`）
2. **自动化流程**：
   - GitHub Actions 将于每周一至周五 00:45 UTC 自动运行；
   - 自动拉取当日 arXiv 数据并调用 LLM 分析；
   - 周五自动触发周报综述；
   - 执行测试与静态编译，并将更新数据自动提交并推送到仓库主分支。

---

## 4. 常用手动触发命令备忘

在终端可随时通过 npm 脚本或 node 脚本手动执行任务：

```bash
# 1. 自动根据当前时间刷新最新批次（带幂等检查）
npm run arxiv:schedule

# 2. 刷新最新批次并在当周最后一天自动生成周报
node scripts/arxiv-daily-scheduler.mjs --auto-weekly

# 3. 指定补全某一特定历史日期的批次
node scripts/arxiv-daily-scheduler.mjs --date=2026-09-17

# 4. 立即针对当前数据重新生成本周周报
npm run arxiv:weekly

# 5. 重新扫描所有归档并更新全站归档目录 manifest.json
npm run arxiv:archive

# 6. 重新编译生成全站静态页面
npm run build
```
