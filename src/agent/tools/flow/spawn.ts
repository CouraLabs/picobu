import type { SessionManager } from '@agent/sessions/session-manager.ts'
import z from 'zod'
export const SpawnToolArgsSchema = z.object({
  subagent: z.string().min(1),
  prompt: z.string().min(1),
})
export const SpawnToolOutputSchema = z.object({
  sessionId: z.string().optional(),
  summary: z.string(),
})

export interface SpawnToolContext {
  manager: SessionManager
  parentId: string
  depth: number
}
export type SpawnToolResult = z.infer<typeof SpawnToolOutputSchema>

export const createSpawnTool = (ctx: SpawnToolContext) => ({
  name: 'spawn',
  kind: 'flow' as const,
  description: 'Run a subagent by exact name with a self-contained prompt and wait for its final report; parallel spawns settle together.',
  parameters: SpawnToolArgsSchema,
  output: SpawnToolOutputSchema,
  handler: async (args: z.infer<typeof SpawnToolArgsSchema>): Promise<SpawnToolResult> => {
    return ctx.manager.spawnSubSession({
      parentId: ctx.parentId,
      subagent: args.subagent,
      prompt: args.prompt,
      depth: ctx.depth,
    })
  },
})
