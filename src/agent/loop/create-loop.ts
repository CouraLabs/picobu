import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { DirectChatTransport, ToolLoopAgent, hasToolCall, isStepCount, type InferUITools, type LanguageModel, type UIMessage } from "ai";
import { buildToolSet, toolsInfo } from "@agent/tools/toolset.ts";
import { createLocalSandboxSession } from "@agent/tools/sandbox.ts";
import { getAgent } from "@agent/agents/registry.ts";
import { resolveModel, resolveModelRef } from "@agent/model/resolver.ts";
import { buildRulesSection, buildSkillsSection, buildSubagentsSection, generateSystemMessage } from "@agent/prompts/system.ts";
import { loadAgentsMarkdown } from "@agent/prompts/agents-md.ts";
import { listRules } from "@agent/rules/rules";
import { listSkills } from "@agent/commands/index.ts";
import { listSubagents } from "@agent/agents/subagents.ts";
import { options, type ProviderModelBilling, type ProviderModelReasoningEffort } from "@config/options.ts";
import { folderKeyFor, sessionTodoFilePath } from "@agent/sessions/session.ts";
import { checkpointsPath } from "@agent/sessions/checkpoints.ts";
import type { SpawnToolContext } from "@agent/tools/flow/spawn.ts";
import type { AgentType } from "@agent/agents/types.ts";
import { describeError } from "@shared/error-report.ts";
import { createMcpManager, type McpManager } from "@integrations/mcp/client.ts";
import { renderMcpServerToolsInfo } from "@integrations/mcp/tools-info.ts";

/** The AI SDK's `reasoning` union. The project's `ProviderModelReasoningEffort`
 * adds `"max"` (used by configured providers) but omits `"minimal"` /
 * `"provider-default"`, so reasoning values are cast across that boundary. */
export type AiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "provider-default";

