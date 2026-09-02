import { rgPath } from "@vscode/ripgrep";
import z from "zod";
import { detectFiletype } from "../../../../libs/filetype";

const GrepToolOutputSchema = z.object({
  filetype: z.string(),
  content: z.string(),
});

export const GrepToolArgsSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
})

export const grepTool = {
  name: "grep",
  description: 'Search a file or directory for text matching a regex pattern using ripgrep; returns matching lines.',
  parameters: GrepToolArgsSchema,
  output: GrepToolOutputSchema,
  isTerminal: false,
  overridesBuiltInTool: true,
  skipPermission: true,
  defer: "auto",
  handler: async (args: z.infer<typeof GrepToolArgsSchema>) : Promise<z.infer<typeof GrepToolOutputSchema>> => {
    const searchPath = args.path ?? process.cwd();
    const proc = Bun.spawn({
      cmd: [rgPath, "-n", "--no-heading", "--color", "never", args.pattern, searchPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code === 1) return { filetype: "text", content: `No matches for /${args.pattern}/ in ${searchPath}` };
    if (code !== 0) throw new Error(`rg failed (exit ${code}): ${stderr.trim()}`);
    return { filetype: detectFiletype(searchPath), content: stdout.trimEnd() };
  }
};