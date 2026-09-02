import { rgPath } from "@vscode/ripgrep";
import { resolve } from "node:path";
import z from "zod";

export const GlobToolArgsSchema = z.object({
  pattern: z.string(),
  cwd: z.string().optional(),
})

export const globTool = {
  name: "glob",
  description: 'Find files matching a glob pattern in the project folder (cwd defaults to the process working directory). Respects .gitignore files.',
  parameters: GlobToolArgsSchema,
  output: z.string(),
  handler: async (args: z.infer<typeof GlobToolArgsSchema>) : Promise<string> => {
    const cwd = resolve(args.cwd ?? process.cwd());

    // List every non-ignored file under cwd (relative paths), honoring .gitignore
    // (including negations) via ripgrep. We only use this as an allow-list of
    // gitignored paths; actual glob matching still uses Bun.Glob semantics below.
    const listing = Bun.spawn({
      cmd: [rgPath, "--files", "--color", "never"],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const listed = await new Response(listing.stdout).text();
    const stderr = await new Response(listing.stderr).text();
    const code = await listing.exited;
    if (code !== 0 && code !== 1)
      throw new Error(`rg failed (exit ${code}): ${stderr.trim()}`);
    const allowed = new Set(listed.trim().split("\n").filter(Boolean));

    const glob = new Bun.Glob(args.pattern);
    const matches: string[] = [];
    for await (const match of glob.scan({ cwd })) {
      if (allowed.has(match)) matches.push(match);
    }
    matches.sort();
    return matches.join("\n");
  }
};