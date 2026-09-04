import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import z from "zod";
import type { Command } from "@agent/commands/index.ts";
import { createSkillTool, SkillToolArgsSchema } from "@agent/tools/flow/skill.ts";

let root = "";

const skillEntry = (name: string): Command => ({
  kind: "skill",
  name,
  aliases: [],
  title: name,
  description: `${name} description`,
  path: join(root, name, "SKILL.md"),
});

beforeAll(async () => {
  root = join(tmpdir(), `picobu-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(root, "demo", "nested"), { recursive: true });
  await mkdir(join(root, "other"), { recursive: true });
  await writeFile(
    join(root, "demo", "SKILL.md"),
    "---\nname: demo\ndescription: Demo skill\n---\n\n# Demo\n\nDo the demo thing. See ref.md and nested/deep.md.\n",
  );
  await writeFile(join(root, "demo", "ref.md"), "reference\n");
  await writeFile(join(root, "demo", "nested", "deep.md"), "deep\n");
  await writeFile(join(root, "demo", ".hidden.md"), "hidden\n");
  await writeFile(join(root, "other", "SKILL.md"), "---\nname: other\ndescription: Other skill\n---\n\nOther.\n");
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("skill tool", () => {
  test("loads the SKILL.md body stripped of frontmatter plus the related file list", async () => {
    const tool = createSkillTool(() => [skillEntry("demo")]);
    const out = await tool.handler({ name: "demo" } satisfies z.infer<typeof SkillToolArgsSchema>);
    expect(out.name).toBe("demo");
    expect(out.description).toBe("demo description");
    expect(out.skillFile).toBe(join(root, "demo", "SKILL.md"));
    expect(out.skillDir).toBe(join(root, "demo"));
    expect(out.content).not.toContain("name: demo");
    expect(out.content).toContain("# Demo");
    expect(out.files).toEqual([".hidden.md", "SKILL.md", "nested/deep.md", "ref.md"]);
  });

  test("matches names case-insensitively", async () => {
    const tool = createSkillTool(() => [skillEntry("demo")]);
    const out = await tool.handler({ name: "  DEMO " } satisfies z.infer<typeof SkillToolArgsSchema>);
    expect(out.name).toBe("demo");
  });

  test("throws with the available skill names on an unknown name", async () => {
    const tool = createSkillTool(() => [skillEntry("demo"), skillEntry("other")]);
    try {
      await tool.handler({ name: "nope" } satisfies z.infer<typeof SkillToolArgsSchema>);
      throw new Error("expected unknown skill to throw");
    } catch (error) {
      expect((error as Error).message).toContain('Unknown skill: "nope"');
      expect((error as Error).message).toContain("demo, other");
    }
  });

  test("empty catalog produces a (none) listing in the error", async () => {
    const tool = createSkillTool(() => []);
    try {
      await tool.handler({ name: "demo" } satisfies z.infer<typeof SkillToolArgsSchema>);
      throw new Error("expected unknown skill to throw");
    } catch (error) {
      expect((error as Error).message).toContain("(none)");
    }
  });
});
