import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { CheckpointStore } from "@agent/sessions/checkpoints.ts";
import { sandboxRoot } from "@agent/tools/sandbox.ts";
import type { ToolExecuteOptions } from "@agent/tools/toolset.ts";
import { withLock } from "@shared/lock.ts";
import z from "zod";
export const WriteToolArgsSchema = z.object({
  path: z.string().min(1),
  contents: z.string(),
});
const CONTENT_PREVIEW_MAX_CHARS = 4_000;
export type WriteToolResult = {
  message: string;
  content: string;
};
export const WriteToolOutputSchema = z.object({
  message: z.string(),
  content: z.string(),
});
const resolveInsideBase = (base: string | undefined, userPath: string): string => {
  const resolved = resolve(base ?? process.cwd(), userPath);
  if (!base) return resolved;
  const normalizedBase = resolve(base);
  const rel = relative(normalizedBase, resolved);
  if (rel !== "" && (rel === ".." || rel.startsWith("../") || isAbsolute(rel))) {
    throw new Error(`Path escapes working directory: ${userPath}`);
  }
  return resolved;
};
export const createWriteTool = (checkpointsPath?: string) => {
  const checkpoints = checkpointsPath ? new CheckpointStore(checkpointsPath) : undefined;
  return {
    name: "write",
    description: "Write contents to a file at path, creating parent directories as needed.",
    parameters: WriteToolArgsSchema,
    output: WriteToolOutputSchema,
    skipPermission: true,
    handler: async (args: z.infer<typeof WriteToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<WriteToolResult> => {
      if (!args.path) throw new Error("write requires a non-empty path");
      const base = sandboxRoot(toolOptions?.experimental_sandbox);
      const resolvedPath = resolveInsideBase(base, args.path);
      return withLock(resolvedPath, async () => {
        await mkdir(dirname(resolvedPath), { recursive: true });
        const before = await Bun.file(resolvedPath)
          .text()
          .catch(() => null);
        await Bun.write(resolvedPath, args.contents);
        if (checkpoints) {
          await checkpoints.record({ tool: "write", path: resolvedPath, before, after: args.contents });
        }
        const lines = (args.contents.match(/\n/g) ?? []).length + 1;
        const content = args.contents.length > CONTENT_PREVIEW_MAX_CHARS ? `${args.contents.slice(0, CONTENT_PREVIEW_MAX_CHARS)}\n…[truncated]` : args.contents;
        return {
          message: `Wrote ${args.path} (${lines} lines)`,
          content,
        };
      });
    },
  };
};
