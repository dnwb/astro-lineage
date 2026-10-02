# Scripts 架构与核心职责索引 (Architecture & Service Topology)

本项目的所有自动化流水线、学术智能体推理、QQ 官方机器人服务及内容校验脚本均集中在 `scripts/` 目录下。

---

## 1. 学术智能体与 QQ 机器人服务 (Agent & QQ Bot)

| 脚本文件 | 核心职责 | 调用与依赖 | 对应 npm 指令 |
| :--- | :--- | :--- | :--- |
| `agent-core.mjs` | **统一学术问答中枢**：集成高能天体物理知识库（每日雷达、R1~R7 课题组主线、可见文献书目），提供多级大模型自动降级（Fallback）链与 HTTPS 安全请求控制。 | 依赖 `.env`，调用 upstream AI endpoints | 库模块 / 内部调用 |
| `qq-official-bot.mjs` | **QQ 官方机器人常驻服务**：基于 WebSocket 网关监听 QQ 频道（AT_MESSAGE）、QQ 群聊（GROUP_AT_MESSAGE）及私聊（C2C），支持 `/start`、`/whoami` 等指令与学术自动研讨。 | systemd 用户服务 `astrolineage-qq-bot.service` | `npm run bot:doctor` |
| `qq-memory.mjs` | **会话滑动记忆管理器**：提供 7 天滑动窗口（最大 10 条对话）磁盘原子存储与 TTL 懒汉淘汰，支持跨服务重启会话保留。 | 读写 `.cache/qq-bot/memory/` | 库模块 / 内部调用 |
| `qq-users.mjs` | **用户与群聊身份收录**：记录交互用户的 `user_openid` 与群聊 `group_openid`，管理提问统计与最后交互时间戳。 | 读写 `.cache/qq-bot/users.json` | 库模块 / 内部调用 |
| `qq-send.mjs` | **主动消息推送 CLI**：允许运维与定时脚本向指定 OpenID 或已记录的全部用户/群聊主动推送前沿简报与测试通知。 | 依赖 `scripts/qq-users.mjs` 与官方 Open API | `node scripts/qq-send.mjs` |
| `probe-models.mjs` | **AI 模型健康探针**：一次性探测主供应商与备用网关的所有候选模型（`gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.5` 等）的连通性、延迟与 HTTP 状态。 | 依赖 `agent-core.mjs` | `npm run bot:probe` |

---

## 2. arXiv 前沿文献与定时工作流 (arXiv Pipeline & Cron)

| 脚本文件 | 核心职责 | 触发方式 | 对应 npm 指令 |
| :--- | :--- | :--- | :--- |
| `cron-runner.sh` | **每日定时任务调度脚本**：工作日自动抓取当日 arXiv、执行 AI 深度研判、生成雷达简报与周报、更新归档并派发频道。 | systemd timer / crontab | 调度器调用 |
| `arxiv-daily.mjs` | **arXiv 每日抓取与重放**：基于 OAI/Atom API 拉取 `astro-ph.HE/GA/SR` 最新批次，生成规范化 `arxiv-daily.json`。 | CLI / `cron-runner.sh` | `npm run arxiv:refresh` / `arxiv:replay` |
| `arxiv-ai-analyzer.mjs` | **论文 AI 筛选与研读引擎**：多阶段阅读 arXiv 源码包与正文，生成 Must Read、Worth Knowing 导读卡片与阅读抓手。 | `cron-runner.sh` / 队列任务 | `npm run arxiv:analyze` |
| `daily-radar.mjs` | **每日雷达数据模型**：构建与校验每日文献雷达卡片，生成分类统计与前沿导引。 | 读写 `src/data/daily-radar.json` | 库模块 |
| `arxiv-weekly-summary.mjs`| **学术周报综合提炼**：聚合自然周批次，提炼宏观态势综述、Top Picks 与经典脉络对照。 | `cron-runner.sh` (每周五执行) | `npm run arxiv:weekly` |
| `arxiv-archive.mjs` | **历史归档管理器**：持久化沉淀每日与每周 JSON 归档，维护 `manifest.json` 索引。 | 流水线触发 | `npm run arxiv:archive` |
| `tencent-channel-publisher.mjs` | **腾讯频道图文发布器**：将每日精选与周报排版格式化为 Markdown 并发布至腾讯频道指定子版块。 | `cron-runner.sh` | CLI / 库模块 |

---

## 3. 本地内容验证与测试套件 (Content & Testing)

| 脚本/目录 | 核心职责 |
| :--- | :--- |
| `validate.mjs` / `content-validator.mjs` | 对 `content/` 中的文献（Works）、研究主线（Research Lines）、学习路径（Learning Paths）等执行离线结构与语义校验。 |
| `cleanup-test-tmp.mjs` | 在 `pretest` 和 `posttest` 阶段自动扫描并清理 `/tmp/astro-lineage-*` 孤儿测试目录，防止磁盘 Inode 耗尽。 |
| `validation/` | 校验器各个细分领域的子模块实现。 |
