// 硅基流动 SiliconFlow (China): no public model API without a key, but both
// official pages embed their data in the Next.js RSC payload:
// - https://www.siliconflow.cn/models  → `data`: model name, type, context, capabilities, status
// - https://www.siliconflow.cn/pricing → `pricingApiItems`: live CNY prices per K tokens
// (the pricing page is authoritative for prices; the model cards' `price` field can lag).
import { z } from "zod";

import { fetchText, jsonArrayAfter, round, rscPayload } from "../parse.js";
import type { CnPriceTier, CnRemoteModel, CnSyncProvider } from "../types.js";

const MODELS = "https://www.siliconflow.cn/models";
const PRICING = "https://www.siliconflow.cn/pricing";

export const SFModel = z
  .object({
    modelName: z.string().min(1),
    DisplayName: z.string().optional(),
    type: z.string().optional(),
    subType: z.string().optional(),
    contextLen: z.number().optional(),
    status: z.string().optional(),
    functionCallSupport: z.boolean().optional(),
    jsonModeSupport: z.boolean().optional(),
    vlm: z.boolean().optional(),
    publishTime: z.object({ seconds: z.number() }).partial().passthrough().optional(),
    deprecatedTime: z.object({ seconds: z.number() }).partial().passthrough().optional(),
  })
  .passthrough();

const PriceItem = z
  .object({
    playgroundName: z.string(),
    componentCode: z.string(),
    coordinateDesc: z.string().optional(),
    realTimePriceCnyUnit: z.string(),
    unitZhCnName: z.string(),
  })
  .passthrough();

export type SFSource = z.infer<typeof SFModel> & { prices: z.infer<typeof PriceItem>[] };

const COMPONENT: Record<string, "input" | "output" | "cache_read"> = {
  "input-tokens": "input",
  "output-tokens": "output",
  "cached-input-tokens": "cache_read",
};

export function sfPrice(items: z.infer<typeof PriceItem>[]) {
  const byWhen = new Map<string, Partial<Record<"input" | "output" | "cache_read", number>>>();
  for (const item of items) {
    const key = COMPONENT[item.componentCode];
    if (key === undefined || item.unitZhCnName !== "K tokens") continue;
    const when = (item.coordinateDesc ?? "").replace(/^费用发生时段:\s*/, "").trim();
    const row = byWhen.get(when) ?? {};
    row[key] = round(Number(item.realTimePriceCnyUnit) * 1000);
    byWhen.set(when, row);
  }
  const rows = [...byWhen.entries()].filter(([, p]) => p.input !== undefined && p.output !== undefined);
  if (rows.length === 0) return undefined;
  // Time-of-day prices: the main fields hold the peak (standard) price.
  rows.sort((a, b) => b[1].input! - a[1].input!);
  const main = rows[0]![1];
  const tiers: CnPriceTier[] = rows.length > 1 ? rows.map(([when, p]) => ({ when: `北京时间 ${when}`, ...p })) : [];
  const off = rows.slice(1).map(([when, p]) => `${when} 输入¥${p.input}/输出¥${p.output}${p.cache_read !== undefined ? `/缓存¥${p.cache_read}` : ""}`);
  return {
    ...main,
    tiers: tiers.length ? tiers : undefined,
    off_peak: off.length ? `分时计价：${off.join("；")}；主字段为高峰价` : undefined,
  };
}

export const siliconflow = {
  id: "siliconflow",
  name: "硅基流动 SiliconFlow",
  researchFile: "siliconflow.json",
  catalogProvider: "siliconflow-cn",
  sources: [PRICING, MODELS],
  createNew: true,
  minModels: 20,
  coverage: [
    "模型列表（模型广场 type=text 的对话模型，排除已下线 deprecatedTime）",
    "上下文 contextLen；工具调用 functionCallSupport；是否视觉输入 vlm",
    "人民币价格：价格页 pricingApiItems 的输入/输出/缓存读取实时价（K tokens ×1000），北京时间分时计价写 tiers",
    "不含：最大输出、发布日期（publishTime 是上架时间，不等于模型发布日期）、思考开关参数与默认值、开源权重；json_mode 只作参考不映射为 structured_output",
  ],
  async fetchModels() {
    const [models, pricing] = await Promise.all([fetchText(MODELS), fetchText(PRICING)]);
    const modelList = jsonArrayAfter(rscPayload(models), "data");
    const priceList = jsonArrayAfter(rscPayload(pricing), "pricingApiItems");
    if (modelList === undefined || priceList === undefined) throw new Error("SiliconFlow page layout changed: data / pricingApiItems not found");
    return { models: modelList, prices: priceList };
  },
  parseModels(raw) {
    const { models, prices } = z.object({ models: z.array(SFModel), prices: z.array(PriceItem) }).parse(raw);
    const byName = new Map<string, z.infer<typeof PriceItem>[]>();
    for (const p of prices) byName.set(p.playgroundName.toLowerCase(), [...(byName.get(p.playgroundName.toLowerCase()) ?? []), p]);
    return models.map((m) => ({ ...m, prices: byName.get(m.modelName.toLowerCase()) ?? [] }));
  },
  translateModel(m: SFSource): CnRemoteModel | undefined {
    if (m.type !== "text" || (m.subType && m.subType !== "chat")) return undefined;
    if (m.deprecatedTime?.seconds) return undefined;
    return {
      id: m.modelName,
      name: m.DisplayName || undefined,
      limit: { context: m.contextLen || undefined },
      modalities: m.vlm ? { input: ["text", "image"], output: ["text"] } : undefined,
      tools: m.functionCallSupport ? true : undefined,
      price_cny: sfPrice(m.prices),
    };
  },
} satisfies CnSyncProvider<SFSource>;
