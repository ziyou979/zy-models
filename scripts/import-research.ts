#!/usr/bin/env bun
// zy-models: imports research/*.json (国内平台调研数据, format in research/FORMAT.md)
// into the catalog.
//
//   bun scripts/import-research.ts [--rate 6.685797 --rate-date 2026-11-12]
//
// - Existing upstream providers/models are never edited: their Chinese data goes
//   to overlays/<same path>.toml (deep-merged at load time, see
//   packages/core/src/cn/ext.ts). Numeric conflicts (limits, prices) are resolved
//   in favour of the research data, written into the overlay and listed in
//   research/IMPORT_REPORT.md for the PR description.
// - Plans are attached to an existing plan-type provider when its `api` matches
//   the plan's base_url (alibaba-token-plan-cn, kimi-code-plan-cn,
//   zhipuai-coding-plan, …); otherwise they stay on the research provider.
// - New providers / new models are written as normal files; hosted models use
//   `base_model` pointing at models/<lab>/, and a lab file is created when
//   missing. null research fields are never written.
// - Re-runnable: everything the previous run generated (overlays/ and the files
//   in scripts/import-manifest.json) is removed first.
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const ROOT = path.resolve(import.meta.dir, "..");
const RESEARCH_DIR = path.join(ROOT, "research");
const OVERLAYS = path.join(ROOT, "overlays");
const MANIFEST = path.join(ROOT, "scripts", "import-manifest.json");
const REPORT = path.join(RESEARCH_DIR, "IMPORT_REPORT.md");

type Json = Record<string, any>;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

// ---------------------------------------------------------------- cleanup
if (existsSync(MANIFEST)) {
  for (const file of JSON.parse(readFileSync(MANIFEST, "utf8")) as string[]) {
    await fs.rm(path.join(ROOT, file), { force: true });
  }
}
await fs.rm(OVERLAYS, { recursive: true, force: true });
const generated: string[] = [];

// Baseline = upstream data only (imported after cleanup, so no overlays).
const { generateCatalog } = await import("../packages/core/src/index.ts");
const baseline = (await generateCatalog(ROOT)) as { providers: Json; models: Json };

// ---------------------------------------------------------------- exchange rate
let rate = Number(arg("rate"));
let rateDate = arg("rate-date");
const RATE_SOURCE = "https://open.er-api.com/v6/latest/USD";
if (!rate) {
  const res = (await fetch(RATE_SOURCE).then((r) => r.json())) as Json;
  rate = res.rates.CNY;
  rateDate = new Date(res.time_last_update_unix * 1000).toISOString().slice(0, 10);
}
const usd = (cny: number) => Math.round((cny / rate) * 1e8) / 1e8;

// ---------------------------------------------------------------- helpers
const LAB_DIR: Record<string, string> = {
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
  "ant-ling": "inclusionai",
};
// The lab's own API host in this repo: a hosted copy of one of its model ids
// reuses that file's base_model (e.g. deepseek-flash → deepseek/deepseek-v4.1-flash).
const FIRST_PARTY: Record<string, string> = {
  deepseek: "deepseek", moonshotai: "moonshotai-cn", zhipuai: "zhipuai", minimax: "minimax-cn", xiaomi: "xiaomi",
  stepfun: "stepfun", alibaba: "alibaba-cn", tencent: "tencent-tokenhub", meituan: "longcat", "bytedance-seed": "volcengine",
  inclusionai: "bailing", sensetime: "sensenova",
};
const LAB_NAME: Record<string, string> = {
  alibaba: "Alibaba", deepseek: "DeepSeek", moonshotai: "Moonshot AI", zhipuai: "Zhipu AI", minimax: "MiniMax",
  stepfun: "StepFun", xiaomi: "Xiaomi", meituan: "Meituan", tencent: "Tencent", "bytedance-seed": "ByteDance Seed",
  inclusionai: "inclusionAI", sensetime: "SenseTime", baidu: "Baidu", baichuan: "Baichuan", iflytek: "iFlytek",
};

// Plans: every coding/token plan forbids use as a general-purpose API.
const PLAN_USAGE_RESTRICTION =
  "订阅套餐额度仅限在官方支持的编程工具 / Agent 中交互使用，禁止当作普通 API（自建应用、批量或程序化调用）使用；违规可能被限流或封禁。具体条款见 sources。";

// Regions of upstream providers the research files don't cover (by their
// official API host). Research data wins where both exist.
const CURATED_REGION: Record<string, "cn" | "intl"> = {
  "alibaba-cn": "cn", "alibaba-coding-plan-cn": "cn", "alibaba-token-plan-cn": "cn", bailing: "cn", deepseek: "cn",
  "kimi-code-plan-cn": "cn", "kuae-cloud-coding-plan": "cn", longcat: "cn", "minimax-cn": "cn",
  "minimax-cn-coding-plan": "cn", modelscope: "cn", "moonshotai-cn": "cn", "qiniu-ai": "cn", "scnet-token-plan": "cn",
  sensenova: "cn", "siliconflow-cn": "cn", stepfun: "cn", "stepfun-step-plan": "cn", "tencent-coding-plan": "cn",
  "tencent-token-plan": "cn", "tencent-tokenhub": "cn", volcengine: "cn", "volcengine-coding-plan": "cn", xiaomi: "cn",
  "xiaomi-token-plan-cn": "cn", zhipuai: "cn", "zhipuai-coding-plan": "cn",
  alibaba: "intl", "alibaba-coding-plan": "intl", "alibaba-token-plan": "intl", minimax: "intl",
  "minimax-coding-plan": "intl", moonshotai: "intl", siliconflow: "intl", "stepfun-ai": "intl",
  "stepfun-ai-step-plan": "intl", "xiaomi-token-plan-ams": "intl", "xiaomi-token-plan-sgp": "intl",
  "kimi-code-plan-global": "intl", zai: "intl", "zai-coding-plan": "intl",
};

