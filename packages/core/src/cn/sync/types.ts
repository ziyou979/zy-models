// zy-models CN sync: provider interface.
//
// Mirrors upstream's `SyncProvider` (packages/core/src/sync/index.ts): a module
// only fetches, parses and translates one platform's public catalog; the runner
// (./index.ts) owns reconciliation, writing, reporting and issues.
//
// The difference from upstream: a CN module translates into the research format
// (research/FORMAT.md) instead of an upstream TOML model, because our CN data's
// single source of truth is research/<platform>.json and every catalog file
// (overlays/, new provider models) is generated from it by
// scripts/import-research.ts. Writing upstream TOMLs directly would bypass the
// overlay design and conflict with the daily upstream merge.

export interface CnPriceTier {
  when: string;
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface CnPrice {
  unit?: "per_million_tokens";
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  tiers?: CnPriceTier[];
  /** 原价, when the main fields carry a discounted price */
  list_price?: { input?: number; output?: number; cache_read?: number };
  off_peak?: string;
}

/** One remote model in research-file shape. Only fields the source states are set. */
export interface CnRemoteModel {
  id: string;
  name?: string;
  aliases?: string[];
  /** research `lab` key (deepseek, qwen, zhipu, moonshot, minimax, …) */
  lab?: string;
  release_date?: string;
  status?: "ga" | "beta" | "deprecated";
  limit?: { context?: number; input?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  tools?: boolean;
  structured_output?: boolean;
  reasoning?: { supported?: boolean };
  price_cny?: CnPrice;
}

export interface CnSyncProvider<Source> {
  /** Sync target id (`bun scripts/cn-sync.ts <id>`). */
  id: string;
  name: string;
  /** research/<file> this platform's data lives in. */
  researchFile: string;
  /** providers/<catalogProvider> the importer writes this platform to. */
  catalogProvider: string;
  /** Official public URLs the values come from; written to `sources`. */
  sources: string[];
  /**
   * Remote IDs are real API model IDs, so a model missing locally may be added
   * (when its lab model exists). False for sources keyed by display names.
   */
  createNew: boolean;
  /** Refuse to sync when the source parses to fewer models (truncated page). */
  minModels: number;
  fetchModels(): Promise<unknown>;
  parseModels(raw: unknown): Source[];
  /** undefined = intentionally skipped (not chat, internal lane, …). */
  translateModel(model: Source): CnRemoteModel | undefined;
  /**
   * For sources keyed by display names: map a remote model to the local id
   * (research id or catalog file id) it describes, or undefined when unknown.
   */
  resolveLocalID?(model: CnRemoteModel, localIDs: string[]): string | undefined;
  /** Source-level notes for the report (what the source does not cover). */
  coverage: string[];
}
