// zy-models extension layer (中国版 models.dev).
//
// Everything this fork adds on top of upstream models.dev lives in this
// directory, so upstream merges touch as few upstream files as possible.
//
// 1. Extra optional TOML keys (see ProviderExt / LabModelExt / ProviderModelExt).
//    They may appear in any provider.toml or model file. The loaders strip them
//    before the strict upstream schemas run, validate them here, and the v1
//    generator re-attaches them to its output as new keys (old clients ignore
//    unknown keys).
// 2. Overlays: `overlays/<same path as an upstream file>.toml` is deep-merged
//    over that upstream file at load time (tables merge, arrays/values replace).
//    This is how we add Chinese data to upstream providers without editing
//    upstream files, so the daily upstream merge never conflicts on them.
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mergeDeep } from "remeda";
import { z } from "zod";

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");
export const OVERLAY_DIR = path.join(REPO_ROOT, "overlays");

const Url = z.string().url();
const DateStr = z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Must be YYYY-MM or YYYY-MM-DD");
const Price = z.number().min(0);

export const ApiProtocolCn = z.enum([
  "openai-chat",
  "openai-responses",
  "anthropic",
  "gemini",
  "native",
]);

const TierPrice = z.union([Price, z.record(Price)]);

// A subscription / coding plan sold by the platform (编程套餐、Token Plan…).
export const PlanCn = z
  .object({
    id: z.string().min(1),
    name_zh: z.string().min(1),
    name: z.string().min(1).optional(),
    // 元/月: a number, or { <tier> = price } when the plan has several tiers
    price_cny_month: TierPrice.optional(),
    price_cny_quarter: TierPrice.optional(),
    price_cny_year: TierPrice.optional(),
    base_url: Url.optional(),
    anthropic_base_url: Url.optional(),
    other_base_urls: z.array(Url).optional(),
    protocol: ApiProtocolCn.optional(),
    models: z.array(z.string()).optional(),
    quota_note: z.string().optional(),
    // 套餐的使用限制（如：仅限编程工具，禁止当普通 API 调用）
    usage_restriction: z.string().optional(),
    sources: z.array(Url).optional(),
  })
  .strict();

export const ProviderExt = z
  .object({
    name_zh: z.string().min(1).optional(),
    region: z.enum(["cn", "intl"]).optional(),
    pricing_page: Url.optional(),
    plans: z.array(PlanCn).optional(),
    notes: z.string().optional(),
  })
  .strict();
export type ProviderExt = z.infer<typeof ProviderExt>;

// CNY cost, same idea as `cost` but in 元 per million tokens.
// `tiers` keeps the official tier condition text verbatim in `when`
// (input length band, time of day, …); `context_min`/`context_max` are the
// machine-readable input-token bounds when the band is a length band.
export const CostCnyTier = z
  .object({
    when: z.string().min(1),
    context_min: z.number().int().min(0).optional(),
    context_max: z.number().int().min(0).optional(),
    input: Price.optional(),
    output: Price.optional(),
    cache_read: Price.optional(),
    cache_write: Price.optional(),
    reasoning: Price.optional(),
  })
  .strict();

