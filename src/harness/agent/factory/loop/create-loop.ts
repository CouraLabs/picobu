import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { DirectChatTransport, ToolLoopAgent, hasToolCall, isStepCount, type InferUITools, type LanguageModel, type UIMessage } from "ai";
import { buildToolSet, toolsInfo } from "../../tool/toolset";
import { getAgent } from "../agent/registry";
import { resolveModel } from "../provider-resolver";
import { generateSystemMessage } from "../../prompts/system";
import { options, type ProviderModelReasoningEffort } from "../../../../libs/options";
import { folderKeyFor, sessionTodoFilePath } from "../../../../libs/sessions";

/** The AI SDK's `reasoning` union. The project's `ProviderModelReasoningEffort`
 * adds `"max"` (used by configured providers) but omits `"minimal"` /
 * `"provider-default"`, so reasoning values are cast across that boundary. */
type AiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "provider-default";

export type LoopConfig = {
  agentId: string;
  modelKey: string;
  thinking: ProviderModelReasoningEffort;
  /** `persistent` runs each prompt as a fresh, tool-less 10-step session. */
  sessionMode?: "chat" | "persistent";
  /** Session id: enables session-scoped flow tools (the `todo` list). */
  sessionId?: string;
};

/** Options forwarded to the agent loop per call (visible in `prepareCall`). */
type LoopCallOptions = { sessionMode?: "chat" | "persistent" };

/** The UI message type the loop's chat transport carries: data-part-free, with
 * tool names resolved from the tool set at runtime. */
export type LoopMessage = UIMessage<unknown, never, InferUITools<any>>;

export type Loop = {
  agent: ToolLoopAgent<any, any, any, any>;
  transport: DirectChatTransport<any, any, any, any, LoopMessage>;
};

/**
 * Initial model for the loop. `prepareCall` re-resolves the model every step,
 * so when the configured (e.g. OAuth) model can't be built yet — a missing
 * login, offline at mount — a harmless placeholder keeps the transport/loop
 * constructible instead of crashing the app; the real model lands on the
 * first prepared call.
 */
const initialModel = (modelKey: string): LanguageModel => {
  try {
    return resolveModel(modelKey).model;
  } catch (error) {
    console.error("picobu: initial model resolution failed:", error);
    return createOpenAICompatible({ name: "unconfigured", apiKey: "pending", baseURL: "https://api.openai.com/v1" })("no-model");
  }
};

export function createLoop(getConfig: () => LoopConfig): Loop {
  const initialConfig = getConfig();
  const isPersistent = initialConfig.sessionMode === "persistent";
  // Flow tools are session-scoped: the todo list lives in the session folder
  // (`<folder>/<sessionId>/session-todo.json`) and is only registered when the
  // loop knows its session id.
  const toolSet = buildToolSet({
    todoFilePath: initialConfig.sessionId
      ? sessionTodoFilePath(folderKeyFor(options.app.cwd), initialConfig.sessionId)
      : undefined,
    sessionId: initialConfig.sessionId,
  });

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

  const agent = new ToolLoopAgent<LoopCallOptions, any, any, any>({
    model: initialModel(initialConfig.modelKey),
    tools: toolSet.getToolSet(), // full set; activeTools narrows per agent below
    prepareCall: ({ options, ...rest }) => {
      const persistent = options?.sessionMode === "persistent";
      const config = getConfig();
      const agentDef = getAgent(persistent ? "persistent" : config.agentId);
      const resolved = resolveModel(config.modelKey);
      const base = {
        ...rest,
        model: resolved.model,
        activeTools: agentDef.tools.length ? agentDef.tools : undefined,
        instructions: buildSystem(persistent ? "persistent" : config.agentId),
        reasoning: config.thinking as AiReasoningEffort,
        // Interactive flow tools interrupt the run once their (stub) result is
        // in: `ask` (questions) and `plan-write` (plan submission) pause for the
        // user. `plan-exit` stays non-interrupting so the loop continues as the
        // Coder agent.
        stopWhen: [isStepCount(20), hasToolCall("ask", "plan-write")],
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
      // Persistent mode: every prompt is a fresh context — send only the latest
      // user message and cap the run at 10 agent steps.
      if (!persistent) return base;
      const lastUser = Array.isArray(rest.prompt)
        ? rest.prompt.filter((m) => m.role === "user").at(-1)
        : undefined;
      return {
        ...base,
        prompt: lastUser ? [lastUser] : rest.prompt,
        stopWhen: isStepCount(10),
      };
    },
  });

  const transport = new DirectChatTransport({
    agent,
    options: { sessionMode: isPersistent ? "persistent" : "chat" },
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