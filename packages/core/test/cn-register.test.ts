// zy-models: the loader plugin that lets upstream code (unchanged) see overlays.
import { describe, expect, test } from "bun:test";
import path from "node:path";
import "../src/cn/register.ts";
import { REPO_ROOT, extByPath } from "../src/cn/ext.ts";

const importToml = async (rel: string) =>
  (await import(path.join(REPO_ROOT, rel), { with: { type: "toml" } })).default as Record<string, any>;

describe("zy-models data loader", () => {
  test("upstream imports get the overlay merged and extension keys stripped", async () => {
    const rel = "providers/alibaba-cn/models/deepseek-v4-pro-0813.toml";
    const toml = await importToml(rel);
    // upstream keys are still there
    expect(toml.base_model ?? toml.name).toBeTruthy();
    // extension keys from the overlay are not visible to upstream schemas …
    for (const key of ["cost_cny", "reasoning_default", "sources", "checked_at"]) expect(toml).not.toHaveProperty(key);
    // … but are kept for the catalog
    const ext = extByPath.get(path.join(REPO_ROOT, rel))?.ext as Record<string, any>;
    expect(ext.cost_cny.input).toBe(9);
    expect(ext.reasoning_default.value).toBe("on");
  });

  test("provider.toml extension keys are split off too", async () => {
    const rel = "providers/alibaba-cn/provider.toml";
    const toml = await importToml(rel);
    expect(toml).not.toHaveProperty("name_zh");
    expect(toml).not.toHaveProperty("region");
    const ext = extByPath.get(path.join(REPO_ROOT, rel))?.ext as Record<string, any>;
    expect(ext.region).toBe("cn");
  });

  test("files outside the data dirs are left alone", async () => {
    const tmp = path.join(import.meta.dir, "..", "..", "..", "node_modules", ".zy-register-test.toml");
    await Bun.write(tmp, 'name_zh = "x"\n');
    const toml = (await import(tmp, { with: { type: "toml" } })).default;
    expect(toml).toEqual({ name_zh: "x" });
  });
});
