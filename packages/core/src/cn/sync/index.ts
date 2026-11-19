// zy-models CN sync runner (`bun scripts/cn-sync.ts`).
//
// Same shape as upstream's `bun models:sync` (packages/core/src/sync/index.ts):
// provider modules in ./providers, `--list-providers` for the workflow matrix,
// `--dry-run`, a markdown report in .sync/, and GitHub issues for what can't be
// synced automatically. Where it differs: it writes research/<platform>.json
// (our CN source of truth) and scripts/import-research.ts regenerates overlays/
// and provider model files from it.
//
// Rules (docs/cn-sync.md):
// - A model already in research: only fields that are null/missing are filled.
//   A differing non-null value is an official-source conflict: reported, never
//   overwritten.
// - A model only in the upstream catalog (no research entry): upstream values
//   carry no official source, so a research entry is added from the official
//   data; the importer then overlays it.
// - A model nowhere locally: added only when the source's ids are real API ids
//   and its lab model exists under models/; otherwise reported for manual work.
// - Nothing is deleted. Local models absent from the source are only reported.
import path from "node:path";
import { mkdir } from "node:fs/promises";

import { catalogModelIDs, labFromID, strictBaseModel } from "./labs.js";
import { todayCST } from "./parse.js";
import { numOf, readResearch, serializeResearch, val } from "./research.js";
import type { CnPrice, CnRemoteModel, CnSyncProvider } from "./types.js";
import { deepseek } from "./providers/deepseek.js";
import { ppio } from "./providers/ppio.js";
import { qiniu } from "./providers/qiniu.js";
import { siliconflow } from "./providers/siliconflow.js";
import { volcengine } from "./providers/volcengine.js";
import { zhipu } from "./providers/zhipu.js";

export const cnProviders: Record<string, CnSyncProvider<any>> = {
  ppio,
  qiniu,
  siliconflow,
  zhipu,
  volcengine,
  deepseek,
};

export interface FieldChange {
  id: string;
  field: string;
  value: unknown;
}

export interface FieldConflict {
  id: string;
  field: string;
  local: unknown;
  remote: unknown;
  localSources: string[];
}

export interface CnSyncResult {
  id: string;
  name: string;
  researchFile: string;
  sources: string[];
  coverage: string[];
  remoteCount: number;
  changed: boolean;
  /** New research entries for models with no local data at all. */
  added: string[];
  /** New research entries for models only the upstream catalog had. */
  adopted: string[];
  filled: FieldChange[];
  conflicts: FieldConflict[];
  missing: { id: string; reason: string }[];
  /** Research models the source no longer lists (not removed). */
  absent: string[];
  notices: string[];
}

const LIMIT_KEYS = ["context", "input", "output"] as const;
const PRICE_KEYS = ["input", "output", "cache_read", "cache_write"] as const;

/** 1M ≈ 1_000_000 ≈ 1_048_576: the same nominal value in either K/M convention. */
export function sameLabel(a: number, b: number) {
  if (a === b) return true;
  const label = (n: number) => {
    for (const base of [1000, 1024]) {
      if (n % (base * base) === 0) return `${n / (base * base)}M`;
      if (n % base === 0) return `${n / base}K`;
    }
    return String(n);
  };
  return label(a) === label(b);
}

const samePrice = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, 1e-6 * Math.max(Math.abs(a), Math.abs(b)));
const isEmpty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

