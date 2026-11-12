# 国内平台调研数据格式（每个平台一个 <provider_id>.json）
{
  "provider_id": "dashscope",            // 小写短横线；若 models.dev 已有对应 provider，写在 modelsdev_id
  "modelsdev_id": "alibaba-cn",          // 没有就 null
  "name_zh": "阿里云百炼", "name_en": "Alibaba Cloud Model Studio",
  "doc": "官方模型列表页 URL",
  "pricing_page": "官方价格页 URL",
  "env": ["DASHSCOPE_API_KEY"],
  "endpoints": [ { "region": "cn|intl", "protocol": "openai-chat|openai-responses|anthropic|gemini|native", "base_url": "...", "source": "URL" } ],
  "plans": [ { "id": "coding-plan", "name_zh": "...", "base_url": "...", "protocol": "...", "price_cny_month": 0, "quota_note": "官方原文要点", "models": ["..."], "source": "URL" } ],
  "models": [ {
    "id": "API 里实际传的 model 字符串",
    "name": "官方英文显示名", "name_zh": "官方中文名或 null", "aliases": ["带日期快照名等"],
    "lab": "qwen|deepseek|moonshot|zhipu|...", "open_weights": true, "release_date": "YYYY-MM-DD|null", "status": "ga|beta|deprecated",
    "limit": { "context": 0, "input": null, "output": 0 },
    "modalities": { "input": ["text","image"], "output": ["text"] },
    "tools": true, "structured_output": null,
    "reasoning": { "supported": true, "toggle": true, "effort": ["low","high"], "default": "on|off|<档位>|null", "default_source": "URL 或 null", "field": "reasoning_content|null" },
    "price_cny": { "unit": "per_million_tokens", "input": 0, "output": 0, "cache_read": null, "cache_write": null,
                   "tiers": [ { "when": "input<=32k", "input": 0, "output": 0 } ], "off_peak": "原文要点或 null" },
    "price_usd_intl": null,
    "sources": ["URL", "..."], "checked_at": "2026-11-12"
  } ],
  "notes": "需实名/备案/区域限制等官方说明"
}
规则：只用官方文档、官方价格页、官方 API 返回或官方博客；查不到就写 null，绝不猜，绝不用第三方聚合站。每个数值都要能在 sources 里找到。
