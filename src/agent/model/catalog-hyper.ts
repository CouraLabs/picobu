import type { LlmProviderDefinition } from "@agent/model/types.ts";

/** Charm Hyper — https://hyper.charm.land (keyed by `HYPER_API_KEY`). */
export const hyper: LlmProviderDefinition = {
  id: "hyper",
  name: "Charm Hyper",
  type: "openai-compatible",
  baseUrl: "https://hyper.charm.land/v1",
  modelsUrl: "https://hyper.charm.land/v1/models",
  apiKeyEnv: "HYPER_API_KEY",
};
