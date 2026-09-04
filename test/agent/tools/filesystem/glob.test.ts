import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import z from "zod";
import { globTool, GlobToolArgsSchema } from "@agent/tools/filesystem/glob.ts";

/** Fixture: a git repo whose `.agents/` is hidden AND gitignored. */
let base = "";

const write = async (rel: string, content: string): Promise<void> => {
  const file = join(base, rel);
  await mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  await writeFile(file, content);
};

beforeAll(async () => {
  base = join(tmpdir(), `picobu-glob-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(base, { recursive: true });
  await Bun.spawn(["git", "init", "-q", base]).exited;
  await write(".gitignore", ".agents/\nsecret.txt\nnode_modules\n");
  await write("normal.txt", "hello\n");
  await write("secret.txt", "ignored\n"); // gitignored, not an agent dir
  await write("node_modules/x.js", "ignored\n"); // gitignored
  await write(".agents/skills/demo/SKILL.md", "# demo\n");
  await write(".agents/skills/.hidden.md", "hidden agent file\n");
});

afterAll(() => rm(base, { recursive: true, force: true }));

const glob = (pattern: string): Promise<string> =>
  globTool.handler({ pattern, cwd: base } satisfies z.infer<typeof GlobToolArgsSchema>);

describe("globTool", () => {
  test("respects .gitignore for regular files", async () => {
    const out = await glob("**/*");
    expect(out).toContain("normal.txt");
    expect(out).not.toContain("secret.txt");
    expect(out).not.toContain("node_modules/x.js");
  });

  test("lists agent-dir files even when .agents is gitignored and hidden", async () => {
    expect(await glob("**/SKILL.md")).toBe(".agents/skills/demo/SKILL.md");
  });

  test("includes dot-files inside agent dirs", async () => {
    const out = await glob(".agents/**");
    expect(out).toContain(".agents/skills/demo/SKILL.md");
    expect(out).toContain(".agents/skills/.hidden.md");
  });
});
