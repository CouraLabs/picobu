import { rgPath } from "@vscode/ripgrep";
import { relative, resolve } from "node:path";
import z from "zod";
import { agentDirsUnder } from "@agent/tools/filesystem/agent-dirs.ts";
import { sandboxRoot, type LocalSandboxSession } from "@agent/tools/sandbox.ts";
import type { ToolExecuteOptions } from "@agent/tools/toolset.ts";

export const GlobToolArgsSchema = z.object({
  pattern: z.string(),
  cwd: z.string().optional(),
})

/** Run an argv vector inside the session sandbox when available, else directly. */
async function runArgv(argv: string[], cwd: string, toolOptions?: ToolExecuteOptions) {
  const sandbox = toolOptions?.experimental_sandbox as LocalSandboxSession | undefined;
  if (sandbox && typeof sandbox.exec === "function") return sandbox.exec(argv, { cwd });
  const proc = Bun.spawn({
    cmd: argv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

export const globTool = {
  name: "glob",
  description:
    'Find files matching a glob pattern in the project folder (cwd defaults to the process working directory). Respects .gitignore files (agent config folders like .agents/ are always included).',
  parameters: GlobToolArgsSchema,
  output: z.string(),
  handler: async (args: z.infer<typeof GlobToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<string> => {
    // The search root is the session sandbox root when a sandbox is attached;
    // relative `cwd` args resolve against it (absolute paths pass through).
    const cwd = resolve(sandboxRoot(toolOptions?.experimental_sandbox) ?? process.cwd(), args.cwd ?? ".");

    // List every non-ignored file under cwd (relative paths), honoring .gitignore
    // (including negations) via ripgrep. We only use this as an allow-list of
    // gitignored paths; actual glob matching still uses Bun.Glob semantics below.
    const listing = await runArgv([rgPath, "--files", "--color", "never"], cwd, toolOptions);
    if (listing.exitCode !== 0 && listing.exitCode !== 1)
      throw new Error(`rg failed (exit ${listing.exitCode}): ${listing.stderr.trim()}`);
    const allowed = new Set(listing.stdout.trim().split("\n").filter(Boolean));

    // Agent config dirs (.agents/, ~/.agents/, ~/.picobu/{skills,workflows,
    // prompts,commands}) are hidden and often gitignored, so the pass above
    // never sees them. Re-list each with both filters disabled — scoped to the
    // dir, so .gitignore stays authoritative everywhere else.
    for (const dir of await agentDirsUnder(cwd)) {
      const rel = relative(cwd, dir);
      const pass = await runArgv([rgPath, "--files", "--color", "never", "--hidden", "--no-ignore-vcs", rel], cwd, toolOptions);
      if (pass.exitCode !== 0 && pass.exitCode !== 1)
        throw new Error(`rg failed (exit ${pass.exitCode}): ${pass.stderr.trim()}`);
      for (const file of pass.stdout.trim().split("\n").filter(Boolean)) allowed.add(file);
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
