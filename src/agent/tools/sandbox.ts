import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Experimental_SandboxProcess, Experimental_SandboxSession } from "ai";

type SandboxProcessOptions = Parameters<Experimental_SandboxSession["run"]>[0];
export type ShellSpec = { cmd: string[] };
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

export type LocalSandboxSession = Experimental_SandboxSession & {
  readonly root: string;
  exec(argv: string[], opts?: { cwd?: string; env?: Record<string, string>; abortSignal?: AbortSignal }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
};
export const sandboxRoot = (sandbox: unknown): string | undefined =>
  typeof sandbox === "object" && sandbox !== null && "root" in sandbox && typeof (sandbox as LocalSandboxSession).root === "string"
    ? (sandbox as LocalSandboxSession).root
    : undefined;
const MISSING = "ENOENT";
export const killProcessTree = (proc: Bun.Subprocess): void => {
  try {
    if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, "SIGKILL");
    else proc.kill(9);
  } catch {}
};
export function createLocalSandboxSession(root: string, shellLabel: string): LocalSandboxSession {
  const spec = shellSpec(shellLabel);
  const normalizedRoot = resolve(root);
  const isInsideRoot = (candidate: string): boolean => {
    const rel = relative(normalizedRoot, candidate);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  const resolveInRoot = (p: string | undefined): string => {
    if (!p) return normalizedRoot;
    if (isAbsolute(p)) {
      const normalized = resolve(p);
      if (!isInsideRoot(normalized)) throw new Error(`Path escapes sandbox root: ${p}`);
      return normalized;
    }
    const joined = resolve(normalizedRoot, p);
    if (!isInsideRoot(joined)) throw new Error(`Path escapes sandbox root: ${p}`);
    return joined;
  };
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
      detached: process.platform !== "win32",
    });
    const onAbort = () => {
      killProcessTree(proc);
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
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    done(opts, onAbort, exitCode);
    return { exitCode, stdout, stderr };
  };
  const readStream = (path: string, abortSignal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null> =>
    new Promise((resolveStream) => {
      let resolved: string;
      try {
        resolved = resolveInRoot(path);
      } catch {
        return resolveStream(null);
      }
      const file = Bun.file(resolved);
      if (abortSignal?.aborted) return resolveStream(null);
      file
        .exists()
        .then((exists) => resolveStream(exists ? file.stream() : null))
        .catch(() => resolveStream(null));
    });
  const readText = async (path: string, opts?: { startLine?: number; endLine?: number }): Promise<string | null> => {
    let resolved: string;
    try {
      resolved = resolveInRoot(path);
    } catch {
      return null;
    }
    let text: string;
    try {
      const file = Bun.file(resolved);
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
    root: normalizedRoot,
    description: `Local sandbox: shell commands run via the user's shell in ${normalizedRoot}; relative file paths resolve against this root.`,
    readFile: (opts) => readStream(opts.path, opts.abortSignal),
    readBinaryFile: async (opts) => {
      let resolved: string;
      try {
        resolved = resolveInRoot(opts.path);
      } catch {
        return null;
      }
      try {
        const file = Bun.file(resolved);
        if (!(await file.exists())) return null;
        return new Uint8Array(await file.arrayBuffer());
      } catch {
        return null;
      }
    },
    readTextFile: async (opts) => {
      try {
        return await readText(opts.path, opts);
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
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      done(opts, onAbort, exitCode);
      return { exitCode, stdout, stderr };
    },
  };
}
