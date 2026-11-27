#!/usr/bin/env bash
# zy-models: run right after the upstream merge has been committed
# (used by .github/workflows/zy-sync-upstream.yml).
#
#   bash scripts/sync-keep-workflows.sh <pre-merge-sha> <upstream-ref>
#
# Upstream's own workflows (.github/workflows/*, except our zy-* ones) are
# guarded by `github.repository == 'anomalyco/models.dev'` and never do anything
# here. The sync job pushes with GITHUB_TOKEN, which GitHub refuses to let
# create or update anything under .github/workflows/ ("refusing to allow a
# GitHub App to create or update workflow ... without workflows permission").
# So the merge keeps this repo's version of every upstream workflow file:
# changed/added/deleted upstream workflows are put back to the pre-merge state
# and the merge commit is amended. The skipped changes are listed (with links)
# in /tmp/skipped-workflows.md for the PR body, so they can be adopted by hand.
set -euo pipefail
pre="$1"
up="${2:-upstream/dev}"
repo_url="https://github.com/anomalyco/models.dev"
up_sha=$(git rev-parse "$up")
# What upstream had last time we synced: changes after this are "new this sync".
pre_base=$(git merge-base "$pre" "$up")

is_ours() { case "$1" in .github/workflows/zy-*) return 0 ;; *) return 1 ;; esac; }

# Upstream workflow files the merge changed relative to the pre-merge tree.
mapfile -t touched < <(git diff --name-only "$pre" HEAD -- .github/workflows/ | while read -r f; do is_ours "$f" || echo "$f"; done)
if [ "${#touched[@]}" -gt 0 ]; then
  echo "Keeping this repo's version of ${#touched[@]} upstream workflow file(s):"
  for f in "${touched[@]}"; do
    echo "  $f"
    if git cat-file -e "$pre:$f" 2>/dev/null; then
      git checkout "$pre" -- "$f"
    else
      git rm -q --cached -- "$f"
      rm -f -- "$f"
    fi
  done
  git add -A -- .github/workflows/
  git commit -q --amend --no-edit
fi

# Report every upstream workflow file that differs from upstream (this sync's
# skipped changes and older ones still not adopted).
: > /tmp/skipped-workflows.md
mapfile -t differ < <(git diff --name-only HEAD "$up_sha" -- .github/workflows/ | while read -r f; do is_ours "$f" || echo "$f"; done)
[ "${#differ[@]}" -gt 0 ] || exit 0
{
  echo "跳过的上游 workflow 改动（GITHUB_TOKEN 无权推送 \`.github/workflows/\`，这些文件保留本库版本；上游 workflow 都限定 \`anomalyco/models.dev\`，在本库不会执行。需要时手动采纳）："
  echo
  for f in "${differ[@]}"; do
    if git cat-file -e "$up_sha:$f" 2>/dev/null; then
      line="- \`$f\`（[上游版本](${repo_url}/blob/${up_sha}/${f})"
    else
      line="- \`$f\`（上游已删除"
    fi
    commits=$(git log --format=%H "$pre_base..$up_sha" -- "$f")
    if [ -n "$commits" ]; then
      links=$(for c in $commits; do printf '[%s](%s/commit/%s) ' "${c:0:9}" "$repo_url" "$c"; done)
      line="$line；本次新改动：${links% }）"
    else
      line="$line；此前已跳过）"
    fi
    echo "$line"
  done
  echo
  echo "本地采纳：\`git checkout upstream/dev -- <文件>\` 后用有 workflow 权限的身份推送。"
} > /tmp/skipped-workflows.md
cat /tmp/skipped-workflows.md
