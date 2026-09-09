import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTodoTool, type TodoItem } from "./todo.ts";

const item = (title: string, done = false): TodoItem => ({
  phase: "test",
  title,
  prompt: `prompt for ${title}`,
  done,
});

describe("createTodoTool", () => {
  let dir: string;
  let todoPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "picobu-todo-test-"));
    todoPath = join(dir, "todos.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterAll(() => {
    rm(join(tmpdir(), "picobu-todo-test-"), { recursive: true, force: true });
  });

  const tool = () => createTodoTool(todoPath);

  test("ins appends items and persists them", async () => {
    const result = await tool().handler({
      actionType: "ins",
      action: { ins: [item("a"), item("b")] },
    });
    expect(result.items).toHaveLength(2);
    expect(result.message).toBe("2 todo item(s) added");
    const onDisk = JSON.parse(await readFile(todoPath, "utf8"));
    expect(onDisk.items).toEqual(result.items);
  });

  test("upd replaces the item at the given index and shifts nothing", async () => {
    await tool().handler({ actionType: "ins", action: { ins: [item("a"), item("b")] } });
    const result = await tool().handler({
      actionType: "upd",
      action: { upd: { index: 1, item: item("b2", true) } },
    });
    expect(result.items[0]!.title).toBe("a");
    expect(result.items[1]!.title).toBe("b2");
    expect(result.items[1]!.done).toBe(true);
    expect(result.message).toBe("todo #1 updated");
  });

  test("del removes the item at the given index and shifts subsequent indices", async () => {
    await tool().handler({
      actionType: "ins",
      action: { ins: [item("a"), item("b"), item("c")] },
    });
    const result = await tool().handler({ actionType: "del", action: { del: { index: 1 } } });
    expect(result.items.map((it) => it.title)).toEqual(["a", "c"]);
    expect(result.message).toBe("todo #1 removed");
  });

  test("ins onto an empty file-less state creates the list", async () => {
    const result = await tool().handler({ actionType: "ins", action: { ins: [item("first")] } });
    expect(result.items).toHaveLength(1);
  });

  test("ins with an empty list is rejected", async () => {
    await expect(
      tool().handler({ actionType: "ins", action: { ins: [] } }),
    ).rejects.toThrow("todo 'ins' requires action.ins to list at least one item");
  });

  test("upd index out of range is rejected and leaves the file untouched", async () => {
    await tool().handler({ actionType: "ins", action: { ins: [item("a")] } });
    const before = await readFile(todoPath, "utf8");
    await expect(
      tool().handler({ actionType: "upd", action: { upd: { index: 5, item: item("x") } } }),
    ).rejects.toThrow("todo index 5 out of range (1 item(s))");
    expect(await readFile(todoPath, "utf8")).toBe(before);
  });

  test("del index out of range is rejected", async () => {
    await tool().handler({ actionType: "ins", action: { ins: [item("a")] } });
    await expect(
      tool().handler({ actionType: "del", action: { del: { index: 1 } } }),
    ).rejects.toThrow("todo index 1 out of range (1 item(s))");
  });

  test("missing action payloads are rejected", async () => {
    await expect(tool().handler({ actionType: "upd", action: {} })).rejects.toThrow(
      "todo 'upd' requires action.upd { index, item }",
    );
    await expect(tool().handler({ actionType: "del", action: {} })).rejects.toThrow(
      "todo 'del' requires action.del { index }",
    );
  });

  test("a corrupt todo file is reported instead of silently reset", async () => {
    await writeFile(todoPath, "not json");
    await expect(
      tool().handler({ actionType: "ins", action: { ins: [item("a")] } }),
    ).rejects.toThrow(`Corrupt todo file at ${todoPath}`);
  });

  test("args schema rejects unknown action types and non-integer indices", () => {
    expect(
      tool().parameters.safeParse({ actionType: "merge", action: {} }).success,
    ).toBe(false);
    expect(
      tool().parameters.safeParse({
        actionType: "del",
        action: { del: { index: 1.5 } },
      }).success,
    ).toBe(false);
  });

  test("concurrent handlers do not lose writes", async () => {
    const t = tool();
    await Promise.all([
      t.handler({ actionType: "ins", action: { ins: [item("a")] } }),
      t.handler({ actionType: "ins", action: { ins: [item("b")] } }),
      t.handler({ actionType: "ins", action: { ins: [item("c")] } }),
    ]);
    const result = await t.handler({ actionType: "del", action: { del: { index: 0 } } });
    expect(result.items).toHaveLength(2);
  });
});
