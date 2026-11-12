/** @jsx jsx */
/** @jsxImportSource hono/jsx */

// zy-models: everything the website adds on top of upstream models.dev.
//
// render.tsx only calls into this file from a handful of hooks (marked
// "zy-models" there), so upstream merges of render.tsx stay small.
// Data comes from the extension keys attached by packages/core/src/cn/ext.ts:
//   provider: name_zh, region, pricing_page, plans[], notes
//   model:    name_zh, aliases, cost_cny, reasoning_default, sources, checked_at, notes

import { Fragment } from "hono/jsx";

export const SITE = {
  name: "zy-models",
  tagline: "中国版 models.dev · AI 模型能力库",
  repo: "https://github.com/ziyou979/zy-models",
  url: "https://zy-models.ziyou979.workers.dev",
};

export const SITE_METADATA = {
  title: "zy-models · 中国版 models.dev",
  description:
    "开源 AI 模型能力库：在 models.dev 全量数据之上补齐国内平台的人民币价格、编程套餐、默认思考档位与中文名。",
};

// UI labels: Chinese first, upstream wording kept where it is a term of art.
export const T = {
  models: "模型",
  providers: "平台",
  labs: "厂商",
  search: "搜索",
  help: "使用说明",
  model: "模型",
  provider: "平台",
  lab: "厂商",
  context: "上下文",
  output: "输出",
  input: "输入",
  reasoning: "推理",
  toolCall: "工具调用",
  structured: "结构化输出",
  temperature: "温度",
  weights: "权重",
  price: "美元价（输入/输出）",
  release: "发布",
  updated: "更新",
  modelId: "模型 ID",
  package: "SDK 包",
  api: "API",
  docs: "文档",
  description: "简介",
  family: "系列",
  outputLimit: "输出上限",
  knowledge: "知识截止",
  outputTypes: "输出类型",
  capabilities: "能力",
  emptyRows: "没有符合条件的行。",
  providerSpecific: "平台专有",
  cnOnly: "仅国内平台",
  canonical: "通用模型",
};

const YES_NO: Record<string, string> = { Yes: "是", No: "否", Open: "开源", Closed: "闭源" };
export function zhWord(value: string) {
  return YES_NO[value] ?? value;
}

// ---------------------------------------------------------------- types

export interface CostCny {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  cache_write_1h?: number;
  reasoning?: number;
  list_price?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  discount_note?: string;
  tiers?: Array<{ when: string; input?: number; output?: number; cache_read?: number; cache_write?: number; reasoning?: number }>;
  off_peak?: string;
  note?: string;
}

export interface ReasoningDefault {
  value: string;
  source?: string;
}

export interface CnModelExt {
  name_zh?: string;
  aliases?: string[];
  cost_cny?: CostCny;
  reasoning_default?: ReasoningDefault;
  sources?: string[];
  checked_at?: string;
  notes?: string;
}

export interface Plan {
  id: string;
  name_zh: string;
  name?: string;
  price_cny_month?: number | Record<string, number>;
  price_cny_quarter?: number | Record<string, number>;
  price_cny_year?: number | Record<string, number>;
  base_url?: string;
  anthropic_base_url?: string;
  other_base_urls?: string[];
  protocol?: string;
  models?: string[];
  quota_note?: string;
  usage_restriction?: string;
  sources?: string[];
}

export interface CnProviderExt {
  name_zh?: string;
  region?: "cn" | "intl";
  pricing_page?: string;
  plans?: Plan[];
  notes?: string;
}

export function providerExt(provider: unknown): CnProviderExt {
  return (provider ?? {}) as CnProviderExt;
}

export function modelExt(model: unknown): CnModelExt {
  return (model ?? {}) as CnModelExt;
}

export function isCnProvider(provider: unknown) {
  return providerExt(provider).region === "cn";
}

// ---------------------------------------------------------------- names

