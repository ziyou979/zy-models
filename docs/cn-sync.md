# 国内平台官方数据同步（cn-sync）

每天从国内平台**无需 API key** 的官方公开数据（公开 JSON 接口、官方价格页/模型广场内嵌数据、官方文档 markdown）同步模型列表、规格与人民币价格。命令 `bun cn:sync`，工作流 `.github/workflows/zy-sync-cn.yml`。

## 和上游 `bun models:sync` 的关系

复用上游的框架形状：

| 上游 models.dev | 本仓库 cn-sync |
| --- | --- |
| `packages/core/src/sync/providers/*.ts`，`SyncProvider`：`fetchModels` / `parseModels` / `translateModel` | `packages/core/src/cn/sync/providers/*.ts`，`CnSyncProvider`：同名三个方法，另加 `researchFile`、`createNew`、`minModels`、`resolveLocalID` |
| `bun models:sync --list-providers` 输出 `{include:[{provider,name}]}` | `bun cn:sync --list-providers` 同格式 |
| `--dry-run`、`.sync/model-sync-report.md` | `--dry-run`、`.sync/cn-<p>-report.md`（PR 描述）、`.sync/cn-<p>-issue.md`（issue 正文） |
| 工作流逐个 provider 从干净的 dev 开始，各出一个 patch、各开一个 PR，失败的不影响其他 | `scripts/cn-sync-publish.sh` 同样逐个平台从干净的 main 开始，分支 `cn-sync/<p>`，各开/更新一个 draft PR |
| `skipCreates` 的新模型开 `[missing-model]` issue | 无法自动创建的新模型、与官方来源冲突的字段，每个平台汇总到一个 `[cn-sync]` issue，每次运行刷新，清空后自动关闭 |

不同点：上游 runner 直接写 provider TOML；我们的中文数据唯一来源是 `research/<平台>.json`，overlays/ 和新 provider 模型文件都由 `scripts/import-research.ts` 生成。所以 cn-sync 写的是 research JSON（保留原有缩进和 `2.0` 这类数字写法，只增不改），之后用上一次导入的汇率重跑导入器。这样既不改上游文件（不影响每日上游合并），也不会与导入器打架。上游 runner 也无法读取带扩展字段（`cost_cny` 等）的模型文件。

## 合并规则

1. **research 里已有的模型**：官方源给出、而本地为 null/缺失的字段才补上（补的同时追加 `sources`、更新 `checked_at`）。本地已有值且不同 → 视为与已有官方来源冲突，**不覆盖**，写进 PR 描述和 issue。分档价格（分时段、按输入长度）只要一方的某一档与另一方的主价格相同就不算冲突；K/M 两种进制的同一标称值（1M = 1,000,000 = 1,048,576）不算冲突。
2. **只有上游 catalog 有、research 没有的模型**：上游数值没有官方来源，新增一条 research 记录（官方数据 + `sources`），导入器把它写成 overlay；与上游不同的数值按导入器既有规则以官方数据为准，列在 `research/IMPORT_REPORT.md`。
3. **本地完全没有的模型**：仅当数据源给的是真实 API 模型 ID，且 `models/<lab>/` 下有同 ID 的 lab 模型、导入器也会解析到同一个 lab 文件时，才新增（导入器写 `providers/<p>/models/<id>.toml`，`base_model` 指向 lab）。否则进 issue，不生成占位 lab 文件，也不按"第一方别名"猜（例如七牛的 `deepseek/deepseek-v4-flash` 不会被自动映射到 DeepSeek 当前别名指向的 V4.1）。
4. **从不删除**。本地有、官方源没列出的模型只在报告里列出。
5. 自相矛盾的官方数据（如最大输出 > 上下文）不同步该字段并在报告中提示；能力类布尔值只取"支持"（七牛、硅基流动的部分 `false` 不可靠）。

## 已实现的平台（5 个，均无需 key）

| 平台 | 数据源 | 同步字段 | 新模型 | 稳定性 |
| --- | --- | --- | --- | --- |
| PPIO 派欧云 `ppio` | `GET https://api.ppio.com/openai/v1/models`（公开 JSON） | 模型列表、context、max output、输入/输出模态、工具调用、结构化输出、是否推理、人民币价格（输入/输出/缓存读写）、原价、按长度分档 | 自动创建（有 lab 模型时） | 高：正式 API，字段稳定 |
| 七牛云 `qiniu` | `https://www.qiniu.com/ai/models` 页内 `__NEXT_DATA__` | 模型列表与别名、context、max output、模态、工具/结构化输出/推理、人民币价格（高峰/空闲、按长度分档）、发布日期、下线标记 | 自动创建 | 中高：Next.js pages 数据，结构多年未变；与公开 `GET https://api.qnaigc.com/v1/models` 一致 |
| 硅基流动 `siliconflow` | `https://www.siliconflow.cn/pricing`（`pricingApiItems`）+ `https://www.siliconflow.cn/models`（`data`），均为 RSC 内嵌数据 | 对话模型列表、context、工具调用、视觉输入、人民币价格（北京时间分时计价） | 自动创建 | 中：RSC 载荷随前端发版可能变化，解析不到会整平台失败而不是写错 |
| 智谱 BigModel `zhipu` | `https://docs.bigmodel.cn/cn/guide/start/pricing.md`（官方价格页的 markdown） | 按 token 计费的 GLM 模型列表、人民币价格（输入/输出/缓存命中）、按输入/输出长度分档 | 自动创建（多数旧模型缺 lab 文件，进 issue） | 高：Mintlify 官方 .md |
| 火山方舟 `volcengine` | `https://docs.volcengine.com/docs/zh/ark/model-pricing.md`（官方「模型价格」文档 markdown，即 https://www.volcengine.com/docs/82379/1544106） | 「在线推理（常规）」人民币价格（输入/输出/缓存命中，分档/高峰空闲） | 不创建：价格表只有短名，按名称对应已有的带日期 Model ID，对不上的进 issue | 高：官方文档接口 |

