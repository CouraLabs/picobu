import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { DirectChatTransport, ToolLoopAgent, isStepCount, type InferUITools, type LanguageModel, type UIMessage } from "ai";
import { buildToolSet, toolsInfo } from "@agent/tools/toolset.ts";
import { createLocalSandboxSession } from "@agent/tools/sandbox.ts";
import { getAgent } from "@agent/agents/registry.ts";
import { resolveModel, resolveModelRef } from "@agent/model/resolver.ts";
import { buildRulesSection, buildSkillsSection, buildSubagentsSection, generateSystemMessage } from "@agent/prompts/system.ts";
import { loadAgentsMarkdown } from "@agent/prompts/agents-md.ts";
import { listRules } from "@agent/rules/rules.ts";
import { listSkills } from "@agent/commands/index.ts";
import { listSubagents } from "@agent/agents/subagents.ts";
import { options, type ProviderModelBilling, type ProviderModelReasoningEffort } from "@config/options.ts";
import { computeCost, type LoopUsage } from "@agent/model/cost.ts";
import { folderKeyFor, sessionTodoFilePath } from "@agent/sessions/session-paths.ts";
import { checkpointsPath } from "@agent/sessions/checkpoints.ts";
import type { SpawnToolContext } from "@agent/tools/flow/spawn.ts";
import type { AgentType } from "@agent/agents/types.ts";
import { describeError } from "@shared/error-report.ts";
import { createMcpManager, type McpManager } from "@integrations/mcp/client.ts";
import { renderMcpServerToolsInfo } from "@integrations/mcp/tools-info.ts";


export type AiReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "provider-default";
export type LoopConfig = {
  agentId: string;
  modelKey: string;
  thinking: ProviderModelReasoningEffort;
  sessionMode?: "chat" | "persistent";
  sessionId?: string;
  cwd?: string;
  sandbox?: boolean;
  agentOverride?: AgentType;
  subagent?: boolean;
  spawn?: SpawnToolContext;
};


type LoopCallOptions = { sessionMode?: "chat" | "persistent" };


export type LoopMessage = UIMessage<unknown, never, InferUITools<any>>;


export type LoopMessageMetadata = {
  usage?: LoopUsage;
  finishReason?: string;
  cost?: number;
  compaction?: CompactionMetadata;
};


export type CompactionMetadata = {
  summary: string;
  compactedMessageIds: string[];
  createdAt: number;
  kind?: "compact" | "plan-handoff";
};
export type Loop = {
  agent: ToolLoopAgent<any, any, any, any>;
  transport: DirectChatTransport<any, any, any, any, LoopMessage>;
  mcp: McpManager;
};


// Like `hasToolCall` from "ai", but ignores invalid tool calls. The AI SDK marks
// tool calls with schema-invalid input as `invalid` and feeds a tool-error back to
// the model so it can retry — stopping on those would kill the run before the
// model ever sees the error (observed with malformed `ask` calls).
const hasValidToolCall = (...toolNames: string[]) =>
  ({ steps }: { steps: Array<{ toolCalls?: Array<{ toolName: string; invalid?: boolean }> }> }) => {
    const lastStep = steps.at(-1);
    return lastStep?.toolCalls?.some(
      (toolCall) => toolNames.includes(toolCall.toolName) && !toolCall.invalid,
    ) ?? false;
  };


const initialModel = (modelKey: string): LanguageModel => {
  try {
    return resolveModel(modelKey).model;
  } catch (error) {
    console.error("picobu: initial model resolution failed:", error);
    return createOpenAICompatible({ name: "unconfigured", apiKey: "pending", baseURL: "https://api.openai.com/v1" })("no-model");
  }
};


