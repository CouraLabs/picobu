import { rgPath } from "@vscode/ripgrep";
import { isAbsolute, relative, resolve } from "node:path";
import z from "zod";
import { detectFiletype } from "@shared/filetype.ts";
import { agentDirsUnder, insideAgentDir } from "@agent/tools/filesystem/agent-dirs.ts";
import { sandboxRoot, type LocalSandboxSession } from "@agent/tools/sandbox.ts";
import type { ToolExecuteOptions } from "@agent/tools/toolset.ts";
const GrepToolOutputSchema = z.object({
  filetype: z.string(),
  content: z.string(),
});
export const GrepToolArgsSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
});
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
  handler: async (args: z.infer<typeof GrepToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<z.infer<typeof GrepToolOutputSchema>> => {
    const sandbox = sandboxRoot(toolOptions?.experimental_sandbox);
    const root = sandbox ?? process.cwd();
    const searchPath = args.path ? resolve(root, args.path) : root;
    if (sandbox) {
      const rel = relative(resolve(sandbox), resolve(searchPath));
      if (rel !== "" && (rel === ".." || rel.startsWith("../") || isAbsolute(rel))) {
        throw new Error(`Path escapes working directory: ${args.path}`);
      }
    }
    const base = resolve(searchPath);
    const bypassFilters = insideAgentDir(base);
    const flags = bypassFilters ? ["--hidden", "--no-ignore-vcs"] : [];
    const proc = await runArgv([rgPath, "-n", "--no-heading", "--color", "never", ...flags, "-e", args.pattern, "--", searchPath], root, toolOptions);
    if (proc.exitCode !== 0 && proc.exitCode !== 1) throw new Error(`rg failed (exit ${proc.exitCode}): ${proc.stderr.trim()}`);
    const lines = new Set(proc.stdout.trim().split("\n").filter(Boolean));
    if (!bypassFilters) {
      for (const dir of await agentDirsUnder(base)) {
        const pass = await runArgv([rgPath, "-n", "--no-heading", "--color", "never", "--hidden", "--no-ignore-vcs", "-e", args.pattern, "--", dir], root, toolOptions);
        if (pass.exitCode !== 0 && pass.exitCode !== 1)
          throw new Error(`rg failed (exit ${pass.exitCode}): ${pass.stderr.trim()}`);
        for (const line of pass.stdout.trim().split("\n").filter(Boolean)) lines.add(line);
      }
    }
    if (lines.size === 0) return { filetype: "text", content: `No matches for /${args.pattern}/ in ${searchPath}` };
    return { filetype: detectFiletype(searchPath), content: [...lines].join("\n") };
  }
};
