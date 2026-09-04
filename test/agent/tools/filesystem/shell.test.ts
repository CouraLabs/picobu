import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type z from "zod";
import { createShellTool, ShellToolArgsSchema } from "@agent/tools/filesystem/shell.ts";
import { createLocalSandboxSession } from "@agent/tools/sandbox.ts";

describe("shellTool", () => {
  test("returns the command's trimmed stdout", async () => {
    const result = await createShellTool().handler({
      command: "echo picobu-shell-test",
    } satisfies z.infer<typeof ShellToolArgsSchema>);
    expect(result).toBe("picobu-shell-test");
  });

  test("a silent command yields the (no output) placeholder", async () => {
    const result = await createShellTool().handler({
      command: "true",
    } satisfies z.infer<typeof ShellToolArgsSchema>);
    expect(result).toBe("(no output)");
  });

  test("cwd is honored (relative to the process cwd)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shell-tool-"));
    try {
      const result = await createShellTool().handler({
        command: "pwd",
        cwd: dir,
      } satisfies z.infer<typeof ShellToolArgsSchema>);
      // macOS tmpdir paths may pass through the /var -> /private/var symlink.
      expect(result).toBe(await realpath(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("non-zero exits throw with the exit code and stderr detail", async () => {
    await expect(
      createShellTool().handler({
        command: 'echo "stdout noise" >&1; echo "boom" >&2; exit 3',
      } satisfies z.infer<typeof ShellToolArgsSchema>),
    ).rejects.toThrow("command `echo \"stdout noise\" >&1; echo \"boom\" >&2; exit 3` exited 3\nstderr:\nboom\nstdout:\nstdout noise");
  });

  test("with a session sandbox the command runs in the sandbox root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shell-tool-"));
    try {
      const result = await createShellTool().handler(
        { command: "pwd" } satisfies z.infer<typeof ShellToolArgsSchema>,
        { experimental_sandbox: createLocalSandboxSession(dir, "Bash") },
      );
      expect(result).toBe(await realpath(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
