# 上游（models.dev）过时数据修正

本仓库在不改动上游文件的前提下修正了以下上游数据（provider 字段用 `overlays/` 覆盖，下架模型列在 `overlays/removed.json`，由加载器跳过）。
这些条目可以整理后作为 PR 提交给 https://github.com/anomalyco/models.dev 。本文件由 `bun scripts/import-research.ts` 生成。

## provider 字段

- `providers/bailing/provider.toml`：`api = "https://api.ant-ling.com/v1"`，`doc = "https://developer.ant-ling.com/zh-CN/docs/models/ling/"`。百灵（蚂蚁 Ling）平台已迁移：旧地址 https://api.tbox.cn/api/llm/v1 → OpenAI 兼容 https://api.ant-ling.com/v1，Anthropic 兼容 https://api.ant-ling.com/anthropic。 来源：https://developer.ant-ling.com/zh-CN/docs/models/ling/、https://developer.ant-ling.com/zh-CN/docs/models/price/

## 已下架 / ID 变更的模型（本仓库已移除）

- `providers/bailing/models/Ling-1T.toml`：Ling-1T 已于 2026-06-15 下架（research/ant-ling.json notes）。来源：https://developer.ant-ling.com/zh-CN/docs/models/ling/
- `providers/bailing/models/Ring-1T.toml`：Ring-1T 已于 2026-06-15 下架；Ring 系列并入 Ling 混合推理（research/ant-ling.json notes）。来源：https://developer.ant-ling.com/zh-CN/docs/models/ling/
- `providers/longcat/models/LongCat-2.0.toml`：LongCat 按量价目表已不再列出 LongCat-2.0，按量仅支持 LongCat-2.5（research/longcat.json notes）。来源：https://longcat.chat/platform/docs/zh/pricing/longcat-2.5
- `providers/longcat/models/LongCat-2.5-Preview.toml`：LongCat-2.5-Preview 不在官方按量价目表（仅 LongCat-2.5）。来源：https://longcat.chat/platform/docs/zh/pricing/longcat-2.5
- `providers/sensenova/models/deepseek-v4.1-flash.toml`：商汤平台该模型的官方 ID 现为 deepseek-flash；替代：providers/sensenova/models/deepseek-flash.toml（研究导入新建）。来源：https://platform.sensenova.cn/docs

## 数值修正候选（研究数据与上游冲突，已在本仓库按研究数据覆盖）

完整列表与换算说明见 `research/IMPORT_REPORT.md` 的「数值冲突」一节（23 项）。提交上游前请逐项复核来源（每个模型 overlay 的 `sources`）。
