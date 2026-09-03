import { rgPath } from "@vscode/ripgrep";
import { relative, resolve } from "node:path";
import z from "zod";
import { agentDirsUnder } from "./agent-dirs";

export const GlobToolArgsSchema = z.object({
  pattern: z.string(),
  cwd: z.string().optional(),
})

export const globTool = {
  name: "glob",
  description:
    'Find files matching a glob pattern in the project folder (cwd defaults to the process working directory). Respects .gitignore files (agent config folders like .agents/ are always included).',
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

    // Agent config dirs (.agents/, ~/.agents/, ~/.picobu/{skills,workflows,
    // prompts,commands}) are hidden and often gitignored, so the pass above
    // never sees them. Re-list each with both filters disabled — scoped to the
    // dir, so .gitignore stays authoritative everywhere else.
    for (const dir of await agentDirsUnder(cwd)) {
      const rel = relative(cwd, dir);
      const pass = Bun.spawn({
        cmd: [rgPath, "--files", "--color", "never", "--hidden", "--no-ignore-vcs", rel],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const passListed = await new Response(pass.stdout).text();
      const passStderr = await new Response(pass.stderr).text();
      const passCode = await pass.exited;
      if (passCode !== 0 && passCode !== 1)
        throw new Error(`rg failed (exit ${passCode}): ${passStderr.trim()}`);
      for (const file of passListed.trim().split("\n").filter(Boolean)) allowed.add(file);
    }

    // `dot: true` lets the pattern see the dot-paths the agent-dir passes added;
    // every other hidden file is still excluded by the allow-list above.
    const glob = new Bun.Glob(args.pattern);
    const matches: string[] = [];
    for await (const match of glob.scan({ cwd, dot: true })) {
      if (allowed.has(match)) matches.push(match);
    }
    matches.sort();
    return matches.join("\n");
  }
};
