import { SUBAGENT_DEPTH_CAP } from '@agent/agents/subagents.ts'
import type { SessionManager } from '@agent/sessions/session-manager.ts'
import z from 'zod'
export const SpawnToolArgsSchema = z.object({
  subagent: z.string().min(1),
  prompt: z.string().min(1),
  description: z.string().min(1).max(80).optional().describe('Short (3-5 word) description of the task, shown in progress UI.'),
  taskId: z.string().optional().describe('Resume a previous task by passing its prior sessionId; continues the topic in a fresh session instead of starting a new one.'),
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
  description:
    'Run a subagent by exact name with a self-contained prompt and wait for its final report; parallel spawns settle together. Pass description (3-5 words) for progress UI and taskId to continue a previous task.',
  parameters: SpawnToolArgsSchema,
  output: SpawnToolOutputSchema,
  handler: async (args: z.infer<typeof SpawnToolArgsSchema>): Promise<SpawnToolResult> => {
    if (ctx.depth >= SUBAGENT_DEPTH_CAP) {
      throw new Error(`Subagent depth limit reached (${SUBAGENT_DEPTH_CAP}). Report your findings instead of spawning deeper.`)
    }
    return ctx.manager.spawnSubSession({
      parentId: ctx.parentId,
      subagent: args.subagent,
      prompt: args.prompt,
      depth: ctx.depth,
      ...(args.description ? { description: args.description } : {}),
      ...(args.taskId ? { taskId: args.taskId } : {}),
    })
  },
})
