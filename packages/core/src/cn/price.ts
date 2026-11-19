// zy-models: research `price_cny` rules shared by scripts/import-research.ts and
// the CN sync (packages/core/src/cn/sync). Pure functions, no I/O, so both the
// importer and the tests use the same code.
//
// - `cost` (USD) is the CNY main fields converted at the import rate. The main
//   fields hold the price actually charged now (the peak/regular one when a
//   platform has time-of-day prices, see normalizePrice in the importer), so
//   `cost` and `cost_cny` always describe the same price. The 原价 (list price)
//   stays in `cost_cny.list_price` and never feeds `cost`.
// - A research entry can state its 原价 in several places: `original` (older
//   research files), `list_price` (cn-sync), a 原价 tier, or the discount note.
//   They are merged key by key so no source can hide a value another one has.

type Price = Record<string, unknown> | null | undefined;

export const LIST_PRICE_KEYS = ["input", "output", "cache_read", "cache_write"] as const;

const plain = (v: unknown): unknown => {
  const raw = (JSON as any).isRawJSON?.(v) ? JSON.parse((v as any).rawJSON) : v;
  return raw;
};
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Merge every 原价 a research price states. Earlier arguments win per key, so pass
 * the values already in the research file before derived ones; a key only a later
 * source has is still kept. Returns undefined when no source has a number.
 */
export function mergeListPrice(...sources: Price[]): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const k of LIST_PRICE_KEYS) {
      const v = plain(src[k]);
      if (out[k] === undefined && isNum(v)) out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** The research 原价 of a price_cny entry (`original` and `list_price` merged). */
export const researchListPrice = (p: Price) =>
  p ? mergeListPrice(p.original as Price, p.list_price as Price) : undefined;

/** CNY amount the USD `cost.<key>` is converted from: the current main-field price. */
export function usdBasis(p: Price, key: "input" | "output" | "cache_read" | "cache_write"): number | undefined {
  const v = plain(p?.[key]);
  return isNum(v) ? v : undefined;
}
