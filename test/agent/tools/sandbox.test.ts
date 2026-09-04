import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalSandboxSession, sandboxRoot } from "@agent/tools/sandbox.ts";

describe("createLocalSandboxSession", () => {
  test("run executes shell-line commands inside the root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-sandbox-"));
    try {
      const sandbox = createLocalSandboxSession(dir, "Unix:Zsh");
      const result = await sandbox.run({ command: "pwd" });
      expect(result.exitCode).toBe(0);
      // /var/... is a symlink to /private/var/... on macOS: compare resolved.
      expect(result.stdout.trim()).toBe(realpathSync(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a relative workingDirectory resolves under the root; absolute paths pass through", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-sandbox-"));
    try {
      await Bun.write(join(dir, "sub/marker.txt"), "hi");
      const sandbox = createLocalSandboxSession(dir, "Unix:Zsh");
      const relative = await sandbox.run({ command: "pwd", workingDirectory: "sub" });
      expect(relative.stdout.trim()).toBe(join(realpathSync(dir), "sub"));
      const absolute = await sandbox.run({ command: "pwd", workingDirectory: join(dir, "sub") });
      expect(absolute.stdout.trim()).toBe(join(realpathSync(dir), "sub"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("non-zero exits carry stdout/stderr instead of throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-sandbox-"));
    try {
      const sandbox = createLocalSandboxSession(dir, "Unix:Zsh");
      const result = await sandbox.run({ command: "echo out; echo err >&2; exit 3" });
      expect(result.exitCode).toBe(3);
      expect(result.stdout.trim()).toBe("out");
      expect(result.stderr.trim()).toBe("err");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("abortSignal kills a running command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-sandbox-"));
    try {
      const sandbox = createLocalSandboxSession(dir, "Unix:Zsh");
      const controller = new AbortController();
      const started = Date.now();
      const run = sandbox.run({ command: "sleep 30", abortSignal: controller.signal });
      setTimeout(() => controller.abort(), 150);
      const result = await run;
      expect(result.exitCode).not.toBe(0);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("exec runs raw argv (ripgrep-style) without shell semantics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-sandbox-"));
    try {
      await Bun.write(join(dir, "f.txt"), "needle\n");
      const sandbox = createLocalSandboxSession(dir, "Unix:Zsh");
      const result = await sandbox.exec(["grep", "-c", "needle", "f.txt"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("file reads and writes resolve relative paths against the root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-sandbox-"));
    try {
      const sandbox = createLocalSandboxSession(dir, "Unix:Zsh");
      await sandbox.writeTextFile({ path: "nested/out.txt", content: "hello" });
      expect(await readFile(join(dir, "nested/out.txt"), "utf8")).toBe("hello");
      expect(await sandbox.readTextFile({ path: "nested/out.txt" })).toBe("hello");
      // Nonexistent reads resolve to null (SDK contract), not throws.
      expect(await sandbox.readTextFile({ path: "missing.txt" })).toBeNull();
      // Line ranges are 1-based and inclusive.
      await Bun.write(join(dir, "lines.txt"), "one\ntwo\nthree\n");
      expect(await sandbox.readTextFile({ path: "lines.txt", startLine: 2, endLine: 3 })).toBe("two\nthree");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("sandboxRoot extracts the root from a local sandbox only", () => {
    expect(sandboxRoot(undefined)).toBeUndefined();
    expect(sandboxRoot({})).toBeUndefined();
    const sandbox = createLocalSandboxSession("/tmp/x", "Unix:Zsh");
    expect(sandboxRoot(sandbox)).toBe("/tmp/x");
  });
});
