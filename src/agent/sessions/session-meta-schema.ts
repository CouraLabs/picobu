import { z } from 'zod'

export type SessionState = 'waiting' | 'finished' | 'error' | 'running'

export const metaSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  state: z.enum(['waiting', 'finished', 'error', 'running']),
  parentSessionId: z.string().optional(),
  cwd: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  modelKey: z.string().optional(),
})

export type SessionMeta = z.infer<typeof metaSchema>
