import type { SessionManager } from "@agent/sessions/session-manager.ts";
import z from "zod";
export const SpawnToolArgsSchema = z.object({
  subagent: z.string().min(1),
  prompt: z.string().min(1),
});
export const SpawnToolOutputSchema = z.object({
  sessionId: z.string().optional(),
  summary: z.string(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    cost: z.number().optional(),
  }),
});

export type SpawnToolContext = {
  manager: SessionManager;
  parentId: string;
  depth: number;
};
export type SpawnToolResult = z.infer<typeof SpawnToolOutputSchema>;

export const createSpawnTool = (ctx: SpawnToolContext) => ({
  name: "spawn",
  kind: "flow" as const,
  description: [
    "Run/spawn/call a subagent as an isolated sub session and wait for its final report.",
    "Write a self-contained prompt: sub agents cannot ask questions — resolve everything from the prompt and the repository.",
    "Several spawns in one step run in parallel; the step continues once all have settled.",
  ].join(" "),
  parameters: SpawnToolArgsSchema,
  output: SpawnToolOutputSchema,
  handler: async (args: z.infer<typeof SpawnToolArgsSchema>): Promise<SpawnToolResult> => {
    return ctx.manager.spawnSubSession({
      parentId: ctx.parentId,
      subagent: args.subagent,
      prompt: args.prompt,
      depth: ctx.depth,
    });
  },
});
