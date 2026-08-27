import { DirectChatTransport, ToolLoopAgent } from "ai";
import { buildToolSet, toolsInfo } from "../../tool/toolset";
import { getAgent } from "../agent/registry";
import { resolveModel } from "../provider-resolver";
import { generateSystemMessage } from "../../prompts/system";
import { options, type ProviderModelReasoningEffort } from "../../../../libs/options";

/** The AI SDK's `reasoning` union. The project's `ProviderModelReasoningEffort`
 * adds `"max"` (used by configured providers) but omits `"minimal"` /
 * `"provider-default"`, so reasoning values are cast across that boundary. */
type AiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "provider-default";

export type LoopConfig = {
  agentId: string;
  modelKey: string;
  thinking: ProviderModelReasoningEffort;
};

export type Loop = {
  agent: ToolLoopAgent<any, any, any, any>;
  transport: DirectChatTransport;
};

export function createLoop(getConfig: () => LoopConfig): Loop {
  const toolSet = buildToolSet();
  const initialConfig = getConfig();

  // System prompts are deterministic per (agent, tool set): build once so the
  // prompt-cache prefix stays byte-stable and we skip recomputing every turn.
  const systemCache: Record<string, string> = {};
  const buildSystem = (agentId: string): string => {
    const cached = systemCache[agentId];
    if (cached !== undefined) return cached;
    const agent = getAgent(agentId);
    const built = generateSystemMessage({
      appName: options.app.name,
      cwd: options.app.cwd,
      os: options.app.os,
      shell: options.app.shell,
      agentPrompt: agent.prompt,
      toolsInfo: toolsInfo(toolSet.getTools(agent.tools)),
    }).map((s) => `<${s.key}>${s.content}</${s.key}>`).join("\n");
    systemCache[agentId] = built;
    return built;
  };

  const agent = new ToolLoopAgent({
    model: resolveModel(initialConfig.modelKey).model,
    tools: toolSet.getToolSet(), // full set; activeTools narrows per agent below
    prepareCall: ({ options, ...rest }) => {
      const config = getConfig();
      const agentDef = getAgent(config.agentId);
      const resolved = resolveModel(config.modelKey);
      return {
        ...rest,
        model: resolved.model,
        activeTools: agentDef.tools.length ? agentDef.tools : undefined,
        instructions: buildSystem(config.agentId),
        reasoning: config.thinking as AiReasoningEffort,
        // Explicit ephemeral cache breakpoint (Anthropic): pins the prompt prefix
        // with a 1h TTL instead of the default 5m auto-cache. Non-Anthropic
        // providers ignore this namespaced option.
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
        ...(agentDef.temperature !== undefined ? { temperature: agentDef.temperature } : {}),
        ...(agentDef.topP !== undefined ? { topP: agentDef.topP } : {}),
        ...(agentDef.topK !== undefined ? { topK: agentDef.topK } : {}),
      };
    },
  });

  const transport = new DirectChatTransport({
    agent,
    sendFinish: true,
    sendReasoning: true,
    sendSources: true,
    sendStart: true,
    messageMetadata: (opts) =>
      opts.part.type === "finish"
        ? {
            usage: {
              inputTokens: opts.part.totalUsage.inputTokens,
              outputTokens: opts.part.totalUsage.outputTokens,
              cacheReadTokens: opts.part.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
              cacheWriteTokens: opts.part.totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
            },
          }
        : undefined,
  });

  return { agent, transport };
}