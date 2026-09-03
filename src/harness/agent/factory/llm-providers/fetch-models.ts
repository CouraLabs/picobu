import { z } from "zod";
import type { ProviderModelCapability, ProviderModelOptions } from "@libs/options.ts";

/**
 * One entry of an OpenAI-compatible `/models` payload. Only `id` is required —
 * the extended fields are optional so plain listings (id-only) still parse,
 * while Hyper's rich entries map onto full model metadata.
 */
const ModelsEntrySchema = z.object({
  id: z.string(),
  display_name: z.string().optional(),
  context_window: z.number().optional(),
  max_output_tokens: z.number().optional(),
  capabilities: z
    .object({
      vision: z.boolean().optional(),
    })
    .optional(),
  reasoning: z
    .object({
      effort_levels: z
        .array(z.object({ value: z.string(), display: z.string().optional() }))
        .optional(),
      default_effort_level: z.string().optional(),
    })
    .optional(),
  pricing: z
    .object({
      input: z.number().optional(),
      output: z.number().optional(),
      cache_create: z.number().optional(),
      cache_hit: z.number().optional(),
    })
    .optional(),
});

const ModelsResponseSchema = z.object({ data: z.array(ModelsEntrySchema) });

/** Map one `/models` entry to a `ProviderModelOptions`, dropping id-less entries. */
const toProviderModel = (entry: z.infer<typeof ModelsEntrySchema>): ProviderModelOptions | null => {
  if (!entry.id) return null;
  const efforts = (entry.reasoning?.effort_levels ?? [])
    .map((level) => level.value)
    .filter((value): value is string => Boolean(value));

  const supports: ProviderModelCapability[] = ["text"];
  if (entry.capabilities?.vision) supports.push("vision");

  return {
    id: entry.id,
    name: entry.display_name ?? entry.id,
    context: entry.context_window ?? 0,
    output: entry.max_output_tokens ?? 0,
    reasoning: efforts.length > 0 ? true : undefined,
    supports,
    efforts: efforts.length > 0 ? efforts : undefined,
    defaultEffort: entry.reasoning?.default_effort_level,
    billing: entry.pricing
      ? {
          input: entry.pricing.input,
          output: entry.pricing.output,
          cacheRead: entry.pricing.cache_hit,
          cacheWrite: entry.pricing.cache_create,
        }
      : undefined,
  };
};

/**
 * Parse a `/models` JSON payload into model metadata. Unknown shapes and
 * empty listings resolve to `[]` so callers can fall back to models.dev.
 */
export const parseModelsResponse = (payload: unknown): ProviderModelOptions[] => {
  const parsed = ModelsResponseSchema.safeParse(payload);
  if (!parsed.success) return [];
  return parsed.data.data.flatMap((entry) => {
    const model = toProviderModel(entry);
    return model ? [model] : [];
  });
};

/** Fetch a provider's OpenAI-compatible models listing with bearer auth. */
export const fetchModels = async (url: string, apiKey: string): Promise<ProviderModelOptions[]> => {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Fetching models from ${url} failed: ${res.status} ${res.statusText}`);
  }
  return parseModelsResponse((await res.json()) as unknown);
};
