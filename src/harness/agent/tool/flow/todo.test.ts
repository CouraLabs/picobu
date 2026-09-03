import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { createTodoTool, TodoToolArgsSchema, type TodoItem } from "@harness/agent/tool/flow/todo.ts";

type TodoArgs = z.infer<typeof TodoToolArgsSchema>;

/**
 * Run `fn` with the todo file pointed at a fresh temp path, cleaning up after.
 * bun:test runs each file in its own process, so this cannot leak.
 */
async function withTodoFile(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "picobu-todo-"));
  const todoFilePath = join(dir, "session-todo.json");
  try {
    await fn(todoFilePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const item = (phase: string, title: string, done: boolean): TodoItem => ({
  phase,
  title,
  prompt: `${title} prompt`,
  done,
});

describe("todo flow tool", () => {
  test("ins appends items and writes session-todo.json in full", async () => {
    await withTodoFile(async (path) => {
      const todo = createTodoTool(path);
      const result = await todo.handler({
        actionType: "ins",
        action: { ins: [item("Setup", "scaffold", false), item("Setup", "lint", false)] },
      } satisfies TodoArgs);

      expect(result.items).toEqual([item("Setup", "scaffold", false), item("Setup", "lint", false)]);
      const raw = JSON.parse(await readFile(path, "utf8")) as { items: TodoItem[] };
      expect(raw.items).toEqual([item("Setup", "scaffold", false), item("Setup", "lint", false)]);
    });
  });

  test("each call replaces the file: upd by index, del by index", async () => {
    await withTodoFile(async (path) => {
      const todo = createTodoTool(path);
      await todo.handler({
        actionType: "ins",
        action: { ins: [item("A", "one", false), item("A", "two", false), item("B", "three", false)] },
      } satisfies TodoArgs);

      const updated = await todo.handler({
        actionType: "upd",
        action: { upd: { index: 1, item: item("A", "two!", true) } },
      } satisfies TodoArgs);
      expect(updated.items).toEqual([item("A", "one", false), item("A", "two!", true), item("B", "three", false)]);

      const deleted = await todo.handler({
        actionType: "del",
        action: { del: { index: 0 } },
      } satisfies TodoArgs);
      // Indices shift after a del: the list is the source of truth.
      expect(deleted.items).toEqual([item("A", "two!", true), item("B", "three", false)]);

      const raw = JSON.parse(await readFile(path, "utf8")) as { items: TodoItem[] };
      expect(raw.items).toEqual(deleted.items);
    });
  });

  test("out-of-range indices throw and preserve the stored list", async () => {
    await withTodoFile(async (path) => {
      const todo = createTodoTool(path);
      await todo.handler({
        actionType: "ins",
        action: { ins: [item("A", "one", false)] },
      } satisfies TodoArgs);

      expect(
        todo.handler({ actionType: "del", action: { del: { index: 5 } } } satisfies TodoArgs),
      ).rejects.toThrow("out of range");
      expect(
        todo.handler({
          actionType: "upd",
          action: { upd: { index: 3, item: item("A", "x", false) } },
        } satisfies TodoArgs),
      ).rejects.toThrow("out of range");
      expect(
        todo.handler({ actionType: "ins", action: {} } satisfies TodoArgs),
      ).rejects.toThrow("requires action.ins");

      const raw = JSON.parse(await readFile(path, "utf8")) as { items: TodoItem[] };
      expect(raw.items).toEqual([item("A", "one", false)]);
    });
  });

  test("a fresh session starts with an empty list", async () => {
    await withTodoFile(async (path) => {
      const todo = createTodoTool(path);
      const result = await todo.handler({
        actionType: "ins",
        action: { ins: [item("Phase", "first", true)] },
      } satisfies TodoArgs);
      expect(result.items).toEqual([item("Phase", "first", true)]);
    });
  });
});
