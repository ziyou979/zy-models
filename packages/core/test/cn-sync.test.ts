// zy-models CN sync: parser and matching rules (offline, fixed fixtures).
import { expect, test } from "bun:test";

import { sameLabel } from "../src/cn/sync/index.js";
import { markdownTables, priceCell } from "../src/cn/sync/parse.js";
import { qiniuPrice } from "../src/cn/sync/providers/qiniu.js";
import { sfPrice } from "../src/cn/sync/providers/siliconflow.js";
import { volcengine, volcKey, volcRows } from "../src/cn/sync/providers/volcengine.js";
import { zhipu, zhipuRows } from "../src/cn/sync/providers/zhipu.js";
import { ppio } from "../src/cn/sync/providers/ppio.js";
import { deepseek, deepseekSize, OFF_PEAK_WHEN } from "../src/cn/sync/providers/deepseek.js";

test("K/M labels compare in either convention", () => {
  expect(sameLabel(1_000_000, 1_048_576)).toBe(true);
  expect(sameLabel(128_000, 131_072)).toBe(true);
  expect(sameLabel(163_840, 164_000)).toBe(false);
  expect(sameLabel(256_000, 320_000)).toBe(false);
});

test("price cells", () => {
  expect(priceCell("8")).toBe(8);
  expect(priceCell("¥13.00 / MTok")).toBe(13);
  expect(priceCell("免费")).toBe(0);
  expect(priceCell("限时免费")).toBeUndefined();
  expect(priceCell("不支持")).toBeUndefined();
  expect(priceCell("-")).toBeUndefined();
});

const VOLC = `# 大语言模型

## 在线推理（常规）

|模型名称 |条件<br><br>输入长度：K token |输入(非音频)<br><br>元/M token |输入(音频)<br><br>元/M token |缓存存储<br><br>元/M token/小时 |缓存命中(非音频)<br><br>元/M token |缓存命中(音频)<br><br>元/M token |输出<br><br>元/M token |
|---|---|---|---|---|---|---|---|
|doubao\\-seed\\-2.0\\-pro |输入长度 [0, 32] |3.2 |\\- |0.017 |0.64 |\\- |16.0 |
||输入长度 (32, 128] |4.8 |\\- |0.017 |0.96 |\\- |24.0 |
|deepseek\\-v4\\-1\\-flash |空闲时段 |1.00 |\\- |0.017 |0.02 |\\- |4.00 |
||高峰时段 |2.00 |\\- |0.017 |0.04 |\\- |8.00 |
|deepseek\\-v4\\-pro 正式版 |\\- |9.00 |\\- |0.017 |0.30 |\\- |27.00 |

## 在线推理（低优）

|模型名称 |条件 |输入（非音频）<br><br>元/M token |输出<br><br>元/M token |
|---|---|---|---|
|doubao\\-seed\\-2.0\\-pro |输入长度 [0, 32] |1.6 |8.0 |
`;

test("volcengine: only the 在线推理（常规） table, continuation rows, peak as main price", () => {
  const groups = volcengine.parseModels(VOLC);
  expect(groups.length).toBe(3);
  const models = groups.map((g) => volcengine.translateModel(g)!);
  expect(models[0]!.id).toBe("doubao-seed-2-0-pro");
  expect(models[0]!.price_cny).toMatchObject({ input: 3.2, output: 16, cache_read: 0.64 });
  expect(models[0]!.price_cny!.tiers!.map((t) => t.when)).toEqual(["input<=32k", "32k<input<=128k"]);
  expect(models[1]!.price_cny).toMatchObject({ input: 2, output: 8, cache_read: 0.04 });
  expect(volcRows(VOLC).length).toBe(5);
  expect(volcKey("deepseek-v4-pro 正式版")).toBe("deepseek-v4-pro-ga");
  const ids = ["deepseek-v4-pro-ga-260813", "deepseek-v4-1-flash-261017", "deepseek-v4-1-flash-economy-261017", "doubao-seed-2-0-code-preview-260215"];
  expect(volcengine.resolveLocalID!(models[2]!, ids)).toBe("deepseek-v4-pro-ga-260813");
  expect(volcengine.resolveLocalID!({ id: "deepseek-v4-1-flash" }, ids)).toBe("deepseek-v4-1-flash-261017");
  expect(volcengine.resolveLocalID!({ id: "doubao-seed-2-0-code" }, ids)).toBe("doubao-seed-2-0-code-preview-260215");
  expect(volcengine.resolveLocalID!({ id: "deepseek-v4-pro-preview" }, ids)).toBeUndefined();
});

