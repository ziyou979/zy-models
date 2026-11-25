// PPIO 派欧云: public OpenAI-style model list with prices, no API key.
// GET https://api.ppio.com/openai/v1/models — price_per_m_decimal is 元/百万 tokens
// (cross-checked with https://ppio.com/pricing), origin_price_* is the list price.
import { z } from "zod";

import { fetchJson } from "../parse.js";
import type { CnPriceTier, CnRemoteModel, CnSyncProvider } from "../types.js";

const SOURCE = "https://api.ppio.com/openai/v1/models";

const Price = z.object({ price_per_m_decimal: z.string(), origin_price_per_m_decimal: z.string().optional() }).passthrough();
const Pricing = z
  .object({ prompt: Price.optional(), completion: Price.optional(), input_cache_read: Price.optional(), input_cache_write: Price.optional() })
  .passthrough();

export const PPIOModel = z
  .object({
    id: z.string().min(1),
    display_name: z.string().optional(),
    model_type: z.string().optional(),
    status: z.number().optional(),
    context_size: z.number().int().nonnegative().optional(),
    max_output_tokens: z.number().int().nonnegative().optional(),
    features: z.array(z.string()).nullish(),
    input_modalities: z.array(z.string()).nullish(),
    output_modalities: z.array(z.string()).nullish(),
    pricing: Pricing.optional(),
    is_tiered_billing: z.boolean().optional(),
    tiered_billing_configs: z
      .array(z.object({ min_tokens: z.number(), max_tokens: z.number(), pricing: Pricing }).passthrough())
      .nullish(),
  })
  .passthrough();
export type PPIOModel = z.infer<typeof PPIOModel>;

// Routers, internal test deployments and lane variants (-p/-h/-z/-exp) are not public models.
const IGNORED = /^(pprouter\/|ai_infer_test|elephant$|ppio-)|-(p|h|z)$|-exp$/;
const MODALITIES = new Set(["text", "image", "video", "audio"]);

const num = (p: z.infer<typeof Price> | undefined, key: "price_per_m_decimal" | "origin_price_per_m_decimal") => {
  const v = p?.[key];
  return v === undefined || v === "" ? undefined : Number(v);
};
const stripUndefined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const kTokens = (n: number) => (n % 1024 === 0 ? `${n / 1024}K` : `${Math.round(n / 1000)}K`);

export const ppio = {
  id: "ppio",
  name: "PPIO 派欧云",
  researchFile: "ppio.json",
  catalogProvider: "ppio",
  sources: [SOURCE],
  createNew: true,
  minModels: 20,
  coverage: [
    "模型列表（chat 类、status=1，排除 pprouter 路由、测试与 -p/-h/-z 等内部线路）",
    "上下文 context_size、最大输出 max_output_tokens",
    "输入/输出模态、工具调用（function-calling）、结构化输出（structured-outputs）、是否推理（reasoning）",
    "人民币价格：输入/输出/缓存读取（price_per_m_decimal，元/百万 tokens），原价（origin_price）与按输入长度分档（tiered_billing_configs）",
    "不含：思考开关参数与默认值、发布日期、开源权重",
  ],
  async fetchModels() {
    return fetchJson(SOURCE);
  },
  parseModels(raw) {
    return z.object({ data: z.array(PPIOModel) }).passthrough().parse(raw).data;
  },
  translateModel(m: PPIOModel): CnRemoteModel | undefined {
    if (m.model_type !== "chat" || m.status !== 1 || !m.id.includes("/") || IGNORED.test(m.id)) return undefined;
    if (m.output_modalities && !m.output_modalities.includes("text")) return undefined;
    const features = m.features ?? [];
    const input = num(m.pricing?.prompt, "price_per_m_decimal");
    const output = num(m.pricing?.completion, "price_per_m_decimal");
    const tiers: CnPriceTier[] = (m.is_tiered_billing ? m.tiered_billing_configs ?? [] : []).map((t) => ({
      when: `${kTokens(t.min_tokens === 1 ? 0 : t.min_tokens)}<input<=${kTokens(t.max_tokens)}`,
      input: num(t.pricing.prompt, "price_per_m_decimal"),
      output: num(t.pricing.completion, "price_per_m_decimal"),
      cache_read: num(t.pricing.input_cache_read, "price_per_m_decimal"),
    }));
    const listInput = num(m.pricing?.prompt, "origin_price_per_m_decimal");
    const listOutput = num(m.pricing?.completion, "origin_price_per_m_decimal");
    const listCacheRead = num(m.pricing?.input_cache_read, "origin_price_per_m_decimal");
    return {
      id: m.id,
      name: m.display_name,
      limit: { context: m.context_size || undefined, output: m.max_output_tokens || undefined },
      modalities: {
        input: m.input_modalities?.filter((x) => MODALITIES.has(x)),
        output: m.output_modalities?.filter((x) => MODALITIES.has(x)),
      },
      tools: features.includes("function-calling") ? true : undefined,
      structured_output: features.includes("structured-outputs") ? true : undefined,
      reasoning: features.includes("reasoning") ? { supported: true } : undefined,
      price_cny:
        input === undefined || output === undefined
          ? undefined
          : {
              input,
              output,
              cache_read: num(m.pricing?.input_cache_read, "price_per_m_decimal"),
              cache_write: num(m.pricing?.input_cache_write, "price_per_m_decimal"),
              tiers: tiers.length >= 2 ? tiers : undefined,
              list_price:
                listInput !== undefined && listOutput !== undefined && (listInput !== input || listOutput !== output)
                  ? stripUndefined({ input: listInput, output: listOutput, cache_read: listCacheRead })
                  : undefined,
            },
    };
  },
} satisfies CnSyncProvider<PPIOModel>;
