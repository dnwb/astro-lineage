#!/usr/bin/env bash
set -euo pipefail

# AstroLineage Systemd User Timers Installer
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_ROOT="${TARGET_ROOT:-/home/long/astro-lineage-cron}"

echo "=== 安装 AstroLineage arXiv 定时调度任务 ==="
echo "-> 目标生产工作区: ${TARGET_ROOT}"
mkdir -p "${SYSTEMD_USER_DIR}"

# 复制 Unit 文件并动态对齐生产目录
for unit in "${SCRIPT_DIR}"/*.service "${SCRIPT_DIR}"/*.timer; do
  [ -f "${unit}" ] || continue
  filename="$(basename "${unit}")"
  sed "s|/home/long/astro-lineage\b|${TARGET_ROOT}|g" "${unit}" > "${SYSTEMD_USER_DIR}/${filename}"
  echo "installed: ${SYSTEMD_USER_DIR}/${filename}"
done

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
