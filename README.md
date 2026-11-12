# zy-models · 中国版 models.dev

开源的 AI 模型能力库：在 [models.dev](https://github.com/anomalyco/models.dev)（MIT）全量数据之上，补齐**国内平台**的数据——人民币价格（含阶梯、峰谷、原价）、编程/Token 套餐、不传参数时的默认思考档位、中文名、别名和官方来源链接。

- 与 models.dev **完全兼容**：`api.json` / `models.json` / `catalog.json` 的结构不变，只新增可选键，老客户端忽略即可。
- 每天自动合并上游 models.dev，通过校验后以 PR 形式进入本仓库。
- 国内数据只取官方文档、官方价格页、官方 API 返回或官方博客；每个模型都带 `sources` 与 `checked_at`。

## 网站（试用）

**https://zy-models.ziyou979.workers.dev** —— models.dev 同款网页，界面中文为主：模型表多了「人民币价（输入/输出/缓存）」和「默认思考」两列，有中文名时显示中文名；平台页显示中文名、区域和编程套餐（价格、接入地址、包含模型、额度、使用限制）；首页默认勾选「仅国内平台」（可取消，选择会记住）；**[编程套餐对比](https://zy-models.ziyou979.workers.dev/plans)** 页把所有套餐放在一张表里，可按月价排序、按平台筛选。人民币价单元格点击或悬停可看阶梯 / 峰谷 / 优惠明细，手机上同样可用。

站点同样提供 JSON：`/api.json`、`/models.json`、`/catalog.json`（均支持 `?type=`，同 models.dev）和 `/cn.json`（仅国内平台），都带 `Access-Control-Allow-Origin: *`。

> ⚠️ **`*.workers.dev` 在中国大陆可能无法访问**（DNS 污染 / 间歇性阻断）。国内长期使用需要给 Worker 绑定自有域名（Cloudflare → Workers → zy-models → Settings → Domains & Routes → Custom Domain），国内程序取数据仍建议优先用下方的 npmmirror 地址。

部署（不用上游的 SST / PostHog / Lake 上报）：

```bash
(cd packages/web && ./script/build.ts)   # 生成 packages/web/dist（静态页 + 搜索索引 + JSON）
bun x wrangler deploy                    # 读取 wrangler.toml：Worker 名 zy-models，assets = packages/web/dist
```

需要环境变量 `CLOUDFLARE_API_TOKEN`（Workers Scripts 编辑权限）和 `CLOUDFLARE_ACCOUNT_ID`。

## 访问地址

包名：`zy-models`（npm）。文件都是静态 JSON，可直接 `fetch`。

| 用途 | 国内首选（npmmirror） | 海外（jsDelivr） | GitHub raw |
| --- | --- | --- | --- |
| 全量 providers（同 models.dev `/api.json`） | `https://registry.npmmirror.com/zy-models/latest/files/dist/api.json` | `https://cdn.jsdelivr.net/npm/zy-models@latest/dist/api.json` | `https://raw.githubusercontent.com/ziyou979/zy-models/dist/api.json` |
| **仅国内平台**（体积小，约 0.4 MB） | `https://registry.npmmirror.com/zy-models/latest/files/dist/cn.json` | `https://cdn.jsdelivr.net/npm/zy-models@latest/dist/cn.json` | `https://raw.githubusercontent.com/ziyou979/zy-models/dist/cn.json` |
| 模型元数据（同 `/models.json`） | `…/latest/files/dist/models.json` | `…/zy-models@latest/dist/models.json` | `…/dist/models.json` |
| `{ providers, models }`（同 `/catalog.json`） | `…/latest/files/dist/catalog.json` | `…/zy-models@latest/dist/catalog.json` | `…/dist/catalog.json` |
| v2（实验，同 `/experimental/v2.0/api.json`） | `…/latest/files/dist/v2/api.json` | `…/zy-models@latest/dist/v2/api.json` | `…/dist/v2/api.json` |
| 构建信息 | `…/latest/files/dist/meta.json` | `…/zy-models@latest/dist/meta.json` | `…/dist/meta.json` |

说明：

- **国内请优先用 npmmirror**。jsDelivr 在中国大陆访问不稳定（时快时慢、偶发不可用），只建议海外使用；GitHub raw 在国内同样不稳定，适合 CI 或海外服务器。
- npmmirror 在 npm 发布后几分钟内自动同步；`latest` 可换成具体版本号（如 `/zy-models/0.1.0/files/dist/api.json`）以锁定数据。
- GitHub raw 读的是 `dist` 分支，每次 main 有新提交都会由 CI 重新构建（比 npm 发布更新得勤）。
- 也可以 `npm i zy-models` 后 `import api from "zy-models/api.json"`。

## 扩展字段

全部是**可选**键，只在有数据时出现。TOML 里的写法与 JSON 输出同名。

### provider 级

| 键 | 说明 |
| --- | --- |
| `name_zh` | 中文名，如「阿里云百炼」 |
| `region` | `cn`（国内站/大陆端点）或 `intl`；`cn.json` 只收 `region = "cn"` 的平台 |
| `pricing_page` | 官方价格页 |
| `plans[]` | 编程 / Token 套餐：`id`、`name_zh`、`price_cny_month`（数字，或 `{档位: 价格}`）、`price_cny_quarter`、`price_cny_year`、`base_url`、`anthropic_base_url`、`other_base_urls`、`protocol`（`openai-chat` / `openai-responses` / `anthropic` / `gemini` / `native`）、`models`（套餐内的 model id）、`quota_note`（额度原文要点）、`usage_restriction`、`sources` |
| `notes` | 实名、备案、地域限制等官方说明 |

> **套餐不能当普通 API 用。** 所有套餐都带 `usage_restriction`：额度仅限官方支持的编程工具 / Agent 交互使用，禁止自建应用、批量或程序化调用，违规可能被限流或封禁。

### model 级

| 键 | 说明 |
| --- | --- |
| `name_zh` | 官方中文名 |
| `aliases` | 带日期的快照名、旧名等 |
| `cost_cny` | 人民币价格，单位**元 / 百万 tokens**，与 `cost` 同思路：`input`、`output`、`cache_read`、`cache_write`、`cache_write_1h`、`reasoning`；`list_price`（原价，主字段为限时实付价时）、`discount_note`；`tiers[]`（`when` 为官方条件原文，长度分档另有 `context_min` / `context_max`）；`off_peak`（峰谷/闲时说明）；`note` |
| `reasoning_default` | `{ value, source }`：请求**不传任何思考参数**时的默认档位（`on` / `off` / `low` / `high` / `max` / `budget:<n>`…）与官方出处。研究数据优先；没有研究数据时取上游 `capabilities.reasoning.default` |
| `sources` | 官方来源链接 |
| `checked_at` | 核查日期 |
| `notes` | 模型说明（原价、限时活动、限制等原文要点） |

`cost`（美元）仍按 models.dev 语义保留：国内平台的人民币价按导入当日汇率换算（汇率、日期写在文件头注释与 `research/IMPORT_REPORT.md`）。

### 数据口径

- **价格**：`cost` / `cost_cny` 的主字段一律是**标准价（高峰 / 常规时段）**；闲时、夜间、峰谷价在 `cost_cny.tiers` 和 `off_peak` 里。部分调研文件原本把闲时价放在主字段，导入时已统一。很多国内价格是**当前限时实付价**，原价见 `cost_cny.list_price` 或 `notes`。
- **上下文 / 最大输出**：官方文档给出具体数字就**原样使用**，不做 1000 / 1024 换算（例如百川 M 系列官方 `max_tokens` 最大 32000、上下文 32000，库里就是 32,000）。调研文件记录的就是各平台文档原值，导入时新建的 lab 文件和平台模型文件直接写入该值；同一模型在不同平台文档数字不同时，各平台文件各自写自己的数字。唯一的例外是**上游已收录的模型**：若上游数值与调研数值只是同一标称值的两种写法（如 128,000 与 131,072），保留上游数值不改，逐条列在 `research/IMPORT_REPORT.md`「K/M 换算口径差异」。
- **v2-only 模型**：上游标记 `v2_only = true` 的模型（如百炼 `deepseek-v4-pro-0813`、智谱 `glm-5-turbo`）不进 v1 的 `api.json` / `cn.json`，它们的扩展字段只出现在 `dist/v2/api.json`。
- **占位值**：新建 lab 文件时，上游 schema 必填但官方未公开的字段（`release_date`、`open_weights`、未公开的最大输出等）用了占位值，文件头注释写明「占位」，报告里有完整清单。
- **占位 logo**：没有官方 logo 文件的国内平台，用统一风格的圆角方框 + 平台中文名首字（无中文名时用英文首字母）作为占位，不使用从别处下载的商标图；清单见报告「占位 logo」。

## 仓库结构

保留上游目录结构（`models/`、`providers/`、`labs/`、`packages/`），只增加：

```
packages/core/src/cn/ext.ts   扩展 schema、overlay 加载、扩展键输出（上游代码只加了几处钩子）
packages/web/src/cn*.ts(x)    网站的国内扩展界面（人民币价、默认思考、编程套餐页 /plans、仅国内平台筛选、首页统计、移动端适配、中文文案），render.tsx 只加了几处钩子
packages/function/src/zy-worker.ts  Worker 入口（包一层上游 worker.ts：JSON 加 CORS、HTML 标注 UTF-8）；上游的统计上报已删除
wrangler.toml                 用 wrangler 部署到 Cloudflare Workers（替代上游 sst.config.ts）
overlays/                     对上游文件的覆盖：overlays/<与上游相同路径>.toml，加载时深合并
overlays/removed.json         本库移除的上游过时模型（下架 / 改名）
research/                     国内平台调研数据（*.json，格式见 research/FORMAT.md）与导入报告
scripts/import-research.ts    research → TOML 导入脚本（可重复运行）
scripts/build-dist.ts         生成 dist/
docs/upstream-fixes.md        上游过时数据修正清单（方便给 models.dev 提 PR）
README.upstream.md            上游原版 README
```

为了让每日合并上游尽量不冲突，**上游已有的文件一律不改**：国内数据写在 `overlays/` 里（同路径深合并：表合并，数组/标量覆盖）；新平台、新模型直接按上游规则新建文件（托管模型用 `base_model` 指向 `models/<lab>/`）。

## 本地使用

```bash
bun install
bun validate                      # 上游校验 + 扩展字段校验 + overlay 校验
bun run build                     # 生成 dist/
bun scripts/import-research.ts    # 重新导入 research/*.json（可加 --rate 6.685797 --rate-date 2026-11-12 固定汇率）
```

导入规则：已有上游 provider 按 id 合并；数值冲突（上下文、输出上限、价格）以研究数据为准，写进 overlay 并列入 `research/IMPORT_REPORT.md`；非数值差异只报告不覆盖；套餐优先挂到上游已有的套餐型 provider（如 `alibaba-token-plan-cn`、`kimi-code-plan-cn`、`zhipuai-coding-plan`）；`null` 字段不写。

## 自动化

| 工作流 | 触发 | 作用 |
| --- | --- | --- |
| `zy-build.yml` | push / PR 到 main | `bun validate` + `bun run build`，并把 `dist/` 强推到 `dist` 分支 |
| `zy-sync-upstream.yml` | 每天 09:30（北京时间） | 合并 `anomalyco/models.dev@dev`，校验构建通过后开 / 更新 PR；有冲突时开 issue |
| `zy-publish.yml` | 推送 `v*` tag | 构建并以 tag 版本号发布 npm（需要仓库 secret `NPM_TOKEN`），然后请求 npmmirror 立即同步 |

上游自带的工作流都限定 `github.repository == 'anomalyco/models.dev'`，在本仓库会自动跳过。

## 许可

MIT。上游 models.dev 的版权声明完整保留，见 [LICENSE](LICENSE)。
