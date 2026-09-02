import { tool, type Tool, type ToolSet } from "ai";
import z from "zod";
import { readTool } from "./filesystem/read/read";
import { writeTool } from "./filesystem/write/write";
import { editTool } from "./filesystem/edit/edit";
import { globTool } from "./filesystem/glob/glob";
import { grepTool } from "./filesystem/grep/grep";
import { createBashTool } from "./filesystem/bash/bash";
import { createTodoTool } from "./flow/todo/todo";
import { createAskTool } from "./flow/ask/ask";
import { createPlanExitTool } from "./flow/plan-exit/plan-exit";
import { createPlanWriteTool } from "./flow/plan-write/plan-write";
import { websearchTool } from "./external/websearch/websearch";
import { webfetchTool } from "./external/webfetch/webfetch";
import { wwpTools } from "./integration/wwp";
import { options } from "../../../libs/options";

/** Tool families: `filesystem` (file I/O), `flow` (session workflow state), `external` (web), and `integration` (WhatsApp ops). */
export type ToolKind = "filesystem" | "flow" | "external" | "integration";

export type AgentTool = {
  name: string;
  /** Which family the tool belongs to. */
  kind: ToolKind;
  /** AI SDK tool ready for the agent loop. */
  tool: Tool;
  /** LLM-facing usage docs: description + JSON schema, for the system prompt. */
  info: string;
};

/** Per-session context a tool set may need (session-scoped flow tools). */
export type ToolSetContext = {
  /** Absolute path of this session's todo file; registers the `todo` flow tool. */
  todoFilePath?: string;
  /**
   * Session id. Registers the interactive flow tools (`ask`, `plan-exit`,
   * `plan-write`), which key their interaction state by session.
   */
  sessionId?: string;
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
    wrapTool(writeTool),
    wrapTool(editTool),
    wrapTool(globTool),
    wrapTool(grepTool),
    wrapTool(createBashTool(options.app.shell)),
    wrapTool(websearchTool),
    wrapTool(webfetchTool),
    ...wwpTools.map(wrapTool),
    ...(ctx.todoFilePath ? [wrapTool(createTodoTool(ctx.todoFilePath))] : []),
    ...(ctx.sessionId
      ? [
          wrapTool(createAskTool()),
          wrapTool(createPlanExitTool(ctx.sessionId)),
          wrapTool(createPlanWriteTool()),
        ]
      : []),
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
  ) => Promise<z.infer<TOutput>> | AsyncIterable<z.infer<TOutput>> | z.infer<TOutput>;
}): AgentTool {
  return {
    name: def.name,
    kind: def.kind ?? "filesystem",
    tool: tool({
      description: def.description,
      inputSchema: def.parameters,
      outputSchema: def.output,
      execute: (args) => def.handler(args as z.infer<TSchema>),
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