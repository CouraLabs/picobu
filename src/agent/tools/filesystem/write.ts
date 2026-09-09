import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import z from "zod";
import { sandboxRoot } from "@agent/tools/sandbox.ts";
import { CheckpointStore } from "@agent/sessions/checkpoints.ts";
import type { ToolExecuteOptions } from "@agent/tools/toolset.ts";
export const WriteToolArgsSchema = z.object({
  path: z.string(),
  contents: z.string(),
})


// The content echo is for the TUI preview (`code` renderable); cap it so a
// large write doesn't bloat the tool result sent back to the model.
const CONTENT_PREVIEW_MAX_CHARS = 4_000


export type WriteToolResult = {
  message: string;
  content: string;
};
export const WriteToolOutputSchema = z.object({
  message: z.string(),
  content: z.string(),
});


export const createWriteTool = (checkpointsPath?: string) => {
  const checkpoints = checkpointsPath ? new CheckpointStore(checkpointsPath) : undefined;
  return {
    name: "write",
    description: 'Write contents to a file at path, creating parent directories as needed.',
    parameters: WriteToolArgsSchema,
    output: WriteToolOutputSchema,
    skipPermission: true,
    handler: async (args: z.infer<typeof WriteToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<WriteToolResult> => {
      const base = sandboxRoot(toolOptions?.experimental_sandbox) ?? process.cwd();
      const resolvedPath = resolve(base, args.path);
      await mkdir(dirname(resolvedPath), { recursive: true });
      const before = await Bun.file(resolvedPath).text().catch(() => null);
      await Bun.write(resolvedPath, args.contents);
      if (checkpoints) {
        await checkpoints.record({ tool: "write", path: resolvedPath, before, after: args.contents });
      }
      const lines = (args.contents.match(/\n/g) ?? []).length + 1;
      const content =
        args.contents.length > CONTENT_PREVIEW_MAX_CHARS
          ? `${args.contents.slice(0, CONTENT_PREVIEW_MAX_CHARS)}\n…[truncated]`
          : args.contents;
      return {
        message: `Wrote ${args.path} (${lines} lines)`,
        content,
      };
    },
  };
};
