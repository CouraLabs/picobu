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

/**
 * Streams the written file back as tool output. The content value is emitted
 * line by line as it is written; once the content has fully streamed, the
 * number of lines written is appended at the end.
 *
 * When `checkpointsPath` is provided, every write records a checkpoint (the
 * file's before/after content) so `undo`/`redo` can replay it. Relative paths
 * resolve against the session sandbox root when a sandbox is attached.
 */
export const createWriteTool = (checkpointsPath?: string) => {
  const checkpoints = checkpointsPath ? new CheckpointStore(checkpointsPath) : undefined;
  return {
    name: "write",
    description: 'Write contents to a file at path, creating parent directories as needed.',
    parameters: WriteToolArgsSchema,
    output: z.string(),
    skipPermission: true,
    handler: (args: z.infer<typeof WriteToolArgsSchema>, toolOptions?: ToolExecuteOptions) =>
      new ReadableStream<string>({
        async start(controller) {
          const base = sandboxRoot(toolOptions?.experimental_sandbox) ?? process.cwd();
          const resolvedPath = resolve(base, args.path);
          await mkdir(dirname(resolvedPath), { recursive: true });
          const before = await Bun.file(resolvedPath).text().catch(() => null);
          await Bun.write(resolvedPath, args.contents);
          if (checkpoints) {
            await checkpoints.record({ tool: "write", path: resolvedPath, before, after: args.contents });
          }

          const lines = args.contents.split("\n");
          for (let i = 0; i < lines.length; i++) {
            // re-attach the delimiter so the aggregated output is the exact content
            controller.enqueue(i < lines.length - 1 ? `${lines[i]}\n` : lines[i]);
          }
          // line count follows POSIX semantics: number of newlines
          controller.enqueue(`\n${(args.contents.match(/\n/g) ?? []).length} lines written`);
          controller.close();
        },
      }),
  };
};