function reconcile(entry: Record<string, any>, remote: CnRemoteModel, result: CnSyncResult) {
  let filled = 0;
  const localSources: string[] = Array.isArray(entry.sources) ? entry.sources : [];
  const fill = (field: string, value: unknown, set: () => void) => {
    set();
    filled++;
    result.filled.push({ id: entry.id, field, value });
  };
  const conflict = (field: string, local: unknown, remoteValue: unknown) =>
    result.conflicts.push({ id: entry.id, field, local, remote: remoteValue, localSources });

  if (remote.name !== undefined && isEmpty(entry.name)) fill("name", remote.name, () => (entry.name = remote.name));
  if (remote.release_date !== undefined && isEmpty(entry.release_date))
    fill("release_date", remote.release_date, () => (entry.release_date = remote.release_date));
  if (remote.status === "deprecated" && val(entry.status) !== "deprecated") {
    if (isEmpty(entry.status)) fill("status", "deprecated", () => (entry.status = "deprecated"));
    else conflict("status", val(entry.status), "deprecated");
  }

  for (const key of LIMIT_KEYS) {
    const want = remote.limit?.[key];
    if (want === undefined) continue;
    const have = numOf(entry.limit?.[key]);
    if (have === undefined) fill(`limit.${key}`, want, () => ((entry.limit ??= {})[key] = want));
    else if (!sameLabel(have, want)) conflict(`limit.${key}`, have, want);
  }

  for (const key of ["input", "output"] as const) {
    const want = remote.modalities?.[key];
    if (want === undefined || want.length === 0) continue;
    if (isEmpty(entry.modalities?.[key])) fill(`modalities.${key}`, want, () => ((entry.modalities ??= {})[key] = want));
  }

  for (const key of ["tools", "structured_output"] as const) {
    const want = remote[key];
    if (want === undefined) continue;
    const have = val(entry[key]);
    if (typeof have !== "boolean") fill(key, want, () => (entry[key] = want));
    else if (have !== want) conflict(key, have, want);
  }

  if (remote.reasoning?.supported === true) {
    const have = val(entry.reasoning?.supported);
    if (typeof have !== "boolean") fill("reasoning.supported", true, () => ((entry.reasoning ??= {}).supported = true));
    else if (have !== true) conflict("reasoning.supported", have, true);
  }

  const price = remote.price_cny;
  if (price !== undefined) {
    if (entry.price_cny === null || entry.price_cny === undefined) {
      fill("price_cny", price, () => (entry.price_cny = { unit: "per_million_tokens", ...price }));
    } else {
      const local = entry.price_cny;
      const localRows = [local, ...(Array.isArray(local.tiers) ? local.tiers : [])];
      const remoteRows = [price, ...(price.tiers ?? [])] as unknown as Record<string, unknown>[];
      const has = (rows: Record<string, unknown>[], key: string, v: number) => rows.some((r) => { const x = numOf(r[key]); return x !== undefined && samePrice(x, v); });
      for (const key of PRICE_KEYS) {
        const want = price[key];
        if (want === undefined) continue;
        const have = numOf(local[key]);
        if (have === undefined) fill(`price_cny.${key}`, want, () => (local[key] = want));
        // Tiered prices (time of day, input length): the two sides may put a
        // different tier in the main fields. Only a price neither side's tiers
        // contain is a conflict.
        else if (!samePrice(have, want) && !has(localRows, key, want) && !has(remoteRows, key, have)) conflict(`price_cny.${key}`, have, want);
      }
      if ((price.tiers?.length ?? 0) >= 2 && isEmpty(local.tiers)) fill("price_cny.tiers", price.tiers, () => (local.tiers = price.tiers));
      if (price.list_price !== undefined && isEmpty(local.list_price)) {
        const discounted = PRICE_KEYS.some((k) => price[k] !== undefined && price.list_price![k as "input"] !== undefined && !samePrice(price[k]!, price.list_price![k as "input"]!));
        if (discounted) fill("price_cny.list_price", price.list_price, () => (local.list_price = price.list_price));
      }
      if (price.off_peak !== undefined && isEmpty(local.off_peak)) fill("price_cny.off_peak", price.off_peak, () => (local.off_peak = price.off_peak));
    }
  }
  return filled;
}

function newEntry(remote: CnRemoteModel, lab: string, provider: CnSyncProvider<unknown>, today: string, aliases: string[]) {
  const price: CnPrice | undefined = remote.price_cny === undefined ? undefined : { unit: "per_million_tokens", ...remote.price_cny };
  return {
    id: remote.id,
    name: remote.name ?? remote.id.split("/").pop(),
    name_zh: null,
    aliases,
    lab,
    open_weights: null,
    release_date: remote.release_date ?? null,
    status: remote.status ?? "ga",
    limit: { context: remote.limit?.context ?? null, input: remote.limit?.input ?? null, output: remote.limit?.output ?? null },
    modalities: remote.modalities ?? { input: ["text"], output: ["text"] },
    tools: remote.tools ?? null,
    structured_output: remote.structured_output ?? null,
    reasoning: { supported: remote.reasoning?.supported ?? null, toggle: null, effort: null, default: null, default_source: null, field: null },
    price_cny: price ?? null,
    price_usd_intl: null,
    sources: [...provider.sources],
    checked_at: today,
    notes: `由 cn-sync 自动添加（${today}），字段取自官方公开数据，未经人工复核；思考开关/档位等未公开字段留空。`,
  };
}

