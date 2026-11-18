// 火山方舟 Volcengine Ark: the official 模型价格 doc is public as markdown
// (https://docs.volcengine.com/docs/zh/ark/model-pricing.md, the LlmsMdUrl of
// https://www.volcengine.com/docs/82379/1544106), no API key. The table lists
// short model names (doubao-seed-2.1-pro, "deepseek-v4-pro 正式版"), not the
// dated Model IDs the API takes, so rows are matched to existing local IDs and
// never create new models.
import { fetchText, markdownTables, priceCell } from "../parse.js";
import type { CnPrice, CnPriceTier, CnRemoteModel, CnSyncProvider } from "../types.js";

const SOURCE = "https://docs.volcengine.com/docs/zh/ark/model-pricing.md";
const PAGE = "https://www.volcengine.com/docs/82379/1544106";

export interface VolcRow {
  name: string;
  condition: string;
  input?: number;
  output?: number;
  cache_read?: number;
}

const col = (header: string[], re: RegExp) => header.findIndex((h) => re.test(h));

/** Rows of the 大语言模型 › 在线推理（常规） table. */
export function volcRows(md: string): VolcRow[] {
  const table = markdownTables(md).find(
    (t) => t.headings.some((h) => /大语言模型/.test(h)) && t.headings.some((h) => /^在线推理（常规）$/.test(h)) && col(t.header, /模型名称/) >= 0,
  );
  if (table === undefined) return [];
  const h = table.header;
  const name = col(h, /模型名称/);
  const cond = col(h, /条件/);
  const input = col(h, /^输入[（(]非音频[)）]/);
  const cache = col(h, /^缓存命中[（(]非音频[)）]/);
  const output = col(h, /^输出/);
  return table.rows.map((r) => ({
    name: r[name]!,
    condition: cond >= 0 ? r[cond] ?? "" : "",
    input: priceCell(r[input]),
    output: priceCell(r[output]),
    cache_read: cache >= 0 ? priceCell(r[cache]) : undefined,
  }));
}

const VARIANT: Record<string, string> = { 正式版: "ga", 经济版: "economy", 预览版: "preview" };

/** "deepseek-v4-pro 正式版" → "deepseek-v4-pro-ga"; "doubao-seed-2.1-pro" → "doubao-seed-2-1-pro". */
export function volcKey(name: string) {
  const [base, ...rest] = name.trim().split(/\s+/);
  const suffix = rest.map((r) => VARIANT[r] ?? r).join("-");
  return [base!.toLowerCase().replace(/\./g, "-"), suffix].filter(Boolean).join("-");
}

const stripDate = (id: string) => id.toLowerCase().replace(/-\d{6}$/, "");

function bandWhen(condition: string) {
  const m = condition.match(/([[(])\s*(\d+)\s*,\s*(\d+)\s*]/);
  if (!m) return condition;
  return m[2] === "0" ? `input<=${m[3]}k` : `${m[2]}k<input<=${m[3]}k`;
}

export const volcengine = {
  id: "volcengine",
  name: "火山方舟",
  researchFile: "volcengine.json",
  catalogProvider: "volcengine",
  sources: [PAGE],
  createNew: false,
  minModels: 8,
  coverage: [
    "人民币价格：大语言模型「在线推理（常规）」表的输入(非音频)/输出/缓存命中(非音频)（元/百万 tokens），按输入长度分档与高峰/空闲时段写 tiers",
    "价格表只有短名（如 doubao-seed-2.1-pro），按名称对应到已有的带日期 Model ID；对不上的只进 issue，不新建模型",
    "不含：上下文与最大输出、模态、能力、思考参数、低延迟/低优/批量价格",
  ],
  async fetchModels() {
    return fetchText(SOURCE);
  },
  parseModels(raw) {
    const byName = new Map<string, VolcRow[]>();
    for (const row of volcRows(String(raw))) byName.set(row.name, [...(byName.get(row.name) ?? []), row]);
    return [...byName.values()];
  },
  translateModel(rows: VolcRow[]): CnRemoteModel | undefined {
    const priced = rows.filter((r) => r.input !== undefined && r.output !== undefined);
    if (priced.length === 0) return undefined;
    const time = priced.some((r) => /高峰|空闲/.test(r.condition));
    let main = priced[0]!;
    let tiers: CnPriceTier[] = [];
    let offPeak: string | undefined;
    if (time) {
      main = priced.find((r) => /高峰/.test(r.condition)) ?? main;
      tiers = priced.map((r) => ({ when: r.condition, input: r.input, output: r.output, cache_read: r.cache_read }));
      const off = priced.find((r) => /空闲/.test(r.condition));
      if (off) offPeak = `空闲时段 输入¥${off.input}/输出¥${off.output}${off.cache_read !== undefined ? `/缓存¥${off.cache_read}` : ""}；高峰/空闲时段划分见官方价格页；主字段为高峰价`;
    } else if (priced.length > 1) {
      tiers = priced.map((r) => ({ when: bandWhen(r.condition), input: r.input, output: r.output, cache_read: r.cache_read }));
    }
    const price: CnPrice = { input: main.input, output: main.output, cache_read: main.cache_read, tiers: tiers.length > 1 ? tiers : undefined, off_peak: offPeak };
    return { id: volcKey(rows[0]!.name), name: rows[0]!.name, price_cny: price };
  },
  resolveLocalID(model, localIDs) {
    const key = model.id;
    const exact = localIDs.filter((id) => stripDate(id) === key);
    if (exact.length > 0) return exact[0];
    const prefix = [...new Set(localIDs.filter((id) => stripDate(id).startsWith(`${key}-`)).map(stripDate))];
    if (prefix.length === 1) return localIDs.find((id) => stripDate(id) === prefix[0]);
    return undefined;
  },
} satisfies CnSyncProvider<VolcRow[]>;
