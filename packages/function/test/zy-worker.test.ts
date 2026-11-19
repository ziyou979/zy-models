// zy-models: tests for our wrapper around the (unchanged) upstream worker.
import { describe, expect, spyOn, test } from "bun:test";

import worker, { SITE_ORIGIN, type Env } from "../src/zy-worker.js";

const providers = {
  example: { id: "example", models: { text: { id: "text-model", modalities: { input: ["text"], output: ["text"] } } } },
};

function env(seen: string[] = []) {
  return {
    // No PosthogToken / LakeEndpoint / LakeToken: the wrapper must not need them.
    ASSETS: {
      fetch(input: Request) {
        const pathname = new URL(input.url).pathname;
        seen.push(pathname);
        if (pathname === "/_api.json") return Response.json(providers);
        if (pathname === "/_index.html") return new Response("<p>home</p>", { headers: { "Content-Type": "text/html" } });
        if (pathname === "/plans/index.html") return new Response("<p>plans</p>", { headers: { "Content-Type": "text/html" } });
        return new Response(null, { status: 404 });
      },
    },
  } as unknown as Env;
}

async function request(path: string, headers: Record<string, string> = {}, seen: string[] = [], waits: unknown[] = []) {
  return worker.fetch(new Request(`https://zy.example${path}`, { headers }), env(seen), {
    waitUntil: (p: unknown) => waits.push(p),
  } as unknown as ExecutionContext);
}

describe("zy-worker", () => {
  test("never sends telemetry, even for opencode/bun clients", async () => {
    const fetch = spyOn(globalThis, "fetch");
    try {
      const waits: unknown[] = [];
      const response = await request("/api.json", { "user-agent": "opencode/1.0 bun/1.2" }, [], waits);
      expect(response.status).toBe(200);
      expect(Object.keys(await response.json())).toEqual(["example"]);
      expect(fetch).not.toHaveBeenCalled();
      expect(waits).toHaveLength(0);
    } finally {
      fetch.mockRestore();
    }
  });

  test("JSON endpoints allow any origin", async () => {
    const response = await request("/api.json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("home page is served from _index.html as UTF-8", async () => {
    for (const path of ["/", "/index", "/index.html"]) {
      const seen: string[] = [];
      const response = await request(path, {}, seen);
      expect(seen).toEqual(["/_index.html"]);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(await response.text()).toBe("<p>home</p>");
    }
  });

  test("/plans is served from plans/index.html", async () => {
    const response = await request("/plans");
    expect(await response.text()).toBe("<p>plans</p>");
  });

  test("model-schema.json uses our $id", async () => {
    const response = await request("/model-schema.json");
    const body = (await response.json()) as { $id: string; $defs: { Model: { enum: string[] } } };
    expect(body.$id).toBe(`${SITE_ORIGIN}/model-schema.json`);
    expect(body.$defs.Model.enum).toEqual(["example/text"]);
  });
});
