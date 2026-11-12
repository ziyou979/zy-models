/** @jsx jsx */
/** @jsxImportSource hono/jsx */

// zy-models: /plans — every 编程套餐 / Token Plan in one comparison table.
// Rows carry data-provider (platform filter, cn-client.ts) and data-cn (仅国内平台).

import { Fragment } from "hono/jsx";
import { CnFilter, SortTh, allPlans, isCnProvider, providerDisplayName, type Plan } from "./cn.js";

export const PLANS_METADATA = {
  title: "编程套餐对比 · zy-models",
  description: "国内外 AI 编程套餐 / Token Plan 一表对比：月价（人民币）、包含模型、额度、接入地址、协议与使用限制，附官方来源。",
};

const cny = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2, useGrouping: false });

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

function entries(value?: number | Record<string, number>): Array<[string | undefined, number]> {
  if (value === undefined) return [];
  if (typeof value === "number") return [[undefined, value]];
  return Object.entries(value);
}

/** Lowest per-month price (quarter / year prices divided down) — the sort key. */
function monthlyKey(plan: Plan) {
  const candidates = [
    ...entries(plan.price_cny_month).map(([, v]) => v),
    ...entries(plan.price_cny_quarter).map(([, v]) => v / 3),
    ...entries(plan.price_cny_year).map(([, v]) => v / 12),
  ];
  return candidates.length ? Math.min(...candidates) : undefined;
}

function PriceLines(props: { plan: Plan }) {
  const lines: Array<[string | undefined, string]> = [];
  for (const [tier, v] of entries(props.plan.price_cny_month)) lines.push([tier, `¥${cny.format(v)}/月`]);
  if (lines.length === 0) {
    for (const [tier, v] of entries(props.plan.price_cny_quarter)) lines.push([tier, `¥${cny.format(v)}/季`]);
    for (const [tier, v] of entries(props.plan.price_cny_year)) lines.push([tier, `¥${cny.format(v)}/年`]);
  }
  if (lines.length === 0) return <span class="subtle-inline">见官网</span>;
  return (
    <span class="plan-prices">
      {lines.map(([tier, text]) => (
        <span class="plan-price-line">
          {tier && <span class="plan-tier">{tier}</span>}
          <span class="plan-price">{text}</span>
        </span>
      ))}
    </span>
  );
}

const MODELS_SHOWN = 6;
const CLAMP_CHARS = 90;

/** Long text clamped to a few lines; click / tap expands it (cn-client.ts). */
function Clamp(props: { text: string }) {
  if (props.text.length <= CLAMP_CHARS) return <span>{props.text}</span>;
  return (
    <button type="button" class="plan-clamp" aria-expanded="false" title="点击展开 / 收起">
      <span class="plan-clamp-text">{props.text}</span>
      <span class="plan-clamp-more">展开</span>
    </button>
  );
}