// Per-provider model facts the research states in prose rather than per model.
// Kimi Code (subscription) defaults differ from the Moonshot open platform (max):
// research/moonshot.json notes, source https://www.kimi.com/code/docs/kimi-code/models.html
const MODEL_HINTS: Record<string, Record<string, Json>> = {
  "kimi-code-plan-cn": {
    "k3.1-pro": { reasoning_default: { value: "high", source: "https://www.kimi.com/code/docs/kimi-code/models.html" } },
    k3: { reasoning_default: { value: "high", source: "https://www.kimi.com/code/docs/kimi-code/models.html" } },
    "kimi-for-coding": { reasoning_default: { value: "max", source: "https://www.kimi.com/code/docs/kimi-code/models.html" } },
  },
};

// Token-count labels ("128K", "1M") were converted by the research with base 1000
// for some platforms and 1024 for others. Two values with the same label are the
// same official number: keep upstream's spelling when upstream has the model,
// else use the lab's convention in models/<lab>/ (see README「数值口径」).
function labels(v: number) {
  const out = new Set<string>();
  for (const [unit, tag] of [[1000, "K"], [1024, "K"], [1e6, "M"], [1048576, "M"]] as const) {
    const x = v / unit;
    const r = Math.round(x);
    if (r >= 1 && Math.abs(x - r) / x <= 0.0012) out.add(`${tag}${r}`);
  }
  return out;
}
const sameLabel = (a: number, b: number) => [...labels(a)].some((l) => labels(b).has(l));
const labBaseCache = new Map<string, 1000 | 1024>();
function labBase(labDir: string): 1000 | 1024 {
  if (labBaseCache.has(labDir)) return labBaseCache.get(labDir)!;
  let k1000 = 0, k1024 = 0;
  const dir = path.join(ROOT, "models", labDir);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".toml"))) {
      const lim = readToml(path.join(dir, f)).limit ?? {};
      for (const v of [lim.context, lim.output]) {
        if (!isNum(v)) continue;
        if (v % 1024 === 0 && v % 1000 !== 0) k1024++;
        else if (v % 1000 === 0 && v % 1024 !== 0) k1000++;
      }
    }
  }
  const base = k1024 >= k1000 ? 1024 : 1000;
  labBaseCache.set(labDir, base);
  return base;
}
function toLabBase(v: number, labDir: string) {
  const base = labBase(labDir);
  if (base === 1024 && v % 1000 === 0 && v % 1024 !== 0) return v % 1e6 === 0 ? (v / 1e6) * 1048576 : (v / 1000) * 1024;
  if (base === 1000 && v % 1024 === 0 && v % 1000 !== 0) return v % 1048576 === 0 ? (v / 1048576) * 1e6 : (v / 1024) * 1000;
  return v;
}

// Price normalisation (models.dev cost semantics): the main fields hold the
// standard (peak / regular) price. Some research files put the off-peak price
// in the main fields and the peak price in a time-of-day tier; swap those. Tiers
// marked 原价 become list_price.
const TIME_RE = /北京|时段|高峰|空闲|闲时|峰谷|peak|\d{1,2}[:：]\d{2}|\d+点/i;
const LIST_RE = /原价|list price/i;
function normalizePrice(p: Json | null | undefined) {
  if (!p) return p;
  const tiers: Json[] = p.tiers ?? [];
  const timeTiers = tiers.filter((t) => TIME_RE.test(String(t.when)) && !LIST_RE.test(String(t.when)));
  const listTiers = tiers.filter((t) => LIST_RE.test(String(t.when)));
  const out: Json = { ...p };
  let swapped = false;
  const peak = [p, ...timeTiers].filter((t) => isNum(t.input)).sort((a, b) => b.input - a.input)[0];
  if (peak && peak !== p && peak.input > p.input) {
    for (const k of ["input", "output", "cache_read", "cache_write"]) if (isNum(peak[k])) out[k] = peak[k];
    swapped = true;
  }
  const list = listTiers.filter((t) => isNum(t.input)).sort((a, b) => b.input - a.input)[0];
  if (list) out.list_price = { input: list.input, output: list.output, cache_read: list.cache_read, cache_write: list.cache_write };
  if (swapped) out.off_peak = [p.off_peak, "（导入时已统一：主字段为标准/高峰价，闲时价见 tiers。）"].filter(Boolean).join(" ");
  return out;
}