const ZHIPU = `## 语言模型

| 模型名称 | 上下文 | 输入单价（元/百万 Tokens） | 输出单价（元/百万 Tokens） | 缓存存储（元/百万 Tokens/小时） | 缓存命中（元/百万 Tokens） |
| - | - | - | - | - | - |
| GLM-5.2 | 1M | 8 | 28 | 限时免费 | 2 |
| GLM-5.1 | 输入长度 \\[0, 32K) | 6 | 24 | 限时免费 | 1.3 |
| GLM-5.1 | 输入长度 ≥32K | 8 | 28 | 限时免费 | 2 |

> | 模型名称 | 上下文 | 输入单价（元/百万 Tokens） | 输出单价（元/百万 Tokens） | 缓存存储（元/百万 Tokens/小时） | 缓存命中（元/百万 Tokens） |
> | - | - | - | - | - | - |
> | GLM-4.7-Flash | 200K | 免费 | 免费 | 限时免费 | 免费 |
`;

test("zhipu: tables inside blockquotes, length tiers", () => {
  expect(zhipuRows(ZHIPU).length).toBe(4);
  const models = zhipu.parseModels(ZHIPU).map((g) => zhipu.translateModel(g)!);
  expect(models.map((m) => m.id)).toEqual(["glm-5.2", "glm-5.1", "glm-4.7-flash"]);
  expect(models[1]!.price_cny!.tiers!.map((t) => t.when)).toEqual(["input<32k", "input>=32k"]);
  expect(models[2]!.price_cny).toMatchObject({ input: 0, output: 0, cache_read: 0 });
});

test("markdown tables keep their headings", () => {
  const tables = markdownTables(VOLC);
  expect(tables[0]!.headings).toEqual(["大语言模型", "在线推理（常规）"]);
  expect(tables[1]!.headings).toEqual(["大语言模型", "在线推理（低优）"]);
});

test("qiniu: peak/off-peak and input-length rules", () => {
  const item = (price: number) => ({ unit_name: "token", unit_size: 1000, unit_price: price });
  expect(
    qiniuPrice([{ input_range: [0, 99_999_999], details_v2: { ncache_peak: item(0.009), output_peak: item(0.027), cache_peak: item(0.0003), ncache_offpeak: item(0.0045), output_offpeak: item(0.0135), cache_offpeak: item(0.00015) } }]),
  ).toMatchObject({ input: 9, output: 27, cache_read: 0.3, tiers: [{ when: "高峰", input: 9 }, { when: "空闲", input: 4.5 }] });
  const banded = qiniuPrice([
    { input_range: [0, 32000], details_v2: { ncache: item(0.0002), output: item(0.0008) } },
    { input_range: [32000, 99_999_999], details_v2: { ncache: item(0.0006), output: item(0.0024) } },
  ])!;
  expect(banded).toMatchObject({ input: 0.2, output: 0.8 });
  expect(banded.tiers!.map((t) => t.when)).toEqual(["0k<input<=32k", "32k<input<=∞"]);
});

test("siliconflow: K-token prices, time-of-day peak as main", () => {
  const row = (componentCode: string, coordinateDesc: string, price: string) => ({ playgroundName: "x", componentCode, coordinateDesc, realTimePriceCnyUnit: price, unitZhCnName: "K tokens" });
  const price = sfPrice([
    row("input-tokens", "费用发生时段: 2点～8点", "0.001000"),
    row("input-tokens", "费用发生时段: 0点～2点/8点～24点", "0.002000"),
    row("output-tokens", "费用发生时段: 2点～8点", "0.004000"),
    row("output-tokens", "费用发生时段: 0点～2点/8点～24点", "0.008000"),
  ])!;
  expect(price).toMatchObject({ input: 2, output: 8 });
  expect(price.tiers!.length).toBe(2);
});

test("ppio: skips routers, test deployments and lane variants; list price only when discounted", () => {
  const base = { model_type: "chat", status: 1, output_modalities: ["text"], features: ["function-calling", "reasoning"] };
  const price = (p: string, o = p) => ({ price_per_m_decimal: p, origin_price_per_m_decimal: o });
  expect(ppio.translateModel({ ...base, id: "pprouter/auto" })).toBeUndefined();
  expect(ppio.translateModel({ ...base, id: "deepseek/deepseek-v4-flash-0731-p" })).toBeUndefined();
  expect(ppio.translateModel({ ...base, id: "ai_infer_test_2" })).toBeUndefined();
  const same = ppio.translateModel({ ...base, id: "qwen/qwen4-max", pricing: { prompt: price("10"), completion: price("30") } })!;
  expect(same.price_cny).toMatchObject({ input: 10, output: 30 });
  expect(same.price_cny!.list_price).toBeUndefined();
  expect(same.tools).toBe(true);
  const discounted = ppio.translateModel({ ...base, id: "tencent/hy4", pricing: { prompt: price("3", "6"), completion: price("9", "18") } })!;
  expect(discounted.price_cny!.list_price).toEqual({ input: 6, output: 18 });
});