/** Name shown for a provider: 中文名 when there is one. */
export function providerDisplayName(provider: { name: string }) {
  return providerExt(provider).name_zh ?? provider.name;
}

/** Name cell content: 中文名 first, upstream name kept underneath when it differs. */
export function ZhName(props: { name: string; nameZh?: string }) {
  if (!props.nameZh || props.nameZh === props.name) return <Fragment>{props.name}</Fragment>;
  return <Fragment>{props.nameZh}</Fragment>;
}

export function zhAltName(name: string, nameZh?: string) {
  return nameZh && nameZh !== name ? name : undefined;
}

// ---------------------------------------------------------------- canonical aggregation

interface ProviderEntryLike {
  provider: unknown;
  model: unknown;
}

export interface CanonicalCn {
  nameZh?: string;
  cost?: CostCny;
  costProvider?: string;
  reasoningDefault?: ReasoningDefault;
  cn: boolean;
}

/** Roll provider-level extension data up to a canonical model row. */
export function canonicalCn(metadata: unknown, providers: Array<ProviderEntryLike & { provider: { name: string } }>): CanonicalCn {
  const ext = modelExt(metadata);
  const cnFirst = [...providers].sort(
    (a, b) => Number(isCnProvider(b.provider)) - Number(isCnProvider(a.provider)),
  );
  let cost: CostCny | undefined;
  let costProvider: string | undefined;
  for (const entry of providers) {
    const c = modelExt(entry.model).cost_cny;
    if (c?.input === undefined && c?.output === undefined) continue;
    if (!cost || (c!.input ?? Infinity) < (cost.input ?? Infinity)) {
      cost = c;
      costProvider = providerDisplayName(entry.provider);
    }
  }
  return {
    nameZh: ext.name_zh ?? cnFirst.map((e) => modelExt(e.model).name_zh).find(Boolean),
    cost,
    costProvider,
    reasoningDefault:
      ext.reasoning_default ?? cnFirst.map((e) => modelExt(e.model).reasoning_default).find(Boolean),
    cn: providers.some((entry) => isCnProvider(entry.provider)),
  };
}

// ---------------------------------------------------------------- cells

const cny = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4, useGrouping: false });
export function formatCny(value?: number) {
  return value === undefined ? "-" : `¥${cny.format(value)}`;
}

function costLines(cost: CostCny, via?: string) {
  const lines: string[] = ["单位：元 / 百万 tokens"];
  if (via) lines.push(`最低价来自：${via}`);
  lines.push(
    `输入 ${formatCny(cost.input)} · 输出 ${formatCny(cost.output)} · 缓存命中 ${formatCny(cost.cache_read)}` +
      (cost.cache_write !== undefined ? ` · 缓存写入 ${formatCny(cost.cache_write)}` : ""),
  );
  if (cost.list_price) {
    lines.push(`原价：输入 ${formatCny(cost.list_price.input)} · 输出 ${formatCny(cost.list_price.output)}`);
  }
  if (cost.discount_note) lines.push(`优惠：${cost.discount_note}`);
  for (const tier of cost.tiers ?? []) {
    lines.push(`【${tier.when}】输入 ${formatCny(tier.input)} · 输出 ${formatCny(tier.output)}` + (tier.cache_read !== undefined ? ` · 缓存 ${formatCny(tier.cache_read)}` : ""));
  }
  if (cost.off_peak) lines.push(`峰谷：${cost.off_peak}`);
  if (cost.note) lines.push(cost.note);
  return lines;
}

const MARKS: Array<[key: string, label: string, test: (cost: CostCny) => boolean]> = [
  ["tier", "阶梯", (cost) => Boolean(cost.tiers?.length)],
  ["peak", "峰谷", (cost) => Boolean(cost.off_peak)],
  ["deal", "优惠", (cost) => Boolean(cost.list_price || cost.discount_note)],
];