每个平台都设了最少模型数（`minModels`），页面结构变化导致解析数量骤减时整平台失败，不会把错误数据写进去。

## 已调研、本次未实现

| 平台 | 无 key 能拿到什么 | 未实现原因 |
| --- | --- | --- |
| DeepSeek | 官方价格页 https://api-docs.deepseek.com/zh-cn/quick_start/pricing 的 HTML 表格（2 个模型：上下文、输出、能力、高峰/空闲价） | 可做，模型只有 2 个、research 已手工维护，优先级低；`/models` 需 key |
| MiniMax | https://platform.minimaxi.com/docs/guides/pricing.md （Mintlify markdown，语言模型价格表，含原价/折扣与 >512k 分档） | 可做，表格是 tab+折扣删除线混排，语言模型只有 2 个；`/v1/models` 需 key |
| Moonshot/Kimi | https://platform.kimi.com/docs/pricing/chat 的 HTML 内编译后的 MDX（`rows:[[…]]`） | .md 版表格是空的（前端渲染），只能解析编译后的 JS，脆弱；`/v1/models` 需 key |
| 阿里云百炼 | https://help.aliyun.com/zh/model-studio/model-pricing.md （约 700KB，markdown 里嵌 HTML 表格，含 API 模型名） | 可做但表格结构复杂（多级合并单元格、地域/阶梯混排），需单独开发；模型列表接口需 key |
| 百度千帆 | https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya 等 HTML 文档表格 | 只有显示名（如 ERNIE-5.5-Flash），没有 API 模型 ID，价格是「活动价/原价」文本，按千 token 计；对应关系不可靠 |
| 腾讯混元 / TokenHub | 文档页（cloud.tencent.com/document/product/1729、/1823） | 文档站返回 EdgeOne 反爬 JS 挑战，curl 拿不到正文，需要真浏览器 |
| ModelScope 魔搭 | `GET https://api-inference.modelscope.cn/v1/models`（公开） | 只有模型 ID，没有上下文/价格（API-Inference 为免费额度制），只能做"新模型提醒"，暂未接入 |

这些平台的模型列表/调用接口都需要 API key。注册门槛（官方文档）：

| 平台 | 注册门槛 |
| --- | --- |
| 火山方舟 | 火山引擎账号 + 个人或企业实名认证（https://docs.volcengine.com/docs/ark/platform-capabilities-overview）；新用户有 50 万 token 免费额度（https://www.volcengine.com/docs/ark/activation-management） |
| 阿里云百炼 | 阿里云主账号，开通百炼需实名认证；北京地域新人免费额度 90 天（https://help.aliyun.com/zh/model-studio/new-free-quota） |
| DeepSeek | 手机号/微信注册；API 先充值后使用，在线充值需实名认证（https://api-docs.deepseek.com/zh-cn/faq） |
| 百度千帆 | 百度智能云账号 + 实名认证，实名后送 20 元代金券（https://cloud.baidu.com/doc/qianfan/s/1mh4su5jg） |
| 智谱 BigModel | 手机号注册（支持海外手机号）；调用 API 不强制实名（https://docs.bigmodel.cn/cn/faq/authentication-issues） |
| MiniMax | 注册后在「接口密钥」创建 Key，按量付费需在「余额」充值（https://platform.minimaxi.com/docs/guides/quickstart-preparation）；实名仅声音复刻等能力强制 |
| Moonshot/Kimi | 新用户认证赠 15 元代金券，最低充值 10 元（见 research/moonshot.json 的来源） |
| 腾讯 TokenHub | 开通需腾讯云实名认证（见 research/tencent-tokenhub.json 的来源） |
| ModelScope | 魔搭账号需绑定已实名的阿里云账号才能用 API-Inference（见 research/modelscope.json 的来源） |

## 本地使用

```bash
bun cn:sync --list-providers
bun cn:sync ppio --dry-run          # 只看报告，不写文件
bun cn:sync all                     # 写 research/*.json
bun scripts/import-research.ts --rate 6.685797 --rate-date 2026-11-12   # 用 research/IMPORT_REPORT.md 里的上次汇率
bun validate && bun run build
CN_SYNC_DRY=1 bash scripts/cn-sync-publish.sh ppio   # 走一遍工作流，不推送、不开 PR/issue（会 reset 工作区，先提交改动）
```

## 加一个平台

1. 写 `packages/core/src/cn/sync/providers/<p>.ts`，导出 `CnSyncProvider`（zod 校验来源数据；价格换算成元/百万 tokens；只输出来源明确给出的字段）。
2. 加进 `packages/core/src/cn/sync/index.ts` 的 `cnProviders`，工作流会自动带上（与上游 matrix 机制一样）。
3. 在 `packages/core/test/cn-sync.test.ts` 加解析用例，`bun cn:sync <p> --dry-run` 看第一份报告。
