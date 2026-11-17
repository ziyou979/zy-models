#!/usr/bin/env bash
# zy-models: run the CN platform syncs and publish each platform's result
# (used by .github/workflows/zy-sync-cn.yml; mirrors upstream's sync-models.yml
# loop: every platform starts from a clean main, gets its own branch and draft
# PR, and a failing platform doesn't stop the rest).
#
#   bash scripts/cn-sync-publish.sh [provider]      # all platforms when empty
#   CN_SYNC_DRY=1 bash scripts/cn-sync-publish.sh   # local: no push / PR / issue
#
# Per platform:
#   1. bun cn:sync <p>         → research/<file>.json (+ .sync/cn-<p>-report.md, -issue.md)
#   2. import-research.ts      → overlays/ + provider files, with the last import's exchange rate
#   3. bun validate + build    → a platform that fails is reported and skipped
#   4. branch cn-sync/<p>, force-pushed; draft PR opened or its body refreshed
#   5. one issue per platform for conflicts / models needing manual work,
#      refreshed every run and closed when nothing is left
# Never pushes main, never merges.
set -uo pipefail

only="${1:-}"
dry="${CN_SYNC_DRY:-}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
base_branch="${CN_SYNC_BASE:-main}"

base="$(git rev-parse HEAD)"
rate=$(grep -oE '1 USD = [0-9.]+ CNY（[0-9-]+' research/IMPORT_REPORT.md | head -1)
rate_value=$(echo "$rate" | grep -oE '= [0-9.]+' | tr -d '= ')
rate_date=$(echo "$rate" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')
if [ -z "$rate_value" ] || [ -z "$rate_date" ]; then
  echo "::error::could not read the last exchange rate from research/IMPORT_REPORT.md"
  exit 1
fi

providers=$(bun scripts/cn-sync.ts --list-providers | jq -r '.include[] | [.provider, .name] | @tsv') || {
  echo "::error::failed to list CN sync providers"
  exit 1
}

if [ -z "$dry" ]; then
  gh label create cn-sync --color 1D76DB --description "国内平台官方数据自动同步" --force >/dev/null
fi

failed=0
printf '| 平台 | 结果 |\n| --- | --- |\n' >> "$summary"

reset_tree() {
  git reset -q --hard "$base"
  git clean -qfd providers overlays models research docs scripts
}

# Refresh (or close) the platform's tracking issue from .sync/cn-<p>-issue.md.
update_issue() {
  local p="$1" name="$2" body=".sync/cn-$1-issue.md"
  local title="[cn-sync] ${name}（${p}）：冲突与待人工处理的模型"
  local num
  num=$(gh issue list --state open --label cn-sync --label "provider:$p" --json number,title \
    -q "map(select(.title == \"$title\")) | .[0].number // empty") || return 1
  if [ -s "$body" ]; then
    if [ -n "$num" ]; then
      gh issue edit "$num" --body-file "$body" >/dev/null
    else
      gh label create "provider:$p" --color C5DEF5 --force >/dev/null
      gh issue create --title "$title" --label cn-sync --label "provider:$p" --body-file "$body" >/dev/null
    fi
  elif [ -n "$num" ]; then
    gh issue close "$num" --comment "最新一次同步已没有冲突或待处理模型，自动关闭。" >/dev/null
  fi
}

while IFS=$'\t' read -r p name <&3; do
  [ -n "$only" ] && [ "$only" != "$p" ] && continue
  echo "::group::CN sync $name ($p)"
  reset_tree
  branch="cn-sync/$p"
  result=""

  if ! bun scripts/cn-sync.ts "$p" < /dev/null; then
    result="同步失败（数据源不可用或页面结构变化，见运行日志）"
  else
    if [ -z "$dry" ]; then update_issue "$p" "$name" || echo "::warning::$p: failed to update issue"; fi
    if [ -z "$(git status --porcelain -- research)" ]; then
      result="无变化"
    elif ! bun scripts/import-research.ts --rate "$rate_value" --rate-date "$rate_date" < /dev/null > /tmp/cn-import-$p.log 2>&1; then
      result="导入失败"; tail -30 /tmp/cn-import-$p.log
    elif ! bun validate > /tmp/cn-validate-$p.json < /dev/null; then
      result="bun validate 失败"
    elif ! bun run build > /tmp/cn-build-$p.log 2>&1 < /dev/null; then
      result="构建失败"; tail -30 /tmp/cn-build-$p.log
    fi
  fi

  if [ -n "$result" ]; then
    case "$result" in 无变化) ;; *) failed=1; echo "::error::$p: $result" ;; esac
    printf '| %s | %s |\n' "$name" "$result" >> "$summary"
    echo "::endgroup::"
    continue
  fi

  report=".sync/cn-$p-report.md"
  cat "$report" >> "$summary"
  if [ -n "$dry" ]; then
    git status --short | sed 's/^/  /'
    printf '| %s | 有变化（dry run，未推送）|\n' "$name" >> "$summary"
    echo "::endgroup::"
    continue
  fi

  git checkout -q -B "$branch"
  git add -A providers overlays models research docs scripts/import-manifest.json
  git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q --no-verify -m "chore(cn-sync): 同步 ${name} 官方公开数据"
  if ! git push -q -f origin "$branch"; then
    failed=1; printf '| %s | 推送失败 |\n' "$name" >> "$summary"; echo "::endgroup::"; git checkout -q --detach "$base"; continue
  fi
  pr=$(gh pr list --head "$branch" --base "$base_branch" --state open --json number -q '.[0].number // empty')
  if [ -n "$pr" ]; then
    gh pr edit "$pr" --body-file "$report" >/dev/null && printf '| %s | 已更新 PR #%s |\n' "$name" "$pr" >> "$summary"
  else
    gh pr create --draft --base "$base_branch" --head "$branch" --title "chore(cn-sync): 同步 ${name} 官方公开数据" \
      --label cn-sync --body-file "$report" >/dev/null && printf '| %s | 已开 draft PR |\n' "$name" >> "$summary"
  fi
  git checkout -q --detach "$base"
  echo "::endgroup::"
done 3<<< "$providers"

reset_tree
exit "$failed"
