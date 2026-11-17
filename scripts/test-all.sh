#!/usr/bin/env bash
# 仓库验证入口（兼容旧调用）。实际检查全部委托给 scripts/verify.mjs，避免两套清单漂移。
#
#   bash scripts/test-all.sh           # = node scripts/verify.mjs full（11 个插件 + 客户端冒烟 + 规则/文档/证据）
#   bash scripts/test-all.sh --fast    # = node scripts/verify.mjs fast（≤170s，离线免安装依赖）
#   bash scripts/test-all.sh --heavy   # full 之后追加 novel-forge 的 dev/verify.mjs 与 dev/e2e.mjs（要 playwright；P0 尚未并入 heavy 档）
#   bash scripts/test-all.sh --json    # 透传 verify 的 JSON 报告
#
# 退出码：0 全绿；1 失败/超时；2 阻塞（缺依赖、缺基线、三轮失败停止）；64 参数错误。
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

MODE=full
JSON=0
HEAVY=0
for arg in "$@"; do
  case "$arg" in
    --heavy) HEAVY=1 ;;
    --fast) MODE=fast ;;
    --json) JSON=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg（支持 --fast / --heavy / --json）" >&2; exit 64 ;;
  esac
done

args=("$MODE")
[ "$JSON" = 1 ] && args+=(--json)
node scripts/verify.mjs "${args[@]}"
code=$?
[ "$code" -eq 0 ] || exit "$code"

if [ "$HEAVY" = 1 ]; then
  echo
  echo "== 旧 --heavy 路径（尚未并入 verify heavy 档；P0 的 heavy 一律 BLOCKED）=="
  log_dir="${TMPDIR:-/tmp}/dsh-plugins-test-all"
  mkdir -p "$log_dir"
  rc=0
  for name in verify e2e; do
    if node "plugins/novel-forge/dev/$name.mjs" >"$log_dir/novel-forge-$name.log" 2>&1; then
      printf '  \033[32mPASS\033[0m novel-forge/%s\n' "$name"
    else
      printf '  \033[31mFAIL\033[0m novel-forge/%s -> %s\n' "$name" "$log_dir/novel-forge-$name.log"
      rc=1
    fi
  done
  exit "$rc"
fi
exit 0