export async function syncCnProvider(provider: CnSyncProvider<any>, options: { dryRun?: boolean; today?: string } = {}) {
  const today = options.today ?? todayCST();
  console.log(`\nSyncing ${provider.name} (${provider.id})...`);
  const result: CnSyncResult = {
    id: provider.id,
    name: provider.name,
    researchFile: provider.researchFile,
    sources: provider.sources,
    coverage: provider.coverage,
    remoteCount: 0,
    changed: false,
    added: [],
    adopted: [],
    filled: [],
    conflicts: [],
    missing: [],
    absent: [],
    notices: [],
  };

  const sourceModels = provider.parseModels(await provider.fetchModels());
  const remotes: CnRemoteModel[] = [];
  const seen = new Set<string>();
  for (const model of sourceModels) {
    const translated = provider.translateModel(model);
    if (translated === undefined) continue;
    const key = translated.id.toLowerCase();
    if (seen.has(key)) {
      result.notices.push(`官方数据中重复的模型 \`${translated.id}\`，只取第一条`);
      continue;
    }
    seen.add(key);
    const { context, input, output } = translated.limit ?? {};
    for (const [k, v] of [["output", output], ["input", input]] as const) {
      if (context !== undefined && v !== undefined && v > context) {
        result.notices.push(`\`${translated.id}\` 官方数据 limit.${k} ${v} 大于 context ${context}，自相矛盾，本次不同步该字段`);
        delete translated.limit![k];
      }
    }
    remotes.push(translated);
  }
  if (remotes.length < provider.minModels) {
    throw new Error(`${provider.name}: parsed ${remotes.length} models, below the ${provider.minModels} expected — page layout changed or response truncated`);
  }
  result.remoteCount = remotes.length;

  const research = readResearch(provider.researchFile);
  const models: Record<string, any>[] = (research.data.models ??= []);
  const index = new Map<string, Record<string, any>>();
  for (const m of models) for (const id of [m.id, ...(m.aliases ?? [])]) index.set(String(id).toLowerCase(), m);
  const catalog = catalogModelIDs(provider.catalogProvider);
  const localIDs = [...new Set([...models.map((m) => String(m.id)), ...catalog.values()])];
  const matched = new Set<Record<string, any>>();
  let changed = false;

  // Resolve local ids first (display-name sources), then match in two passes:
  // exact id matches claim their entry before alias matches, so a remote whose
  // alias list names another model (seen on 七牛) can't take that model's entry.
  const resolved: CnRemoteModel[] = [];
  for (const raw of remotes) {
    if (!provider.resolveLocalID) {
      resolved.push(raw);
      continue;
    }
    const local = provider.resolveLocalID(raw, localIDs);
    if (local === undefined) result.missing.push({ id: raw.id, reason: "官方价格表只给显示名，无法唯一对应到 API 模型 ID，需人工补录" });
    else resolved.push({ ...raw, id: local });
  }
  const byID = new Map(models.map((m) => [String(m.id).toLowerCase(), m]));
  const remoteIDs = new Set(resolved.map((r) => r.id.toLowerCase()));
  const entryFor = new Map<CnRemoteModel, Record<string, any>>();
  for (const remote of resolved) {
    const exact = byID.get(remote.id.toLowerCase());
    if (exact) {
      entryFor.set(remote, exact);
      matched.add(exact);
    }
  }
  for (const remote of resolved) {
    if (entryFor.has(remote)) continue;
    const keys = [remote.id, ...(remote.aliases ?? [])].map((id) => id.toLowerCase());
    const entry = keys.map((k) => index.get(k)).find((e) => e !== undefined && !matched.has(e));
    if (entry) {
      entryFor.set(remote, entry);
      matched.add(entry);
    }
  }

  for (const remote of resolved) {
    const keys = [remote.id, ...(remote.aliases ?? [])].map((id) => id.toLowerCase());
    const entry = entryFor.get(remote);
    if (entry) {
      if (reconcile(entry, remote, result) > 0) {
        entry.sources = [...new Set([...(entry.sources ?? []), ...provider.sources])];
        entry.checked_at = today;
        changed = true;
      }
      continue;
    }

    const catalogHit =
      catalog.get(remote.id.toLowerCase()) ??
      keys.slice(1).filter((k) => !remoteIDs.has(k) && !index.has(k)).map((k) => catalog.get(k)).find(Boolean);
    const lab = remote.lab ?? labFromID(remote.id);
    // Aliases the importer matches catalog files with: keep only ones that name
    // no other model (another remote, a research entry, a different catalog file).
    const ownAliases = (remote.aliases ?? []).filter((a) => {
      const k = a.toLowerCase();
      return k !== remote.id.toLowerCase() && !remoteIDs.has(k) && !index.has(k) && (catalog.get(k) === undefined || catalog.get(k) === catalogHit);
    });
    const aliases = [...new Set([...ownAliases, ...(catalogHit && catalogHit.toLowerCase() !== remote.id.toLowerCase() ? [catalogHit] : [])])];
    const register = (e: Record<string, any>) => {
      for (const k of [e.id, ...e.aliases]) if (!index.has(String(k).toLowerCase())) index.set(String(k).toLowerCase(), e);
    };
    if (catalogHit) {
      const added = newEntry(remote, lab ?? provider.catalogProvider, provider, today, aliases);
      models.push(added);
      matched.add(added);
      register(added);
      result.adopted.push(remote.id);
      changed = true;
      continue;
    }
    if (!provider.createNew) {
      result.missing.push({ id: remote.id, reason: "本地无此模型，且该数据源的模型名不是 API ID，不自动创建" });
      continue;
    }
    const { base, own, importer } = lab === undefined ? {} : strictBaseModel(lab, [remote.id, ...aliases]);
    if (base === undefined) {
      result.missing.push({
        id: remote.id,
        reason:
          lab === undefined
            ? "无法判断所属厂商（lab），不自动创建"
            : importer !== undefined
              ? own !== undefined
                ? `lab 中有同 ID 的 \`${own}\`，但导入器会按第一方别名解析成 \`${importer}\`，需人工确认 base_model`
                : `models/ 下没有同 ID 的 lab 模型；导入器会按别名推断为 \`${importer}\`，可能不对，需人工确认`
              : `models/ 下没有对应的 lab 模型（${lab}），需先补 lab 文件`,
      });
      continue;
    }
    const added = newEntry(remote, lab!, provider, today, aliases);
    models.push(added);
    matched.add(added);
    register(added);
    result.added.push(`${remote.id} → base_model ${base}`);
    changed = true;
  }

  for (const m of models) if (!matched.has(m)) result.absent.push(String(m.id));

  result.changed = changed;
  if (changed && !options.dryRun) await Bun.write(research.path, serializeResearch(research));
  console.log(
    `${provider.name}: ${result.added.length} added, ${result.adopted.length} adopted, ${result.filled.length} fields filled, ` +
      `${result.conflicts.length} conflicts, ${result.missing.length} need manual work, ${result.absent.length} absent from source`,
  );
  return result;
}

