// 智谱 BigModel 开放平台: official pricing page, served as markdown without a key
// (https://docs.bigmodel.cn/cn/guide/start/pricing.md, the Mintlify .md of
// https://docs.bigmodel.cn/cn/guide/start/pricing). Model names are the API
// model codes in display case (GLM-5.3 → glm-5.3).
import { fetchText, markdownTables, priceCell } from "../parse.js";
import type { CnPrice, CnPriceTier, CnRemoteModel, CnSyncProvider } from "../types.js";

const SOURCE = "https://docs.bigmodel.cn/cn/guide/start/pricing.md";
const PAGE = "https://docs.bigmodel.cn/cn/guide/start/pricing";

export interface ZhipuRow {
  name: string;
  condition: string;
  input?: number;
  output?: number;
  cache_read?: number;
}

const col = (header: string[], re: RegExp) => header.findIndex((h) => re.test(h));

/** Rows of every token-priced table (元/百万 Tokens with 输入 + 输出 columns). */
export function zhipuRows(md: string): ZhipuRow[] {
  const rows: ZhipuRow[] = [];
  for (const table of markdownTables(md)) {
    const h = table.header;
    const name = col(h, /模型/);
    const input = col(h, /^输入单价.*百万\s*Tokens/i);
    const output = col(h, /^输出单价.*百万\s*Tokens/i);
    if (name < 0 || input < 0 || output < 0) continue;
    const cond = col(h, /上下文|条件/);
    const cache = col(h, /缓存命中/);
    for (const r of table.rows) {
      if (!/^GLM/i.test(r[name] ?? "")) continue;
      rows.push({
        name: r[name]!,
        condition: cond >= 0 ? r[cond] ?? "" : "",
        input: priceCell(r[input]),
        output: priceCell(r[output]),
        cache_read: cache >= 0 ? priceCell(r[cache]) : undefined,
      });
    }
  }
  return rows;
}

/** "输入长度 [0, 32K)" → "input<32k"; "输入 [0, 32K)，输出 ≥0.2K" → "input<32k && output>=0.2k". */
function tierWhen(condition: string) {
  return condition
    .replace(/\\/g, "")
    .replace(/输入长度|输入/g, "input")
    .replace(/输出/g, "output")
    .replace(/(input|output)\s*\[0,\s*([\d.]+K)\)/gi, "$1<$2")
    .replace(/(input|output)\s*\[([\d.]+K),\s*([\d.]+K)\)/gi, "$2<=$1<$3")
    .replace(/(input|output)\s*≥\s*([\d.]+K)/gi, "$1>=$2")
    .replace(/，\s*/g, " && ")
    .replace(/K/g, "k")
    .trim();
}

const isBand = (condition: string) => /输入|输出/.test(condition);

export const zhipu = {
  id: "zhipu",
  name: "智谱 BigModel",
  researchFile: "zhipu.json",
  catalogProvider: "zhipuai",
  sources: [PAGE],
  createNew: true,
  minModels: 10,
  coverage: [
    "模型列表：官方价格页中按 token 计费的 GLM 模型（模型名小写即 API 模型编码）",
    "人民币价格：输入/输出/缓存命中（元/百万 tokens），按输入/输出长度分档写 tiers（主字段取第一档）",
    "不含：上下文（价格页只有 1M/128K 这类标注，K/M 进制不明，不用来补数）、最大输出、模态、工具调用、思考参数与默认值、发布日期",
  ],
  async fetchModels() {
    return fetchText(SOURCE);
  },
  parseModels(raw) {
    const byName = new Map<string, ZhipuRow[]>();
    for (const row of zhipuRows(String(raw))) {
      const key = row.name.toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), row]);
    }
    return [...byName.values()];
  },
  translateModel(rows: ZhipuRow[]): CnRemoteModel | undefined {
    const first = rows[0]!;
    if (first.input === undefined || first.output === undefined) return undefined;
    const banded = rows.length > 1 && rows.every((r) => isBand(r.condition));
    const tiers: CnPriceTier[] = banded
      ? rows.map((r) => ({ when: tierWhen(r.condition), input: r.input, output: r.output, cache_read: r.cache_read }))
      : [];
    const price: CnPrice = { input: first.input, output: first.output, cache_read: first.cache_read, tiers: tiers.length ? tiers : undefined };
    return { id: first.name.toLowerCase(), name: first.name, lab: "zhipu", price_cny: price };
  },
} satisfies CnSyncProvider<ZhipuRow[]>;
