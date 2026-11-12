/** @jsx jsx */
/** @jsxImportSource hono/jsx */

// zy-models: Chinese "使用说明" dialog, used in place of upstream HelpDialog.
// Same element ids / classes as upstream so index.ts and index.css keep working.

import { SITE } from "./cn.js";

const ENDPOINTS: Array<[string, string]> = [
  ["/api.json", "全部平台及其模型（同 models.dev /api.json，含扩展字段）"],
  ["/cn.json", "仅国内平台（region = cn），体积小"],
  ["/models.json", "与平台无关的通用模型元数据"],
  ["/catalog.json", "{ providers, models } 合集"],
];

export function CnHelpDialog() {
  return (
    <dialog id="modal">
      <div class="header">
        <h2>使用说明</h2>
        <button id="close" aria-label="关闭">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <div class="body">
        <p>
          <a href="/">{SITE.name}</a> 是中国版 models.dev：在{" "}
          <a href="https://models.dev" target="_blank" rel="noopener noreferrer">models.dev</a>{" "}
          全量数据之上，补齐国内平台的人民币价格（含阶梯、峰谷、原价）、编程套餐、默认思考档位和中文名。
        </p>
        <p>
          首页列出与平台无关的通用模型；模型页列出提供该模型的平台；平台页列出该平台的全部模型和编程套餐；厂商页按研发方分组。
          勾选「仅国内平台」只看国内平台。人民币价单位为元 / 百万 tokens，鼠标悬停可看阶梯、峰谷与原价；「默认思考」指请求不传任何思考参数时的行为。
        </p>
        <h2>API</h2>
        <p>以下 JSON 均可直接 fetch，结构与 models.dev 一致，只多出可选的扩展键。默认省略专用模型类型，加 <code>?type=all</code> 返回全部。</p>
        {ENDPOINTS.map(([path, label]) => (
          <div class="code-block">
            <code>
              curl <a href={path}>{`${SITE.url}${path}`}</a>
            </code>
            <p class="cn-help-note">{label}</p>
          </div>
        ))}
        <h2>Logo</h2>
        <p>
          平台 Logo：<code>/logos/{`{provider}`}.svg</code>；厂商 Logo：<code>/logos/labs/{`{lab}`}.svg</code>。
        </p>
        <h2>数据与贡献</h2>
        <p>
          国内数据只取官方文档、价格页、API 返回或官方博客，每个模型带来源与核查日期。数据以 TOML 存放在{" "}
          <a href={SITE.repo} target="_blank" rel="noopener noreferrer">GitHub</a>，每天自动合并上游 models.dev。
          编程套餐额度仅限官方支持的编程工具使用，不能当普通 API 调用。
        </p>
      </div>
      <div class="footer">
        <a href={SITE.repo} target="_blank" rel="noopener noreferrer">在 GitHub 上编辑</a>
        <a href="https://github.com/anomalyco/models.dev" target="_blank" rel="noopener noreferrer">基于 models.dev（MIT）</a>
      </div>
    </dialog>
  );
}
