import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { DirectChatTransport, ToolLoopAgent, hasToolCall, isStepCount, type InferUITools, type LanguageModel, type UIMessage } from "ai";
import { buildToolSet, toolsInfo } from "../../tool/toolset";
import { getAgent } from "../agent/registry";
import { resolveModel, resolveModelRef } from "../provider-resolver";
import { buildRulesSection, buildSkillsSection, generateSystemMessage } from "../../prompts/system";
import { loadAgentsMarkdown } from "../../prompts/agents-md";
import { listRules } from "../../rules";
import { listSkills } from "../../../commands";
import { options, type ProviderModelBilling, type ProviderModelReasoningEffort } from "../../../../libs/options";
import { folderKeyFor, sessionTodoFilePath } from "../../../../libs/sessions";
import { describeError } from "../../../../libs/error-report";

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

/** Token usage attached to assistant-message metadata (AI SDK's usage union). */
export type LoopUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/** Assistant-message metadata carried through the UI stream: per-step usage
 * updates arrive mid-run (`finish-step`); the last step's usage — the current
 * context size — is the final value (see the `messageMetadata` note below). */
export type LoopMessageMetadata = {
  usage?: LoopUsage;
  finishReason?: string;
  /** USD cost derived from the resolved model's `billing` (no SDK cost field). */
  cost?: number;
};

/**
 * USD cost for a usage record, mirroring the status-bar formula: uncached
 * input at the input rate, cached tokens at their own rates, scaled by the
 * provider multiplier. `undefined` when the model has no billing metadata.
 */
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

/**
 * Serialize any loop error for the UI stream. The SDK's default masks errors
 * as "An error occurred." to avoid leaking server details over HTTP; the
 * direct in-process transport has no such boundary, so surface the real
 * message plus technical detail (status code, URL, response body, cause).
 */
const formatStreamError = (error: unknown): string => {
  const report = describeError(error);
  return report.detail ? `${report.message}\n${report.detail}` : report.message;
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

  // System prompts are deterministic per (agent, tool set, cwd): build once so
  // the prompt-cache prefix stays byte-stable and we skip recomputing every
  // turn. The cwd is part of the key so `/cd` rebuilds instead of serving a
  // stale prompt. The agents markdown (AGENTS.md/CLAUDE.md) and the rules
  // catalog are loaded here too — i.e. once per session, not per step.
  const systemCache: Record<string, string> = {};
  const buildSystem = async (agentId: string): Promise<string> => {
    const cacheKey = `${agentId}:${options.app.cwd}`;
    const cached = systemCache[cacheKey];
    if (cached !== undefined) return cached;
    const agent = getAgent(agentId);
    // Skills are only advertised to agents that can actually call the `skill`
    // tool (empty tools list = all tools); otherwise the prompt would name a
    // tool outside the agent's `activeTools`.
    const skills = listSkills();
    const hasSkillTool = agent.tools.length === 0 || agent.tools.includes("skill");
    // Same gating for rules and the `rule` tool.
    const rules = listRules();
    const hasRuleTool = agent.tools.length === 0 || agent.tools.includes("rule");
    const agentsAppendix = await loadAgentsMarkdown(options.app.cwd);
    const built = generateSystemMessage({
      appName: options.app.name,
      cwd: options.app.cwd,
      os: options.app.os,
      shell: options.app.shell,
      agentPrompt: agent.prompt,
      toolsInfo: toolsInfo(toolSet.getTools(agent.tools)),
      ...(skills.length && hasSkillTool ? { skillsInfo: buildSkillsSection(skills) } : {}),
      ...(rules.length && hasRuleTool ? { rulesInfo: buildRulesSection(rules) } : {}),
      ...(agentsAppendix ? { agentsAppendix } : {}),
    }).map((s) => `<${s.key}>${s.content}</${s.key}>`).join("\n");
    systemCache[cacheKey] = built;
    return built;
  };

  const agent = new ToolLoopAgent<LoopCallOptions, any, any, any>({
    model: initialModel(initialConfig.modelKey),
    tools: toolSet.getToolSet(), // full set; activeTools narrows per agent below
    prepareCall: async ({ options, ...rest }) => {
      const persistent = options?.sessionMode === "persistent";
      const config = getConfig();
      const agentDef = getAgent(persistent ? "persistent" : config.agentId);
      const resolved = resolveModel(config.modelKey);
      const base = {
        ...rest,
        model: resolved.model,
        activeTools: agentDef.tools.length ? agentDef.tools : undefined,
        instructions: await buildSystem(persistent ? "persistent" : config.agentId),
        reasoning: config.thinking as AiReasoningEffort,
        // Interactive flow tools interrupt the run once their (stub) result is
        // in: `ask` (questions) and `plan-write` (plan submission) pause for the
        // user. `plan-exit` stays non-interrupting so the loop continues as the
        // Coder agent.
        stopWhen: [isStepCount(100), hasToolCall("ask", "plan-write")],
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
    // Real error details in the stream's `errorText` (reaches the UI through
    // `useChat`'s `onError`) instead of the SDK's default "An error occurred.".
    onError: formatStreamError,
    // Usage metadata flows live: returning a value for any stream part makes
    // the SDK emit a `message-metadata` chunk, so each step's `finish-step`
    // updates tokens/cost in the status bar mid-run (not only at the end).
    // `finish` deliberately reports no usage: the SDK's `totalUsage` sums the
    // usage of every step, and each step re-sends the whole conversation, so
    // summing double-counts the shared prefix. The last `finish-step` usage —
    // which survives the merge because `finish` adds none — is the true
    // current context size the status bar and auto-compaction key on.
    messageMetadata: (opts) => {
      const build = (usage: LoopUsage, extra?: Omit<LoopMessageMetadata, "usage" | "cost">): LoopMessageMetadata => {
        // Billing comes from the live model config (no client construction).
        let billing: ProviderModelBilling | undefined;
        try {
          billing = resolveModelRef(getConfig().modelKey).modelMeta.billing;
        } catch {
          billing = undefined; // unconfigured model — status bar shows tokens only
        }
        return { usage, cost: computeCost(usage, billing), ...extra };
      };
      if (opts.part.type === "finish-step") {
        return build({
          inputTokens: opts.part.usage.inputTokens,
          outputTokens: opts.part.usage.outputTokens,
          cacheReadTokens: opts.part.usage.inputTokenDetails?.cacheReadTokens ?? 0,
          cacheWriteTokens: opts.part.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
        });
      }
      if (opts.part.type === "finish") {
        return { finishReason: opts.part.finishReason };
      }
      return undefined;
    },
  });

  return { agent, transport };
}