# 年度精读笔记本自动同步

`AstroLineage｜YYYY 精读日报与周报` 按年组织已发布导读。内容按月汇总为文本来源，超过 1 MB 时拆分；不是每天新建 notebook，也不是把导读冒充论文全文。日报使用公历年；周报使用 ISO 周所属年。原有研究方向笔记本不变。

## 一次性认证

服务器浏览器的登录状态不同于你正在使用的浏览器。需要有图形显示的服务器终端执行：

```bash
npm run notebooklm:login
```

可见 Chrome 打开后，在五分钟内手动登录正确的 Google 账号。凭据保存在被 Git 忽略的 `.cache/notebooklm/auth.json`，目录 0700、文件 0600；不要上传或提交该文件。无桌面环境时，需要先提供可交互的显示环境，不能用“浏览器里已经登录”代替服务器认证。

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

同步由全局锁保护，来源标题包含内容哈希。远端已上传、本地未记账时重入会先核对现有来源，避免重复上传。确认新来源中哈希标记可见后，才删除同一自动生成 bundle 的旧版本；不删除 notebook 或用户来源。浏览器任务每年度最多运行六分钟；超时后保留已确认进度，下一次继续。页面变化重新构建后才进入同步，不读取构建后的可变 JSON。

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
bash -n scripts/cron-runner.sh
```

软件测试：跨年/ISO 周、公式与证据范围、重复执行、部分失败恢复、上次成功保留、目标失败隔离、锁和进程超时。
环境验收：真实账号可创建/复用年度 notebook、上传后来源可读、更新与重入不重复、下一次 cron 的目标状态明确。只有通过这些环境验收，才可宣布无人值守同步已打通。
