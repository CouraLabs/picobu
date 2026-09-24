import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withLock } from '@shared/lock.ts'
import z from 'zod'

export const TodoPrioritySchema = z.enum(['high', 'medium', 'low'])
export type TodoPriority = z.infer<typeof TodoPrioritySchema>
export const TodoItemSchema = z.object({
  phase: z.string().describe('Grouping label shown as a header above the item (e.g. "verify", "tests")'),
  title: z.string().describe('Short imperative summary of the step, shown in the UI'),
  prompt: z.string().describe('One-line instruction describing exactly what to do in this step'),
  done: z.boolean().describe('true when this step is finished, false otherwise — required'),
  priority: TodoPrioritySchema.optional().describe('high, medium, or low (default medium)'),
})
export type TodoItem = z.infer<typeof TodoItemSchema>
const storedItemSchema = z.object({
  phase: z.string(),
  title: z.string(),
  prompt: z.string(),
  done: z.boolean().optional(),
  priority: TodoPrioritySchema.optional(),
})
const todoFileSchema = z.object({ items: z.array(storedItemSchema) })
export const TodoToolArgsSchema = z.object({
  items: z
    .array(TodoItemSchema)
    .describe(
      'The complete desired todo list, replacing the previous one in full: include every step (open and done), adding, updating, or removing steps just by rewriting the list. Pass [] to clear the list.',
    ),
})
export const TodoToolOutputSchema = z.object({
  message: z.string(),
  done: z.number(),
  total: z.number(),
})

export const normalizeTodoItem = (item: {
  phase: string
  title: string
  prompt: string
  done?: boolean
  priority?: TodoPriority
}): { phase: string; title: string; prompt: string; done: boolean; priority: TodoPriority } => ({
  phase: item.phase,
  title: item.title,
  prompt: item.prompt,
  done: item.done ?? false,
  priority: item.priority ?? 'medium',
})

const todoKey = (item: { phase: string; title: string }): string => `${item.phase}\0${item.title}`

export const buildTodoMessage = (
  prev: Array<{ phase: string; title: string; done: boolean }>,
  next: Array<{ phase: string; title: string; done: boolean }>,
): { message: string; done: number; total: number } => {
  const done = next.filter((it) => it.done).length
  const total = next.length
  if (total === 0) return { message: 'todo list cleared', done, total }
  if (prev.length === 0) return { message: `Created ${total} todo${total === 1 ? '' : 's'}`, done, total }
  const prevByKey = new Map(prev.map((it) => [todoKey(it), it]))
  const nextByKey = new Map(next.map((it) => [todoKey(it), it]))
  let added = 0
  let removed = 0
  let completed = 0
  let reopened = 0
  for (const key of nextByKey.keys()) {
    const before = prevByKey.get(key)
    const after = nextByKey.get(key)
    if (!before) added++
    else if (after?.done && !before.done) completed++
    else if (after && !after.done && before.done) reopened++
  }
  for (const key of prevByKey.keys()) {
    if (!nextByKey.has(key)) removed++
  }
  if (added === 0 && removed === 0 && reopened === 0 && completed === 1) return { message: `Completed todo ${done} of ${total}`, done, total }
  const parts: Array<string> = []
  if (added > 0) parts.push(`Added ${added} todo${added === 1 ? '' : 's'}`)
  if (completed > 0) parts.push(`Completed ${completed} todo${completed === 1 ? '' : 's'}`)
  if (reopened > 0) parts.push(`Reopened ${reopened} todo${reopened === 1 ? '' : 's'}`)
  if (removed > 0) parts.push(`Removed ${removed} todo${removed === 1 ? '' : 's'}`)
  if (parts.length === 0) return { message: `${done} of ${total} done`, done, total }
  return { message: `${parts.join(' · ')} (${done} of ${total} done)`, done, total }
}

export const createTodoTool = (todoFilePath: string) => ({
  name: 'todo',
  kind: 'flow' as const,
  description:
    'Write the session todo list. Pass the complete desired list in items — it replaces the previous list in full: add steps, mark steps done, or remove steps just by rewriting the list (include unfinished and finished steps alike). Each item takes phase, title, prompt, and done (a required boolean: true when the step is finished, false otherwise), plus optional priority (high/medium/low). Work through the items one by one: execute the next open item fully, then rewrite the list with done true for it before starting the next — never mark an item done before its work is finished, and never leave the list stale between items.',
  parameters: TodoToolArgsSchema,
  output: TodoToolOutputSchema,
  handler: async (args: z.infer<typeof TodoToolArgsSchema>): Promise<z.infer<typeof TodoToolOutputSchema>> =>
    withLock(todoFilePath, async () => {
      const file = Bun.file(todoFilePath)
      let prev: Array<{ phase: string; title: string; prompt: string; done: boolean; priority: TodoPriority }> = []
      if (await file.exists()) {
        let raw: unknown
        try {
          raw = await file.json()
        } catch {
          throw new Error(`Corrupt todo file at ${todoFilePath}: not valid JSON`)
        }
        const parsed = todoFileSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error(`Corrupt todo file at ${todoFilePath}: ${parsed.error.message}`)
        }
        prev = parsed.data.items.map((it) => normalizeTodoItem(it))
      }
      const items = args.items.map((it) => normalizeTodoItem(it))
      const result = buildTodoMessage(prev, items)
      await mkdir(dirname(todoFilePath), { recursive: true })
      await Bun.write(todoFilePath, `${JSON.stringify({ items }, null, 2)}\n`)
      return result
    }),
})
