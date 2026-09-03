import { rgPath } from "@vscode/ripgrep";
import { resolve } from "node:path";
import z from "zod";
import { detectFiletype } from "../../../../libs/filetype";
import { agentDirsUnder, insideAgentDir } from "./agent-dirs";

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
  description:
    'Search a file or directory for text matching a regex pattern using ripgrep; returns matching lines. Respects .gitignore files (agent config folders like .agents/ are always included).',
  parameters: GrepToolArgsSchema,
  output: GrepToolOutputSchema,
  isTerminal: false,
  overridesBuiltInTool: true,
  skipPermission: true,
  defer: "auto",
  handler: async (args: z.infer<typeof GrepToolArgsSchema>) : Promise<z.infer<typeof GrepToolOutputSchema>> => {
    const searchPath = args.path ?? process.cwd();
    const base = resolve(searchPath);

    // Inside an agent config dir the user scoped the search into agent content
    // explicitly: disable the hidden/gitignore filters for the whole pass.
    // Otherwise search normally, then re-search each agent dir under the path
    // with both filters disabled so their content is never missed.
    const bypassFilters = insideAgentDir(base);
    const flags = bypassFilters ? ["--hidden", "--no-ignore-vcs"] : [];

    const proc = Bun.spawn({
      cmd: [rgPath, "-n", "--no-heading", "--color", "never", ...flags, args.pattern, searchPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0 && code !== 1) throw new Error(`rg failed (exit ${code}): ${stderr.trim()}`);

    const lines = new Set(stdout.trim().split("\n").filter(Boolean));
    if (!bypassFilters) {
      for (const dir of await agentDirsUnder(base)) {
        const pass = Bun.spawn({
          cmd: [rgPath, "-n", "--no-heading", "--color", "never", "--hidden", "--no-ignore-vcs", args.pattern, dir],
          stdout: "pipe",
          stderr: "pipe",
        });
        const passStdout = await new Response(pass.stdout).text();
        const passStderr = await new Response(pass.stderr).text();
        const passCode = await pass.exited;
        if (passCode !== 0 && passCode !== 1)
          throw new Error(`rg failed (exit ${passCode}): ${passStderr.trim()}`);
        for (const line of passStdout.trim().split("\n").filter(Boolean)) lines.add(line);
      }
    }

    if (lines.size === 0) return { filetype: "text", content: `No matches for /${args.pattern}/ in ${searchPath}` };
    return { filetype: detectFiletype(searchPath), content: [...lines].join("\n") };
  }
};