// Hosts whose upstream `cost` is the platform's own published USD price.
const USD_NATIVE = new Set(["deepseek", "xiaomi"]);
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const urlRe = /^https?:\/\/\S+$/;
const urls = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s*[;；,，]\s*|\s+/) : [])
    .map((s: string) => String(s).trim())
    .filter((s: string) => urlRe.test(s));
const normUrl = (u: string) => u.toLowerCase().replace(/\/+$/, "").replace(/\/v1$/, "");
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, 0.02 * Math.max(Math.abs(a), Math.abs(b)));
const providerExists = (id: string) => existsSync(path.join(ROOT, "providers", id, "provider.toml"));
const readToml = (file: string) => Bun.TOML.parse(readFileSync(file, "utf8")) as Json;
const stripNulls = (v: any): any => {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === "object") {
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined) continue;
      const y = stripNulls(x);
      if (y && typeof y === "object" && !Array.isArray(y) && Object.keys(y).length === 0) continue;
      if (Array.isArray(y) && y.length === 0) continue;
      out[k] = y;
    }
    return out;
  }
  return v;
};

// ---------------------------------------------------------------- TOML writer
const bare = /^[A-Za-z0-9_-]+$/;
const key = (k: string) => (bare.test(k) ? k : JSON.stringify(k));
const isTable = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
const isTableArray = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(isTable);
function scalar(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) >= 10000 ? v.toLocaleString("en-US").replaceAll(",", "_") : String(v);
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(scalar).join(", ")}]`;
  if (isTable(v)) return `{ ${Object.entries(v as Json).map(([k, x]) => `${key(k)} = ${scalar(x)}`).join(", ")} }`;
  throw new Error(`Cannot serialise ${v}`);
}
// `inline` lists dotted paths written as inline tables (e.g. capabilities.reasoning).
function toToml(obj: Json, header: string[] = [], inline: string[] = []): string {
  const lines: string[] = header.map((h) => (h ? `# ${h}` : "#"));
  const emit = (table: Json, prefix: string[]) => {
    const subs: [string, any][] = [];
    for (const [k, v] of Object.entries(table)) {
      const full = [...prefix, k].join(".");
      if ((isTable(v) && !inline.includes(full)) || isTableArray(v)) subs.push([k, v]);
      else lines.push(`${key(k)} = ${scalar(v)}`);
    }
    for (const [k, v] of subs) {
      const p = [...prefix, k];
      if (isTableArray(v)) {
        for (const item of v) {
          lines.push("", `[[${p.map(key).join(".")}]]`);
          emit(item, p);
        }
      } else {
        const hasScalars = Object.entries(v).some(([kk, x]) => !(isTable(x) && !inline.includes([...p, kk].join("."))) && !isTableArray(x));
        if (hasScalars) lines.push("", `[${p.map(key).join(".")}]`);
        emit(v, p);
      }
    }
  };
  emit(obj, []);
  return lines.join("\n").replace(/^\n+/, "") + "\n";
}
async function writeFile(rel: string, content: string, track = true) {
  const file = path.join(ROOT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, content);
  if (track && !rel.startsWith("overlays/")) generated.push(rel);
}