export type LoopConfig = {
  agentId: string;
  modelKey: string;
  thinking: ProviderModelReasoningEffort;
  /** `persistent` runs each prompt as a fresh, tool-less 10-step session. */
  sessionMode?: "chat" | "persistent";
  /** Session id: enables session-scoped flow tools (the `todo` list). */
  sessionId?: string;
  /**
   * Absolute working directory of this session: sandbox root, system-prompt
   * environment, and per-worktree discovery. Owned by the session manager —
   * never `options.app.cwd` (that is a bootstrap default only).
   */
  cwd?: string;
  /** Disable the local sandbox for this session (kill switch: tools fall back
   * to process cwd / direct fs). Applies at session creation. */
  sandbox?: boolean;
  /** Inline agent definition for spawned sub sessions: wins over the registry. */
  agentOverride?: AgentType;
  /** Marks a spawned sub session: interactive flow tools are never registered. */
  subagent?: boolean;
  /** Wiring that lets the `spawn` tool reach the session manager. */
  spawn?: SpawnToolContext;
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

/**
 * A compaction cut: appended to the conversation when it is compacted. The
 * cut's text part (the summary) is what the provider sees; everything before
 * the last cut stays saved but never reaches the LLM again.
 */
export type CompactionMetadata = {
  summary: string;
  /** Audit record of the messages the cut replaces (slicing uses position). */
  compactedMessageIds: string[];
  createdAt: number;
};

/** Assistant-message metadata carried through the UI stream: per-step usage
 * updates arrive mid-run (`finish-step`); the last step's usage — the current
 * context size — is the final value (see the `messageMetadata` note below). */
export type LoopMessageMetadata = {
  usage?: LoopUsage;
  finishReason?: string;
  /** USD cost derived from the resolved model's `billing` (no SDK cost field). */
  cost?: number;
  /** Present on a compaction cut message (role `user`). */
  compaction?: CompactionMetadata;
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

/** Exact per-component split of `computeCost`, from the model's billing rates. */
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

export type Loop = {
  agent: ToolLoopAgent<any, any, any, any>;
  transport: DirectChatTransport<any, any, any, any, LoopMessage>;
  /** MCP clients for this session: tools merge into every step's tool set. */
  mcp: McpManager;
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
  // The session's working directory: owned by the session manager, falling
  // back to the bootstrap default for direct `createSession` callers.
  const cwd = initialConfig.cwd ?? options.app.cwd;
  // Flow tools are session-scoped: the todo list lives in the session folder
  // (`<folder>/<sessionId>/session-todo.json`) and is only registered when the
  // loop knows its session id. Spawned sub sessions never get the interactive
  // flow tools (`ask`/`plan-write`/`plan-exit`) — their pending output would
  // pause the sub run with nobody able to answer.
  const toolSet = buildToolSet({
    todoFilePath: initialConfig.sessionId
      ? sessionTodoFilePath(folderKeyFor(cwd), initialConfig.sessionId)
      : undefined,
    sessionId: initialConfig.sessionId,
    interactive: !initialConfig.subagent,
    checkpointsPath: initialConfig.sessionId
      ? checkpointsPath(folderKeyFor(cwd), initialConfig.sessionId)
      : undefined,
    spawn: initialConfig.spawn,
  });

  // MCP clients connect lazily (first step / first snapshot) and are closed
  // by the session teardown (`Session.close()`).
  const mcp = createMcpManager();

  // LLM-facing docs for MCP tools, gated like skills/rules: only agents that
  // can actually call them (no tool list = all tools, or an explicit
  // `mcp_*` opt-in) see them in the prompt.
  const mcpInfo = async (agentDef: { tools: string[] }): Promise<string> => {
    const hasMcpTools = agentDef.tools.length === 0 || agentDef.tools.some((name) => name.startsWith("mcp_"));
    if (!hasMcpTools) return "";
    const snapshots = await mcp.snapshot();
    return snapshots
      .map((snapshot) =>
        snapshot.connected && snapshot.tools.length
          ? renderMcpServerToolsInfo(
              snapshot.id,
              snapshot.instructions ?? snapshot.serverInstructions,
              snapshot.tools,
            )
          : "",
      )
      .filter(Boolean)
      .join("\n\n");
  };

  // System prompts are deterministic per (agent, tool set, cwd, MCP
  // generation): build once so the prompt-cache prefix stays byte-stable and
  // we skip recomputing every turn. The cwd is part of the key so `/cd`
  // rebuilds instead of serving a stale prompt; the MCP generation bumps
  // whenever servers (re)connect or refresh, invalidating only on a real
  // tool-set change. The agents markdown (AGENTS.md/CLAUDE.md) and the rules
  // catalog are loaded here too — i.e. once per session, not per step.
  const systemCache: Record<string, string> = {};
  const buildSystem = async (agentId: string): Promise<string> => {
    const cacheKey = `${agentId}:${cwd}:${mcp.generation}`;
    const cached = systemCache[cacheKey];
    if (cached !== undefined) return cached;
    const config = getConfig();
    const agent = config.agentOverride ?? getAgent(agentId);
    // Skills are only advertised to agents that can actually call the `skill`
    // tool (empty tools list = all tools); otherwise the prompt would name a
    // tool outside the agent's `activeTools`.
    const skills = listSkills();
    const hasSkillTool = agent.tools.length === 0 || agent.tools.includes("skill");
    // Same gating for rules and the `rule` tool.
    const rules = listRules();
    const hasRuleTool = agent.tools.length === 0 || agent.tools.includes("rule");
    // Same gating for the subagent catalog and the `spawn` tool.
    const subagents = config.spawn ? await listSubagents(cwd) : [];
    const hasSpawnTool = agent.tools.includes("spawn");
    const agentsAppendix = await loadAgentsMarkdown(cwd);
    const mcpDocs = await mcpInfo(agent);
    const built = generateSystemMessage({
      appName: options.app.name,
      cwd,
      os: options.app.os,
      shell: options.app.shell,
      agentPrompt: agent.prompt,
      toolsInfo: [toolsInfo(toolSet.getTools(agent.tools)), mcpDocs].filter(Boolean).join("\n\n"),
      ...(skills.length && hasSkillTool ? { skillsInfo: buildSkillsSection(skills) } : {}),
      ...(rules.length && hasRuleTool ? { rulesInfo: buildRulesSection(rules) } : {}),
      ...(subagents.length && hasSpawnTool ? { subagentsInfo: buildSubagentsSection(subagents, options.harness.maxAgents ?? 4) } : {}),
      ...(agentsAppendix ? { agentsAppendix } : {}),
    }).map((s) => `<${s.key}>${s.content}</${s.key}>`).join("\n");
    systemCache[cacheKey] = built;
    return built;
  };

  const loopAgent = new ToolLoopAgent<LoopCallOptions, any, any, any>({
    model: initialModel(initialConfig.modelKey),
    tools: toolSet.getToolSet(), // full set; activeTools narrows per agent below
    prepareCall: async ({ options, ...rest }) => {
      const persistent = options?.sessionMode === "persistent";
      const config = getConfig();
      const agentDef = config.agentOverride ?? getAgent(persistent ? "persistent" : config.agentId);
      const resolved = resolveModel(config.modelKey);
      // MCP tools join the loop's tool set per step: connected servers merge
      // their (namespaced) tools over the built-ins — a connected server can
      // shadow nothing since names are `mcp_<server>_<tool>` prefixed.
      const mcpTools = await mcp.tools();
      const base = {
        ...rest,
        model: resolved.model,
        tools: { ...toolSet.getToolSet(), ...mcpTools },
        activeTools: agentDef.tools.length ? agentDef.tools : undefined,
        instructions: await buildSystem(persistent ? "persistent" : config.agentId),
        reasoning: config.thinking as any,
        providerOptions: {
          cacheControl: { type: "ephemeral", ttl: "1h" },
        },
        ...(agentDef.temperature !== undefined ? { temperature: agentDef.temperature } : {}),
        ...(agentDef.topP !== undefined ? { topP: agentDef.topP } : {}),
        ...(agentDef.topK !== undefined ? { topK: agentDef.topK } : {}),
      };
      // Chat mode pauses on the blocking flow tools (`ask`/`plan-write`) so
      // their pending output can be answered by the host; sub sessions never
      // get those tools, so nothing may pause their run. Persistent mode
      // behaves the same with a fresh, tool-less context per prompt.
      const blocking: string[] = config.subagent ? [] : ["ask", "plan-write"];
      const stopWhen = blocking.length
        ? [isStepCount(100), hasToolCall(...blocking)]
        : [isStepCount(100)];
      // Persistent mode: every prompt is a fresh context — send only the latest
      // user message and cap the run at 10 agent steps.
      if (!persistent) return { ...base, stopWhen };
      const lastUser = Array.isArray(rest.prompt)
        ? rest.prompt.filter((m) => m.role === "user").at(-1)
        : undefined;
      return {
        ...base,
        prompt: lastUser ? [lastUser] : rest.prompt,
        stopWhen: [isStepCount(100), hasToolCall("ask", "plan-write")],
      };
    },
  });

  // Sandbox injection happens at the call level: `ToolLoopAgent.generate` /
  // `.stream` destructure `experimental_sandbox` from their arguments and
  // re-spread it AFTER the prepared call, so a settings-level value would be
  // clobbered — and `DirectChatTransport` never passes one. The wrapper makes
  // every transport-driven call carry the session's sandbox.
  const sandboxSession = initialConfig.sandbox === false
    ? undefined
    : createLocalSandboxSession(cwd, options.app.shell);
  const agent = sandboxSession
    ? ({
        get id() {
          return loopAgent.id;
        },
        get tools() {
          return loopAgent.tools;
        },
        stream: (callOptions: any) => loopAgent.stream({ ...callOptions, experimental_sandbox: sandboxSession }),
        generate: (callOptions: any) => loopAgent.generate({ ...callOptions, experimental_sandbox: sandboxSession }),
      } as ToolLoopAgent<any, any, any, any>)
    : loopAgent;

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

  return { agent, transport, mcp };
}