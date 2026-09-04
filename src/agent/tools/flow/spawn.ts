import z from "zod";
import type { SessionManager } from "@agent/sessions/session-manager.ts";

export const SpawnToolArgsSchema = z.object({
  subagent: z.string().min(1),
  prompt: z.string().min(1),
});

export const SpawnToolOutputSchema = z.object({
  summary: z.string(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    cost: z.number().optional(),
  }),
});

/** Wiring the spawn tool needs to reach its session manager. */
export type SpawnToolContext = {
  manager: SessionManager;
  /** Id of the session this tool runs in. */
  parentId: string;
  /** Nesting depth of the calling session (a root session is depth 0). */
  depth: number;
};

export type SpawnToolResult = z.infer<typeof SpawnToolOutputSchema>;

/**
 * Spawn a sub session from a subagent definition and wait for it to finish.
 * The tool is deliberately **blocking** (no `defer`, no `isTerminal`): a step
 * containing spawn calls waits until every one of them returns, errors, or is
 * aborted before the loop advances — spawn results are inputs to the rest of
 * the step, never background work. Failures surface as tool-error outputs
 * (thrown `Error`s are rendered as `output-error` parts by the SDK), never as
 * uncaught loop errors.
 */
export const createSpawnTool = (ctx: SpawnToolContext) => ({
  name: "spawn",
  kind: "flow" as const,
  description: [
    "Run a subagent as an isolated sub session and wait for its final report.",
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
