#!/usr/bin/env bash
set -euo pipefail

# AstroLineage Systemd User Timers Installer
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== 安装 AstroLineage arXiv 定时调度任务 ==="
mkdir -p "${SYSTEMD_USER_DIR}"

# 复制 Unit 文件
cp -v "${SCRIPT_DIR}"/astrolineage-arxiv-daily.service "${SYSTEMD_USER_DIR}/"
cp -v "${SCRIPT_DIR}"/astrolineage-arxiv-daily.timer "${SYSTEMD_USER_DIR}/"
cp -v "${SCRIPT_DIR}"/astrolineage-arxiv-weekly.service "${SYSTEMD_USER_DIR}/"
cp -v "${SCRIPT_DIR}"/astrolineage-arxiv-weekly.timer "${SYSTEMD_USER_DIR}/"

# 重载并启动
echo "-> 重新加载 systemd 用户守护进程..."
systemctl --user daemon-reload

echo "-> 启用并启动 Daily 与 Weekly 定时器..."
systemctl --user enable --now astrolineage-arxiv-daily.timer
systemctl --user enable --now astrolineage-arxiv-weekly.timer

echo ""
echo "=== 当前定时器状态 ==="
systemctl --user list-timers --all | grep -E 'astrolineage|NEXT' || true

echo ""
echo "✓ 安装完成！"
echo "  - 查看运行日志: journalctl --user -u astrolineage-arxiv-daily.service -f"
echo "  - 手动触发一次每日任务: systemctl --user start astrolineage-arxiv-daily.service"
echo "  - 手动触发一次周报任务: systemctl --user start astrolineage-arxiv-weekly.service"
