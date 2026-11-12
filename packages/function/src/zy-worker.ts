// zy-models Worker entry (wrangler `main`). Wraps the upstream worker so the
// upstream file stays mergeable:
//   - JSON endpoints (/api.json, /cn.json, /models.json, ...) always carry
//     `Access-Control-Allow-Origin: *`, since asset `_headers` rules are not
//     applied to responses the Worker returns from the ASSETS binding.
//   - HTML is labelled UTF-8 (assets are served as bare `text/html`).
import upstream, { type Env } from "./worker";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await upstream.fetch(request, env, ctx);
    const path = new URL(request.url).pathname;
    const type = response.headers.get("Content-Type") ?? "";
    const html = type.startsWith("text/html") && !type.includes("charset");
    const json = path.endsWith(".json") && !response.headers.get("Access-Control-Allow-Origin");
    if (!html && !json) return response;
    const headers = new Headers(response.headers);
    if (html) headers.set("Content-Type", "text/html; charset=utf-8");
    if (json) headers.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
