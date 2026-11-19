// zy-models Worker entry (wrangler `main`). Wraps the upstream worker so the
// upstream file (./worker.ts) stays byte-for-byte upstream and mergeable:
//   - No telemetry: upstream reports opencode/bun requests to PostHog and Lake.
//     We call it with a neutral User-Agent so that branch never runs (and the
//     PosthogToken / Lake env vars it would need are not required).
//   - "/" serves _index.html directly (wrangler html_handling = "none" serves
//     exact files only; upstream asks for "/_index").
//   - /model-schema.json carries our own $id.
//   - JSON endpoints (/api.json, /cn.json, /models.json, ...) always carry
//     `Access-Control-Allow-Origin: *`, since asset `_headers` rules are not
//     applied to responses the Worker returns from the ASSETS binding.
//   - HTML is labelled UTF-8 (assets are served as bare `text/html`).
//   - /plans (编程套餐对比) is served from plans/index.html; upstream's worker
//     only knows /models, /providers and /labs.
import upstream from "./worker";

export const SITE_ORIGIN = "https://zy-models.ziyou979.workers.dev";

export interface Env {
  ASSETS: any;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    let response: Response;
    if (path === "/plans" || path === "/plans/") {
      url.pathname = "/plans/index.html";
      response = await env.ASSETS.fetch(new Request(url.toString(), request));
    } else if (path === "/" || path === "/index.html" || path === "/index") {
      url.pathname = "/_index.html";
      response = await env.ASSETS.fetch(new Request(url.toString(), request));
    } else {
      const headers = new Headers(request.headers);
      headers.set("user-agent", "zy-models");
      response = await upstream.fetch(new Request(request, { headers }), env as never, ctx);
      if (path === "/model-schema.json" && response.ok) {
        const schema = (await response.json()) as Record<string, unknown>;
        schema.$id = `${SITE_ORIGIN}/model-schema.json`;
        response = new Response(JSON.stringify(schema, null, 2), { status: response.status, headers: response.headers });
      }
    }
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
