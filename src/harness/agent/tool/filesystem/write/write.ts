import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import z from "zod";

export const WriteToolArgsSchema = z.object({
  path: z.string(),
  contents: z.string(),
})

/**
 * Streams the written file back as tool output. The content value is emitted
 * line by line as it is written; once the content has fully streamed, the
 * number of lines written is appended at the end.
 */
export const writeTool = {
  name: "write",
  description: 'Write contents to a file at path, creating parent directories as needed.',
  parameters: WriteToolArgsSchema,
  output: z.string(),
  skipPermission: true,
  handler: (args: z.infer<typeof WriteToolArgsSchema>) =>
    new ReadableStream<string>({
      async start(controller) {
        const resolvedPath = resolve(args.path);
        await mkdir(dirname(resolvedPath), { recursive: true });
        await Bun.write(resolvedPath, args.contents);

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