import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withLock } from '@shared/lock.ts'
import z from 'zod'
export const TodoItemSchema = z.object({
  phase: z.string().describe('Grouping label shown as a header above the item (e.g. "verify", "tests")'),
  title: z.string().describe('Short imperative summary of the step, shown in the UI'),
  prompt: z.string().describe('One-line instruction describing exactly what to do in this step'),
  done: z.boolean().default(false).describe('true = step completed, false = step still open'),
})
export type TodoItem = z.infer<typeof TodoItemSchema>
const todoFileSchema = z.object({ items: z.array(TodoItemSchema) })
export const TodoToolArgsSchema = z.object({
  items: z
    .array(TodoItemSchema)
    .describe(
      'The complete desired todo list, replacing the previous one in full: include every step (open and done), adding, updating, or removing steps just by rewriting the list. Pass [] to clear the list.',
    ),
})
export const TodoToolOutputSchema = z.object({
  items: z.array(TodoItemSchema),
  message: z.string(),
})

export const createTodoTool = (todoFilePath: string) => ({
  name: 'todo',
  kind: 'flow' as const,
  description:
    'Write the session todo list. Pass the complete desired list in items — it replaces the previous list in full: add steps, mark steps done, or remove steps just by rewriting the list (include unfinished and finished steps alike). Pass an empty array to clear the list. Work through the items one by one: execute the next open item fully, then rewrite the list marking it done before starting the next — never mark an item done before its work is finished, and never leave the list stale between items.',
  parameters: TodoToolArgsSchema,
  output: TodoToolOutputSchema,
  handler: async (args: z.infer<typeof TodoToolArgsSchema>): Promise<z.infer<typeof TodoToolOutputSchema>> =>
    withLock(todoFilePath, async () => {
      const file = Bun.file(todoFilePath)
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
      }
      const items: Array<TodoItem> = args.items.map((it) => ({ phase: it.phase, title: it.title, prompt: it.prompt, done: it.done ?? false }))
      const doneCount = items.filter((it) => it.done).length
      const message = items.length === 0 ? 'todo list cleared' : `${doneCount} of ${items.length} done`
      await mkdir(dirname(todoFilePath), { recursive: true })
      await Bun.write(todoFilePath, `${JSON.stringify({ items }, null, 2)}\n`)
      return { items, message }
    }),
})