const DEEPSEEK = `# 模型 & 价格

## 模型细节

| 模型 | 模型 | 模型 | deepseek-flash(1) | deepseek-v4-pro |
| --- | --- | --- | --- | --- |
| 模型版本 | 模型版本 | 模型版本 | DeepSeek-V4.1-Flash-1017 | DeepSeek-V4-Pro-0813 |
| 思考模式 | 思考模式 | 思考模式 | 支持非思考与思考模式（默认） / 切换方式详见[思考模式](https://x/thinking_mode.md) | 支持非思考与思考模式（默认） |
| 上下文长度 | 上下文长度 | 上下文长度 | 1M | 1M |
| 输出长度 | 输出长度 | 输出长度 | 最大 384K | 最大 384K |
| 功能 | [Json Output](https://x/json_mode.md) | [Json Output](https://x/json_mode.md) | 支持 | 支持 |
| 功能 | [Tool Calls](https://x/tool_calls.md) | [Tool Calls](https://x/tool_calls.md) | 支持 | 支持 |
| 功能 | [FIM 补全（Beta）](https://x/fim.md) | [FIM 补全（Beta）](https://x/fim.md) | 仅非思考模式支持 | 仅非思考模式支持 |
| 功能 | [图像理解](https://x/vision.md) | [图像理解](https://x/vision.md) | 支持 | 不支持 |
| 价格(2) | 百万tokens输入 / （缓存命中） | 空闲时段 | 0.02元 | 0.15元 |
| 价格(2) | 百万tokens输入 / （缓存命中） | 高峰时段 | 0.04元 | 0.30元 |
| 价格(2) | 百万tokens输入 / （缓存未命中） | 空闲时段 | 1元 | 4.5元 |
| 价格(2) | 百万tokens输入 / （缓存未命中） | 高峰时段 | 2元 | 9.0元 |
| 价格(2) | 百万tokens输出 | 空闲时段 | 4元 | 13.5元 |
| 价格(2) | 百万tokens输出 | 高峰时段 | 8元 | 27.0元 |
| 并发限制(3) | 并发限制(3) | 并发限制(3) | 2500 | 500 |

(1) 模型名请使用 \`deepseek-flash\`。旧模型名 \`deepseek-v4-flash\`、\`deepseek-v4-flash-vision-exp\` 仍可调用，但对应模型已下线。

(2) 空闲时段价格为高峰时段价格的一半。北京时间周一至周五 9:00 - 12:00、14:00 - 18:00 为高峰时段。

## Search 与 Fetch API 价格

| 项目 | 计费单位 | 价格 |
| --- | --- | --- |
| Search API（文字） | 每 1,000 次成功请求 | 5元 |
`;

test("deepseek: transposed 模型细节 table, peak price main, off-peak tier, footnote aliases", () => {
  expect(deepseekSize("1M")).toBe(1_048_576);
  expect(deepseekSize("最大 384K")).toBe(393_216);
  const models = deepseek.parseModels(DEEPSEEK).map((c) => deepseek.translateModel(c)!);
  expect(models.map((m) => m.id)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  const [flash, pro] = models;
  expect(flash!.name).toBe("DeepSeek-V4.1-Flash-1017");
  expect(flash!.aliases).toEqual(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]);
  expect(pro!.aliases).toBeUndefined();
  expect(flash!.limit).toEqual({ context: 1_048_576, output: 393_216 });
  expect(flash!.modalities?.input).toEqual(["text", "image"]);
  expect(pro!.modalities?.input).toEqual(["text"]);
  expect(pro!.tools).toBe(true);
  expect(pro!.structured_output).toBe(true);
  expect(pro!.reasoning?.supported).toBe(true);
  expect(pro!.price_cny).toMatchObject({ input: 9, output: 27, cache_read: 0.3 });
  expect(pro!.price_cny!.tiers).toEqual([{ when: OFF_PEAK_WHEN, input: 4.5, output: 13.5, cache_read: 0.15 }]);
  expect(pro!.price_cny!.off_peak).toMatch(/^空闲时段价格为高峰时段价格的一半/);
});
