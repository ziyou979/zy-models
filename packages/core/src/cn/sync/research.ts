// Read/write research/<platform>.json without reformatting what the sync does
// not touch: number spellings such as `2.0` are kept via JSON.rawJSON, and the
// file's indentation (1 or 2 spaces, as the researcher wrote it) is preserved.
import path from "node:path";
import { readFileSync } from "node:fs";

import { REPO_ROOT } from "../ext.js";

const J = JSON as any;

export const RESEARCH_DIR = path.join(REPO_ROOT, "research");

export interface ResearchFile {
  path: string;
  indent: number;
  trailingNewline: boolean;
  data: Record<string, any>;
}

export function readResearch(file: string): ResearchFile {
  const filePath = path.join(RESEARCH_DIR, file);
  const text = readFileSync(filePath, "utf8");
  // Reviver with source-text access (TC39 JSON.parse source text; supported by Bun).
  const reviver = (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === "number" && typeof context?.source === "string" && context.source !== String(value)
      ? J.rawJSON(context.source)
      : value;
  const data = JSON.parse(text, reviver as (key: string, value: unknown) => unknown);
  const indent = text.match(/^\{\n( +)"/)?.[1]?.length ?? 2;
  return { path: filePath, indent, trailingNewline: text.endsWith("\n"), data };
}

export function serializeResearch(file: ResearchFile) {
  return JSON.stringify(file.data, null, file.indent) + (file.trailingNewline ? "\n" : "");
}

/** Plain value of a research field (unwraps kept number spellings). */
export function val<T = unknown>(value: unknown): T {
  return (J.isRawJSON?.(value) ? JSON.parse((value as any).rawJSON) : value) as T;
}

/** A finite number, or undefined (null, missing, text). */
export function numOf(value: unknown): number | undefined {
  const v = val(value);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
