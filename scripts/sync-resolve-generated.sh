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
for f in "${conflicts[@]}"; do
  # add/add: no common-ancestor stage, and the path is one our importer wrote.
  if ! git cat-file -e ":1:$f" 2>/dev/null && jq -e --arg f "$f" 'index($f) != null' scripts/import-manifest.json >/dev/null; then
    generated+=("$f")
  else
    echo "not auto-resolvable: $f"
    exit 1
  fi
done

echo "Auto-resolving ${#generated[@]} add/add conflict(s) on importer-generated files:"
printf '  %s\n' "${generated[@]}"
git checkout --theirs -- "${generated[@]}"
git add -- "${generated[@]}"
printf '%s\n' "${generated[@]}" | jq -R . | jq -s . > /tmp/zy-resolved.json
jq --slurpfile drop /tmp/zy-resolved.json '[.[] | select(. as $f | $drop[0] | index($f) | not)]' \
  scripts/import-manifest.json > /tmp/zy-manifest.json && mv /tmp/zy-manifest.json scripts/import-manifest.json

# Re-import with the exchange rate of the last import, so USD prices don't churn.
rate=$(grep -oE '1 USD = [0-9.]+ CNY（[0-9-]+' research/IMPORT_REPORT.md | head -1)
rate_value=$(echo "$rate" | grep -oE '= [0-9.]+' | tr -d '= ')
rate_date=$(echo "$rate" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')
if [ -z "$rate_value" ] || [ -z "$rate_date" ]; then
  echo "could not read the last exchange rate from research/IMPORT_REPORT.md"
  exit 1
fi
bun install
if ! bun scripts/import-research.ts --rate "$rate_value" --rate-date "$rate_date"; then
  echo "import-research failed"
  exit 1
fi
git add -A overlays providers models labs research docs scripts/import-manifest.json
git commit --no-edit -q
printf '%s\n' "${generated[@]}" > /tmp/auto-resolved.txt
