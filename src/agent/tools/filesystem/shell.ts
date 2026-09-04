import { resolve } from "node:path";
import z from "zod";
import { options } from "@config/options.ts";
import { shellSpec } from "@agent/tools/sandbox.ts";
import type { ToolExecuteOptions } from "@agent/tools/toolset.ts";

export const ShellToolArgsSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
})

/**
 * Execute a command in the user's shell (the harness-detected shell, named
 * `{APP_SHELL}` in the system prompt). With a session sandbox the command runs
 * inside it (relative `cwd` resolves against the sandbox root, abort signals
 * kill the process); without one it falls back to a direct spawn rooted at the
 * process cwd.
 */
export function createShellTool() {
  return {
    name: "shell",
    description: "Execute a shell command on the host; use for real binaries or short fact pipelines. Prefer the dedicated read/write/edit/glob/grep tools over shell when they can do the job.",
    parameters: ShellToolArgsSchema,
    output: z.string(),
    isTerminal: true,
    overridesBuiltInTool: true,
    skipPermission: true,
    defer: "auto",
    handler: async (args: z.infer<typeof ShellToolArgsSchema>, toolOptions?: ToolExecuteOptions): Promise<string> => {
      const sandbox = toolOptions?.experimental_sandbox;
      if (sandbox) {
        const result = await sandbox.run({
          command: args.command,
          workingDirectory: args.cwd,
          abortSignal: toolOptions?.abortSignal,
        });
        if (result.exitCode !== 0) {
          const stdoutTrim = result.stdout.trim();
          const stderrTrim = result.stderr.trim();
          throw new Error(
            `command \`${args.command}\` exited ${result.exitCode}\n` +
              (stderrTrim ? `stderr:\n${stderrTrim}\n` : "") +
              (stdoutTrim ? `stdout:\n${stdoutTrim}` : ""),
          );
        }
        return result.stdout.trimEnd() || "(no output)";
      }

      // Legacy path: direct spawn via the harness shell, rooted at the process cwd.
      const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
      const proc = Bun.spawn({
        cmd: [...shellSpec(options.app.shell).cmd, args.command],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      if (code !== 0) {
        const stdoutTrim = stdout.trim();
        const stderrTrim = stderr.trim();
        throw new Error(
          `command \`${args.command}\` exited ${code}\n` +
            (stderrTrim ? `stderr:\n${stderrTrim}\n` : "") +
            (stdoutTrim ? `stdout:\n${stdoutTrim}` : ""),
        );
      }
      return stdout.trimEnd() || "(no output)";
    },
  };
}
