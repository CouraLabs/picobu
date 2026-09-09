import { isAbsolute, relative, resolve } from "node:path";
import { CheckpointStore } from "@agent/sessions/checkpoints.ts";
import { sandboxRoot } from "@agent/tools/sandbox.ts";
import type { ToolExecuteOptions } from "@agent/tools/toolset.ts";
import { withLock } from "@shared/lock.ts";
import { createTwoFilesPatch } from "diff";
import z from "zod";
export const EditToolArgsSchema = z.object({
  path: z.string().min(1),
  oldString: z.string().min(1),
  newString: z.string(),
});
export type EditToolResult = {
  message: string;
  diff: string;
};
export const EditToolOutputSchema = z.object({
  message: z.string(),
  diff: z.string(),
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
export const createEditTool = (checkpointsPath?: string) => {
  const checkpoints = checkpointsPath ? new CheckpointStore(checkpointsPath) : undefined;
  return {
    name: "edit",
    description:
      "Replace a single occurrence of oldString with newString in a file; errors if oldString is absent or matches more than one place. Returns the unified diff of the change.",
    parameters: EditToolArgsSchema,
    output: EditToolOutputSchema,
    handler: async (args: z.infer<typeof EditToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<EditToolResult> => {
      if (!args.path) throw new Error("edit requires a non-empty path");
      if (args.oldString === "") throw new Error("edit requires a non-empty oldString");
      const base = sandboxRoot(toolOptions?.experimental_sandbox);
      const path = resolveInsideBase(base, args.path);
      return withLock(path, async () => {
        const file = Bun.file(path);
        if (!(await file.exists())) throw new Error(`File not found: ${path}`);
        const text = await file.text();
        const count = text.split(args.oldString).length - 1;
        if (count === 0) throw new Error(`oldString not found in ${path}`);
        if (count > 1) throw new Error(`oldString appears ${count} times in ${path}; refusing ambiguous replace (supply more context)`);
        const updated = text.replace(args.oldString, () => args.newString);
        await Bun.write(path, updated);
        if (checkpoints) {
          await checkpoints.record({ tool: "edit", path, before: text, after: updated });
        }
        return {
          message: `Replaced single occurrence in ${path}`,
          diff: createTwoFilesPatch(path, path, text, updated, "", ""),
        };
      });
    },
  };
};