/**
 * Price + 阶梯/峰谷/优惠 badges; the details open on hover (mouse) or on
 * click / tap (cn-client.ts toggles .open), so they work on touch screens.
 */
export function CnyDetail(props: { cost: CostCny; via?: string; compact?: boolean }) {
  const cost = props.cost;
  const marks = MARKS.filter(([, , test]) => test(cost));
  return (
    <span class="cny-detail">
      <button type="button" class="cny-toggle" aria-expanded="false" aria-label="查看人民币价格明细">
        <span class="cny-price">
          {formatCny(cost.input)} / {formatCny(cost.output)}
          {props.compact ? null : <Fragment> / {formatCny(cost.cache_read)}</Fragment>}
        </span>
        {marks.length > 0 && (
          <span class="cny-marks">
            {marks.map(([key, label]) => (
              <span class={`cny-badge cny-badge-${key}`}>{label}</span>
            ))}
          </span>
        )}
      </button>
      <span class="cny-pop" role="tooltip">
        {costLines(cost, props.via).map((line) => (
          <span class="cny-pop-line">{line}</span>
        ))}
      </span>
    </span>
  );
}

/** 人民币价（输入/输出/缓存） cell. Sorts by input price; rows without a price sort last. */
export function CnyCell(props: { cost?: CostCny; via?: string }) {
  const cost = props.cost;
  if (!cost || (cost.input === undefined && cost.output === undefined)) {
    return <td class="numeric cny" data-sort="">-</td>;
  }
  return (
    <td class="numeric cny" data-sort={cost.input === undefined ? "" : String(cost.input)}>
      <CnyDetail cost={cost} via={props.via} />
    </td>
  );
}

const REASONING_ZH: Record<string, string> = {
  on: "开启",
  enabled: "开启",
  off: "关闭",
  disabled: "关闭",
  auto: "自动",
  adaptive: "自适应",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最高",
};

export function reasoningDefaultText(value?: string) {
  if (!value) return "-";
  if (REASONING_ZH[value]) return `${REASONING_ZH[value]}（${value}）`;
  const budget = /^budget:(\d+)$/.exec(value);
  if (budget) return `预算 ${Number(budget[1]).toLocaleString()} tokens`;
  return value;
}

/** 默认思考 cell: what happens when the request sets no reasoning parameter. */
export function ReasoningDefaultCell(props: { value?: ReasoningDefault }) {
  const value = props.value;
  if (!value) return <td data-sort="">-</td>;
  const text = reasoningDefaultText(value.value);
  return (
    <td data-sort={value.value} title="请求不传任何思考参数时的默认行为">
      {value.source ? (
        <a href={value.source} target="_blank" rel="noopener noreferrer">
          {text}
        </a>
      ) : (
        text
      )}
    </td>
  );
}

export function CnHeaders(props: { th: (label: string, type?: "text" | "number") => unknown }) {
  return (
    <Fragment>
      {props.th("人民币价（输入/输出/缓存）", "number")}
      {props.th("默认思考")}
    </Fragment>
  );
}

/** Number of columns the hooks above add to a table. */
export const CN_COLUMNS = 2;

// ---------------------------------------------------------------- filter