// ---------------------------------------------------------------- report

const fmt = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export function renderReport(r: CnSyncResult) {
  const lines = [
    `由 \`bun scripts/cn-sync.ts ${r.id}\` 自动生成：从 ${r.name} 的官方公开数据同步到 \`research/${r.researchFile}\`，再由 \`scripts/import-research.ts\` 重新生成 overlays/ 与 provider 模型文件。`,
    "",
    "**数据源（无需 API key）**",
    ...r.sources.map((s) => `- ${s}`),
    "",
    "**同步范围**",
    ...r.coverage.map((c) => `- ${c}`),
    "",
    `| 官方数据中的模型 | 新增模型 | 补录上游已有模型 | 补全字段 | 冲突（未覆盖） | 需人工处理 | 本地有、官方源未列出 |`,
    `| ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
    `| ${r.remoteCount} | ${r.added.length} | ${r.adopted.length} | ${r.filled.length} | ${r.conflicts.length} | ${r.missing.length} | ${r.absent.length} |`,
  ];
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push("", `<details><summary>${title}（${items.length}）</summary>`, "", ...items.map((i) => `- ${i}`), "", "</details>");
  };
  section("新增模型（写入 research，导入器生成 provider 模型文件）", r.added.map((a) => `\`${a}\``));
  section("补录上游已有、但缺官方来源的模型（导入器写 overlays/）", r.adopted.map((a) => `\`${a}\``));
  section("补全的空字段", r.filled.map((f) => `\`${f.id}\` ${f.field} = ${fmt(f.value)}`));
  section("与已有官方来源数据冲突（保留原值，未覆盖）", conflictLines(r));
  section("需人工处理（未自动创建）", r.missing.map((m) => `\`${m.id}\`：${m.reason}`));
  section("本地研究数据中有、官方源本次未列出（未删除，请核实是否下线）", r.absent.map((a) => `\`${a}\``));
  if (r.notices.length) section("提示", r.notices);
  return lines.join("\n") + "\n";
}

