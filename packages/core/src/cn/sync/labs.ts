// Lab resolution for new models, mirroring scripts/import-research.ts
// (LAB_DIR / FIRST_PARTY / normalizeId / findBaseModel): a new model is only
// added when the importer will find its lab model under models/, so the sync
// never generates placeholder lab files.
import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { REPO_ROOT } from "../ext.js";

// Research `lab` key → models/<dir> (same table as the importer).
export const LAB_DIR: Record<string, string> = {
  qwen: "alibaba",
  alibaba: "alibaba",
  moonshot: "moonshotai",
  moonshotai: "moonshotai",
  zhipu: "zhipuai",
  zai: "zhipuai",
  sensetime: "sensetime",
  sensenova: "sensetime",
  bytedance: "bytedance-seed",
  doubao: "bytedance-seed",
  ernie: "baidu",
  ant: "inclusionai",
  "tencent-hunyuan": "tencent",
  hunyuan: "tencent",
  "huawei-pangu": "huawei",
  "ant-ling": "inclusionai",
};

const FIRST_PARTY: Record<string, string> = {
  deepseek: "deepseek", moonshotai: "moonshotai-cn", zhipuai: "zhipuai", minimax: "minimax-cn", xiaomi: "xiaomi",
  stepfun: "stepfun", alibaba: "alibaba-cn", tencent: "tencent-tokenhub", meituan: "longcat", "bytedance-seed": "volcengine",
  inclusionai: "bailing", sensetime: "sensenova",
};

// Model id namespace (`<ns>/<model>`) as hosts publish it → research `lab` key.
const NAMESPACE_LAB: Record<string, string> = {
  "deepseek": "deepseek",
  "deepseek-ai": "deepseek",
  "qwen": "qwen",
  "alibaba": "qwen",
  "zai-org": "zhipu",
  "z-ai": "zhipu",
  "zhipuai": "zhipu",
  "thudm": "zhipu",
  "moonshotai": "moonshot",
  "minimax": "minimax",
  "minimaxai": "minimax",
  "tencent": "tencent",
  "xiaomi": "xiaomi",
  "xiaomimimo": "xiaomi",
  "stepfun": "stepfun",
  "stepfun-ai": "stepfun",
  "meituan": "meituan",
  "meituan-longcat": "meituan",
  "bytedance": "bytedance",
  "bytedance-seed": "bytedance",
  "inclusionai": "ant",
  "sensenova": "sensenova",
  "baidu": "ernie",
};

/** Research `lab` key for a host model id, from its namespace or name prefix. */
export function labFromID(id: string): string | undefined {
  const lower = id.toLowerCase().replace(/^pro\//, "");
  const slash = lower.indexOf("/");
  if (slash > 0) return NAMESPACE_LAB[lower.slice(0, slash)];
  if (/^(glm|cogview|codegeex)/.test(lower)) return "zhipu";
  if (/^(doubao|seed)/.test(lower)) return "bytedance";
  if (/^deepseek/.test(lower)) return "deepseek";
  if (/^(qwen|qwq)/.test(lower)) return "qwen";
  if (/^kimi/.test(lower)) return "moonshot";
  if (/^minimax/.test(lower)) return "minimax";
  return undefined;
}

const readToml = (file: string) => Bun.TOML.parse(readFileSync(file, "utf8")) as Record<string, any>;

function modelFiles(providerId: string) {
  const dir = path.join(REPO_ROOT, "providers", providerId, "models");
  const map = new Map<string, string>();
  if (!existsSync(dir)) return map;
  for (const f of new Bun.Glob("**/*.toml").scanSync({ cwd: dir })) map.set(f.slice(0, -5).toLowerCase(), f.slice(0, -5));
  return map;
}

export function normalizeId(id: string) {
  return id
    .toLowerCase()
    .replace(/^doubao-/, "")
    .replace(/-\d{6}$/, "")
    .replace(/(\d)-(\d)(?=-|$)/g, "$1.$2");
}

const candidatesFor = (ids: string[]) => {
  const shorts = ids.map((id) => id.split("/").pop()!);
  return [...new Set(shorts.flatMap((s) => [s, normalizeId(s), normalizeId(s).replace(/-(economy|ga)$/, "")]))];
};

/** The lab model (`<dir>/<id>`) the importer would use as base_model, or undefined. */
export function findBaseModel(lab: string, ids: string[]): string | undefined {
  const labDir = LAB_DIR[lab] ?? lab;
  const candidates = candidatesFor(ids);
  const firstParty = FIRST_PARTY[labDir];
  if (firstParty) {
    const files = modelFiles(firstParty);
    for (const c of candidates) {
      const hit = files.get(c.toLowerCase());
      if (!hit) continue;
      const base = readToml(path.join(REPO_ROOT, "providers", firstParty, "models", `${hit}.toml`)).base_model;
      if (base && existsSync(path.join(REPO_ROOT, "models", `${base}.toml`))) return base as string;
    }
  }
  return findLabModel(labDir, candidates);
}

function findLabModel(labDir: string, candidates: string[]) {
  const dir = path.join(REPO_ROOT, "models", labDir);
  if (!existsSync(dir)) return undefined;
  const names = readdirSync(dir).filter((f) => f.endsWith(".toml")).map((f) => f.slice(0, -5));
  for (const c of candidates) {
    const hit = names.find((n) => n.toLowerCase() === c.toLowerCase());
    if (hit) return `${labDir}/${hit}`;
  }
  return undefined;
}

/**
 * Base model for an automatically added model: only when a lab file has the
 * model's own (normalized) id AND the importer resolves to that same file. The
 * importer's first-party alias step (a host's `deepseek-v4-flash` → whatever
 * DeepSeek's own alias points at today) is fine for curated research but not
 * for unattended creation, so a disagreement is left for manual review.
 */
export function strictBaseModel(lab: string, ids: string[]): { base?: string; own?: string; importer?: string } {
  const labDir = LAB_DIR[lab] ?? lab;
  const own = findLabModel(labDir, candidatesFor(ids));
  const importer = findBaseModel(lab, ids);
  return { base: own !== undefined && own === importer ? own : undefined, own, importer };
}

/** lowercase id → file id of providers/<id>/models/**. */
export function catalogModelIDs(providerId: string) {
  return modelFiles(providerId);
}
