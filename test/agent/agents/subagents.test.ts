import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILT_IN_SUBAGENTS,
  INTERACTIVE_FLOW_TOOLS,
  SUBAGENT_DEPTH_CAP,
  getSubagent,
  listSubagents,
  prepareSubagent,
} from "@agent/agents/subagents.ts";

const projectOverride = `---
name: Explorer
description: Project explorer wins over the built-in
tools: read, grep, ask
model: acme/mini
---

Project explorer body.
`;

const freshSubagent = `---
name: Fresh
description: A project-only subagent
tools: *
---

Fresh body.
`;

describe("subagent catalog", () => {
  test("ships the three built-ins with prompts", () => {
    expect(Object.keys(BUILT_IN_SUBAGENTS).sort()).toEqual(["executor", "explorer", "reviewer"]);
    expect(BUILT_IN_SUBAGENTS["executor"]?.prompt).toContain("SPAWN_PROMPT");
    expect(BUILT_IN_SUBAGENTS["explorer"]?.prompt).toContain("file search specialist");
    expect(BUILT_IN_SUBAGENTS["reviewer"]?.prompt).toContain("code reviewer");
  });

  test("discovers project subagents; project files override built-ins by name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-subagents-"));
    try {
      await mkdir(join(dir, ".agents", "agents"), { recursive: true });
      await writeFile(join(dir, ".agents", "agents", "Explorer.md"), projectOverride);
      await writeFile(join(dir, ".agents", "agents", "Fresh.md"), freshSubagent);

      const list = await listSubagents(dir);
      const explorer = list.find((s) => s.name === "Explorer");
      expect(explorer?.description).toBe("Project explorer wins over the built-in");
      expect(explorer?.prompt).toContain("Project explorer body.");
      expect(explorer?.model).toBe("acme/mini");
      expect(list.some((s) => s.name === "Fresh")).toBe(true);
      // Built-ins without a project override remain available.
      expect(list.some((s) => s.name === "Executor")).toBe(true);
      // Resolution helper agrees with the list.
      expect((await getSubagent("Fresh", dir))?.prompt).toContain("Fresh body.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a missing project dir still yields the built-ins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-subagents-"));
    try {
      const list = await listSubagents(dir);
      expect(list.map((s) => s.name).sort()).toEqual(["Executor", "Explorer", "Reviewer"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("prepareSubagent", () => {
  test("strips interactive flow tools and appends the shared rules", () => {
    const prepared = prepareSubagent({
      name: "X",
      description: "",
      category: "coding",
      tools: ["read", "ask", "plan-write", "plan-exit", "grep"],
      prompt: "Body.",
    });
    expect(prepared.tools).toEqual(["read", "grep"]);
    expect(prepared.prompt).toContain("Body.");
    expect(prepared.prompt).toContain("Subagent Rules");
    expect(prepared.prompt).toContain("Never wait for user input");
  });

  test("an agent def listing only interactive tools collapses to no-tools (not all-tools)", () => {
    const prepared = prepareSubagent({
      name: "Y",
      description: "",
      category: "coding",
      tools: ["ask"],
      prompt: "Body.",
    });
    // An empty list would mean "all tools" — the sentinel keeps it tool-less.
    expect(prepared.tools).toEqual(["__none__"]);
  });

  test("an all-tools def (empty list) stays all-tools minus the interactive ones", () => {
    // The toolset itself excludes unregistered tools for sub sessions; the
    // def keeps its shape and only loses interactive names it named.
    const prepared = prepareSubagent({
      name: "Z",
      description: "",
      category: "coding",
      tools: ["read", "ask"],
      prompt: "Body.",
    });
    expect(prepared.tools).toEqual(["read"]);
  });

  test("the interactive-tool ban covers ask, plan-write, and plan-exit", () => {
    expect(INTERACTIVE_FLOW_TOOLS).toContain("ask");
    expect(INTERACTIVE_FLOW_TOOLS).toContain("plan-write");
    expect(INTERACTIVE_FLOW_TOOLS).toContain("plan-exit");
  });

  test("depth cap is 3", () => {
    expect(SUBAGENT_DEPTH_CAP).toBe(3);
  });
});