function conflictLines(r: CnSyncResult) {
  return r.conflicts.map(
    (c) => `\`${c.id}\` ${c.field}：本地 ${fmt(c.local)}（来源 ${c.localSources.join("、") || "—"}） vs 官方源 ${fmt(c.remote)}`,
  );
}

/** Issue body: conflicts + models needing manual work; empty when there is nothing to do. */
export function renderIssue(r: CnSyncResult) {
  if (r.conflicts.length === 0 && r.missing.length === 0) return "";
  const lines = [
    `\`bun scripts/cn-sync.ts ${r.id}\` 每日从 ${r.name} 官方公开数据同步时，以下内容不能自动处理（本 issue 每次运行会刷新）。`,
    "",
    `数据源：${r.sources.join("、")}`,
  ];
  if (r.conflicts.length) {
    lines.push("", `### 与已有官方来源数据冲突（${r.conflicts.length}）`, "", "已有值来自官方来源，同步没有覆盖。请核实哪一方是最新的官方数据，再手工更新 `research/" + r.researchFile + "`。", "");
    lines.push(...conflictLines(r).map((l) => `- [ ] ${l}`));
  }
  if (r.missing.length) {
    lines.push("", `### 官方数据中有、本地缺失且未自动创建的模型（${r.missing.length}）`, "");
    lines.push(...r.missing.map((m) => `- [ ] \`${m.id}\`：${m.reason}`));
  }
  return lines.join("\n") + "\n";
}

export function syncProviderMatrix() {
  return { include: Object.values(cnProviders).map((p) => ({ provider: p.id, name: p.name })) };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--list-providers")) {
    console.log(JSON.stringify(syncProviderMatrix()));
    return;
  }
  const target = args.find((a) => !a.startsWith("-")) ?? "all";
  const ids = target === "all" ? Object.keys(cnProviders) : [target];
  const dryRun = args.includes("--dry-run");
  await mkdir(".sync", { recursive: true });
  let failed = false;
  for (const id of ids) {
    const provider = cnProviders[id];
    if (provider === undefined) throw new Error(`Unknown CN sync target: ${id} (known: ${Object.keys(cnProviders).join(", ")})`);
    try {
      const result = await syncCnProvider(provider, { dryRun });
      await Bun.write(path.join(".sync", `cn-${id}-report.md`), renderReport(result));
      await Bun.write(path.join(".sync", `cn-${id}-issue.md`), renderIssue(result));
      await Bun.write(path.join(".sync", `cn-${id}.json`), JSON.stringify(result, null, 2));
      if (dryRun) console.log(renderReport(result));
    } catch (error) {
      failed = true;
      console.error(`${provider.name}: sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed) process.exitCode = 1;
}