// ---------------------------------------------------------------- research → ext
function tierBounds(when: string) {
  const n = (s: string) => {
    const m = s.match(/^([\d.]+)\s*([km]?)$/i);
    if (!m) return undefined;
    return Math.round(Number(m[1]) * (m[2].toLowerCase() === "k" ? 1000 : m[2].toLowerCase() === "m" ? 1_000_000 : 1));
  };
  if (/output|service_tier|batch|北京|时段|off-peak/i.test(when)) return {};
  const out: Json = {};
  const between = when.match(/([\d.]+[km]?)\s*<=?\s*input\s*<(=?)\s*([\d.]+[km]?)/i);
  if (between) return { context_min: n(between[1]), context_max: n(between[3]) };
  const lt = when.match(/input\s*<(=?)\s*([\d.]+[km]?)/i);
  if (lt) out.context_max = n(lt[2]);
  const gt = when.match(/input\s*>(=?)\s*([\d.]+[km]?)/i);
  if (gt) out.context_min = n(gt[2]);
  return out;
}
function costCny(p: Json | null | undefined) {
  if (!p) return undefined;
  return stripNulls({
    input: p.input, output: p.output, cache_read: p.cache_read, cache_write: p.cache_write,
    cache_write_1h: p.cache_write_1h, list_price: p.list_price, discount_note: p.discount_note,
    tiers: (p.tiers ?? []).map((t: Json) => ({ when: t.when, ...tierBounds(String(t.when)), input: t.input, output: t.output, cache_read: t.cache_read, cache_write: t.cache_write })),
    off_peak: p.off_peak,
    note: p.note,
  });
}
function cleanAlias(a: string) {
  return a.split(/[（(\s]/)[0].trim();
}
function modelExt(m: Json, _providerId: string) {
  const notes = m.notes;
  const r = m.reasoning ?? {};
  return stripNulls({
    name_zh: m.name_zh,
    aliases: (m.aliases ?? []).map(cleanAlias).filter((a: string) => a && a !== m.id),
    cost_cny: costCny(m.price_cny),
    reasoning_default: r.default ? { value: String(r.default), source: urlRe.test(r.default_source ?? "") ? r.default_source : undefined } : undefined,
    sources: urls(m.sources),
    checked_at: m.checked_at,
    notes: notes || undefined,
  });
}
function upstreamDefault(value: string, reasoning: Json | undefined) {
  if (!reasoning?.supported) return undefined;
  if ((value === "on" || value === "off") && reasoning.toggle) return { type: "toggle", value: value === "on" };
  if (EFFORTS.includes(value) && (reasoning.effort ?? []).includes(value)) return { type: "effort", value };
  return undefined;
}

// ---------------------------------------------------------------- upstream fixes
// Upstream models.dev data that is out of date. Fixed here (provider fields via
// overlays, delisted models via overlays/removed.json) and written to
// docs/upstream-fixes.md so they can be sent upstream as a PR.
const researchDoc = (providerId: string, key = "doc") => {
  const f = path.join(RESEARCH_DIR, `${providerId}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Json)[key] : undefined;
};
const PROVIDER_FIXES: Record<string, { set: Json; reason: string; sources: string[] }> = {
  bailing: {
    set: { api: "https://api.ant-ling.com/v1", doc: researchDoc("ant-ling") },
    reason:
      "百灵（蚂蚁 Ling）平台已迁移：旧地址 https://api.tbox.cn/api/llm/v1 → OpenAI 兼容 https://api.ant-ling.com/v1，Anthropic 兼容 https://api.ant-ling.com/anthropic。",
    sources: [researchDoc("ant-ling"), researchDoc("ant-ling", "pricing_page")].filter(Boolean),
  },
};
const REMOVALS: { path: string; reason: string; source?: string; replacement?: string }[] = [
  { path: "providers/bailing/models/Ling-1T.toml", reason: "Ling-1T 已于 2026-06-15 下架（research/ant-ling.json notes）", source: researchDoc("ant-ling") },
  { path: "providers/bailing/models/Ring-1T.toml", reason: "Ring-1T 已于 2026-06-15 下架；Ring 系列并入 Ling 混合推理（research/ant-ling.json notes）", source: researchDoc("ant-ling") },
  { path: "providers/longcat/models/LongCat-2.0.toml", reason: "LongCat 按量价目表已不再列出 LongCat-2.0，按量仅支持 LongCat-2.5（research/longcat.json notes）", source: researchDoc("longcat", "pricing_page") },
  { path: "providers/longcat/models/LongCat-2.5-Preview.toml", reason: "LongCat-2.5-Preview 不在官方按量价目表（仅 LongCat-2.5）", source: researchDoc("longcat", "pricing_page") },
  { path: "providers/sensenova/models/deepseek-v4.1-flash.toml", reason: "商汤平台该模型的官方 ID 现为 deepseek-flash", source: researchDoc("sensenova"), replacement: "providers/sensenova/models/deepseek-flash.toml（研究导入新建）" },
];

// ---------------------------------------------------------------- state
const report = {
  conflicts: [] as string[],
  additions: [] as string[],
  differences: [] as string[],
  placeholders: [] as string[],
  unitKept: [] as string[],
  providers: [] as string[],
  newModels: [] as string[],
  newLabModels: [] as string[],
  overlays: 0,
};
const providerOverlay = new Map<string, Json>(); // provider id → ext + overrides
const modelOverlay = new Map<string, Json>(); // "providers/<p>/models/<m>.toml" → overlay

function upstreamModelFiles(providerId: string) {
  const dir = path.join(ROOT, "providers", providerId, "models");
  const map = new Map<string, string>(); // lowercase id → id
  if (!existsSync(dir)) return map;
  for (const f of new Bun.Glob("**/*.toml").scanSync({ cwd: dir })) {
    const id = f.slice(0, -5);
    map.set(id.toLowerCase(), id);
  }
  return map;
}
function findLabModel(labDir: string, ids: string[]) {
  const dir = path.join(ROOT, "models", labDir);
  if (!existsSync(dir)) return undefined;
  const names = readdirSync(dir).filter((f) => f.endsWith(".toml")).map((f) => f.slice(0, -5));
  for (const id of ids) {
    const short = id.split("/").pop()!.toLowerCase();
    const hit = names.find((n) => n.toLowerCase() === short);
    if (hit) return `${labDir}/${hit}`;
  }
  return undefined;
}

// "doubao-seed-2-1-lite-260915" → "seed-2.1-lite"; "kimi-k3-1-pro-261024" → "kimi-k3.1-pro".
function normalizeId(id: string) {
  return id
    .toLowerCase()
    .replace(/^doubao-/, "")
    .replace(/-\d{6}$/, "")
    .replace(/(\d)-(\d)(?=-|$)/g, "$1.$2");
}
function findBaseModel(labDir: string, ids: string[]) {
  const shorts = ids.map((id) => id.split("/").pop()!);
  const candidates = [...new Set(shorts.flatMap((s) => [s, normalizeId(s), normalizeId(s).replace(/-(economy|ga)$/, "")]))];
  const fp = FIRST_PARTY[labDir];
  if (fp) {
    const files = upstreamModelFiles(fp);
    for (const c of candidates) {
      const hit = files.get(c.toLowerCase());
      if (!hit) continue;
      const bm = readToml(path.join(ROOT, "providers", fp, "models", `${hit}.toml`)).base_model;
      if (bm && existsSync(path.join(ROOT, "models", `${bm}.toml`))) return bm as string;
    }
  }
  return findLabModel(labDir, candidates);
}

// ---------------------------------------------------------------- import
const files = readdirSync(RESEARCH_DIR).filter((f) => f.endsWith(".json")).sort();
for (const file of files) {
  const r = JSON.parse(readFileSync(path.join(RESEARCH_DIR, file), "utf8")) as Json;
  const pid: string =
    r.modelsdev_id && providerExists(r.modelsdev_id) ? r.modelsdev_id : providerExists(r.provider_id) ? r.provider_id : r.provider_id;
  const isNew = !providerExists(pid);
  const endpoints: Json[] = r.endpoints ?? [];

  // Region: the endpoint whose host serves the provider's api, else cn when all endpoints are cn.
  let region: "cn" | "intl" | undefined;
  const upstreamApi: string | undefined = isNew
    ? undefined
    : PROVIDER_FIXES[pid]?.set.api ?? readToml(path.join(ROOT, "providers", pid, "provider.toml")).api;
  if (upstreamApi) {
    const host = new URL(upstreamApi).host;
    region = endpoints.find((e) => e.base_url && new URL(e.base_url).host === host)?.region;
  }
  region ??= endpoints.length > 0 && endpoints.every((e) => e.region === "cn") ? "cn" : CURATED_REGION[pid] ?? "cn";

  // Plans → existing plan-type providers when their api matches.
  const ownPlans: Json[] = [];
  for (const plan of r.plans ?? []) {
    const entry = stripNulls({
      id: plan.id, name_zh: plan.name_zh, name: plan.name,
      price_cny_month: plan.price_cny_month, price_cny_quarter: plan.price_cny_quarter, price_cny_year: plan.price_cny_year,
      base_url: plan.base_url, anthropic_base_url: plan.anthropic_base_url, other_base_urls: plan.other_clusters ?? plan.other_base_urls,
      protocol: plan.protocol, models: plan.models, quota_note: plan.quota_note,
      usage_restriction: plan.usage_restriction ?? PLAN_USAGE_RESTRICTION, sources: urls(plan.source ?? plan.sources),
    });
    let target: string | undefined;
    if (plan.base_url) {
      const candidates = Object.values(baseline.providers)
        .filter((p: any) => p.api && normUrl(p.api) === normUrl(plan.base_url))
        .map((p: any) => p.id as string);
      target = candidates.find((c) => c.includes("plan")) ?? candidates.find((c) => c !== pid);
    }
    if (target && target !== pid) {
      const o = providerOverlay.get(target) ?? {};
      (o.plans ??= []).push(entry);
      o.region ??= CURATED_REGION[target] ?? region;
      o.__plan_names = [...(o.__plan_names ?? []), plan.name_zh];
      providerOverlay.set(target, o);
      report.additions.push(`plan \`${plan.id}\` → provider \`${target}\` (matched api ${plan.base_url})`);
    } else ownPlans.push(entry);
  }

  const pExt = stripNulls({ name_zh: r.name_zh, region, pricing_page: r.pricing_page, plans: ownPlans, notes: r.notes });
  if (isNew) {
    // New provider: provider.toml + logo.
    const chat = endpoints.find((e) => e.protocol === "openai-chat" && e.region === region) ?? endpoints.find((e) => e.protocol === "openai-chat");
    const anth = endpoints.find((e) => e.protocol === "anthropic");
    const names = new Set(Object.values(baseline.providers).map((p: any) => p.name.toLowerCase()));
    let name = r.name_en ?? r.provider_id;
    if (names.has(name.toLowerCase())) name = `${name} (China)`;
    const body: Json = chat
      ? { name, env: r.env?.length ? r.env : [`${pid.toUpperCase().replace(/-/g, "_")}_API_KEY`], npm: "@ai-sdk/openai-compatible", opencodeai: "@opencode/ai/providers/openai-compatible", api: chat.base_url, doc: r.doc ?? r.pricing_page }
      : { name, env: r.env?.length ? r.env : [`${pid.toUpperCase().replace(/-/g, "_")}_API_KEY`], npm: "@ai-sdk/anthropic", opencodeai: "@opencode/ai/providers/anthropic-compatible", api: `${anth.base_url.replace(/\/$/, "")}/v1`, doc: r.doc ?? r.pricing_page };
    await writeFile(`providers/${pid}/provider.toml`, toToml({ ...body, ...pExt }, [`Imported from research/${file} by scripts/import-research.ts`, ...endpoints.map((e) => `${e.region} ${e.protocol}: ${e.base_url} (${e.source})`)]));
    await writeFile(`providers/${pid}/logo.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>\n`);
    report.providers.push(`${pid} (新建)`);
  } else {
    providerOverlay.set(pid, { ...(providerOverlay.get(pid) ?? {}), ...pExt });
    report.providers.push(`${pid} ← research/${file}`);
  }

  // Models.
  const existing = upstreamModelFiles(pid);
  for (const m0 of r.models ?? []) {
    const m = { ...m0, price_cny: normalizePrice(m0.price_cny) };
    const ext = { ...modelExt(m, pid), ...(MODEL_HINTS[pid]?.[m.id] ?? {}) };
    const hit = [m.id, ...(m.aliases ?? []).map(cleanAlias)].map((a: string) => existing.get(a.toLowerCase())).find(Boolean);

    if (hit) {
      const rel = `providers/${pid}/models/${hit}.toml`;
      const raw = readToml(path.join(ROOT, rel));
      const base = baseline.providers[pid]?.models?.[hit];
      const overlay: Json = { ...ext };
      // Numeric conflicts: research wins.
      for (const k of ["context", "input", "output"]) {
        const want = m.limit?.[k];
        if (!isNum(want) || base === undefined) continue;
        const have = base.limit?.[k];
        if (isNum(have) && have !== want && sameLabel(have, want)) {
          report.unitKept.push(`${pid}/${hit} limit.${k}: 上游 ${have} / 研究 ${want}（同一标称值，沿用上游）`);
          continue;
        }
        if (have !== want) {
          (overlay.limit ??= {})[k] = want;
          (have === undefined ? report.additions : report.conflicts).push(`${pid}/${hit} limit.${k}: ${have ?? "—"} → ${want}`);
        }
      }
      const p = m.price_cny;
      const isFree = (base?.cost?.input === 0 && base?.cost?.output === 0);
      // Length/output-banded prices: the research base is the lowest band, upstream's base may be another band.
      const banded = (p?.tiers ?? []).filter((t: Json) => /input|output/i.test(String(t.when))).length >= 2;
      // Upstream already carries the platform's official USD price (same as research price_usd_intl, or a host
      // that publishes USD prices itself): converting CNY would be wrong.
      const usdNative =
        USD_NATIVE.has(pid) ||
        (isNum(m.price_usd_intl?.input) && isNum(base?.cost?.input) && close(m.price_usd_intl.input, base.cost.input));
      if (p && base && !isFree && (banded || usdNative)) {
        const cnyIn = isNum(p.input) ? usd(p.input) : undefined;
        if (cnyIn !== undefined && isNum(base.cost?.input) && !close(cnyIn, base.cost.input))
          report.differences.push(`${pid}/${hit} cost.input: upstream $${base.cost.input} vs research ¥${p.input}（${banded ? "研究价格分档，基础价为最低档" : "上游为官方美元价"}，未覆盖）`);
      } else if (p && base && !isFree) {
        const pairs: [string, number | undefined, number | undefined, string[]][] = [
          ["input", p.input, base.cost?.input, ["text", "input", "price"]],
          ["output", p.output, base.cost?.output, ["text", "output", "price"]],
          ["cache_read", p.cache_read, base.cost?.cache_read, ["text", "input", "cache", "read"]],
        ];
        for (const [label, cny, have, at] of pairs) {
          if (!isNum(cny)) continue;
          const want = region === "intl" && isNum(m.price_usd_intl?.[label]) ? m.price_usd_intl[label] : usd(cny);
          if (have !== undefined && close(have, want)) continue;
          if (have === undefined && label !== "input" && overlay.cost === undefined && base.cost === undefined) {
            // only write cache/output when input is written too
          }
          let t = (overlay.cost ??= {});
          for (const seg of at.slice(0, -1)) t = t[seg] ??= {};
          t[at.at(-1)!] = want;
          (have === undefined ? report.additions : report.conflicts).push(
            `${pid}/${hit} cost.${label} (USD): ${have ?? "—"} → ${want} (¥${cny} ÷ ${rate})`,
          );
        }
      }
      // Reasoning default → upstream field too, when it maps onto the file's controls.
      const reasoning = raw.capabilities?.reasoning;
      if (ext.reasoning_default) {
        const def = upstreamDefault(ext.reasoning_default.value, reasoning);
        const cur = reasoning?.default;
        if (def && cur && cur.type !== def.type) {
          report.differences.push(`${pid}/${hit} reasoning.default: upstream ${JSON.stringify(cur)} vs research "${ext.reasoning_default.value}"（类型不同，未覆盖上游字段；reasoning_default 扩展字段按研究写入）`);
        } else if (def && JSON.stringify(cur) !== JSON.stringify(def)) {
          overlay.capabilities = { reasoning: { default: def } };
          (cur ? report.conflicts : report.additions).push(`${pid}/${hit} reasoning.default: ${cur ? JSON.stringify(cur) : "—"} → ${JSON.stringify(def)}`);
        }
      }
      // Non-numeric differences: reported only.
      const rr = m.reasoning ?? {};
      if (Array.isArray(rr.effort) && rr.effort.length && reasoning?.effort && JSON.stringify(rr.effort) !== JSON.stringify(reasoning.effort))
        report.differences.push(`${pid}/${hit} reasoning.effort: upstream ${JSON.stringify(reasoning.effort)} vs research ${JSON.stringify(rr.effort)}`);
      if (typeof m.open_weights === "boolean" && base && base.open_weights !== m.open_weights)
        report.differences.push(`${pid}/${hit} open_weights: upstream ${base.open_weights} vs research ${m.open_weights}`);
      if (m.release_date && base && base.release_date !== m.release_date)
        report.differences.push(`${pid}/${hit} release_date: upstream ${base.release_date} vs research ${m.release_date}`);
      modelOverlay.set(rel, overlay);
      continue;
    }

    // New model on this provider.
    const labDir = LAB_DIR[m.lab] ?? m.lab ?? pid;
    let baseModel = findBaseModel(labDir, [m.id, ...(m.aliases ?? []).map(cleanAlias)]);
    const header = [`Imported from research/${file} by scripts/import-research.ts (checked ${m.checked_at ?? "?"})`, ...urls(m.sources).map((u) => `Source: ${u}`)];
    const tools = m.tools === true;
    const r0 = m.reasoning ?? {};
    if (!baseModel) {
      const short = m.id.split("/").pop()!;
      const labId = `${labDir}/${labDir === "minimax" ? short : normalizeId(short)}`;
      const placeholders: string[] = [];
      const ctx = isNum(m.limit?.context) ? toLabBase(m.limit.context, labDir) : undefined;
      if (!isNum(ctx)) {
        report.placeholders.push(`${pid}/${m.id}: 跳过（无 context，无法生成 lab 文件）`);
        continue;
      }
      let output = isNum(m.limit?.output) ? toLabBase(m.limit.output, labDir) : undefined;
      if (!isNum(output)) { output = ctx; placeholders.push("limit.output 未公开，按上游惯例取 context"); }
      let release = m.release_date;
      if (!release) { release = m.checked_at; placeholders.push(`release_date 未公开，占位为核查日 ${m.checked_at}`); }
      let ow = m.open_weights;
      if (typeof ow !== "boolean") { ow = false; placeholders.push("open_weights 未确认，写 false"); }
      if (typeof m.tools !== "boolean") placeholders.push("tools 未确认，写 false");
      placeholders.push("temperature/top_p/top_k 为默认值 true/true/false，未核实");
      const lab = stripNulls({
        schema: 2,
        name: m.name ?? short,
        description: `${m.name ?? short} by ${LAB_NAME[labDir] ?? labDir}.`,
        open_weights: ow,
        release_date: release,
        modalities: { input: m.modalities?.input ?? ["text"], output: m.modalities?.output ?? ["text"] },
        capabilities: { tools: { supported: tools }, reasoning: { supported: r0.supported === true }, temperature: true, top_p: true, top_k: false },
        limit: { context: ctx, input: isNum(m.limit?.input) ? toLabBase(m.limit.input, labDir) : undefined, output },
        name_zh: m.name_zh,
      });
      await writeFile(`models/${labId}.toml`, toToml(lab, [...header, ...placeholders.map((p) => `占位: ${p}`)], ["capabilities.tools", "capabilities.reasoning"]));
      report.newLabModels.push(`${labId}${placeholders.length > 1 ? `（${placeholders.slice(0, -1).join("；")}）` : ""}`);
      baseModel = labId;
    }
    const labToml = readToml(path.join(ROOT, "models", `${baseModel}.toml`));
    const limit: Json = {};
    for (const k of ["context", "input", "output"]) {
      const want = m.limit?.[k];
      const have = labToml.limit?.[k];
      if (!isNum(want) || want === have) continue;
      if (isNum(have) && sameLabel(have, want)) continue; // same nominal value, lab spelling
      limit[k] = toLabBase(want, baseModel.split("/")[0]);
    }
    let reasoning: Json | undefined;
    if (r0.supported === true) {
      const effort = (r0.effort ?? []).filter((e: string) => EFFORTS.includes(e));
      reasoning = stripNulls({ supported: true, toggle: r0.toggle === true ? true : undefined, effort: effort.length ? effort : undefined });
      if (effort.includes("none")) delete reasoning.toggle;
      const def = r0.default ? upstreamDefault(String(r0.default), reasoning) : undefined;
      if (def) reasoning.default = def;
    } else if (r0.supported === false && labToml.capabilities?.reasoning?.supported) reasoning = { supported: false };
    const p = m.price_cny;
    const cost =
      p && isNum(p.input) && isNum(p.output)
        ? { text: { input: stripNulls({ price: usd(p.input), cache: isNum(p.cache_read) ? { read: usd(p.cache_read) } : undefined }), output: { price: usd(p.output) } } }
        : undefined;
    const body = stripNulls({
      schema: 2,
      base_model: baseModel,
      status: m.status === "beta" ? "beta" : m.status === "deprecated" ? "deprecated" : undefined,
      capabilities: stripNulls({ reasoning, structured_output: m.structured_output === true ? true : undefined }),
      limit,
      cost,
      ...ext,
    });
    const costHeader = cost ? [`Prices: CNY per 1M tokens from the official pricing page, converted to USD (rate ${rate} CNY/USD, ${rateDate}, ${RATE_SOURCE}).`, `CNY: input ${p.input}, output ${p.output}${isNum(p.cache_read) ? `, cache_read ${p.cache_read}` : ""}`] : [];
    await writeFile(`providers/${pid}/models/${m.id}.toml`, toToml(body, [...header, ...costHeader], ["capabilities.reasoning"]));
    report.newModels.push(`${pid}/${m.id} → base_model ${baseModel}`);
  }
}