export function PlansPage(props: {
  providers: Record<string, unknown>;
  modelName: (providerId: string, modelId: string) => string;
  providerLink: (providerId: string) => unknown;
  copy: (value: string) => unknown;
}) {
  const rows = allPlans(props.providers).sort(
    (a, b) =>
      Number(isCnProvider(b.provider)) - Number(isCnProvider(a.provider)) ||
      (monthlyKey(a.plan) ?? Infinity) - (monthlyKey(b.plan) ?? Infinity),
  );
  const platforms = [...new Map(rows.map((r) => [r.providerId, providerDisplayName(r.provider)])).entries()].sort(
    ([, a], [, b]) => a.localeCompare(b, "zh-CN"),
  );
  const columns = 9;

  return (
    <Fragment>
      <section class="cn-page-intro">
        <h2>编程套餐对比</h2>
        <p>
          各平台面向编程工具（Claude Code、Cline、Cursor 等）的包月套餐与 Token Plan。月价为人民币；季付/年付套餐按月折算排序。
          额度与限制摘自官方文档，以官网为准。
        </p>
      </section>
      <CnFilter label="仅国内平台">
        <label class="plan-filter">
          <span>平台</span>
          <select data-plan-provider aria-label="按平台筛选">
            <option value="">全部平台（{platforms.length}）</option>
            {platforms.map(([id, name]) => (
              <option value={id}>{name}</option>
            ))}
          </select>
        </label>
      </CnFilter>
      <section class="table-section cn-plans-table" id="plans">
        <div class="table-wrap">
          <table data-enhanced-table class="plans-table">
            <caption class="sr-only">编程套餐</caption>
            <thead>
              <tr>
                <SortTh>平台</SortTh>
                <SortTh>套餐</SortTh>
                <SortTh type="number" sort="ascending">月价（元）</SortTh>
                <SortTh>包含模型</SortTh>
                <SortTh>额度要点</SortTh>
                <SortTh>接入地址</SortTh>
                <SortTh>协议</SortTh>
                <SortTh>使用限制</SortTh>
                <SortTh>来源</SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ providerId, provider, plan }) => {
                const key = monthlyKey(plan);
                const urls: Array<[string, string]> = [];
                if (plan.base_url) urls.push([plan.protocol ? PROTOCOL_ZH[plan.protocol] ?? plan.protocol : "Base URL", plan.base_url]);
                if (plan.anthropic_base_url) urls.push(["Anthropic", plan.anthropic_base_url]);
                for (const other of plan.other_base_urls ?? []) urls.push(["其他", other]);
                const protocols = [...new Set(urls.map(([label]) => label).filter((l) => l !== "其他" && l !== "Base URL"))];
                const models = plan.models ?? [];
                const names = models.map((id) => props.modelName(providerId, id));
                const chip = (id: string, i: number) => {
                  const name = names[i]!;
                  const clash = names.some((other, j) => j !== i && other === name);
                  return (
                    <span class="cn-chip" title={id}>
                      {clash ? id : name}
                    </span>
                  );
                };
                return (
                  <tr
                    data-cn={isCnProvider(provider) ? "1" : "0"}
                    data-provider={providerId}
                    data-search={`${providerDisplayName(provider)} ${provider.name} ${plan.name_zh} ${plan.name ?? ""} ${models.join(" ")}`}
                  >
                    <th scope="row" data-sort={providerDisplayName(provider)}>
                      {props.providerLink(providerId)}
                    </th>
                    <td data-sort={plan.name_zh} class="plan-name">
                      <a href={`/providers/${providerId}#plan-${plan.id}`}>{plan.name_zh}</a>
                      {plan.name && plan.name !== plan.name_zh && <span class="subtle">{plan.name}</span>}
                    </td>
                    <td class="numeric" data-sort={key === undefined ? "" : String(key)}>
                      <PriceLines plan={plan} />
                    </td>
                    <td class="plan-models" data-sort={String(models.length).padStart(4, "0")}>
                      {models.length === 0 ? (
                        "-"
                      ) : models.length <= MODELS_SHOWN + 1 ? (
                        <span class="cn-chips">{models.map(chip)}</span>
                      ) : (
                        <details class="plan-more">
                          <summary>
                            <span class="cn-chips">
                              {models.slice(0, MODELS_SHOWN).map(chip)}
                              <span class="cn-chip cn-chip-more">+{models.length - MODELS_SHOWN}</span>
                            </span>
                          </summary>
                          <span class="cn-chips">{models.slice(MODELS_SHOWN).map((id, i) => chip(id, i + MODELS_SHOWN))}</span>
                        </details>
                      )}
                    </td>
                    <td class="plan-text">{plan.quota_note ? <Clamp text={plan.quota_note} /> : "-"}</td>
                    <td class="plan-urls" data-sort={plan.base_url ?? plan.anthropic_base_url ?? ""}>
                      {urls.length === 0
                        ? "-"
                        : urls.map(([label, url]) => (
                            <span class="cn-plan-url">
                              <span class="cn-plan-proto">{label}</span>
                              <code class="copy-source">{url}</code>
                              {props.copy(url)}
                            </span>
                          ))}
                    </td>
                    <td data-sort={protocols.join(" ")}>{protocols.length ? protocols.join(" / ") : "-"}</td>
                    <td class="plan-text plan-restriction">
                      {plan.usage_restriction ? <Clamp text={plan.usage_restriction} /> : "-"}
                    </td>
                    <td class="plan-sources">
                      {plan.sources?.length
                        ? plan.sources.map((url) => (
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              {hostOf(url)}
                            </a>
                          ))
                        : "-"}
                    </td>
                  </tr>
                );
              })}
              <tr class="empty-row">
                <td colspan={columns}>没有符合条件的套餐。</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="empty-message">没有符合条件的套餐。</p>
      </section>
    </Fragment>
  );
}
