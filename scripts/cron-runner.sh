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

if [ -f "${PROJECT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_DIR}/.env"
  set +a
fi

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

pull_upstream_master() {
  if [ "${CRON_GIT_PULL:-false}" != "true" ]; then
    return 0
  fi

  echo "[cron-runner] 检查并同步远程 master 最新状态..."

  # 1. 严格分支隔离门禁：仅在 master 分支允许自动前置拉取
  local current_branch
  current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"
  if [ "${current_branch}" != "master" ]; then
    echo "[cron-runner] 当前处于分支 '${current_branch}' (非 master)，安全跳过远程 master 同步"
    return 0
  fi

  # 2. 工作区纯净度保护：检测是否存在未提交的非数据代码改动，若有则安全跳过，防止冲突和覆盖
  local dirty_code
  dirty_code="$(git status --porcelain 2>/dev/null | grep -v -E '^..\s+(src/data/|public/arxiv-figures/|public/arxiv-weekly/)' || true)"
  if [ -n "${dirty_code}" ]; then
    echo "[cron-runner] 检测到工作区存在未提交的代码改动，安全跳过远程同步以保护工作区："
    echo "${dirty_code}"
    return 0
  fi

  # 3. 自动暂存残留数据（若上一轮异常中断遗留了数据文件）
  local has_dirty_data=0
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git stash push -u -m "cron-runner: pre-pull auto-stash" >/dev/null 2>&1 || true
    has_dirty_data=1
  fi

  # 4. 快进同步远程更新（容错设计：失败时不中断流水线，降级使用当前本地基准继续执行）
  if git fetch origin master; then
    if ! git merge --ff-only origin/master; then
      echo "[cron-runner] ⚠️ 警告: 本地 master 与远程 master 产生分叉，快进合并失败，降级使用当前本地版本继续执行" >&2
    else
      echo "[cron-runner] ✓ 成功同步远程 master 最新代码与数据"
    fi
  else
    echo "[cron-runner] ⚠️ 警告: git fetch origin master 失败 (可能受网络波动影响)，跳过拉取继续执行" >&2
  fi

  # 5. 还原暂存数据
  if [ "${has_dirty_data}" -eq 1 ]; then
    git stash pop >/dev/null 2>&1 || true
  fi
}

sync_git_data() {
  if [ "${CRON_GIT_PUSH:-false}" = "true" ]; then
    echo "[cron-runner] 检查并同步数据变更与最近 7 周图表至 Git 仓库以触发 Cloudflare 部署..."

    # 1. 严格分支隔离门禁：仅在 master 分支允许自动提交与推送，防止污染特性分支
    local current_branch
    current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"
    if [ "${current_branch}" != "master" ]; then
      echo "[cron-runner] 当前处于分支 '${current_branch}' (非 master)，安全跳过自动 Git 提交与远程推送以保护工作区"
      return 0
    fi

    # 2. 工作区纯净度门禁：除数据和图片外，若存在任何未提交的代码改动，安全跳过提交与推送
    local dirty_non_data
    dirty_non_data="$(git status --porcelain | grep -v -E '^..\s+(src/data/|public/arxiv-figures/|public/arxiv-weekly/)' || true)"
    if [ -n "${dirty_non_data}" ]; then
      echo "[cron-runner] 检测到工作区存在未提交的代码改动，为防止代码被误推或污染，安全跳过自动 Git 提交与远程推送："
      echo "${dirty_non_data}"
      return 0
    fi

    # 维护最近 7 周图表滑动窗口暂存入库，解绑过期历史图片 (预算上限 300MB)
    node scripts/sync-recent-figures.mjs --weeks "${SYNC_FIGURES_WEEKS:-7}" --max-mb "${SYNC_FIGURES_MAX_MB:-300}" || true

    if [ -n "$(git status --porcelain src/data/)" ]; then
      git add src/data/
    fi

    if [ -d "public/arxiv-weekly" ] && [ -n "$(git status --porcelain public/arxiv-weekly/)" ]; then
      git add public/arxiv-weekly/
    fi

    # 检查暂存区是否有更新需要提交
    if ! git diff --cached --quiet; then
      if ! git commit -m "chore(arxiv): sync recent 7-week editions, archives & figures"; then
        echo "[cron-runner] ⚠️ 警告: git commit 失败" >&2
      fi
    fi

    # 检查是否有待推送的提交（含本次提交或历史未推送成功的提交）
    UNPUSHED="$(git log origin/master..HEAD --oneline 2>/dev/null || true)"
    if [ -n "${UNPUSHED}" ]; then
      echo "[cron-runner] 检测到待同步提交，正在推送到远程 master 分支..."
      if git push origin master:master; then
        echo "[cron-runner] ✓ 数据与图表已成功推送到远程 master 分支"
      else
        echo "[cron-runner] ⚠️ 警告: 推送数据至远程 master 分支失败，请检查网络连接或 Git 凭据" >&2
        DELIVERY_FAILED=1
      fi
    else
      echo "[cron-runner] 暂无新数据需要推送到远程 Git 仓库"
    fi
  fi
}

echo "========================================================"
echo "[$TIMESTAMP] Starting AstroLineage Task: ${TASK}"
echo "Project root: ${PROJECT_DIR}"
echo "Node binary:  $(which node 2>/dev/null || echo 'not found')"
echo "NPM binary:   $(which npm 2>/dev/null || echo 'not found')"
echo "========================================================"

pull_upstream_master

case "${TASK}" in
  auto|sync)
    echo "[cron-runner] 步骤 1/4: 执行每日 arXiv 调度器与 AI 研判..."
    node scripts/arxiv-daily-scheduler.mjs

    echo "[cron-runner] 步骤 1.5/4: 执行每周学术脉络总结与脏周级联更新..."
    node scripts/arxiv-weekly-summary.mjs || true
    echo "[cron-runner] 检查并级联更新历史脏自然周..."
    node scripts/arxiv-weekly-summary.mjs --cascade || true

    echo "[cron-runner] 步骤 2/4: 重新构建全站静态发布页面并热加载 Web 服务..."
    capture_current_build
    npm run build
    record_current_build
    systemctl --user restart astrolineage-web.service || true

    echo "[cron-runner] 步骤 3/4: 预运行发布（仅推送必读单篇讨论帖，不发布整期导读与周报）..."
    node scripts/notebooklm-sync.mjs --deliver preliminary "${BUILD_ID}" || DELIVERY_FAILED=1

    echo "[cron-runner] 检查并确保 AstroLineage 智能体机器人守护进程运行正常..."
    systemctl --user is-active --quiet astrolineage-bot.service || systemctl --user start astrolineage-bot.service || true
    systemctl --user is-active --quiet astrolineage-qq-bot.service || systemctl --user start astrolineage-qq-bot.service || true
    sync_git_data
    ;;

  reconcile|fallback)
    echo "[cron-runner] 执行次日 02:00 兜底扫描与增量对账封板..."
    node scripts/arxiv-daily-scheduler.mjs --reconcile-previous

    echo "[cron-runner] 步骤 1.5/4: 执行每周学术脉络总结与脏周级联更新..."
    node scripts/arxiv-weekly-summary.mjs || true
    node scripts/arxiv-weekly-summary.mjs --cascade || true

    echo "[cron-runner] 重新构建全站静态发布页面并热加载 Web 服务..."
    capture_current_build
    npm run build
    record_current_build
    systemctl --user restart astrolineage-web.service || true

    echo "[cron-runner] 兜底定稿发布到腾讯频道社区与年度 NotebookLM..."
    WEEKDAY="$(TZ="Asia/Shanghai" date +%u)"
    if [ "${WEEKDAY}" -eq 6 ]; then
      node scripts/notebooklm-sync.mjs --deliver both "${BUILD_ID}" || DELIVERY_FAILED=1
    else
      node scripts/notebooklm-sync.mjs --deliver daily "${BUILD_ID}" || DELIVERY_FAILED=1
    fi
    sync_git_data
    ;;

  group-weekly)
    echo "[cron-runner] 执行周一上午 08:00 前一周学术周报群广播..."
    PREV_WEEK="$(node -e 'import("./src/domain/academic-domain.mjs").then(m => console.log(m.getPreviousAcademicWeekId()))')"
    echo "[cron-runner] 上一周学术周标识: ${PREV_WEEK}"
    node scripts/qq-send.mjs --group --brief weekly --week "${PREV_WEEK}" --broadcast
    ;;

  daily)
    echo "[cron-runner] 执行每日流程..."
    node scripts/arxiv-daily-scheduler.mjs
    echo "[cron-runner] 同步更新本周学术脉络总结与脏周级联..."
    node scripts/arxiv-weekly-summary.mjs || true
    node scripts/arxiv-weekly-summary.mjs --cascade || true
    node scripts/weekly-pdf.mjs || true
    capture_current_build
    npm run build
    record_current_build
    systemctl --user restart astrolineage-web.service || true
    node scripts/notebooklm-sync.mjs --deliver daily "${BUILD_ID}" || DELIVERY_FAILED=1
    sync_git_data
    ;;

  weekly)
    echo "[cron-runner] 执行每周综述流程..."
    node scripts/arxiv-weekly-summary.mjs
    node scripts/arxiv-weekly-summary.mjs --cascade || true
    node scripts/weekly-pdf.mjs || true
    capture_current_build
    npm run build
    record_current_build
    systemctl --user restart astrolineage-web.service || true
    node scripts/notebooklm-sync.mjs --deliver weekly "${BUILD_ID}" || DELIVERY_FAILED=1
    sync_git_data
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

  sync-git)
    sync_git_data
    ;;

  sync-pull)
    CRON_GIT_PULL=true pull_upstream_master
    ;;

  *)
    echo "[cron-runner] 错误：未知任务 '${TASK}'。可用参数: auto, reconcile, group-weekly, daily, weekly, agent, build, notebook, sync-git, sync-pull" >&2
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
