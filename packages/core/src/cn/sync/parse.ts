// Small parsers for official pages (no API key): markdown tables, Next.js
// payloads, and fetch with a timeout + retry.

export async function fetchText(url: string, init: RequestInit = {}, attempts = 3): Promise<string> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(30_000),
        headers: { "user-agent": "zy-models-cn-sync (+https://github.com/ziyou979/zy-models)", ...(init.headers ?? {}) },
      });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      last = error;
      await Bun.sleep(2000 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(await fetchText(url, { headers: { accept: "application/json" } }));
}

/** `<script id="__NEXT_DATA__">` (Next.js pages router). */
export function nextData(html: string): any {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("__NEXT_DATA__ not found");
  return JSON.parse(match[1]!);
}

/** Concatenated React Server Components payload (`self.__next_f.push([1,"…"])`, Next.js app router). */
export function rscPayload(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) parts.push(JSON.parse(m[1]!));
  if (parts.length === 0) throw new Error("no RSC payload found");
  return parts.join("");
}

/** The JSON array that follows `"<key>":` in a text (first occurrence). */
export function jsonArrayAfter(text: string, key: string, from = 0): unknown[] | undefined {
  const at = text.indexOf(`"${key}":[`, from);
  if (at < 0) return undefined;
  const start = text.indexOf("[", at);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  return undefined;
}

export interface MdTable {
  /** Nearest preceding markdown headings, outermost first. */
  headings: string[];
  header: string[];
  rows: string[][];
}

const cleanCell = (cell: string) =>
  cell
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\\([-_*.[\]()|>])/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/~~[^~]*~~/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Pipe tables of a markdown document (also inside `>` blockquotes). Empty first cells continue the row above. */
export function markdownTables(md: string): MdTable[] {
  const tables: MdTable[] = [];
  const headings: string[] = [];
  let current: MdTable | undefined;
  for (const raw of md.split("\n")) {
    const line = raw.replace(/^\s*>\s?/, "").trim();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      headings.length = heading[1]!.length - 1;
      headings[heading[1]!.length - 1] = heading[2]!.trim();
      current = undefined;
      continue;
    }
    if (!line.startsWith("|")) {
      if (line !== "") current = undefined;
      continue;
    }
    const cells = line.replace(/^\|/, "").replace(/\|\s*$/, "").split(/(?<!\\)\|/).map(cleanCell);
    if (current === undefined) {
      current = { headings: headings.filter(Boolean), header: cells, rows: [] };
      tables.push(current);
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c) || c === "")) continue;
    if (cells[0] === "" && current.rows.length > 0) cells[0] = current.rows.at(-1)![0]!;
    current.rows.push(cells);
  }
  return tables;
}

/** "8" / "0.80" / "¥13.00 / MTok" → number; "免费" → 0; "-" / "不支持" / "限时免费" → undefined. */
export function priceCell(cell: string | undefined): number | undefined {
  if (cell === undefined) return undefined;
  const text = cell.trim();
  if (text === "免费") return 0;
  const match = text.match(/^[¥￥]?\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : undefined;
}

export const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Asia/Shanghai calendar date, YYYY-MM-DD. */
export function todayCST(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
