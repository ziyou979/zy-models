// 七牛云 AI 大模型推理: the model square page embeds its whole catalog in
// __NEXT_DATA__ (https://www.qiniu.com/ai/models), no API key. pricing_rules_v2
// gives 元 per unit_size tokens (usually 1000); model_constraints gives the
// context and max output (same values as the public GET https://api.qnaigc.com/v1/models).
import { z } from "zod";

import { fetchText, nextData, round } from "../parse.js";
import type { CnPrice, CnPriceTier, CnRemoteModel, CnSyncProvider } from "../types.js";

const SOURCE = "https://www.qiniu.com/ai/models";

const Item = z.object({ unit_name: z.string(), unit_size: z.number().positive(), unit_price: z.number().nonnegative() }).passthrough();
const Rule = z
  .object({ input_range: z.array(z.number()).nullish(), output_range: z.array(z.number()).nullish(), details_v2: z.record(Item).nullish() })
  .passthrough();

export const QiniuModel = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    private: z.boolean().optional(),
    service_status: z.string().optional(),
    release_at: z.string().nullish(),
    retirement_at: z.string().nullish(),
    model_alias: z.array(z.string()).nullish(),
    model_constraints: z.object({ context_length: z.number().nullish(), max_tokens: z.number().nullish() }).passthrough().nullish(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).nullish(),
        output_modalities: z.array(z.string()).nullish(),
        schema_output: z.object({ supported: z.boolean() }).passthrough().nullish(),
        function_calling: z.object({ supported: z.boolean() }).passthrough().nullish(),
        reasoning: z.object({ supported: z.boolean() }).passthrough().nullish(),
      })
      .passthrough()
      .nullish(),
    pricing_rules_v2: z.array(Rule).nullish(),
  })
  .passthrough();
export type QiniuModel = z.infer<typeof QiniuModel>;

const MODALITIES = new Set(["text", "image", "video", "audio"]);
const perMillion = (item: z.infer<typeof Item> | undefined) =>
  item === undefined || item.unit_name !== "token" ? undefined : round((item.unit_price * 1_000_000) / item.unit_size);
const kTokens = (n: number) => `${Math.round(n / 1000)}k`;

function rulePrice(details: Record<string, z.infer<typeof Item>>, lane: "" | "_peak" | "_offpeak") {
  return {
    input: perMillion(details[`ncache${lane}`] ?? details[`input${lane}`]),
    output: perMillion(details[`output${lane}`]),
    cache_read: perMillion(details[`cache${lane}`]),
  };
}

export function qiniuPrice(rules: z.infer<typeof Rule>[]): CnPrice | undefined {
  const usable = rules.filter((r) => r.details_v2 && Object.keys(r.details_v2).length > 0);
  if (usable.length === 0) return undefined;
  const tiers: CnPriceTier[] = [];
  let main: ReturnType<typeof rulePrice> | undefined;
  let offPeak: string | undefined;
  for (const rule of usable) {
    const d = rule.details_v2!;
    const [lo, hi] = rule.input_range ?? [0, 99_999_999];
    const band = usable.length > 1 ? `${kTokens(lo!)}<input<=${hi! >= 99_999_999 ? "∞" : kTokens(hi!)}` : "";
    if (d.ncache_peak || d.output_peak) {
      const peak = rulePrice(d, "_peak");
      const off = rulePrice(d, "_offpeak");
      tiers.push({ when: [band, "高峰"].filter(Boolean).join(" "), ...peak }, { when: [band, "空闲"].filter(Boolean).join(" "), ...off });
      main ??= peak;
      offPeak = "按量计费分高峰/空闲两档（模型广场数据未给出具体时段），主字段为高峰价";
    } else {
      const price = rulePrice(d, "");
      if (band) tiers.push({ when: band, ...price });
      main ??= price;
    }
  }
  if (main?.input === undefined || main.output === undefined) return undefined;
  return { ...main, tiers: tiers.length >= 2 ? tiers : undefined, off_peak: offPeak };
}

export const qiniu = {
  id: "qiniu",
  name: "七牛云 AI 大模型推理",
  researchFile: "qiniu.json",
  catalogProvider: "qiniu-ai",
  sources: [SOURCE],
  createNew: true,
  minModels: 30,
  coverage: [
    "模型列表（公开、service_status=available、输出含文本的模型）及别名 model_alias",
    "上下文 context_length、最大输出 max_tokens",
    "输入/输出模态、工具调用、结构化输出、是否推理",
    "人民币价格：输入/输出/缓存读取（pricing_rules_v2，按千 token 计，×1000 换算为每百万），高峰/空闲与按输入长度分档",
    "发布日期 release_at；retirement_at 非空时标记 deprecated",
    "不含：思考开关参数与默认值、开源权重",
  ],
  async fetchModels() {
    return nextData(await fetchText(SOURCE)).props.pageProps.models;
  },
  parseModels(raw) {
    return z.array(QiniuModel).parse(raw);
  },
  translateModel(m: QiniuModel): CnRemoteModel | undefined {
    if (m.private || m.service_status !== "available") return undefined;
    const arch = m.architecture ?? {};
    if (!(arch.output_modalities ?? ["text"]).includes("text")) return undefined;
    const c = m.model_constraints ?? {};
    const release = m.release_at && /^\d{4}-\d{2}-\d{2}$/.test(m.release_at) ? m.release_at : undefined;
    return {
      id: m.id,
      name: m.name,
      aliases: (m.model_alias ?? []).filter((a) => a !== m.id),
      release_date: release,
      status: m.retirement_at ? "deprecated" : undefined,
      limit: { context: c.context_length || undefined, output: c.max_tokens || undefined },
      modalities: {
        input: arch.input_modalities?.filter((x) => MODALITIES.has(x)),
        output: arch.output_modalities?.filter((x) => MODALITIES.has(x)),
      },
      // Only positive capability flags: the square leaves some known tool-capable models at false.
      tools: arch.function_calling?.supported ? true : undefined,
      structured_output: arch.schema_output?.supported ? true : undefined,
      reasoning: arch.reasoning?.supported ? { supported: true } : undefined,
      price_cny: qiniuPrice(m.pricing_rules_v2 ?? []),
    };
  },
} satisfies CnSyncProvider<QiniuModel>;
