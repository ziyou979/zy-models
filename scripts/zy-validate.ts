#!/usr/bin/env bun
// zy-models: `bun validate` (upstream, unchanged) plus our own checks.
// Upstream code sees overlay-merged data through packages/core/src/cn/register.ts.
//   bun scripts/zy-validate.ts > /tmp/validate.json
import "../packages/core/src/cn/register.ts";
import { overlayErrors } from "../packages/core/src/cn/ext.ts";

// Overlays must sit over an existing upstream file.
const badOverlays = await overlayErrors();
if (badOverlays.length > 0) {
  console.error("Orphan overlay files:\n" + badOverlays.map((e) => `  ${e}`).join("\n"));
  process.exit(1);
}
await import("../packages/core/script/validate.ts");
