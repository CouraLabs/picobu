import { createEditTool } from "@agent/tools/filesystem/edit.ts";
import { globTool } from "@agent/tools/filesystem/glob.ts";
import { grepTool } from "@agent/tools/filesystem/grep.ts";
import { readTool } from "@agent/tools/filesystem/read.ts";
import { createShellTool } from "@agent/tools/filesystem/shell.ts";
import { createWriteTool } from "@agent/tools/filesystem/write.ts";
import { createAskTool } from "@agent/tools/flow/ask.ts";
import { createPlanExitTool } from "@agent/tools/flow/plan-exit.ts";
import { createPlanWriteTool } from "@agent/tools/flow/plan-write.ts";
import { createRuleTool } from "@agent/tools/flow/rule.ts";
import { createSkillTool } from "@agent/tools/flow/skill.ts";
import { createSpawnTool, type SpawnToolContext } from "@agent/tools/flow/spawn.ts";
import { createTodoTool } from "@agent/tools/flow/todo.ts";
import { webfetchTool } from "@agent/tools/web/webfetch.ts";
import { websearchTool } from "@agent/tools/web/websearch.ts";
import { wwpTools } from "@integrations/whatsapp/wwp-tools.ts";
import { type Experimental_SandboxSession, type Tool, type ToolSet, tool } from "ai";
import z from "zod";

export type ToolKind = "filesystem" | "flow" | "external" | "integration" | "mcp";
export type AgentTool = {
  name: string;
  kind: ToolKind;
  tool: Tool;
  info: string;
};

export type ToolExecuteOptions = {
  abortSignal?: AbortSignal;
  experimental_sandbox?: Experimental_SandboxSession;
};

export type ToolSetContext = {
  todoFilePath?: string;
  sessionId?: string;
  interactive?: boolean;
  checkpointsPath?: string;
  spawn?: SpawnToolContext;
};

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
    ...(ctx.sessionId ? [...(ctx.interactive === false ? [] : [wrapTool(createAskTool()), wrapTool(createPlanExitTool()), wrapTool(createPlanWriteTool())])] : []),
    ...(ctx.sessionId && ctx.spawn ? [wrapTool(createSpawnTool(ctx.spawn))] : []),
  ];
  const getTools = (names?: string[]): AgentTool[] => (names?.length ? allTools.filter((t) => names.includes(t.name)) : allTools);
  const getToolSet = (names?: string[]): ToolSet => {
    return toToolSet(getTools(names));
  };
  return { getTools, getToolSet };
}

export function toToolSet(tools: AgentTool[]): ToolSet {
  return Object.fromEntries(tools.map((t) => [t.name, t.tool]));
}

export function toolsInfo(tools: AgentTool[]): string {
  return tools.map((t) => t.info).join("\n\n");
}
function wrapTool<TSchema extends z.ZodType, TOutput extends z.ZodType>(def: {
  name: string;
  description: string;
  parameters: TSchema;
  output: TOutput;
  kind?: ToolKind;
  handler: (args: z.infer<TSchema>, options?: ToolExecuteOptions) => Promise<z.infer<TOutput>> | AsyncIterable<z.infer<TOutput>> | z.infer<TOutput>;
}): AgentTool {
  return {
    name: def.name,
    kind: def.kind ?? "filesystem",
    tool: tool({
      description: def.description,
      inputSchema: def.parameters,
      outputSchema: def.output,

      execute: (args, executeOptions) =>
        def.handler(args as z.infer<TSchema>, {
          abortSignal: executeOptions?.abortSignal,
          experimental_sandbox: executeOptions?.experimental_sandbox,
        }),
    }),
    info: renderToolInfo(def.name, def.description, def.parameters),
  };
}
function renderToolInfo(name: string, description: string, parameters: z.ZodType): string {
  const schema = JSON.stringify(z.toJSONSchema(parameters), null, 2);
  return [`### ${name}`, description, "", "JSON Schema:", "```json", schema, "```"].join("\n");
}
