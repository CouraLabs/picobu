import type { LlmProviderDefinition } from "@agent/model/types.ts";


export const hyper: LlmProviderDefinition = {
  id: "hyper",
  name: "Charm Hyper",
  type: "openai-compatible",
  baseUrl: "https://hyper.charm.land/v1",
  modelsUrl: "https://hyper.charm.land/v1/models",
  apiKeyEnv: "HYPER_API_KEY",
};
