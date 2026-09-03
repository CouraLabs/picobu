import { describe, expect, test } from "bun:test";
import type { Provider as ModelsDevProvider } from "@opencode-ai/models";
import { parseModelsResponse } from "@harness/agent/factory/llm-providers/fetch-models.ts";
import { modelsFromModelsDev } from "@harness/agent/factory/llm-providers/models-dev.ts";
import { upsertProvider } from "@harness/agent/factory/llm-providers/registry.ts";
import type { ProviderOptions } from "@libs/options.ts";

describe("parseModelsResponse", () => {
  test("maps a rich Hyper-style listing onto model metadata", () => {
    const models = parseModelsResponse({
      object: "list",
      data: [
        {
          id: "deepseek-v4-flash",
          object: "model",
          created: 1783361967,
          owned_by: "hyper",
          display_name: "DeepSeek V4 Flash",
          context_window: 1000000,
          max_output_tokens: 384000,
          capabilities: { vision: false },
          reasoning: {
            effort_levels: [
              { value: "high", display: "High" },
              { value: "xhigh", display: "X-High" },
            ],
            default_effort_level: "high",
          },
          pricing: { input: 0.2, output: 0.4, cache_create: 0, cache_hit: 0.04 },
        },
      ],
    });

    expect(models).toEqual([
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        context: 1000000,
        output: 384000,
        reasoning: true,
        supports: ["text"],
        efforts: ["high", "xhigh"],
        defaultEffort: "high",
        billing: { input: 0.2, output: 0.4, cacheRead: 0.04, cacheWrite: 0 },
      },
    ]);
  });

  test("falls back to the model id when no display name is given", () => {
    const models = parseModelsResponse({ data: [{ id: "gpt-9" }] });
    expect(models).toEqual([
      { id: "gpt-9", name: "gpt-9", context: 0, output: 0, supports: ["text"] },
    ]);
  });

  test("returns an empty list for empty or malformed payloads", () => {
    expect(parseModelsResponse({ data: [] })).toEqual([]);
    expect(parseModelsResponse({ data: "nope" })).toEqual([]);
    expect(parseModelsResponse(null)).toEqual([]);
  });
});

const modelsDevProvider = (models: ModelsDevProvider["models"]): ModelsDevProvider => ({
  id: "hyper",
  env: ["HYPER_API_KEY"],
  npm: "@ai-sdk/openai-compatible",
  api: "https://hyper.charm.land/v1",
  name: "Charm Hyper",
  doc: "https://hyper.charm.land",
  models,
});

describe("modelsFromModelsDev", () => {
  test("maps models.dev models onto picobu model metadata", () => {
    const models = modelsFromModelsDev({
      id: "hyper",
      env: ["HYPER_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      name: "Charm Hyper",
      doc: "https://hyper.charm.land",
      models: {
        "kimi-k2.7-code": {
          id: "kimi-k2.7-code",
          name: "Kimi K2.7 Code",
          description: "Coding-focused Kimi model",
          attachment: true,
          reasoning: true,
          reasoning_options: [{ type: "effort", values: ["low", "high"] }],
          tool_call: true,
          release_date: "2026-07-03",
          last_updated: "2026-07-22",
          modalities: { input: ["text", "image"], output: ["text"] },
          open_weights: true,
          limit: { context: 262000, output: 16000 },
          cost: { input: 1.03, output: 4.36, cache_read: 0.2 },
        },
      },
    });

    expect(models).toEqual([
      {
        id: "kimi-k2.7-code",
        name: "Kimi K2.7 Code",
        description: "Coding-focused Kimi model",
        context: 262000,
        output: 16000,
        reasoning: true,
        supports: ["text", "vision"],
        efforts: ["low", "high"],
        billing: { input: 1.03, output: 4.36, cacheRead: 0.2, cacheWrite: undefined },
      },
    ]);
  });
});

describe("upsertProvider", () => {
  const base = {
    name: "Charm Hyper",
    type: "openai-compatible",
    baseUrl: "https://hyper.charm.land/v1",
    apiKey: "env:HYPER_API_KEY",
    models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", context: 1, output: 1 }],
  } satisfies Omit<ProviderOptions, "id">;

  test("appends a new provider", () => {
    const existing: ProviderOptions[] = [{ id: "other", ...base }];
    const next = upsertProvider(existing, { id: "hyper", ...base });
    expect(next.map((p) => p.id)).toEqual(["other", "hyper"]);
  });

  test("replaces an existing provider in place", () => {
    const existing: ProviderOptions[] = [{ id: "hyper", ...base, models: [] }];
    const next = upsertProvider(existing, { id: "hyper", ...base });
    expect(next).toEqual([{ id: "hyper", ...base }]);
  });
});
