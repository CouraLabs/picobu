import { describe, expect, test } from "bun:test";
import type { Provider as ModelsDevProvider } from "@opencode-ai/models";
import type { HarnessOptions, ProviderModelOptions, ProviderOptions } from "@config/options.ts";
import { fixHarnessAfterLogout, pickDefaultModel, repointModelKey, selectCopilotModels } from "@auth/register.ts";

const modelsDevFixture = (models: ModelsDevProvider["models"]): ModelsDevProvider => ({
  id: "github-copilot",
  env: ["GITHUB_TOKEN"],
  api: "https://api.individual.githubcopilot.com",
  name: "GitHub Copilot",
  npm: "@ai-sdk/openai-compatible",
  doc: "https://docs.github.com/en/copilot",
  models,
});

const fullModel = {
  id: "gpt-5.2",
  name: "GPT-5.2",
  description: "Coding model",
  attachment: true,
  reasoning: true,
  tool_call: true,
  release_date: "2025-12-11",
  last_updated: "2025-12-11",
  open_weights: false,
  modalities: { input: ["text", "image"] as const, output: ["text"] as const },
  limit: { context: 400000, output: 128000 },
} satisfies ModelsDevProvider["models"][string];

describe("selectCopilotModels", () => {
  const catalog = modelsDevFixture({ "gpt-5.2": fullModel });

  test("maps the account's available ids through the catalog", () => {
    const models = selectCopilotModels(catalog, ["gpt-5.2"]);
    expect(models).toEqual([
      {
        id: "gpt-5.2",
        name: "GPT-5.2",
        description: "Coding model",
        context: 400000,
        output: 128000,
        reasoning: true,
        supports: ["text", "vision"],
        billing: undefined,
      },
    ]);
  });

  test("appends catalog-less ids as minimal entries", () => {
    const models = selectCopilotModels(catalog, ["gpt-5.2", "gpt-preview-x"]);
    expect(models.map((m) => m.id)).toEqual(["gpt-5.2", "gpt-preview-x"]);
    expect(models[1]).toEqual({ id: "gpt-preview-x", name: "gpt-preview-x", context: 0, output: 0, supports: ["text"] });
  });

  test("an empty account list falls back to the full catalog", () => {
    const models = selectCopilotModels(catalog, undefined);
    expect(models.map((m) => m.id)).toEqual(["gpt-5.2"]);
  });
});

describe("pickDefaultModel", () => {
  test("prefers a reasoning-capable model", () => {
    const models: ProviderModelOptions[] = [
      { id: "gpt-4.1-mini", name: "GPT-4.1 mini", context: 1, output: 1, supports: ["text"] },
      { id: "gpt-5.2", name: "GPT-5.2", context: 1, output: 1, supports: ["text"], reasoning: true },
    ];
    expect(pickDefaultModel(models)).toBe("gpt-5.2");
  });

  test("falls back to the first model and to undefined when empty", () => {
    const models: ProviderModelOptions[] = [
      { id: "a", name: "A", context: 1, output: 1, supports: ["text"] },
    ];
    expect(pickDefaultModel(models)).toBe("a");
    expect(pickDefaultModel([])).toBeUndefined();
  });
});

describe("fixHarnessAfterLogout", () => {
  const anthropic: ProviderOptions = {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "auth:anthropic",
    models: [
      { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", context: 1, output: 1, supports: ["text"], reasoning: true },
    ],
  };
  const harness: HarnessOptions = {
    defaultModel: "openai/gpt-5.2",
    modelRoles: {
      tiny: "openai/gpt-4.1-mini",
      flash: "anthropic/claude-sonnet-4.6",
      heavy: "anthropic/claude-sonnet-4.6",
      flashThinking: "medium",
      heavyThinkingLevel: "high",
    },
  };

  test("repoints openai selectors at the first remaining provider", () => {
    const next = fixHarnessAfterLogout(harness, "openai", [anthropic]);
    expect(next.defaultModel).toBe("anthropic/claude-sonnet-4.6");
    expect(next.modelRoles?.tiny).toBe("anthropic/claude-sonnet-4.6");
    expect(next.modelRoles?.flash).toBe("anthropic/claude-sonnet-4.6");
    expect(next.modelRoles?.heavy).toBe("anthropic/claude-sonnet-4.6");
    expect(next.modelRoles?.flashThinking).toBe("medium");
    expect(next.modelRoles?.heavyThinkingLevel).toBe("high");
  });

  test("clears selectors when no providers remain", () => {
    const next = fixHarnessAfterLogout(harness, "openai", []);
    expect(next.defaultModel).toBeUndefined();
    expect(next.modelRoles?.tiny).toBeUndefined();
    expect(next.modelRoles?.flash).toBe("anthropic/claude-sonnet-4.6");
  });

  test("leaves non-matching selectors untouched", () => {
    const next = fixHarnessAfterLogout(harness, "github-copilot", [anthropic]);
    expect(next.defaultModel).toBe("openai/gpt-5.2");
  });
});

describe("repointModelKey", () => {
  const providers: ProviderOptions[] = [
    {
      id: "anthropic",
      name: "Anthropic",
      type: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "auth:anthropic",
      models: [
        { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", context: 1, output: 1, supports: ["text"], reasoning: true },
        { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", context: 1, output: 1, supports: ["text"] },
      ],
    },
  ];

  test("repoints a model key that referenced the removed provider", () => {
    expect(repointModelKey("openai/gpt-5.2", "openai", providers)).toBe("anthropic/claude-sonnet-4.6");
  });

  test("leaves other providers' keys untouched", () => {
    expect(repointModelKey("anthropic/claude-sonnet-4.6", "openai", providers)).toBe("anthropic/claude-sonnet-4.6");
  });

  test("returns an empty key when no fallback provider remains", () => {
    expect(repointModelKey("openai/gpt-5.2", "openai", [])).toBe("");
  });
});