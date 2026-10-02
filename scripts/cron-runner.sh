#!/usr/bin/env bash
# ==============================================================================
# AstroLineage Crontab Task Runner (统一学术任务调度入口)
#
# 用法:
#   bash scripts/cron-runner.sh auto      # [默认/定时任务] 每日抓取+研判+推送；周五自动追加周报生成与推送
#   bash scripts/cron-runner.sh daily     # 强制仅执行每日流程
#   bash scripts/cron-runner.sh weekly    # 强制仅执行每周综述流程
#   bash scripts/cron-runner.sh build     # 仅重新构建静态页面
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_DIR}"

# 确保 Node 与 npm 全局路径在精简的 cron 环境中可用
export PATH="/home/long/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:/home/long/.local/bin:${PATH:-}"

TASK="${1:-auto}"
TIMESTAMP="$(TZ="Asia/Shanghai" date '+%Y-%m-%d %H:%M:%S CST')"
# ponytail: one host-wide runner lock; split locks only if independent builds are needed.
mkdir -p .cache
exec 9>.cache/cron-runner.lock
flock -n 9 || { echo '[cron-runner] Another run is active; skipping overlapping invocation.'; exit 0; }
DELIVERY_FAILED=0

handle_error() {
  local exit_code=$?
  local line_no=$1
  echo "[$TIMESTAMP] ✗ [cron-runner] 任务执行失败，退出码: ${exit_code}，行号: ${line_no}"
  exit "${exit_code}"
}
trap 'handle_error $LINENO' ERR

capture_current_build() {
  BUILD_ID="$(date +%s%N)-$$"
  node scripts/notebooklm-sync.mjs --capture-build "${BUILD_ID}"
}

record_current_build() {
  node scripts/notebooklm-sync.mjs --built "${BUILD_ID}"
  node scripts/notebooklm-sync.mjs --export "${BUILD_ID}" || DELIVERY_FAILED=1
}

echo "========================================================"
echo "[$TIMESTAMP] Starting AstroLineage Task: ${TASK}"
echo "Project root: ${PROJECT_DIR}"
echo "Node binary:  $(which node 2>/dev/null || echo 'not found')"
echo "NPM binary:   $(which npm 2>/dev/null || echo 'not found')"
echo "========================================================"

case "${TASK}" in
  auto|sync)
    echo "[cron-runner] 步骤 1/4: 执行每日 arXiv 调度器与 AI 研判..."
    node scripts/arxiv-daily-scheduler.mjs

    # 判定当前星期 (1=周一, 5=周五)
    WEEKDAY="$(TZ="Asia/Shanghai" date +%u)"
    if [ "${WEEKDAY}" -eq 5 ]; then
      echo "[cron-runner] 步骤 1.5/4: 检测到当前为周五，自动追加执行每周学术脉络总结..."
      node scripts/arxiv-weekly-summary.mjs
    fi

    echo "[cron-runner] 检查并级联更新历史脏自然周..."
    node scripts/arxiv-weekly-summary.mjs --cascade || true

    echo "[cron-runner] 步骤 2/4: 重新构建全站静态发布页面并热加载 Web 服务..."
    capture_current_build
    npm run build
    record_current_build
    systemctl --user restart astrolineage-web.service || true

    echo "[cron-runner] 步骤 3/4: 同步腾讯频道社区与年度 NotebookLM 知识库..."
    if [ "${WEEKDAY}" -eq 5 ]; then
      node scripts/notebooklm-sync.mjs --deliver both "${BUILD_ID}" || DELIVERY_FAILED=1
    else
      node scripts/notebooklm-sync.mjs --deliver daily "${BUILD_ID}" || DELIVERY_FAILED=1
    fi

    echo "[cron-runner] 检查并确保 AstroLineage 智能体机器人守护进程运行正常..."
    systemctl --user is-active --quiet astrolineage-bot.service || systemctl --user start astrolineage-bot.service || true
    systemctl --user is-active --quiet astrolineage-qq-bot.service || systemctl --user start astrolineage-qq-bot.service || true
    ;;

  daily)
    echo "[cron-runner] 执行每日流程..."
    node scripts/arxiv-daily-scheduler.mjs
    node scripts/arxiv-weekly-summary.mjs --cascade || true
    capture_current_build
    npm run build
    record_current_build
    systemctl --user restart astrolineage-web.service || true
    node scripts/notebooklm-sync.mjs --deliver daily "${BUILD_ID}" || DELIVERY_FAILED=1
    ;;

  weekly)
    echo "[cron-runner] 执行每周综述流程..."
    node scripts/arxiv-weekly-summary.mjs
    node scripts/arxiv-weekly-summary.mjs --cascade || true
    capture_current_build
    npm run build
    record_current_build
    systemctl --user restart astrolineage-web.service || true
    node scripts/notebooklm-sync.mjs --deliver weekly "${BUILD_ID}" || DELIVERY_FAILED=1
    ;;

  agent|bot)
    echo "[cron-runner] 执行单次智能体交互扫描..."
    node scripts/tencent-channel-bot.mjs --once
    ;;

  build)
    echo "[cron-runner] 仅重新构建静态发布页面..."
    capture_current_build
    npm run build
    record_current_build
    ;;

  notebook)
    # Retry only NotebookLM from the last successful build; no fetch/model/channel calls.
    node scripts/notebooklm-sync.mjs || DELIVERY_FAILED=1
    ;;

  *)
    echo "[cron-runner] 错误：未知任务 '${TASK}'。可用参数: auto, daily, weekly, agent, build, notebook" >&2
    exit 1
    ;;
esac

END_TIMESTAMP="$(TZ="Asia/Shanghai" date '+%Y-%m-%d %H:%M:%S CST')"
if [ "${DELIVERY_FAILED}" -ne 0 ]; then
  echo "[$END_TIMESTAMP] AstroLineage Task ${TASK}: downstream target incomplete; see .cache/notebooklm/delivery.json and status.json."
  exit 1
fi
echo "[$END_TIMESTAMP] AstroLineage Task ${TASK} completed successfully (QQ proactive delivery remains waiting_permission)."
echo "========================================================"
