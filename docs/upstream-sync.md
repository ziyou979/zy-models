# 上游同步（anomalyco/models.dev）

每天 `zy-sync-upstream.yml` 把上游 `dev` 合并到 `sync/upstream` 并开 PR。为了让这一步基本不冲突，仓库按“文件归属”来划分：

## 规则：上游文件一字不改

`git diff upstream/dev -- <上游已有的文件>` 应该只剩上游自己的新改动。唯一例外是 `LICENSE`（在上游声明之后追加了本库的版权段落，上游声明完整保留）。

| 我们要改的东西 | 放在哪里 | 怎么生效 |
| --- | --- | --- |
| 上游 provider / 模型的数据（人民币价、套餐、默认思考、修正值…） | `overlays/<与上游相同路径>.toml` | 加载时深合并（`packages/core/src/cn/register.ts` 的 Bun loader 插件） |
| 下架的上游模型 | `overlays/removed.json` | 生成后从输出里去掉（`packages/core/src/cn/catalog.ts`） |
| 新平台、新模型 | 新文件（`providers/<新>/…`、`models/<lab>/<新>.toml`），由 `scripts/import-research.ts` 生成并记在 `scripts/import-manifest.json` | 上游以后在同一路径加了文件 → add/add 冲突自动取上游文件，再重新导入，我们的值转进 overlays/ |
| 扩展字段（`name_zh`、`cost_cny`、`plans`…） | 写在 overlay 或我们自己的文件里 | loader 插件在上游 schema 校验前剥离并校验，`catalog.ts` 再挂回输出 |
| 生成器 / 校验 | `packages/core/src/cn/*`、`scripts/zy-validate.ts`、`scripts/build-dist.ts` | 根目录 `bunfig.toml` 预加载 loader 插件，上游 `generate.ts` / `validate.ts` 原样运行 |
| 网站 | `packages/web/src/cn*.ts(x)/css`、`packages/web/cn-index.html`、`packages/web/script/cn-build.ts` | `cn-render.tsx` / `cn-build.ts` / `cn-index.html` 是上游 `render.tsx` / `build.ts` / `index.html` 的 fork |
| Worker | `packages/function/src/zy-worker.ts`（wrangler `main`） | 包装上游 `worker.ts`：不上报遥测、首页、`$id`、CORS、`/plans` |
| 本库 README | `.github/README.md`（GitHub 优先显示它） | 根目录 `README.md` 保持上游原版 |
| npm 包信息 | `scripts/npm/package.json` | `zy-publish.yml` 在临时目录里组包发布；根 `package.json` 保持上游原版 |
| 工作流 | `.github/workflows/zy-*.yml` | 上游工作流不改（它们限定 `anomalyco/models.dev`，在本库自动跳过） |

## Fork 的上游文件

`cn-render.tsx`、`cn-build.ts`、`cn-index.html` 复制自上游文件，所以上游改了原文件不会冲突，但也不会自动带进来。`scripts/upstream-forks.json` 记着上次移植时上游文件的 blob；`bun scripts/check-upstream-forks.ts` 列出之后上游改过的文件（同步 PR 的说明里会附上），手工移植后运行 `bun scripts/check-upstream-forks.ts --update`。

## 工作流怎么处理冲突

1. `git merge upstream/dev`。`.gitattributes` 把 `bun.lock`、`models.json`（上游的生成文件，我们从不改）设为 `merge=zy-upstream`：冲突时直接取上游版本。
2. 剩下的冲突交给 `scripts/sync-resolve-generated.sh`：只要是 importer 生成的文件上的 add/add，就取上游文件并重新导入；否则中止合并、**不推送任何分支**，并开 / 更新 `upstream-sync-conflict` issue。
3. 合并成功后运行 `scripts/zy-reimport.sh`，在合并后的上游数据上重新生成 overlays/（不信任 git 对生成数据的合并），然后 `zy-validate`、测试、`build-dist`、网站构建。任何一步失败同样开 issue、不推送。
4. 通过后推送 `sync/upstream` 并开 / 更新 PR。开不了 PR（仓库设置没允许 Actions 建 PR）时也开 issue 说明。连 issue 都开不了时让运行失败，避免静默停摆。
