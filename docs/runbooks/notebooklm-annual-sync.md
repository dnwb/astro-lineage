# 年度精读笔记本自动同步

`AstroLineage｜YYYY 精读日报与周报` 按年组织已发布导读。内容按月汇总为文本来源，超过 1 MB 时拆分；不是每天新建 notebook，也不是把导读冒充论文全文。日报使用公历年；周报使用 ISO 周所属年。原有研究方向笔记本不变。

## 认证与账户选择

默认使用新版 `notebooklm` skill 的 HTTP 认证配置，不再要求另一份项目浏览器状态。先做只读检查：

```bash
cd /home/long/.agents/skills/notebooklm
python scripts/run.py notebooklm auth check --test --passive
```

仅在认证缺失或失效时，在有图形显示的服务器终端手动登录：

```bash
cd /home/long/axvdaily
npm run notebooklm:login
```

该命令显式启动上游 CLI 的 Chrome 登录。默认凭据选择遵循 skill：其默认 API profile、API storage 或已有浏览器状态；显式 `NOTEBOOKLM_HOME` / `NOTEBOOKLM_PROFILE` / `NOTEBOOKLM_AUTH_JSON` 优先。需要指定独立状态文件时设置 `NOTEBOOKLM_AUTH_STATE`，它只作为上游 `--storage` 参数，不把凭据写入日志。不要提交任何凭据。同步本身只走 HTTP，失败不会自动打开浏览器或重新登录。

## 日常执行

现有 `scripts/cron-runner.sh auto` 在网页构建前记录已发布日报、周报和历史归档的来源指纹；构建后核对来源未变，才记录本轮构建 ID、导出 NotebookLM 文本。来源变化会停止本轮交付。随后通过唯一的 `--deliver` 入口各尝试一次频道日报（周五加周报）与 NotebookLM 同步，不新增定时器。QQ 主动消息保持 `waiting_permission`，runner 不发送 QQ 群简报或主动告警。导出失败时频道仍独立尝试，NotebookLM 标记 `NOTEBOOKLM_EXPORT_STALE`，不会上传上轮文本；任一目标失败时 runner 退出 1。

```bash
# 离线构建与导出，不访问 Google、不发送通知
bash scripts/cron-runner.sh build
# 离线检查待上传月份
npm run notebooklm:sync -- --dry-run
# 只重试年度 notebook，不重新抓取、分析或发布频道帖子
bash scripts/cron-runner.sh notebook
```

同步由全局锁保护，来源标题包含内容哈希。`scripts/notebooklm-http.py` 调用 skill 的上游 CLI：先核对年度 notebook 的标题与身份，再枚举来源、上传缺失文件、等待索引并验证正文。上传前用字面文本块包装原文，防止 Google 把导读中的 Markdown/TeX 当作排版标记改写；校验仍要求索引正文与原始标记、SHA256 一致，不清洗公式反斜杠或放宽证据范围。远端已上传、本地未记账时重入先核对同名来源，避免重复上传；内容不匹配或写入结果未知时明确阻塞，不盲目重试写入。每年度最多运行六分钟；超时先终止并回收 CLI 子进程，保留已确认进度，下一次继续。

上传前还会核对导出快照与实际归档 HTML 的逐页哈希；仅构建 ID 相同不足以证明 `dist/` 未被其他会话覆盖。网页变化或快照过期返回 `NOTEBOOKLM_EXPORT_STALE`，应重新执行离线 `build`，不能绕过此门槛。

本轮 HTTP 迁移不删除旧版本、用户来源或 notebook。变化的月度 bundle 会上传新版；旧版暂时保留，因此年度来源数量会随修订增加。来源配额或后续清理必须单独核验，不能用同名/标题前缀作为删除用户内容的依据。

## 状态文件

- `.cache/notebooklm/build-capture.json`：构建前已发布来源的指纹，构建后须再次核对。
- `.cache/notebooklm/website.json`：最近成功构建的时间、本轮构建 ID 和通过核对的来源绑定；不代表 NotebookLM 文本导出成功。
- `.cache/notebooklm/export.json`：离线导出文本及绑定的构建 ID；同步前必须与本轮 ID 一致。
- `.cache/notebooklm/status.json`：NotebookLM 结果、年度 URL、同步来源数及错误码。
- `.cache/notebooklm/delivery.json`：最近一轮网站、频道、NotebookLM、QQ 各自状态。
- `.cache/notebooklm/manifest.json`：年度 notebook URL 和已确认来源哈希；保留此文件以复用 notebook。

`success` 仅证明相应操作完成，不证明科学结论被独立验证；`website` 只证明构建，不证明局域网设备可访问。Google 登录失效、限流、界面变化会导致 `blocked`；不能仅凭离线测试宣称远端同步可用。旧的成功记录不代表本轮成功。当前不会自动同步已经从网站移除的归档删除；也不会为 QQ 绕过主动消息权限。

## 验证

```bash
node tests/notebooklm-sync.test.mjs
node tests/cron-runner.test.mjs
python3 tests/notebooklm-http.test.py
bash -n scripts/cron-runner.sh
```

软件测试：跨年/ISO 周、公式与证据范围、重复执行、部分失败恢复、上次成功保留、目标失败隔离、锁和进程超时。
环境验收：真实账号可创建/复用年度 notebook、上传后来源可读、更新与重入不重复、下一次 cron 的目标状态明确。只有通过这些环境验收，才可宣布无人值守同步已打通。
