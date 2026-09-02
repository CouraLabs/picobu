import { describe, expect, test } from "bun:test";
import type { HarnessOptions, ProviderOptions } from "../../libs/options";
import { modelEntries, roleModelRows } from "./model-roles";

describe("roleModelRows", () => {
  const harness: HarnessOptions = {
    defaultModel: "openai/gpt-5.2",
    modelRoles: { tiny: "openai/gpt-4.1-mini", flashThinking: "medium", heavyThinkingLevel: "high" },
  };

  test("prefers explicit per-role overrides, falls back to defaultModel", () => {
    const rows = roleModelRows(harness);
    expect(rows).toHaveLength(3);
    const byRole = Object.fromEntries(rows.map((r) => [r.role, r]));
    expect(byRole.tiny?.assignedKey).toBe("openai/gpt-4.1-mini");
    expect(byRole.flash?.assignedKey).toBe("openai/gpt-5.2");
    expect(byRole.heavy?.assignedKey).toBe("openai/gpt-5.2");
  });

  test("tiny defaults to none thinking; flash/heavy inherit the model default", () => {
    const rows = roleModelRows(harness);
    const byRole = Object.fromEntries(rows.map((r) => [r.role, r]));
    expect(byRole.tiny?.defaultThinking).toBe("none");
    expect(byRole.flash?.defaultThinking).toBeUndefined();
    expect(byRole.heavy?.defaultThinking).toBeUndefined();
  });

  test("model-less harness degrades to unassigned without throwing", () => {
    const rows = roleModelRows(undefined);
    expect(rows.map((r) => r.assignedKey)).toEqual([undefined, undefined, undefined]);
  });

  test("a role override with no defaultModel still resolves", () => {
    const rows = roleModelRows({ defaultModel: undefined, modelRoles: { heavy: "anthropic/claude-sonnet-4.6" } });
    expect(rows.find((r) => r.role === "heavy")?.assignedKey).toBe("anthropic/claude-sonnet-4.6");
  });
});

describe("modelEntries", () => {
  const provider: ProviderOptions = {
    id: "anthropic",
    name: "Anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      {
        id: "claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        context: 200000,
        output: 64000,
        supports: ["text"],
      },
    ],
  };

  test("maps providers/models to ModelEntry shape", () => {
    expect(modelEntries([provider])).toEqual([
      {
        key: "anthropic/claude-sonnet-4.6",
        providerId: "anthropic",
        providerName: "Anthropic",
        modelId: "claude-sonnet-4.6",
        modelName: "Claude Sonnet 4.6",
        supports: ["text"],
        context: 200000,
        output: 64000,
        billing: undefined,
      },
    ]);
  });

  test("empty providers yield an empty list", () => {
    expect(modelEntries([])).toEqual([]);
  });
});