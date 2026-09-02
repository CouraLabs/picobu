import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import z from "zod";
import { withLock } from "../../../../libs/lock";

export const TodoItemSchema = z.object({
  phase: z.string(),
  title: z.string(),
  prompt: z.string(),
  done: z.boolean(),
});

export type TodoItem = z.infer<typeof TodoItemSchema>;

const todoFileSchema = z.object({ items: z.array(TodoItemSchema) });

export const TodoToolArgsSchema = z.object({
  actionType: z.enum(["ins", "upd", "del"]),
  action: z.object({
    del: z.object({ index: z.number().int().min(0) }).optional(),
    ins: z.array(TodoItemSchema).optional(),
    upd: z.object({
      index: z.number().int().min(0),
      item: TodoItemSchema,
    }).optional(),
  }),
});

export const TodoToolOutputSchema = z.object({
  items: z.array(TodoItemSchema),
  message: z.string(),
});

/**
 * Session todo list tool (flow tool family). One list per session, persisted
 * at `<sessionDir>/<sessionId>/session-todo.json`; every call rewrites the
 * file in full. `ins` appends items, `upd` replaces the item at `index`,
 * `del` removes the item at `index`; the full updated list (0-based indices,
 * shifting after `del`) is written back and returned on every call.
 */
export const createTodoTool = (todoFilePath: string) => ({
  name: "todo",
  kind: "flow" as const,
  description: [
    "Maintain the session todo list (one list per session, persisted until finalized).",
    "actionType 'ins' appends the items in action.ins; 'upd' replaces the item at action.upd.index",
    "with action.upd.item; 'del' removes the item at action.del.index. Indices are 0-based and",
    "shift after a del. The full updated list is written back and returned on every call.",
  ].join(" "),
  parameters: TodoToolArgsSchema,
  output: TodoToolOutputSchema,
  handler: async (
    args: z.infer<typeof TodoToolArgsSchema>,
  ): Promise<z.infer<typeof TodoToolOutputSchema>> =>
    withLock(todoFilePath, async () => {
      let items: TodoItem[] = [];
      const file = Bun.file(todoFilePath);
      if (await file.exists()) {
        const parsed = todoFileSchema.safeParse(await file.json());
        if (!parsed.success) {
          throw new Error(`Corrupt todo file at ${todoFilePath}: ${parsed.error.message}`);
        }
        items = parsed.data.items;
      }

      const { actionType, action } = args;
      let message: string;
      if (actionType === "ins") {
        const added = action.ins ?? [];
        if (!added.length) throw new Error("todo 'ins' requires action.ins to list at least one item");
        items = [...items, ...added];
        message = `${added.length} todo item(s) added`;
      } else if (actionType === "upd") {
        const upd = action.upd;
        if (!upd) throw new Error("todo 'upd' requires action.upd { index, item }");
        if (upd.index >= items.length) {
          throw new Error(`todo index ${upd.index} out of range (${items.length} item(s))`);
        }
        items = items.map((it, i) => (i === upd.index ? upd.item : it));
        message = `todo #${upd.index} updated`;
      } else {
        const del = action.del;
        if (!del) throw new Error("todo 'del' requires action.del { index }");
        if (del.index >= items.length) {
          throw new Error(`todo index ${del.index} out of range (${items.length} item(s))`);
        }
        items = items.filter((_, i) => i !== del.index);
        message = `todo #${del.index} removed`;
      }

      await mkdir(dirname(todoFilePath), { recursive: true });
      await Bun.write(todoFilePath, `${JSON.stringify({ items }, null, 2)}\n`);
      return { items, message };
    }),
});
