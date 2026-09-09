import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLoop } from "../../src/agent/loop/create-loop.ts";
import { createTodoTool } from "../../src/agent/tools/flow/todo.ts";
import { initLockDir } from "../../src/shared/lock.ts";

describe("createLoop", () => {
  test("builds agent transport and manager without calling model", () => {
    const loop = createLoop(() => ({ agentId: "ask", modelKey: "test/test", thinking: "none" }));
    expect(loop.agent).toBeDefined();
    expect(loop.transport).toBeDefined();
    expect(loop.mcp).toBeDefined();
  });
  test("reflects config agent on rebuild", () => {
    const loop = createLoop(() => ({ agentId: "coder", modelKey: "test/test", thinking: "minimal" }));
    expect(loop.agent).toBeDefined();
  });
});

describe("todo tool in tests scope", () => {
  test("ins and del round trip in isolation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-gap-todo-"));
    initLockDir(dir);
    try {
      const tool = createTodoTool(join(dir, "todos.json"));
      const added = await tool.handler({ actionType: "ins", action: { ins: [{ phase: "p", title: "t", prompt: "q", done: false }] } });
      expect(added.items).toHaveLength(1);
      const removed = await tool.handler({ actionType: "del", action: { del: { index: 0 } } });
      expect(removed.items).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
