#!/usr/bin/env bash
# 一条命令跑完仓库里所有插件的自检 + 文档一致性校验。
#
#   bash scripts/test-all.sh          # 常规：每个插件的 npm test + 语法检查 + 文档校验
#   bash scripts/test-all.sh --heavy  # 额外跑 novel-forge 的 dev/verify.mjs 与 dev/e2e.mjs（要 playwright）
#
# 退出码：0 全绿；1 有失败（最后会列出失败项）。
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

HEAVY=0
[ "${1:-}" = "--heavy" ] && HEAVY=1

LOG_DIR="${TMPDIR:-/tmp}/dsh-plugins-test-all"
mkdir -p "$LOG_DIR"
rm -f "$LOG_DIR"/*.log

PASS=0
FAIL=0
FAILED_NAMES=()

run() {
  local name="$1"
  shift
  local log="$LOG_DIR/${name//\//-}.log"
  if "$@" >"$log" 2>&1; then
    printf '  \033[32mPASS\033[0m %-42s %s\n' "$name" "$(tail -1 "$log" | cut -c1-40)"
    PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m %-42s -> %s\n' "$name" "$log"
    FAIL=$((FAIL + 1))
    FAILED_NAMES+=("$name")
  fi
}

echo "== 插件测试（npm test）=="
for dir in plugins/*/; do
  p="${dir%/}"
  name="$(basename "$p")"
  [ -f "$p/package.json" ] || continue
  if node -e "const s=require('./$p/package.json').scripts||{};process.exit(s.test?0:1)" 2>/dev/null; then
    run "$name" npm --prefix "$p" test --silent
  fi
done

echo "== 无测试插件的语法门（node --check）=="
for dir in plugins/*/; do
  p="${dir%/}"
  name="$(basename "$p")"
  [ -f "$p/package.json" ] || continue
  if node -e "const s=require('./$p/package.json').scripts||{};process.exit(s.test?1:0)" 2>/dev/null; then
    files=$(find "$p" -maxdepth 2 -name '*.js' -not -path '*/node_modules/*' -not -path '*/dist/*' | sort)
    if [ -n "$files" ]; then
      # shellcheck disable=SC2086
      run "$name(syntax)" node --check $files
    fi
  fi
done

echo "== 清单与索引一致性 =="
run "scripts/check-manifest" node scripts/check-manifest.mjs

echo "== 文档一致性 =="
run "docs/verify-readme" node docs/verify-readme.mjs

if [ "$HEAVY" = 1 ]; then
  echo "== novel-forge 真宿主冒烟（--heavy）=="
  run "novel-forge/verify" node plugins/novel-forge/dev/verify.mjs
  run "novel-forge/e2e" node plugins/novel-forge/dev/e2e.mjs
fi

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m全部通过\033[0m：%d 项\n' "$PASS"
  exit 0
fi
printf '\033[31m失败 %d 项\033[0m / 通过 %d 项\n' "$FAIL" "$PASS"
for n in "${FAILED_NAMES[@]}"; do printf '  - %s\n' "$n"; done
exit 1