// Provider hints for plan providers' models, and curated regions.
for (const [pid, hints] of Object.entries(MODEL_HINTS)) {
  const existing = upstreamModelFiles(pid);
  for (const [id, ext] of Object.entries(hints)) {
    const hit = existing.get(id.toLowerCase());
    if (!hit) continue;
    const rel = `providers/${pid}/models/${hit}.toml`;
    modelOverlay.set(rel, { ...(modelOverlay.get(rel) ?? {}), ...ext });
  }
}
for (const [pid, region] of Object.entries(CURATED_REGION)) {
  if (!providerExists(pid)) continue;
  const o = providerOverlay.get(pid) ?? {};
  o.region ??= region;
  providerOverlay.set(pid, o);
}

// Upstream fixes.
for (const [pid, fix] of Object.entries(PROVIDER_FIXES)) {
  if (!providerExists(pid)) continue;
  providerOverlay.set(pid, { ...stripNulls(fix.set), ...(providerOverlay.get(pid) ?? {}) });
}
const removals = REMOVALS.filter((r) => existsSync(path.join(ROOT, r.path)));
for (const r of removals) modelOverlay.delete(r.path);
await writeFile("overlays/removed.json", JSON.stringify(removals.map(({ path: p, reason, source }) => stripNulls({ path: p, reason, source })), null, 2) + "\n");

