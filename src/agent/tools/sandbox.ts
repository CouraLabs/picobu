import { isAbsolute, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Experimental_SandboxProcess, Experimental_SandboxSession } from "ai";

/** Options for `run`/`spawn` (shell command + working dir + env + abort). */
type SandboxProcessOptions = Parameters<Experimental_SandboxSession["run"]>[0];

export type ShellSpec = { cmd: string[] };

/**
 * Map a `detectShell()` label (`options.app.shell`) to the shell executable and
 * flag used to invoke the command. Falls back to a POSIX shell for unknown labels.
 */
export function shellSpec(shellLabel: string): ShellSpec {
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

/**
 * The AI SDK ships the `SandboxSession` interface but no local implementation;
 * this is the Bun-backed one. It owns the session's working directory: shell
 * commands run inside it, and relative file paths resolve against it.
 * Absolute paths are allowed (no jail — path policy v1).
 */
export type LocalSandboxSession = Experimental_SandboxSession & {
  /** Absolute root directory every relative path resolves against. */
  readonly root: string;
  /**
   * Internal argv-style execution extension (e.g. ripgrep spawning): runs a
   * raw argv vector without shell-line semantics. Not part of the SDK
   * interface — callers must duck-type before use.
   */
  exec(
    argv: string[],
    opts?: { cwd?: string; env?: Record<string, string>; abortSignal?: AbortSignal },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
};

/** Extract the sandbox root from a tool-execute sandbox (undefined when absent/foreign). */
export const sandboxRoot = (sandbox: unknown): string | undefined =>
  typeof sandbox === "object" && sandbox !== null && "root" in sandbox && typeof (sandbox as LocalSandboxSession).root === "string"
    ? (sandbox as LocalSandboxSession).root
    : undefined;

const MISSING = "ENOENT";

/**
 * Create a local sandbox session rooted at `root`. Shell commands run through
 * the user's shell (`shellSpec(shellLabel)`), so `run` takes shell-line
 * semantics; `exec` takes raw argv for programmatic callers. Abort signals
 * kill the running process.
 */
export function createLocalSandboxSession(root: string, shellLabel: string): LocalSandboxSession {
  const spec = shellSpec(shellLabel);
  const resolveInRoot = (p: string | undefined): string =>
    p ? (isAbsolute(p) ? p : join(root, p)) : root;

  const start = (
    cmd: string[],
    opts: { cwd?: string; env?: Record<string, string>; abortSignal?: AbortSignal },
  ): { proc: Bun.Subprocess<"ignore" | "pipe", "ignore" | "pipe", "ignore" | "pipe">; onAbort: () => void } => {
    const proc = Bun.spawn({
      cmd,
      cwd: resolveInRoot(opts.cwd),
      env: opts.env ? { ...Bun.env, ...opts.env } : Bun.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const onAbort = () => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    };
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });
    return { proc, onAbort };
  };

  const done = (opts: { abortSignal?: AbortSignal }, onAbort: () => void, exitCode: number) => {
    opts.abortSignal?.removeEventListener("abort", onAbort);
    return exitCode;
  };

  const spawn = async (opts: SandboxProcessOptions): Promise<Experimental_SandboxProcess> => {
    const { proc, onAbort } = start([...spec.cmd, opts.command], {
      cwd: opts.workingDirectory,
      env: opts.env,
      abortSignal: opts.abortSignal,
    });
    return {
      pid: proc.pid,
      stdout: proc.stdout as ReadableStream<Uint8Array>,
      stderr: proc.stderr as ReadableStream<Uint8Array>,
      wait: async () => ({ exitCode: done(opts, onAbort, await proc.exited) }),
      kill: async () => {
        onAbort();
      },
    };
  };

  const run = async (opts: SandboxProcessOptions) => {
    const { proc, onAbort } = start([...spec.cmd, opts.command], {
      cwd: opts.workingDirectory,
      env: opts.env,
      abortSignal: opts.abortSignal,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    done(opts, onAbort, exitCode);
    return { exitCode, stdout, stderr };
  };

  const readStream = (path: string, abortSignal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null> =>
    new Promise((resolve) => {
      const file = Bun.file(path);
      if (abortSignal?.aborted) return resolve(null);
      file
        .exists()
        .then((exists) => resolve(exists ? file.stream() : null))
        .catch(() => resolve(null));
    });

  const readText = async (path: string, opts?: { startLine?: number; endLine?: number }): Promise<string | null> => {
    let text: string;
    try {
      const file = Bun.file(path);
      if (!(await file.exists())) return null;
      text = await file.text();
    } catch {
      return null;
    }
    if (!opts?.startLine && !opts?.endLine) return text;
    const lines = text.split("\n");
    const startLine = Math.max(1, opts?.startLine ?? 1);
    const endLine = Math.min(lines.length, opts?.endLine ?? lines.length);
    return lines.slice(startLine - 1, endLine).join("\n");
  };

  return {
    root,
    description: `Local sandbox: shell commands run via the user's shell in ${root}; relative file paths resolve against this root.`,
    readFile: (opts) => readStream(resolveInRoot(opts.path), opts.abortSignal),
    readBinaryFile: async (opts) => {
      try {
        const file = Bun.file(resolveInRoot(opts.path));
        if (!(await file.exists())) return null;
        return new Uint8Array(await file.arrayBuffer());
      } catch {
        return null;
      }
    },
    readTextFile: async (opts) => {
      try {
        return await readText(resolveInRoot(opts.path), opts);
      } catch (error) {
        if ((error as { code?: string })?.code === MISSING) return null;
        return null;
      }
    },
    writeFile: async (opts) => {
      const path = resolveInRoot(opts.path);
      await mkdir(dirname(path), { recursive: true });
      const bytes = opts.content instanceof Uint8Array ? opts.content : new Uint8Array(await new Response(opts.content).arrayBuffer());
      await Bun.write(path, bytes);
    },
    writeBinaryFile: async (opts) => {
      const path = resolveInRoot(opts.path);
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, opts.content);
    },
    writeTextFile: async (opts) => {
      const path = resolveInRoot(opts.path);
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, opts.content);
    },
    spawn,
    run,
    exec: async (argv, opts = {}) => {
      const { proc, onAbort } = start(argv, opts);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      done(opts, onAbort, exitCode);
      return { exitCode, stdout, stderr };
    },
  };
}
