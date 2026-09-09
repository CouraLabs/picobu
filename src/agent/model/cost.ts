import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import type { LanguageModelV2, LanguageModelV3, LanguageModelV4, LanguageModelV4Usage } from "@ai-sdk/provider";
import type { ProviderModelBilling } from "@config/options.ts";
import { fmtTokens } from "@shared/format.ts";


export type LoopUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};


export const computeCost = (usage: LoopUsage, billing?: ProviderModelBilling): number | undefined => {
  if (!billing) return undefined;
  const uncached = Math.max(0, (usage.inputTokens ?? 0) - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0));
  return (
    (
      uncached * (billing.input ?? 0)
      + (usage.outputTokens ?? 0) * (billing.output ?? 0)
      + (usage.cacheReadTokens ?? 0) * (billing.cacheRead ?? 0)
      + (usage.cacheWriteTokens ?? 0) * (billing.cacheWrite ?? 0)
    ) / 1_000_000) * (billing.multiplier ?? 1);
};


export const computeCostSplit = (
  usage: LoopUsage,
  billing?: ProviderModelBilling,
): { inputCost: number; outputCost: number; cacheCost: number } | undefined => {
  if (!billing) return undefined;
  const uncached = Math.max(0, (usage.inputTokens ?? 0) - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0));
  const m = (tokens: number, rate: number | undefined) => (tokens * (rate ?? 0) / 1_000_000) * (billing.multiplier ?? 1);
  return {
    inputCost: m(uncached, billing.input),
    outputCost: m(usage.outputTokens ?? 0, billing.output),
    cacheCost: m(usage.cacheReadTokens ?? 0, billing.cacheRead) + m(usage.cacheWriteTokens ?? 0, billing.cacheWrite),
  };
};


const toLoopUsage = (usage: LanguageModelV4Usage): LoopUsage => ({
  inputTokens: usage.inputTokens.total,
  outputTokens: usage.outputTokens.total,
  cacheReadTokens: usage.inputTokens.cacheRead,
  cacheWriteTokens: usage.inputTokens.cacheWrite,
});

const logCall = (modelKey: string, billing: ProviderModelBilling | undefined, usage: LoopUsage): void => {
  const cost = computeCost(usage, billing);
  console.error(
    [
      `picobu: llm ${modelKey}`,
      `in=${fmtTokens(usage.inputTokens ?? 0)}`,
      `out=${fmtTokens(usage.outputTokens ?? 0)}`,
      `cacheRead=${fmtTokens(usage.cacheReadTokens ?? 0)}`,
      `cacheWrite=${fmtTokens(usage.cacheWriteTokens ?? 0)}`,
      `cost=${cost !== undefined ? `$${cost.toFixed(4)}` : "n/a"}`,
    ].join(" "),
  );
};

export const costLoggingMiddleware = (modelKey: string, billing?: ProviderModelBilling): LanguageModelMiddleware => ({
  specificationVersion: "v4",
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    logCall(modelKey, billing, toLoopUsage(result.usage));
    return result;
  },
  wrapStream: async ({ doStream }) => {
    const result = await doStream();
    let logged = false;
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (part.type === "finish" && !logged) {
              logged = true;
              logCall(modelKey, billing, toLoopUsage(part.usage));
            }
            controller.enqueue(part);
          },
        }),
      ),
    };
  },
});

export const withCostLogging = (
  model: LanguageModelV2 | LanguageModelV3 | LanguageModelV4,
  modelKey: string,
  billing?: ProviderModelBilling,
): LanguageModelV4 => wrapLanguageModel({ model, middleware: costLoggingMiddleware(modelKey, billing) });
