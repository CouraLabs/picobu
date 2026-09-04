import { createTwoFilesPatch } from "diff";
import { resolve } from "node:path";
import z from "zod";
import { withLock } from "@shared/lock.ts";
import { sandboxRoot } from "@agent/tools/sandbox.ts";
import { CheckpointStore } from "@agent/sessions/checkpoints.ts";
import type { ToolExecuteOptions } from "@agent/tools/toolset.ts";

export const EditToolArgsSchema = z.object({
  path: z.string(),
  oldString: z.string(),
  newString: z.string(),
})

/** Structured result: a human-readable confirmation plus the unified diff of the change. */
export type EditToolResult = {
  message: string;
  diff: string;
};

export const EditToolOutputSchema = z.object({
  message: z.string(),
  diff: z.string(),
});

/**
 * Replace a single occurrence of oldString with newString. When
 * `checkpointsPath` is provided, every edit records a checkpoint (the file's
 * before/after content) so `undo`/`redo` can replay it. Relative paths resolve
 * against the session sandbox root when a sandbox is attached.
 */
export const createEditTool = (checkpointsPath?: string) => {
  const checkpoints = checkpointsPath ? new CheckpointStore(checkpointsPath) : undefined;
  return {
    name: "edit",
    description: 'Replace a single occurrence of oldString with newString in a file; errors if oldString is absent or matches more than one place. Returns the unified diff of the change.',
    parameters: EditToolArgsSchema,
    output: EditToolOutputSchema,
    handler: async (args: z.infer<typeof EditToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<EditToolResult> => {
      const base = sandboxRoot(toolOptions?.experimental_sandbox) ?? process.cwd();
      const path = resolve(base, args.path);
      return withLock(path, async () => {
        const file = Bun.file(path);
        if (!(await file.exists())) throw new Error(`File not found: ${path}`);
        const text = await file.text();
        const count = text.split(args.oldString).length - 1;
        if (count === 0)      throw new Error(`oldString not found in ${path}`);
        if (count > 1)        throw new Error(`oldString appears ${count} times in ${path}; refusing ambiguous replace (supply more context)`);
        const updated = text.replace(args.oldString, args.newString);
        await Bun.write(path, updated);
        if (checkpoints) {
          await checkpoints.record({ tool: "edit", path, before: text, after: updated });
        }
        return {
          message: `Replaced single occurrence in ${path}`,
          diff: createTwoFilesPatch(path, path, text, updated, "", ""),
        };
      });
    }
  };
};
