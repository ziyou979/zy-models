#!/usr/bin/env bash
# zy-models: regenerate overlays/ and the importer-generated data files from
# research/*.json against the current upstream data, with the exchange rate of
# the last import (so CNY→USD prices don't churn). Used after every upstream
# merge (.github/workflows/zy-sync-upstream.yml) instead of trusting git's merge
# of generated files.
set -euo pipefail
rate=$(grep -oE '1 USD = [0-9.]+ CNY（[0-9-]+' research/IMPORT_REPORT.md | head -1 || true)
rate_value=$(echo "$rate" | grep -oE '= [0-9.]+' | tr -d '= ' || true)
rate_date=$(echo "$rate" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)
if [ -z "$rate_value" ] || [ -z "$rate_date" ]; then
  echo "could not read the last exchange rate from research/IMPORT_REPORT.md" >&2
  exit 1
fi
bun scripts/import-research.ts --rate "$rate_value" --rate-date "$rate_date"
