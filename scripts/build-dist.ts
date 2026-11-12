#!/usr/bin/env bun
// zy-models: builds the static, CDN-friendly catalog into ./dist.
//
//   dist/api.json      v1 providers map (same shape as models.dev/api.json, plus extension keys)
//   dist/models.json   v1 lab model metadata (models.dev/models.json + extension keys)
//   dist/catalog.json  { providers, models }
//   dist/cn.json       api.json filtered to providers with region = "cn" (国内平台)
//   dist/v2/api.json   experimental v2 providers map (models.dev/experimental/v2.0/api.json),
//                      with the same extension keys copied over from v1
//   dist/meta.json     build info (upstream commit, counts)
import path from "node:path";
import fs from "node:fs/promises";
import { filterCatalogByModelType, generateCatalog, generateV2 } from "../packages/core/src/index.ts";

const root = path.resolve(import.meta.dir, "..");
const out = path.join(root, "dist");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "v2"), { recursive: true });

const catalog = await generateCatalog(root);
const view = filterCatalogByModelType({ models: catalog.models, providers: catalog.providers }, "default");

const write = (file: string, value: unknown) => Bun.write(path.join(out, file), JSON.stringify(value));

await write("api.json", view.providers);
await write("models.json", view.models);
await write("catalog.json", view);

const cn = Object.fromEntries(
  Object.entries(view.providers).filter(([, provider]) => (provider as { region?: string }).region === "cn"),
);
await write("cn.json", cn);

// v2: upstream-shaped, then extension keys copied from v1 by provider/model id.
const PROVIDER_KEYS = ["name_zh", "region", "pricing_page", "plans", "notes"];
const MODEL_KEYS = ["name_zh", "aliases", "cost_cny", "reasoning_default", "sources", "checked_at", "notes"];
const v2 = (await generateV2(path.join(root, "providers"))) as Record<string, any>;
for (const [providerID, provider] of Object.entries(v2)) {
  const v1 = (catalog.providers as Record<string, any>)[providerID];
  if (v1 === undefined) continue;
  for (const key of PROVIDER_KEYS) if (v1[key] !== undefined) provider[key] = v1[key];
  for (const [modelID, model] of Object.entries(provider.models as Record<string, any>)) {
    const m1 = v1.models?.[modelID];
    if (m1 === undefined) continue;
    for (const key of MODEL_KEYS) if (m1[key] !== undefined) model[key] = m1[key];
  }
}
await write("v2/api.json", v2);

const upstreamCommit = (await Bun.$`git -C ${root} rev-parse --verify -q upstream/dev`.nothrow().quiet().text()).trim() || null;
const meta = {
  built_at: new Date().toISOString(),
  upstream: "https://github.com/anomalyco/models.dev",
  upstream_commit: upstreamCommit,
  providers: Object.keys(view.providers).length,
  provider_models: Object.values(view.providers).reduce((n, p: any) => n + Object.keys(p.models).length, 0),
  cn_providers: Object.keys(cn).length,
  cn_models: Object.values(cn).reduce((n, p: any) => n + Object.keys(p.models).length, 0),
};
await write("meta.json", meta);

for (const file of ["api.json", "models.json", "catalog.json", "cn.json", "v2/api.json"]) {
  const size = (await fs.stat(path.join(out, file))).size;
  console.log(`dist/${file}  ${(size / 1024).toFixed(0)} KB`);
}
console.log(JSON.stringify(meta));
