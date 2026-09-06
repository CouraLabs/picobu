import { Models, type Model as ModelsDevModel, type Provider as ModelsDevProvider } from "@opencode-ai/models";
import type { ProviderModelOptions, ProviderModelReasoningEffort } from "@config/options.ts";


export const fetchModelsDevProvider = async (apiKeyEnv: string): Promise<ModelsDevProvider | undefined> => {
  try {
    const client = Models.make();
    const providers = await client.providers();
    const match = Object.values(providers).find((provider) => provider.env.includes(apiKeyEnv));
    if (match) return match;
  } catch {
  }
  const snapshot = await import("@opencode-ai/models/snapshot");
  return Object.values(snapshot.providers).find((provider) => provider.env.includes(apiKeyEnv));
};


const modelsDevEfforts = (model: ModelsDevModel): ProviderModelReasoningEffort[] | undefined => {
  const values = (model.reasoning_options ?? []).flatMap((option) =>
    option.type === "effort" ? option.values : [],
  );
  const efforts = values.filter((value): value is Exclude<typeof value, null> => value !== null);
  return efforts.length > 0 ? efforts : undefined;
};


export const modelsFromModelsDev = (provider: ModelsDevProvider): ProviderModelOptions[] =>
  Object.values(provider.models ?? {}).map((model) => {
    const supports = ["text"];
    if (model.modalities.input.includes("image")) supports.push("vision");
    return {
      id: model.id,
      name: model.name || model.id,
      description: model.description || undefined,
      context: model.limit?.context ?? 0,
      output: model.limit?.output ?? 0,
      reasoning: model.reasoning || undefined,
      supports,
      efforts: modelsDevEfforts(model),
      billing: model.cost
        ? {
            input: model.cost.input,
            output: model.cost.output,
            cacheRead: model.cost.cache_read,
            cacheWrite: model.cost.cache_write,
          }
        : undefined,
    } satisfies ProviderModelOptions;
  });
