// zy-models: the catalog with our extension keys, built on the unmodified
// upstream generators.
//
// ./register.ts makes upstream see overlay-merged data without extension keys;
// this file runs the upstream generators and then
//   - drops the models listed in overlays/removed.json (delisted upstream models),
//   - re-attaches the extension keys (name_zh, cost_cny, plans, …) to the v1
//     output, exactly where the former in-place hooks in generate.ts put them.
import "./register.js";
import path from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { generateCatalog, generateV2 } from "../index.js";
import {
  REPO_ROOT,
  extByPath,
  isRemoved,
  loadDataToml,
  modelExtOutput,
  providerExtOutput,
  type ProviderExt,
  type ProviderModelExt,
} from "./ext.js";

type Json = Record<string, any>;

/** Extension data for a data file, as the loader saw it (or read now). */
export function extFor(file: string): { ext: ProviderExt & ProviderModelExt; toml: Json } | undefined {
  const hit = extByPath.get(file);
  if (hit) return hit;
  if (!existsSync(file)) return undefined;
  const real = realpathSync(file);
  return extByPath.get(real) ?? loadDataToml(file);
}

/** Model files under a provider's models/ dir that overlays/removed.json drops. */
function removedModels(providersDir: string, providerID: string, models: Json) {
  return Object.keys(models).filter((modelID) =>
    isRemoved(path.join(providersDir, providerID, "models", `${modelID}.toml`)),
  );
}

/** upstream generateCatalog + overlays/removed.json + extension keys. */
export async function generateCatalogCn(directory: string = REPO_ROOT) {
  const catalog = await generateCatalog(directory);
  const providersDir = path.join(directory, "providers");
  const providers = catalog.providers as Json;
  const models = catalog.models as Json;
  if (path.resolve(directory) !== REPO_ROOT) return catalog;

  // Lab models (models.json): lab-level extension keys.
  for (const [id, model] of Object.entries(models)) {
    Object.assign(model, modelExtOutput(extFor(path.join(directory, "models", `${id}.toml`))?.ext ?? {}));
  }

  const aliases: Array<[string, string]> = [];
  for (const [providerID, provider] of Object.entries(providers)) {
    const providerFile = path.join(providersDir, providerID, "provider.toml");
    const providerData = extFor(providerFile);
    const alias = providerData?.toml.v1_alias as { provider: string } | undefined;
    if (alias !== undefined) {
      // v1_alias providers copy their target's models (see generate.ts) and
      // never carried provider-level extension keys.
      aliases.push([providerID, alias.provider]);
      continue;
    }
    for (const modelID of removedModels(providersDir, providerID, provider.models)) delete provider.models[modelID];
    for (const [modelID, model] of Object.entries(provider.models as Json)) {
      const data = extFor(path.join(providersDir, providerID, "models", `${modelID}.toml`));
      Object.assign(model, modelExtOutput(data?.ext ?? {}, model.canonical_model_id, data?.toml));
    }
    Object.assign(provider, providerExtOutput((providerData?.ext ?? {}) as ProviderExt));
  }

  // Aliases: same models as the target, so the same removals and extension keys.
  const MODEL_KEYS = ["name_zh", "aliases", "cost_cny", "reasoning_default", "limit_label", "sources", "checked_at", "notes"];
  for (const [providerID, targetID] of aliases) {
    const provider = providers[providerID];
    const target = providers[targetID];
    if (provider === undefined || target === undefined) continue;
    for (const modelID of Object.keys(provider.models)) {
      const source = target.models[modelID];
      if (source === undefined) {
        delete provider.models[modelID];
        continue;
      }
      for (const key of MODEL_KEYS) if (source[key] !== undefined) provider.models[modelID][key] = source[key];
    }
  }

  return catalog;
}

/** upstream generateV2 + overlays/removed.json (upstream-shaped, no extension keys). */
export async function generateV2Cn(providersDir: string = path.join(REPO_ROOT, "providers")) {
  const v2 = (await generateV2(providersDir)) as Json;
  if (path.resolve(providersDir) !== path.join(REPO_ROOT, "providers")) return v2;
  for (const [providerID, provider] of Object.entries(v2)) {
    if (!provider?.models) continue;
    for (const modelID of removedModels(providersDir, providerID, provider.models)) delete provider.models[modelID];
  }
  return v2;
}

export type { ProviderModelExt };
