import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import z from "zod";
import { grepTool, GrepToolArgsSchema } from "@agent/tools/filesystem/grep.ts";

/** Fixture: a git repo whose `.agents/` is hidden AND gitignored. */
let base = "";

const write = async (rel: string, content: string): Promise<void> => {
  const file = join(base, rel);
  await mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  await writeFile(file, content);
};

const grep = (pattern: string, path?: string): Promise<{ filetype: string; content: string }> =>
  grepTool.handler({ pattern, path } satisfies z.infer<typeof GrepToolArgsSchema>);

beforeAll(async () => {
  base = join(tmpdir(), `picobu-grep-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(base, { recursive: true });
  await Bun.spawn(["git", "init", "-q", base]).exited;
  await write(".gitignore", ".agents/\nsecret.txt\nnode_modules\n");
  await write("normal.txt", "needle normal\n");
  await write("secret.txt", "needle secret\n"); // gitignored, not an agent dir
  await write("node_modules/x.js", "needle node\n"); // gitignored
  await write(".agents/skills/demo/SKILL.md", "needle demo\n");
  await write(".agents/skills/.hidden.md", "needle hiddenfile\n");
});

afterAll(() => rm(base, { recursive: true, force: true }));

describe("grepTool", () => {
  test("respects .gitignore for regular files", async () => {
    const out = await grep("needle", base);
    expect(out.content).toContain("normal.txt:1:needle normal");
    expect(out.content).not.toContain("secret.txt");
    expect(out.content).not.toContain("node_modules");
  });

  test("matches inside agent dirs even when .agents is gitignored and hidden", async () => {
    const out = await grep("needle", base);
    expect(out.content).toContain(".agents/skills/demo/SKILL.md:1:needle demo");
  });

  test("includes dot-files inside agent dirs", async () => {
    const out = await grep("needle", base);
    expect(out.content).toContain(".agents/skills/.hidden.md:1:needle hiddenfile");
  });

  test("agent-dir-only matches still succeed when the main pass finds nothing", async () => {
    const out = await grep("hiddenfile", base);
    expect(out.content).toContain(".agents/skills/.hidden.md");
  });

  test("searching inside an agent dir sees its dot-files too", async () => {
    const out = await grep("needle", join(base, ".agents", "skills"));
    expect(out.content).toContain(".hidden.md");
    expect(out.content).toContain("SKILL.md");
  });

  test("no matches anywhere returns the no-match message", async () => {
    const out = await grep("does-not-exist-anywhere", base);
    expect(out.filetype).toBe("text");
    expect(out.content).toContain("No matches");
  });
});