/** "仅国内平台" toggle shown above a table; rows carry data-cn="1"|"0". */
export function CnFilter(props: { label?: string; hint?: string; defaultOn?: boolean; children?: unknown }) {
  return (
    <div class="cn-filter-bar">
      {props.children}
      <label class="cn-filter">
        <input
          type="checkbox"
          data-cn-filter
          data-cn-default={props.defaultOn ? "1" : undefined}
          checked={props.defaultOn ? true : undefined}
        />
        <span>{props.label ?? T.cnOnly}</span>
      </label>
      {props.hint && <span class="cn-filter-hint">{props.hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- provider page

export function regionText(region?: string) {
  if (region === "cn") return "国内（中国大陆）";
  if (region === "intl") return "海外 / 国际站";
  return "-";
}

export function providerFacts(provider: unknown): Array<[string, unknown]> {
  const ext = providerExt(provider);
  if (!ext.region && !ext.name_zh && !ext.pricing_page) return [];
  const items: Array<[string, unknown]> = [["区域", regionText(ext.region)]];
  if (ext.pricing_page) {
    items.push([
      "价格页",
      <a href={ext.pricing_page} target="_blank" rel="noopener noreferrer">
        官方价格
      </a>,
    ]);
  }
  if (ext.plans?.length) items.push(["编程套餐", `${ext.plans.length} 个`]);
  return items;
}

function priceText(value?: number | Record<string, number>, unit = "月") {
  if (value === undefined) return undefined;
  if (typeof value === "number") return `¥${cny.format(value)}/${unit}`;
  return Object.entries(value)
    .map(([tier, price]) => `${tier} ¥${cny.format(price)}/${unit}`)
    .join("，");
}

const PROTOCOL_ZH: Record<string, string> = {
  "openai-chat": "OpenAI Chat",
  "openai-responses": "OpenAI Responses",
  anthropic: "Anthropic",
  gemini: "Gemini",
  native: "原生",
};

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 编程套餐 + 平台说明 sections on a provider page. */
export function ProviderCnSections(props: {
  provider: unknown;
  modelNames: Map<string, string>;
  copy: (value: string) => unknown;
}) {
  const ext = providerExt(props.provider);
  const plans = ext.plans ?? [];
  if (plans.length === 0 && !ext.notes) return null;

  return (
    <Fragment>
      {plans.length > 0 && (
        <section class="table-section cn-plans" id="plans">
          <div class="section-heading">
            <h3>编程套餐</h3>
            <span>{plans.length}</span>
          </div>
          <div class="cn-plan-list">
            {plans.map((plan) => {
              const prices = [
                priceText(plan.price_cny_month, "月"),
                priceText(plan.price_cny_quarter, "季"),
                priceText(plan.price_cny_year, "年"),
              ].filter(Boolean);
              const urls: Array<[string, string]> = [];
              if (plan.base_url) urls.push([plan.protocol ? PROTOCOL_ZH[plan.protocol] ?? plan.protocol : "Base URL", plan.base_url]);
              if (plan.anthropic_base_url) urls.push(["Anthropic", plan.anthropic_base_url]);
              for (const other of plan.other_base_urls ?? []) urls.push(["其他", other]);
              return (
                <article class="cn-plan" id={`plan-${plan.id}`}>
                  <div class="cn-plan-head">
                    <h4>{plan.name_zh}</h4>
                    <span class="cn-plan-price">{prices.length ? prices.join(" · ") : "价格见官网"}</span>
                  </div>
                  <dl class="cn-plan-facts">
                    {urls.length > 0 && (
                      <div>
                        <dt>接入地址</dt>
                        <dd>
                          {urls.map(([label, url]) => (
                            <div class="cn-plan-url">
                              <span class="cn-plan-proto">{label}</span>
                              <code class="copy-source">{url}</code>
                              {props.copy(url)}
                            </div>
                          ))}
                        </dd>
                      </div>
                    )}
                    {plan.models?.length ? (
                      <div>
                        <dt>包含模型</dt>
                        <dd class="cn-plan-models">
                          {plan.models.map((id, _, ids) => {
                            const name = props.modelNames.get(id) ?? id;
                            const clash = ids.some((other) => other !== id && (props.modelNames.get(other) ?? other) === name);
                            return (
                              <span class="cn-chip" title={id}>
                                {clash ? id : name}
                              </span>
                            );
                          })}
                        </dd>
                      </div>
                    ) : null}
                    {plan.quota_note && (
                      <div>
                        <dt>额度</dt>
                        <dd>{plan.quota_note}</dd>
                      </div>
                    )}
                    {plan.usage_restriction && (
                      <div class="cn-plan-restriction">
                        <dt>使用限制</dt>
                        <dd>{plan.usage_restriction}</dd>
                      </div>
                    )}
                    {plan.sources?.length ? (
                      <div>
                        <dt>来源</dt>
                        <dd class="cn-plan-sources">
                          {plan.sources.map((url) => (
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              {hostOf(url)}
                            </a>
                          ))}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {ext.notes && (
        <section class="table-section cn-notes">
          <div class="section-heading">
            <h3>平台说明</h3>
          </div>
          <p class="cn-notes-body">{ext.notes}</p>
        </section>
      )}
    </Fragment>
  );
}

/** Extra facts on a model page (CNY price / default reasoning). */
export function modelFacts(cn: CanonicalCn): Array<[string, unknown]> {
  const items: Array<[string, unknown]> = [];
  if (cn.cost) {
    items.push(["人民币最低价", <CnyDetail cost={cn.cost} via={cn.costProvider} compact />]);
  }
  if (cn.reasoningDefault) items.push(["默认思考", reasoningDefaultText(cn.reasoningDefault.value)]);
  return items;
}

// ---------------------------------------------------------------- shared bits

/** Same markup as render.tsx SortableTh, so index.ts sorting picks it up. */
export function SortTh(props: { type?: "text" | "number"; sort?: "ascending" | "descending"; children: unknown }) {
  const type = props.type ?? "text";
  const indicator = (
    <span class="sort-indicator" aria-hidden="true">
      {props.sort === "ascending" ? "↑" : props.sort === "descending" ? "↓" : ""}
    </span>
  );
  return (
    <th class="sortable" data-type={type} scope="col" aria-sort={props.sort}>
      <button type="button" class="sort-button">
        {type === "number" ? indicator : null}
        {props.children}
        {type === "text" ? indicator : null}
      </button>
    </th>
  );
}

/** Provider list order: 国内平台 first, then 海外/国际站, then the rest; by name within each. */
export function cnFirst<T extends [string, { name: string }]>(list: T[]): T[] {
  const rank = (p: unknown) => ({ cn: 0, intl: 1 })[providerExt(p).region ?? ""] ?? 2;
  return [...list].sort(([, a], [, b]) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function allPlans(providers: Record<string, unknown>) {
  const out: Array<{ providerId: string; provider: { name: string }; plan: Plan }> = [];
  for (const [providerId, provider] of Object.entries(providers)) {
    for (const plan of providerExt(provider).plans ?? []) out.push({ providerId, provider: provider as { name: string }, plan });
  }
  return out;
}

// ---------------------------------------------------------------- home stats

/** One-line summary above the home table. */
export function HomeStats(props: {
  providers: Record<string, unknown>;
  models: Array<{ metadata: unknown; providers: Array<ProviderEntryLike & { provider: { name: string } }> }>;
}) {
  const cnProviders = Object.values(props.providers).filter(isCnProvider);
  const cnModels = props.models.filter((m) => m.providers.some((e) => isCnProvider(e.provider))).length;
  let checked = "";
  for (const provider of cnProviders) {
    for (const model of Object.values((provider as { models?: Record<string, unknown> }).models ?? {})) {
      const at = modelExt(model).checked_at;
      if (at && at > checked) checked = at;
    }
  }
  const items: Array<[string, string]> = [
    ["国内平台", String(cnProviders.length)],
    ["国内在售模型", String(cnModels)],
    ["收录模型（全部）", String(props.models.length)],
    ["编程套餐", String(allPlans(props.providers).length)],
    ["数据核对", checked || "-"],
  ];
  return (
    <dl class="cn-stats">
      {items.map(([label, value]) => (
        <div>
          <dt>{label}</dt>
          <dd>{label === "编程套餐" ? <a href="/plans">{value}</a> : value}</dd>
        </div>
      ))}
    </dl>
  );
}
