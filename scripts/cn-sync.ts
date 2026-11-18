#!/usr/bin/env bun
// zy-models: sync research/<platform>.json from Chinese platforms' official
// public catalogs (no API key). See docs/cn-sync.md.
//
//   bun cn:sync --list-providers      # workflow matrix, same shape as `bun models:sync --list-providers`
//   bun cn:sync <provider> [--dry-run]
//   bun cn:sync all [--dry-run]
//
// After a run that changed research/, regenerate the catalog with
//   bun scripts/import-research.ts --rate <last rate> --rate-date <date>
// (the CN sync workflow does this with the rate in research/IMPORT_REPORT.md).
import { main } from "../packages/core/src/cn/sync/index.ts";

await main();
