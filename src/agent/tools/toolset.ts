import { tool, type Experimental_SandboxSession, type Tool, type ToolSet } from "ai";
import z from "zod";
import { readTool } from "@agent/tools/filesystem/read.ts";
import { createWriteTool } from "@agent/tools/filesystem/write.ts";
import { createEditTool } from "@agent/tools/filesystem/edit.ts";
import { globTool } from "@agent/tools/filesystem/glob.ts";
import { grepTool } from "@agent/tools/filesystem/grep.ts";
import { createShellTool } from "@agent/tools/filesystem/shell.ts";
import { createTodoTool } from "@agent/tools/flow/todo.ts";
import { createAskTool } from "@agent/tools/flow/ask.ts";
import { createSkillTool } from "@agent/tools/flow/skill.ts";
import { createRuleTool } from "@agent/tools/flow/rule.ts";
import { createPlanExitTool } from "@agent/tools/flow/plan-exit.ts";
import { createPlanWriteTool } from "@agent/tools/flow/plan-write.ts";
import { createSpawnTool, type SpawnToolContext } from "@agent/tools/flow/spawn.ts";
import { websearchTool } from "@agent/tools/web/websearch.ts";
import { webfetchTool } from "@agent/tools/web/webfetch.ts";
import { wwpTools } from "@integrations/whatsapp/wwp-tools.ts";

/** Tool families: `filesystem` (file I/O), `flow` (session workflow state), `external` (web), `integration` (WhatsApp ops), and `mcp` (connected MCP servers — namespaced `mcp_<server>_<tool>`, merged per step in the loop). */
export type ToolKind = "filesystem" | "flow" | "external" | "integration" | "mcp";

export type AgentTool = {
  name: string;
  /** Which family the tool belongs to. */
  kind: ToolKind;
  /** AI SDK tool ready for the agent loop. */
  tool: Tool;
  /** LLM-facing usage docs: description + JSON schema, for the system prompt. */
  info: string;
};

/** Execute options forwarded from the AI SDK into tool handlers. */
export type ToolExecuteOptions = {
  abortSignal?: AbortSignal;
  /** The session's sandbox (undefined when the sandbox is disabled). */
  experimental_sandbox?: Experimental_SandboxSession;
};

/** Per-session context a tool set may need (session-scoped flow tools). */
export type ToolSetContext = {
  /** Absolute path of this session's todo file; registers the `todo` flow tool. */
  todoFilePath?: string;
  /**
   * Session id. Registers the session-keyed flow tools. The interactive ones
   * (`ask`, `plan-write`, `plan-exit`) additionally require `interactive` —
   * spawned sub sessions never get them (a pending interactive output would
   * pause the sub run with nobody able to answer).
   */
  sessionId?: string;
  /** Interactive flow tools registered only for main sessions (default true
   * when a `sessionId` is present). Sub sessions set this to false. */
  interactive?: boolean;
  /** Absolute path of this session's checkpoint log (write/edit undo). */
  checkpointsPath?: string;
  /** Wiring for the `spawn` flow tool (session manager + parent id + depth). */
  spawn?: SpawnToolContext;
};

/**
 * Build the tool environment for an agent: `getTools` returns the registered
 * tools — optionally filtered by name (e.g. `['read', 'grep']`) — each carrying
 * an AI SDK `tool` for the agent loop and an LLM-facing `info` string (description
 * + JSON schema) to concatenate into the system prompt. Without a name filter it
 * returns every registered tool. Flow tools are only registered when their
 * session context is available (see `ToolSetContext`).
 */
export function buildToolSet(ctx: ToolSetContext = {}) {
  const allTools: AgentTool[] = [
    wrapTool(readTool),
    wrapTool(createWriteTool(ctx.checkpointsPath)),
    wrapTool(createEditTool(ctx.checkpointsPath)),
    wrapTool(globTool),
    wrapTool(grepTool),
    wrapTool(createShellTool()),
    wrapTool(websearchTool),
    wrapTool(webfetchTool),
    ...wwpTools.map(wrapTool),
    ...(ctx.todoFilePath ? [wrapTool(createTodoTool(ctx.todoFilePath))] : []),
    wrapTool(createSkillTool()),
    wrapTool(createRuleTool()),
    ...(ctx.sessionId
      ? [
          // Interactive flow tools are structurally forbidden for sub sessions.
          ...(ctx.interactive === false
            ? []
            : [wrapTool(createAskTool()), wrapTool(createPlanExitTool()), wrapTool(createPlanWriteTool())]),
        ]
      : []),
    ...(ctx.sessionId && ctx.spawn ? [wrapTool(createSpawnTool(ctx.spawn))] : []),
  ];

  const getTools = (names?: string[]): AgentTool[] =>
    names?.length ? allTools.filter((t) => names.includes(t.name)) : allTools;

  const getToolSet = (names?: string[]): ToolSet => {
    return toToolSet(getTools(names));
  }

  return { getTools, getToolSet };
}

/** Convert agent tools into the AI SDK `ToolSet` used by the agent loop. */
export function toToolSet(tools: AgentTool[]): ToolSet {
  return Object.fromEntries(tools.map((t) => [t.name, t.tool]));
}

/** Render LLM-facing usage docs for a list of tools (for the system prompt). */
export function toolsInfo(tools: AgentTool[]): string {
  return tools.map((t) => t.info).join("\n\n");
}

function wrapTool<TSchema extends z.ZodType, TOutput extends z.ZodType>(def: {
  name: string;
  description: string;
  parameters: TSchema;
  output: TOutput;
  kind?: ToolKind;
  handler: (
    args: z.infer<TSchema>,
    options?: ToolExecuteOptions,
  ) => Promise<z.infer<TOutput>> | AsyncIterable<z.infer<TOutput>> | z.infer<TOutput>;
}): AgentTool {
  return {
    name: def.name,
    kind: def.kind ?? "filesystem",
    tool: tool({
      description: def.description,
      inputSchema: def.parameters,
      outputSchema: def.output,
      // Forward the SDK's execute options (abort signal + sandbox) into the
      // handler so tools can run inside the session's working directory and
      // be cancelled mid-flight.
      execute: (args, executeOptions) =>
        def.handler(args as z.infer<TSchema>, {
          abortSignal: executeOptions?.abortSignal,
          experimental_sandbox: executeOptions?.experimental_sandbox,
        }),
    }),
    info: renderToolInfo(def.name, def.description, def.parameters),
  };
}

function renderToolInfo(
  name: string,
  description: string,
  parameters: z.ZodType,
): string {
  const schema = JSON.stringify(z.toJSONSchema(parameters), null, 2);
  return [
    `### ${name}`,
    description,
    "",
    "JSON Schema:",
    "```json",
    schema,
    "```",
  ].join("\n");
}
