import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type z from "zod";
import { writeTool, WriteToolArgsSchema } from "./write";

describe("writeTool", () => {
  test("writes the file and streams the content followed by the line count", async () => {
    const dir = await mkdtemp(join(tmpdir(), "write-tool-"));
    try {
      const contents = "line one\nline two\nline three\n";
      const args = {
        path: join(dir, "nested", "out.txt"),
        contents,
      } satisfies z.infer<typeof WriteToolArgsSchema>;

      const stream = await writeTool.handler(args);
      const chunks: string[] = [];
      for await (const chunk of stream) chunks.push(chunk);

      // The file is written with the exact content, creating parent dirs.
      expect(await readFile(args.path, "utf8")).toBe(contents);

      // The streamed output is the content value, with the number of lines
      // written appended at the very end.
      expect(chunks.join("")).toBe(contents + "\n3 lines written");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});