const formatStreamError = (error: unknown): string => {
  const report = describeError(error);
  return report.detail ? `${report.message}\n${report.detail}` : report.message;
};
export function createLoop(getConfig: () => LoopConfig): Loop {
  const initialConfig = getConfig();
  const isPersistent = initialConfig.sessionMode === "persistent";
  
  
  const cwd = initialConfig.cwd ?? options.app.cwd;
  
  
  
  
  
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

  
  
  const mcp = createMcpManager();

  
  
  
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

  
  
  
  
  
  
  
  const systemCache: Record<string, string> = {};
  const buildSystem = async (agentId: string): Promise<string> => {
    const cacheKey = `${agentId}:${cwd}:${mcp.generation}`;
    const cached = systemCache[cacheKey];
    if (cached !== undefined) return cached;
    const config = getConfig();
    const agent = config.agentOverride ?? getAgent(agentId);
    
    
    
    const skills = listSkills();
    const hasSkillTool = agent.tools.length === 0 || agent.tools.includes("skill");
    const rules = listRules();
    const hasRuleTool = agent.tools.length === 0 || agent.tools.includes("rule");
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
    tools: toolSet.getToolSet(),
    prepareCall: async ({ options, ...rest }) => {
      const persistent = options?.sessionMode === "persistent";
      const config = getConfig();
      const agentDef = config.agentOverride ?? getAgent(persistent ? "persistent" : config.agentId);
      const resolved = resolveModel(config.modelKey);
      
      
      
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
      
      
      
      
      const blocking: string[] = config.subagent ? [] : ["ask", "plan-write", "plan-exit"];
      const stopWhen = blocking.length
        ? [isStepCount(100), hasValidToolCall(...blocking)]
        : [isStepCount(100)];
      
      
      if (!persistent) return { ...base, stopWhen };
      const allMessages = Array.isArray(rest.prompt) ? rest.prompt : [];
      const persistentIndex = allMessages.map((m) => m.role).lastIndexOf("user");
      return {
        ...base,
        prompt: persistentIndex >= 0 ? allMessages.slice(persistentIndex) : rest.prompt,
        stopWhen: [isStepCount(100), hasValidToolCall("ask", "plan-write", "plan-exit")],
      };
    },
  });

  
  
  
  
  
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
  const addUsage = (a: LoopUsage | undefined, b: LoopUsage): LoopUsage => ({
    inputTokens: (a?.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b.outputTokens ?? 0),
    cacheReadTokens: (a?.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: (a?.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
  });
  // messageMetadata is invoked once per stream part with a fresh scope, so the
  // running total must live here to accumulate across a run's finish-step parts.
  let runUsage: LoopUsage | undefined;
  const transport = new DirectChatTransport({
    agent,
    options: { sessionMode: isPersistent ? "persistent" : "chat" },
    sendFinish: true,
    sendReasoning: true,
    sendSources: true,
    sendStart: true,
    
    
    onError: formatStreamError,
    
    
    
    
    
    
    
    
    messageMetadata: (opts) => {
      const build = (usage: LoopUsage, extra?: Omit<LoopMessageMetadata, "usage" | "cost">): LoopMessageMetadata => {
        let billing: ProviderModelBilling | undefined;
        try {
          billing = resolveModelRef(getConfig().modelKey).modelMeta.billing;
        } catch {
          billing = undefined; 
        }
        return { usage, cost: computeCost(usage, billing), ...extra };
      };
      if (opts.part.type === "start") {
        runUsage = undefined;
        return undefined;
      }
      if (opts.part.type === "finish-step") {
        const stepUsage: LoopUsage = {
          inputTokens: opts.part.usage.inputTokens,
          outputTokens: opts.part.usage.outputTokens,
          cacheReadTokens: opts.part.usage.inputTokenDetails?.cacheReadTokens ?? 0,
          cacheWriteTokens: opts.part.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
        };
        runUsage = addUsage(runUsage, stepUsage);
        return build(runUsage);
      }
      if (opts.part.type === "finish") {
        const total = opts.part.totalUsage;
        return {
          ...build({
            inputTokens: total.inputTokens,
            outputTokens: total.outputTokens,
            cacheReadTokens: total.inputTokenDetails?.cacheReadTokens ?? 0,
            cacheWriteTokens: total.inputTokenDetails?.cacheWriteTokens ?? 0,
          }),
          finishReason: opts.part.finishReason,
        };
      }
      return undefined;
    },
  });
  return { agent, transport, mcp };
}