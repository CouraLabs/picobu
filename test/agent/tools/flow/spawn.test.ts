import { describe, expect, test } from "bun:test";
import { createSpawnTool, SpawnToolArgsSchema, SpawnToolOutputSchema } from "@agent/tools/flow/spawn.ts";
import { buildToolSet, type ToolSetContext } from "@agent/tools/toolset.ts";
import { z } from "zod";

describe("spawn tool", () => {
  test("args require a subagent name and a non-empty prompt", () => {
    const ok = { subagent: "explorer", prompt: "Find the entry point" } satisfies z.infer<typeof SpawnToolArgsSchema>;
    expect(SpawnToolArgsSchema.parse(ok).subagent).toBe("explorer");
    expect(() => SpawnToolArgsSchema.parse({ subagent: "explorer", prompt: "" })).toThrow();
    expect(() => SpawnToolArgsSchema.parse({ subagent: "", prompt: "x" })).toThrow();
  });

  test("output schema: summary + itemized usage with cacheRead/cacheWrite", () => {
    const out = {
      summary: "Did the thing",
      usage: { inputTokens: 10, outputTokens: 5, cacheRead: 2, cacheWrite: 1, cost: 0.01 },
    } satisfies z.infer<typeof SpawnToolOutputSchema>;
    expect(SpawnToolOutputSchema.parse(out).summary).toBe("Did the thing");
  });

  test("blocking by construction: no `defer`, no `isTerminal`", () => {
    const manager = {
      spawnSubSession: async () => ({ summary: "s", usage: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 } }),
    } as never;
    const tool = createSpawnTool({ manager, parentId: "root", depth: 0 });
    // The step waits for the spawn to settle precisely because these
    // streaming/deferral knobs are absent.
    expect("defer" in tool).toBe(false);
    expect((tool as { isTerminal?: boolean }).isTerminal).toBeUndefined();
  });

  test("handler forwards to the manager with the parent id and depth", async () => {
    const calls: unknown[] = [];
    const manager = {
      spawnSubSession: async (params: unknown) => {
        calls.push(params);
        return { summary: "done", usage: { inputTokens: 1, outputTokens: 2, cacheRead: 3, cacheWrite: 4 } };
      },
    } as never;
    const tool = createSpawnTool({ manager, parentId: "parent-1", depth: 2 });
    const result = await tool.handler({ subagent: "explorer", prompt: "go" });
    expect(calls).toEqual([{ parentId: "parent-1", subagent: "explorer", prompt: "go", depth: 2 }]);
    expect(result.summary).toBe("done");
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 2, cacheRead: 3, cacheWrite: 4 });
  });

  test("registered only when the context carries spawn wiring and a session id", () => {
    const spawn = { manager: {} as never, parentId: "p", depth: 0 };
    const withSpawn = buildToolSet({ sessionId: "s1", spawn } as ToolSetContext);
    expect(withSpawn.getTools().some((t) => t.name === "spawn")).toBe(true);

    const withoutSpawn = buildToolSet({ sessionId: "s1" });
    expect(withoutSpawn.getTools().some((t) => t.name === "spawn")).toBe(false);

    const noSession = buildToolSet({ spawn });
    expect(noSession.getTools().some((t) => t.name === "spawn")).toBe(false);
  });

  test("sub sessions never register the interactive flow tools", () => {
    const sub = buildToolSet({ sessionId: "s1", interactive: false });
    const names = sub.getTools().map((t) => t.name);
    expect(names).not.toContain("ask");
    expect(names).not.toContain("plan-write");
    expect(names).not.toContain("plan-exit");
    // Session-scoped non-interactive flow tools remain.
    expect(names).toContain("skill");
    expect(names).toContain("rule");

    const main = buildToolSet({ sessionId: "s1" });
    expect(main.getTools().map((t) => t.name)).toContain("ask");
  });
});
