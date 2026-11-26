#!/usr/bin/env bash
# zy-models: run with an upstream merge in progress (used by .github/workflows/zy-sync-upstream.yml).
#
# The usual sync conflict is add/add: upstream adds a model or provider file that
# scripts/import-research.ts had already generated at the same path. Per the repo
# design upstream files stay unchanged and our CN data lives in overlays/, so the
# resolution is mechanical: take upstream's file, drop it from
# scripts/import-manifest.json and re-run the importer, which writes our data into
# overlays/<same path> (numeric conflicts → research/IMPORT_REPORT.md).
#
# Exit 0: every conflict was such a file and the merge is committed.
# Exit 1: some other conflict remains, or the re-import failed; the caller aborts the merge.
set -uo pipefail

mapfile -t conflicts < <(git diff --name-only --diff-filter=U)
[ "${#conflicts[@]}" -gt 0 ] || exit 1

generated=()
upstream_owned=()
workflows=()
for f in "${conflicts[@]}"; do
  if [[ "$f" == .github/workflows/* && "$f" != .github/workflows/zy-* ]]; then
    # Upstream's own workflow: we keep ours (scripts/sync-keep-workflows.sh restores it anyway).
    workflows+=("$f")
  # add/add: no common-ancestor stage, and the path is one our importer wrote.
  elif ! git cat-file -e ":1:$f" 2>/dev/null && jq -e --arg f "$f" 'index($f) != null' scripts/import-manifest.json >/dev/null; then
    generated+=("$f")
  elif [ "$(git check-attr merge -- "$f" | awk '{print $NF}')" = "zy-upstream" ]; then
    # Upstream-owned generated file (bun.lock, models.json): we never edit it, take upstream's.
    upstream_owned+=("$f")
  else
    echo "not auto-resolvable: $f"
    exit 1
  fi
done

if [ "${#workflows[@]}" -gt 0 ]; then
  echo "Keeping our version of ${#workflows[@]} upstream workflow file(s):"
  printf '  %s\n' "${workflows[@]}"
  for f in "${workflows[@]}"; do
    if git cat-file -e "HEAD:$f" 2>/dev/null; then git checkout HEAD -- "$f"; else git rm -q -f -- "$f"; fi
  done
  git add -A -- .github/workflows/
fi
if [ "${#upstream_owned[@]}" -gt 0 ]; then
  echo "Taking upstream's version of ${#upstream_owned[@]} upstream-owned generated file(s):"
  printf '  %s\n' "${upstream_owned[@]}"
  git checkout --theirs -- "${upstream_owned[@]}"
  git add -- "${upstream_owned[@]}"
fi
echo "Auto-resolving ${#generated[@]} add/add conflict(s) on importer-generated files:"
printf '  %s\n' "${generated[@]}"
if [ "${#generated[@]}" -gt 0 ]; then
  git checkout --theirs -- "${generated[@]}"
  git add -- "${generated[@]}"
fi
printf '%s\n' "${generated[@]}" | jq -R . | jq -s . > /tmp/zy-resolved.json
jq --slurpfile drop /tmp/zy-resolved.json '[.[] | select(. as $f | $drop[0] | index($f) | not)]' \
  scripts/import-manifest.json > /tmp/zy-manifest.json && mv /tmp/zy-manifest.json scripts/import-manifest.json

bun install
if ! bash scripts/zy-reimport.sh; then
  echo "import-research failed"
  exit 1
fi
git add -A overlays providers models labs research docs scripts/import-manifest.json
git commit --no-edit -q
printf '%s\n' "${generated[@]}" "${upstream_owned[@]}" | grep -v '^$' > /tmp/auto-resolved.txt || true
