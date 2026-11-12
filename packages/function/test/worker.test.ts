import { describe, expect, spyOn, test } from "bun:test";

import worker, { type Env } from "../src/worker.js";

const textModel = {
  id: "text-model",
  modalities: { input: ["text"], output: ["text"] },
};
const decisionModel = {
  id: "decision-model",
  type: "decision",
  modalities: { input: ["text"], output: ["text"] },
};
const providers = {
  example: {
    id: "example",
    models: { text: textModel, decision: decisionModel },
  },
};
const models = { text: textModel, decision: decisionModel };

describe("catalog API model type filtering", () => {
  test("omits typed models from api.json by default", async () => {
    const response = await request("/api.json");
    const body = await response.json();

    expect(Object.keys(body.example.models)).toEqual(["text"]);
  });

  test("omits typed models from models.json by default", async () => {
    const response = await request("/models.json");
    const body = await response.json();

    expect(Object.keys(body)).toEqual(["text"]);
  });

  test("omits typed models from catalog.json by default", async () => {
    const response = await request("/catalog.json");
    const body = await response.json();

    expect(Object.keys(body.models)).toEqual(["text"]);
    expect(Object.keys(body.providers.example.models)).toEqual(["text"]);
  });

  test("returns explicitly requested decision models", async () => {
    const response = await request("/catalog.json?type=decision");
    const body = await response.json();

    expect(Object.keys(body.models)).toEqual(["decision"]);
    expect(Object.keys(body.providers.example.models)).toEqual(["decision"]);
  });

  test("combines repeated type parameters", async () => {
    const response = await request("/models.json?type=chat&type=decision");
    const body = await response.json();

    expect(Object.keys(body)).toEqual(["text", "decision"]);
  });

  test("gives filtered responses an ETag that revalidates", async () => {
    const response = await request("/models.json?type=decision,chat");
    const etag = response.headers.get("etag");
    const again = await request("/models.json?type=chat,decision", {
      "user-agent": "test",
      "if-none-match": etag ?? "",
    });

    expect(etag).toBe('W/"all;type=chat,decision"');
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
  });

  test("returns the complete static catalog for all", async () => {
    const response = await request("/models.json?type=all");
    const body = await response.json();

    expect(Object.keys(body)).toEqual(["text", "decision"]);
  });

  test("omits typed models from model-schema.json by default", async () => {
    const response = await request("/model-schema.json");
    const body = await response.json();

    expect(body.$defs.Model.enum).toEqual(["example/text"]);
  });

  test("includes typed models in model-schema.json when requested", async () => {
    const response = await request("/model-schema.json?type=all");
    const body = await response.json();

    expect(body.$defs.Model.enum).toEqual(["example/decision", "example/text"]);
  });

  test("rejects unknown model types", async () => {
    const response = await request("/api.json?type=unknown");

    expect(response.status).toBe(400);
  });

  test("serves experimental v2.0 api.json", async () => {
    const response = await request("/experimental/v2.0/api.json");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(providers);
  });

  test("serves one experimental v2.0 type from its prebuilt file", async () => {
    const response = await request("/experimental/v2.0/api.json?type=decision");
    const body = await response.json();

    expect(response.headers.get("etag")).toBe('"v2-decision"');
    expect(Object.keys(body.example.models)).toEqual(["decision"]);
  });
});

// zy-models: upstream's PostHog / Lake hit reporting was removed from the worker.
describe("telemetry", () => {
  test("sends no hit events, even for opencode clients", async () => {
    const sent: string[] = [];
    const fetch = spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        sent.push(String(input));
        return new Response(null, { status: 204 });
      },
    );
    const pending: Promise<unknown>[] = [];
    try {
      const response = await request(
        "/api.json?type=all",
        { "user-agent": "opencode/1.18.34", "cf-connecting-ip": "203.0.113.45" },
        (promise) => pending.push(promise),
      );
      await Promise.all(pending);
      expect(response.status).toBe(200);
      expect(pending).toHaveLength(0);
      expect(sent).toHaveLength(0);
    } finally {
      fetch.mockRestore();
    }
  });
});

async function request(
  path: string,
  headers: Record<string, string> = { "user-agent": "test" },
  waitUntil: (promise: Promise<unknown>) => void = () => {},
) {
  const env = {
    PosthogToken: secret("posthog-token"),
    LakeEndpoint: secret("https://stream.example/"),
    LakeToken: secret("lake-token"),
    ASSETS: {
      fetch(input: Request) {
        const pathname = new URL(input.url).pathname;
        if (pathname === "/_experimental_v2.0_api.json") {
          return Response.json(providers);
        }
        if (pathname === "/_experimental_v2.0_api-decision.json") {
          return Response.json(
            { example: { ...providers.example, models: { decision: decisionModel } } },
            { headers: { etag: '"v2-decision"' } },
          );
        }
        if (pathname === "/_api.json") {
          return Response.json({
            example: { ...providers.example, models: { text: textModel } },
          });
        }
        if (pathname === "/_api-all.json") return Response.json(providers);
        if (pathname === "/_api-decision.json") {
          return Response.json({
            example: {
              ...providers.example,
              models: { decision: decisionModel },
            },
          });
        }
        if (pathname === "/_models.json") {
          return Response.json({ text: textModel });
        }
        if (pathname === "/_models-all.json") {
          if (input.headers.get("if-none-match") === 'W/"all"') {
            return new Response(null, { status: 304, headers: { etag: 'W/"all"' } });
          }
          return Response.json(models, { headers: { etag: 'W/"all"' } });
        }
        if (pathname === "/_models-decision.json") {
          return Response.json({ decision: decisionModel });
        }
        if (pathname === "/_catalog.json") {
          return Response.json({
            providers: {
              example: { ...providers.example, models: { text: textModel } },
            },
            models: { text: textModel },
          });
        }
        if (pathname === "/_catalog-all.json") {
          return Response.json({ providers, models });
        }
        if (pathname === "/_catalog-decision.json") {
          return Response.json({
            providers: {
              example: {
                ...providers.example,
                models: { decision: decisionModel },
              },
            },
            models: { decision: decisionModel },
          });
        }
        return new Response(null, { status: 404 });
      },
    },
  } as unknown as Env;

  return worker.fetch(
    new Request(`https://models.dev${path}`, { headers }),
    env,
    { waitUntil } as unknown as ExecutionContext,
  );
}

function secret(value: string) {
  return JSON.stringify({ value });
}
