import z from "zod";

export const BashToolArgsSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
})

type ShellSpec = { cmd: string[] };

/**
 * Map a `detectShell()` label (`options.app.shell`) to the shell executable and
 * flag used to invoke the command. Falls back to a POSIX shell for unknown labels.
 */
function shellSpec(shellLabel: string): ShellSpec {
  const [platform, shell] = shellLabel.split(":");
  if (platform === "Windows") {
    switch (shell) {
      case "PowerShell":
        return { cmd: ["powershell", "-Command"] };
      case "Bash":
        return { cmd: ["bash", "-c"] };
      case "cmd.exe":
        return { cmd: ["cmd", "/c"] };
    }
  } else {
    switch (shell) {
      case "Zsh":
        return { cmd: ["zsh", "-c"] };
      case "Bash":
        return { cmd: ["bash", "-c"] };
      case "Fish":
        return { cmd: ["fish", "-c"] };
      case "Sh":
        return { cmd: ["sh", "-c"] };
    }
  }
  return { cmd: [Bun.env.SHELL || "/bin/sh", "-c"] };
}

/** Create the bash tool bound to the harness shell reported via `options.app.shell`. */
export function createBashTool(shellLabel: string) {
  const spec = shellSpec(shellLabel);
  return {
    name: "bash",
    description: "Execute a shell command on the host; use for real binaries or short fact pipelines. Prefer the dedicated read/write/edit/glob/grep tools over bash when they can do the job.",
    parameters: BashToolArgsSchema,
    output: z.string(),
    isTerminal: true,
    overridesBuiltInTool: true,
    skipPermission: true,
    defer: "auto",
    handler: async (args: z.infer<typeof BashToolArgsSchema>) : Promise<string> => {
      const cwd = args.cwd ?? process.cwd();
      const proc = Bun.spawn({
        cmd: [...spec.cmd, args.command],
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