import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type z from "zod";
import { readTool, ReadToolArgsSchema } from "@agent/tools/filesystem/read.ts";
import { createLocalSandboxSession } from "@agent/tools/sandbox.ts";

describe("readTool", () => {
  test("reads the whole file with its detected filetype", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-tool-"));
    try {
      const path = join(dir, "notes.md");
      await writeFile(path, "# hello\nworld");

      const result = await readTool.handler({
        path,
        fromLine: null,
        toLine: null,
      } satisfies z.infer<typeof ReadToolArgsSchema>);

      expect(result.filetype).toBe("markdown");
      expect(result.content).toBe("# hello\nworld");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("unknown extensions fall back to text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-tool-"));
    try {
      const path = join(dir, "data.unknownext");
      await writeFile(path, "contents");

      const result = await readTool.handler({
        path,
        fromLine: null,
        toLine: null,
      } satisfies z.infer<typeof ReadToolArgsSchema>);

      expect(result.filetype).toBe("text");
      expect(result.content).toBe("contents");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("line ranges are 1-indexed and inclusive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-tool-"));
    try {
      const path = join(dir, "lines.txt");
      await writeFile(path, "one\ntwo\nthree\nfour\nfive");

      const slice = await readTool.handler({
        path,
        fromLine: 2,
        toLine: 4,
      } satisfies z.infer<typeof ReadToolArgsSchema>);
      expect(slice.content).toBe("two\nthree\nfour");

      const fromTwo = await readTool.handler({
        path,
        fromLine: 4,
        toLine: null,
      } satisfies z.infer<typeof ReadToolArgsSchema>);
      expect(fromTwo.content).toBe("four\nfive");

      const untilThree = await readTool.handler({
        path,
        fromLine: null,
        toLine: 3,
      } satisfies z.infer<typeof ReadToolArgsSchema>);
      expect(untilThree.content).toBe("one\ntwo\nthree");

      // Ranges past the end clamp to the file's last line.
      const clamped = await readTool.handler({
        path,
        fromLine: 4,
        toLine: 100,
      } satisfies z.infer<typeof ReadToolArgsSchema>);
      expect(clamped.content).toBe("four\nfive");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("CRLF line endings are normalized in the returned content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-tool-"));
    try {
      const path = join(dir, "windows.txt");
      await writeFile(path, "one\r\ntwo\r\nthree");

      const result = await readTool.handler({
        path,
        fromLine: null,
        toLine: null,
      } satisfies z.infer<typeof ReadToolArgsSchema>);

      expect(result.content).toBe("one\ntwo\nthree");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fromLine greater than toLine is rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-tool-"));
    try {
      const path = join(dir, "lines.txt");
      await writeFile(path, "one\ntwo\n");

      await expect(
        readTool.handler({
          path,
          fromLine: 3,
          toLine: 2,
        } satisfies z.infer<typeof ReadToolArgsSchema>),
      ).rejects.toThrow("cannot be greater than toLine (2)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing files throw with the resolved absolute path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-tool-"));
    try {
      const path = join(dir, "nope.txt");
      await expect(
        readTool.handler({
          path,
          fromLine: null,
          toLine: null,
        } satisfies z.infer<typeof ReadToolArgsSchema>),
      ).rejects.toThrow(`File not found: ${path}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("relative paths resolve against the session sandbox root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "read-tool-"));
    try {
      await mkdir(join(dir, "nested"), { recursive: true });
      await writeFile(join(dir, "nested", "inner.txt"), "from sandbox");

      const result = await readTool.handler(
        { path: "nested/inner.txt", fromLine: null, toLine: null } satisfies z.infer<typeof ReadToolArgsSchema>,
        { experimental_sandbox: createLocalSandboxSession(dir, "Bash") },
      );

      expect(result.content).toBe("from sandbox");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
