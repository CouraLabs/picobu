import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type z from "zod";
import { createEditTool, EditToolArgsSchema } from "@agent/tools/filesystem/edit.ts";
import { createLocalSandboxSession } from "@agent/tools/sandbox.ts";

describe("editTool", () => {
  test("replaces a single occurrence and returns the unified diff", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edit-tool-"));
    try {
      const path = join(dir, "code.txt");
      await writeFile(path, "const value = 1;\nexport { value };\n");

      const result = await createEditTool().handler({
        path,
        oldString: "const value = 1;",
        newString: "const value = 2;",
      } satisfies z.infer<typeof EditToolArgsSchema>);

      expect(await readFile(path, "utf8")).toBe("const value = 2;\nexport { value };\n");
      expect(result.message).toBe(`Replaced single occurrence in ${path}`);
      expect(result.diff).toContain("-");
      expect(result.diff).toContain("const value = 1;");
      expect(result.diff).toContain("+");
      expect(result.diff).toContain("const value = 2;");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a non-string replacement keeps the rest of the file intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edit-tool-"));
    try {
      const path = join(dir, "text.txt");
      await writeFile(path, "alpha beta gamma\n");

      const result = await createEditTool().handler({
        path,
        oldString: "beta ",
        newString: "",
      } satisfies z.infer<typeof EditToolArgsSchema>);

      expect(await readFile(path, "utf8")).toBe("alpha gamma\n");
      expect(result.message).toBe(`Replaced single occurrence in ${path}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("absent oldString is rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edit-tool-"));
    try {
      const path = join(dir, "code.txt");
      await writeFile(path, "nothing to see\n");

      await expect(
        createEditTool().handler({
          path,
          oldString: "missing text",
          newString: "x",
        } satisfies z.infer<typeof EditToolArgsSchema>),
      ).rejects.toThrow(`oldString not found in ${path}`);
      expect(await readFile(path, "utf8")).toBe("nothing to see\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ambiguous oldString is refused and the file is untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edit-tool-"));
    try {
      const path = join(dir, "code.txt");
      await writeFile(path, "dup\ndup\n");

      await expect(
        createEditTool().handler({
          path,
          oldString: "dup",
          newString: "x",
        } satisfies z.infer<typeof EditToolArgsSchema>),
      ).rejects.toThrow(`oldString appears 2 times in ${path}; refusing ambiguous replace (supply more context)`);
      expect(await readFile(path, "utf8")).toBe("dup\ndup\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing files throw with the resolved absolute path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edit-tool-"));
    try {
      const path = join(dir, "nope.txt");
      await expect(
        createEditTool().handler({
          path,
          oldString: "a",
          newString: "b",
        } satisfies z.infer<typeof EditToolArgsSchema>),
      ).rejects.toThrow(`File not found: ${path}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("relative paths resolve against the session sandbox root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edit-tool-"));
    try {
      await writeFile(join(dir, "inner.txt"), "before\n");

      await createEditTool().handler(
        {
          path: "inner.txt",
          oldString: "before",
          newString: "after",
        } satisfies z.infer<typeof EditToolArgsSchema>,
        { experimental_sandbox: createLocalSandboxSession(dir, "Bash") },
      );

      expect(await readFile(join(dir, "inner.txt"), "utf8")).toBe("after\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("edits record a before/after checkpoint when a checkpoint store path is given", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edit-tool-"));
    try {
      const path = join(dir, "code.txt");
      await writeFile(path, "v1\n");
      const checkpointsPath = join(dir, "checkpoints.jsonl");

      await createEditTool(checkpointsPath).handler({
        path,
        oldString: "v1",
        newString: "v2",
      } satisfies z.infer<typeof EditToolArgsSchema>);

      const lines = (await readFile(checkpointsPath, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(1);
      const record = JSON.parse(lines[0]!) as { seq: number; tool: string; path: string; before: string; after: string };
      expect(record.seq).toBe(0);
      expect(record.tool).toBe("edit");
      expect(record.path).toBe(path);
      expect(record.before).toBe("v1\n");
      expect(record.after).toBe("v2\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
