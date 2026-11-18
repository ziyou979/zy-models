// DeepSeek 开放平台: the official 模型 & 价格 page is public as markdown
// (https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md, the .md of
// https://api-docs.deepseek.com/zh-cn/quick_start/pricing), no API key.
//
// The 模型细节 table is transposed: one column per API model (header cells are
// the model names, e.g. "deepseek-flash(1)"), one row per attribute. The first
// three cells of a row are labels (attribute / sub-attribute / time slot), the
// rest are the values for each model column. Prices come as 高峰时段 and
// 空闲时段 rows; the main price fields hold the peak price (project rule) and
// the off-peak price goes into tiers.
import { fetchText, markdownTables, priceCell } from "../parse.js";
import type { CnPrice, CnRemoteModel, CnSyncProvider } from "../types.js";

const SOURCE = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md";
const PAGE = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";

/** Tier label, kept identical to the hand-written research entries. */
export const OFF_PEAK_WHEN = "空闲时段（off-peak）";

export interface DeepseekColumn {
  id: string;
  /** Footnote numbers attached to the header cell ("deepseek-flash(1)" → ["1"]). */
  notes: string[];
  /** Footnote texts of the page, by number. */
  footnotes: Record<string, string>;
  /** "label1 / label2 / label3" → cell, for every attribute row. */
  cells: { labels: string[]; value: string }[];
}

/** "1M" → 1048576, "最大 384K" → 393216 (DeepSeek's own docs use 1024-based sizes: 1048576, 393216). */
export function deepseekSize(cell: string | undefined): number | undefined {
  const m = cell?.match(/(\d+(?:\.\d+)?)\s*([KM])/i);
  if (!m) return undefined;
  return Math.round(Number(m[1]) * (m[2]!.toUpperCase() === "M" ? 1024 * 1024 : 1024));
}

function footnotes(md: string) {
  const out: Record<string, string> = {};
  for (const line of md.split("\n")) {
    const m = line.trim().match(/^\((\d+)\)\s*(.+)$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

/** One entry per model column of the 模型细节 table. */
export function deepseekColumns(md: string): DeepseekColumn[] {
  const table = markdownTables(md).find((t) => t.headings.some((h) => /模型细节/.test(h)) && /^模型/.test(t.header[0] ?? ""));
  if (table === undefined) return [];
  const notes = footnotes(md);
  // Label columns: leading header cells that repeat the first one ("模型").
  let labelCols = 0;
  while (labelCols < table.header.length && table.header[labelCols] === table.header[0]) labelCols++;
  const columns: DeepseekColumn[] = [];
  for (let c = labelCols; c < table.header.length; c++) {
    const head = table.header[c]!;
    const id = head.replace(/\(\d+\)/g, "").trim().toLowerCase();
    if (!/^deepseek-/.test(id)) continue;
    columns.push({
      id,
      notes: [...head.matchAll(/\((\d+)\)/g)].map((m) => m[1]!),
      footnotes: notes,
      cells: table.rows.map((r) => ({
        labels: [...new Set(r.slice(0, labelCols).map((l) => l.replace(/\(\d+\)/g, "").trim()))],
        value: r[c] ?? "",
      })),
    });
  }
  return columns;
}

const find = (col: DeepseekColumn, ...res: RegExp[]) =>
  col.cells.find((cell) => res.every((re) => cell.labels.some((l) => re.test(l))))?.value;

/** 支持 → true, 不支持 → false, anything else (仅非思考模式支持, blank) → undefined. */
const flag = (cell: string | undefined) => (cell === undefined ? undefined : /^不支持/.test(cell) ? false : /^支持/.test(cell) ? true : undefined);

/** "0.02元" → 0.02 */
const yuan = (cell: string | undefined) => priceCell(cell?.replace(/元.*$/, ""));

export const deepseek = {
  id: "deepseek",
  name: "DeepSeek 开放平台",
  researchFile: "deepseek.json",
  catalogProvider: "deepseek",
  sources: [PAGE],
  createNew: true,
  minModels: 2,
  coverage: [
    "模型列表：官方「模型 & 价格」页「模型细节」表的每一列（表头即 API 模型名），旧模型名取自表头脚注",
    "人民币价格：高峰时段写主字段，空闲时段写 tiers（输入缓存未命中/缓存命中/输出，元/百万 tokens）；峰谷时段说明取自脚注",
    "上下文、最大输出（官方文档按 1024 进制：1M=1048576，384K=393216）、图像理解（输入模态）、Tool Calls、Json Output、是否支持思考",
    "不含：思考档位与默认值（在思考模式文档里）、发布日期（模型版本后缀只有月日）、并发限制、Search/Fetch/OCR/语音等按次计费项目",
  ],
  async fetchModels() {
    return fetchText(SOURCE);
  },
  parseModels(raw) {
    return deepseekColumns(String(raw));
  },
  translateModel(col: DeepseekColumn): CnRemoteModel | undefined {
    const peak = (re: RegExp) => yuan(find(col, re, /高峰/));
    const off = (re: RegExp) => yuan(find(col, re, /空闲/));
    const input = peak(/缓存未命中/);
    const output = peak(/^百万tokens输出/);
    if (input === undefined || output === undefined) return undefined;
    const offInput = off(/缓存未命中/);
    const offOutput = off(/^百万tokens输出/);
    const price: CnPrice = {
      input,
      output,
      cache_read: peak(/缓存命中/),
      tiers:
        offInput !== undefined && offOutput !== undefined
          ? [{ when: OFF_PEAK_WHEN, input: offInput, output: offOutput, cache_read: off(/缓存命中/) }]
          : undefined,
    };
    const priceNote = Object.entries(col.footnotes).find(([, t]) => /空闲时段/.test(t) && /高峰时段/.test(t))?.[1];
    if (priceNote) price.off_peak = priceNote;

    // Old names the footnote says still route to this model.
    const aliases = col.notes
      .flatMap((n) => [...(col.footnotes[n] ?? "").matchAll(/旧模型名([^。]*)/g)].flatMap((m) => [...m[1]!.matchAll(/`([^`]+)`/g)].map((x) => x[1]!)))
      .filter((a) => a.toLowerCase() !== col.id);

    const vision = flag(find(col, /功能/, /图像理解/));
    const thinking = find(col, /思考模式/);
    const name = find(col, /模型版本/);
    return {
      id: col.id,
      name: name || undefined,
      aliases: aliases.length ? aliases : undefined,
      lab: "deepseek",
      limit: { context: deepseekSize(find(col, /上下文长度/)), output: deepseekSize(find(col, /输出长度/)) },
      modalities: vision === undefined ? undefined : { input: vision ? ["text", "image"] : ["text"], output: ["text"] },
      tools: flag(find(col, /功能/, /Tool Calls/i)),
      structured_output: flag(find(col, /功能/, /Json Output/i)),
      reasoning: thinking && /支持.*思考/.test(thinking) ? { supported: true } : undefined,
      price_cny: price,
    };
  },
} satisfies CnSyncProvider<DeepseekColumn>;