// Write overlays.
for (const [pid, o] of providerOverlay) {
  const { __plan_names: names, ...ext } = o;
  if (names?.length && !ext.name_zh) {
    // Common prefix of the attached plan names, e.g. "百炼 Token Plan 个人版".
    let prefix = names[0] as string;
    for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
    ext.name_zh = (prefix.trim().replace(/[（(]$/, "").trim() || names[0]) as string;
  }
  await writeFile(`overlays/providers/${pid}/provider.toml`, toToml(stripNulls(ext), [`zy-models overlay for providers/${pid}/provider.toml (generated by scripts/import-research.ts)`]));
  report.overlays++;
}
for (const [rel, o] of modelOverlay) {
  const clean = stripNulls(o);
  if (Object.keys(clean).length === 0) continue;
  await writeFile(`overlays/${rel}`, toToml(clean, [`zy-models overlay for ${rel} (generated by scripts/import-research.ts)`]));
  report.overlays++;
}

await Bun.write(MANIFEST, JSON.stringify(generated.sort(), null, 2) + "\n");

// ---------------------------------------------------------------- report
const section = (title: string, items: string[]) => `## ${title}（${items.length}）\n\n${items.length ? items.map((i) => `- ${i}`).join("\n") : "- 无"}\n`;
const md = [
  `# 研究数据导入报告`,
  ``,
  `由 \`bun scripts/import-research.ts\` 生成。研究文件：${files.map((f) => `\`${f}\``).join("、")}。`,
  `人民币→美元换算：1 USD = ${rate} CNY（${rateDate}，${RATE_SOURCE}），容差 2%。`,
  ``,
  section("涉及的 provider", report.providers),
  section("数值冲突（以研究数据为准，已写入 overlays/）", report.conflicts),
  section("补充（上游缺失，研究数据新增）", report.additions),
  section("非数值差异（仅报告，未覆盖）", report.differences),
  section("K/M 换算口径差异（同一标称值，沿用上游写法）", report.unitKept),
  section("新增 provider 模型文件", report.newModels),
  section("新增 lab 模型文件", report.newLabModels),
  section("占位与跳过", report.placeholders),
  `overlay 文件数：${report.overlays}`,
  ``,
].join("\n");
await Bun.write(REPORT, md);

const fixes = [
  `# 上游（models.dev）过时数据修正`,
  ``,
  `本仓库在不改动上游文件的前提下修正了以下上游数据（provider 字段用 \`overlays/\` 覆盖，下架模型列在 \`overlays/removed.json\`，由加载器跳过）。`,
  `这些条目可以整理后作为 PR 提交给 https://github.com/anomalyco/models.dev 。本文件由 \`bun scripts/import-research.ts\` 生成。`,
  ``,
  `## provider 字段`,
  ``,
  ...Object.entries(PROVIDER_FIXES).map(([pid, f]) => `- \`providers/${pid}/provider.toml\`：${Object.entries(stripNulls(f.set)).map(([k, v]) => `\`${k} = ${JSON.stringify(v)}\``).join("，")}。${f.reason} 来源：${f.sources.join("、")}`),
  ``,
  `## 已下架 / ID 变更的模型（本仓库已移除）`,
  ``,
  ...removals.map((r) => `- \`${r.path}\`：${r.reason}${r.replacement ? `；替代：${r.replacement}` : ""}${r.source ? `。来源：${r.source}` : ""}`),
  ``,
  `## 数值修正候选（研究数据与上游冲突，已在本仓库按研究数据覆盖）`,
  ``,
  `完整列表与换算说明见 \`research/IMPORT_REPORT.md\` 的「数值冲突」一节（${report.conflicts.length} 项）。提交上游前请逐项复核来源（每个模型 overlay 的 \`sources\`）。`,
  ``,
].join("\n");
await fs.mkdir(path.join(ROOT, "docs"), { recursive: true });
await Bun.write(path.join(ROOT, "docs", "upstream-fixes.md"), fixes);
console.log(md.split("\n").filter((l) => l.startsWith("## ") || l.startsWith("overlay")).join("\n"));