export const CostCny = z
  .object({
    input: Price.optional(),
    output: Price.optional(),
    cache_read: Price.optional(),
    cache_write: Price.optional(),
    reasoning: Price.optional(),
    // 1h-TTL cache write price where the platform prices it separately
    cache_write_1h: Price.optional(),
    // 原价 (list price) when the main fields carry a limited-time price
    list_price: z
      .object({ input: Price.optional(), output: Price.optional(), cache_read: Price.optional(), cache_write: Price.optional() })
      .strict()
      .optional(),
    discount_note: z.string().optional(),
    tiers: z.array(CostCnyTier).optional(),
    off_peak: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();
export type CostCny = z.infer<typeof CostCny>;

// What the model does when the request sets no reasoning parameter at all.
export const ReasoningDefault = z
  .object({
    value: z.string().min(1), // "on" | "off" | an effort level | free text
    source: Url.optional(),
  })
  .strict();

const CommonModelExt = {
  name_zh: z.string().min(1).optional(),
  aliases: z.array(z.string().min(1)).optional(),
  sources: z.array(Url).optional(),
  checked_at: DateStr.optional(),
  notes: z.string().optional(),
};

export const LabModelExt = z.object(CommonModelExt).strict();
// The official doc only gives a label ("1M", "128K"); limit.* holds the number
// converted with the lab's convention, this keeps the original wording.
export const LimitLabel = z
  .object({ context: z.string().min(1).optional(), input: z.string().min(1).optional(), output: z.string().min(1).optional() })
  .strict();

export const ProviderModelExt = z
  .object({
    ...CommonModelExt,
    cost_cny: CostCny.optional(),
    reasoning_default: ReasoningDefault.optional(),
    limit_label: LimitLabel.optional(),
  })
  .strict();
export type ProviderModelExt = z.infer<typeof ProviderModelExt>;

export const PROVIDER_EXT_KEYS = Object.keys(ProviderExt.shape);
export const MODEL_EXT_KEYS = Object.keys(ProviderModelExt.shape);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function split(toml: Record<string, unknown>, keys: string[]) {
  const clean: Record<string, unknown> = {};
  const ext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(toml)) {
    if (keys.includes(key)) ext[key] = value;
    else clean[key] = value;
  }
  return { clean, ext };
}

function parseExt<S extends z.ZodTypeAny>(schema: S, ext: Record<string, unknown>, filePath: string): z.output<S> {
  const parsed = schema.safeParse(ext);
  if (!parsed.success) {
    parsed.error.cause = { filePath, ext };
    throw parsed.error;
  }
  return parsed.data;
}

/** Overlay file for an upstream file, if any. */
export function overlayPathFor(filePath: string) {
  const rel = path.relative(REPO_ROOT, filePath);
  if (rel.startsWith("..") || rel.startsWith("overlays")) return undefined;
  const candidate = path.join(OVERLAY_DIR, rel);
  return existsSync(candidate) ? candidate : undefined;
}

async function importToml(filePath: string): Promise<Record<string, unknown>> {
  const mod = await import(filePath, { with: { type: "toml" } });
  // Module objects are cached and shared; never mutate them.
  return structuredClone(mod.default);
}

/** Reads a TOML file with its overlay (if any) merged on top. */
export async function readTomlWithOverlay(filePath: string): Promise<Record<string, unknown>> {
  const base = await importToml(filePath);
  const overlay = overlayPathFor(filePath);
  if (overlay === undefined) return base;
  return mergeDeep(base, await importToml(overlay)) as Record<string, unknown>;
}

/** provider.toml: upstream keys + validated extension keys. */
export async function readProviderToml(filePath: string) {
  const { clean, ext } = split(await readTomlWithOverlay(filePath), PROVIDER_EXT_KEYS);
  return { toml: clean, ext: parseExt(ProviderExt, ext, filePath) };
}

/** Lab (`models/…`) or provider model file: upstream keys + validated extension keys. */
export async function readModelToml(filePath: string) {
  const { clean, ext } = split(await readTomlWithOverlay(filePath), MODEL_EXT_KEYS);
  const isProviderModel = path.relative(REPO_ROOT, filePath).split(path.sep)[0] === "providers";
  const schema = isProviderModel ? ProviderModelExt : LabModelExt;
  return { toml: clean, ext: parseExt(schema, ext, filePath) as ProviderModelExt };
}

/** Upstream keys only (for the v2 generator, which stays upstream-shaped). */
export async function readUpstreamToml(filePath: string) {
  const { clean } = split(await readTomlWithOverlay(filePath), [...PROVIDER_EXT_KEYS, ...MODEL_EXT_KEYS]);
  return clean;
}

// Lab model extension data, keyed by lab model id (`<lab>/<model>`).
export const labModelExt = new Map<string, ProviderModelExt>();

function withoutEmpty<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * The upstream `capabilities.reasoning.default` of a provider model file, as a
 * reasoning_default value ("on" | "off" | effort | "budget:<n>"), so every
 * model that states a default gets one even without Chinese research data.
 */
export function upstreamReasoningDefault(toml: Record<string, unknown>) {
  const caps = toml.capabilities as Record<string, any> | undefined;
  const def = caps?.reasoning?.default as { type: string; value: unknown } | undefined;
  if (def === undefined) return undefined;
  const value =
    def.type === "toggle" ? (def.value ? "on" : "off") : def.type === "budget" ? `budget:${def.value}` : String(def.value);
  return { value };
}

/** Keys appended to a v1 model object. Provider values win over the lab's. */
export function modelExtOutput(ext: ProviderModelExt, canonicalId?: string, raw?: Record<string, unknown>) {
  const lab = canonicalId === undefined ? undefined : labModelExt.get(canonicalId);
  return withoutEmpty({
    name_zh: ext.name_zh ?? lab?.name_zh,
    aliases: ext.aliases ?? lab?.aliases,
    cost_cny: ext.cost_cny,
    reasoning_default: ext.reasoning_default ?? (raw ? upstreamReasoningDefault(raw) : undefined),
    limit_label: ext.limit_label,
    sources: ext.sources,
    checked_at: ext.checked_at,
    notes: ext.notes,
  });
}

export function providerExtOutput(ext: ProviderExt) {
  return withoutEmpty({ ...ext });
}

// Upstream model files this fork drops (delisted by the platform), from
// overlays/removed.json: [{ "path": "providers/<p>/models/<m>.toml", "reason": "…", "source": "…" }].
// Documented in docs/upstream-fixes.md.
const REMOVED_FILE = path.join(OVERLAY_DIR, "removed.json");
let removed: Set<string> | undefined;
export function isRemoved(filePath: string) {
  removed ??= new Set(
    existsSync(REMOVED_FILE)
      ? (JSON.parse(readFileSync(REMOVED_FILE, "utf8")) as { path: string }[]).map((e) => path.join(REPO_ROOT, e.path))
      : [],
  );
  return removed.has(path.resolve(filePath));
}

/** Every overlay file must sit over an existing upstream file. */
export async function overlayErrors() {
  const errors: string[] = [];
  if (!existsSync(OVERLAY_DIR)) return errors;
  if (existsSync(REMOVED_FILE)) {
    for (const e of JSON.parse(readFileSync(REMOVED_FILE, "utf8")) as { path: string }[]) {
      if (!existsSync(path.join(REPO_ROOT, e.path))) errors.push(`overlays/removed.json: ${e.path} does not exist`);
    }
  }
  for await (const file of new Bun.Glob("**/*.toml").scan({ cwd: OVERLAY_DIR })) {
    if (!existsSync(path.join(REPO_ROOT, file))) {
      errors.push(`overlays/${file}: no upstream file at ${file} (put new files directly in the tree)`);
    }
  }
  return errors;
}

export function isPlainTable(value: unknown) {
  return isPlainObject(value);
}
