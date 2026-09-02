import { createTwoFilesPatch } from "diff";
import z from "zod";
import { withLock } from "../../../../libs/lock";

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

export const editTool = {
  name: "edit",
  description: 'Replace a single occurrence of oldString with newString in a file; errors if oldString is absent or matches more than one place. Returns the unified diff of the change.',
  parameters: EditToolArgsSchema,
  output: EditToolOutputSchema,
  handler: async (args: z.infer<typeof EditToolArgsSchema>) : Promise<EditToolResult> => {
    return withLock(args.path, async () => {
      const file = Bun.file(args.path);
      if (!(await file.exists())) throw new Error(`File not found: ${args.path}`);
      const text = await file.text();
      const count = text.split(args.oldString).length - 1;
      if (count === 0)      throw new Error(`oldString not found in ${args.path}`);
      if (count > 1)        throw new Error(`oldString appears ${count} times in ${args.path}; refusing ambiguous replace (supply more context)`);
      const updated = text.replace(args.oldString, args.newString);
      await Bun.write(args.path, updated);
      return {
        message: `Replaced single occurrence in ${args.path}`,
        diff: createTwoFilesPatch(args.path, args.path, text, updated, "", ""),
      };
    });
  }
};