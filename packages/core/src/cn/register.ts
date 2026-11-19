// zy-models: Bun loader plugin for the repo's data TOML files.
//
// Upstream code (generate.ts, generate-v2.ts, validate.ts, …) reads data with
// `import(file, { with: { type: "toml" } })`. This plugin intercepts those
// imports for files under providers/, models/ and labs/ of this repo and
// returns what upstream should see:
//   - the matching overlays/<same path>.toml deep-merged on top, and
//   - our extension keys (name_zh, cost_cny, plans, …) removed, after
//     validating them, so the strict upstream schemas still pass.
// The extension keys are kept in `extByPath` so ./catalog.ts can re-attach
// them to the generated catalog.
//
// This keeps every upstream source file byte-for-byte upstream, so the daily
// upstream merge cannot conflict on our hooks. It is preloaded for `bun run`
// and `bun test` through the root bunfig.toml, and imported explicitly by our
// own entry points (scripts/*.ts, packages/web/script/cn-build.ts, …).
import { plugin } from "bun";
import path from "node:path";
import { REPO_ROOT, extByPath, loadDataToml } from "./ext.js";

const g = globalThis as { __zyModelsLoader?: boolean };
if (!g.__zyModelsLoader) {
  g.__zyModelsLoader = true;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const roots = ["providers", "models", "labs"].map((dir) => escape(path.join(REPO_ROOT, dir) + path.sep));
  const filter = new RegExp(`^(${roots.join("|")}).*\\.toml$`);
  plugin({
    name: "zy-models-data",
    setup(build) {
      build.onLoad({ filter }, (args) => {
        const { toml, ext } = loadDataToml(args.path);
        extByPath.set(args.path, { ext, toml: structuredClone(toml) });
        return { exports: { ...toml, default: toml }, loader: "object" };
      });
    },
  });
}
