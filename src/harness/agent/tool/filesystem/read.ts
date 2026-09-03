import z from "zod";
import { withLock } from "@libs/lock.ts";
import { detectFiletype } from "@libs/filetype.ts";

const ReadToolOutputSchema = z.object({
  filetype: z.string(),
  content: z.string(),
});

export const ReadToolArgsSchema = z.object({
  path: z.string(),
  fromLine: z.number().min(1).nullable(),
  toLine: z.number().min(1).nullable(),
})

export const readTool = {
  name: "read",
  description: 'Reads a file on specified path',
  parameters: ReadToolArgsSchema,
  output: ReadToolOutputSchema,
  defer: "auto",
  handler: async (args: z.infer<typeof ReadToolArgsSchema>) : Promise<z.infer<typeof ReadToolOutputSchema>> => {
    return withLock(args.path, async () => {
      const file = Bun.file(args.path);
      if (!(await file.exists())) throw new Error(`File not found: ${args.path}`);
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      if (args.fromLine != null && args.toLine != null && args.fromLine > args.toLine)
        throw new Error(`fromLine (${args.fromLine}) cannot be greater than toLine (${args.toLine})`);
      const begin = args.fromLine ?? 1;                    // inclusive, 1-indexed
      const end   = args.toLine   ?? lines.length;         // inclusive, 1-indexed
      const content = lines
        .slice(Math.max(begin - 1, 0), Math.min(end, lines.length))
        .join("\n");
      return { filetype: detectFiletype(args.path), content };
    });
  }
};