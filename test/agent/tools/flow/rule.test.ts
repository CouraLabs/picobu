import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import z from "zod";
import type { Rule } from "@agent/rules/rules";
import { createRuleTool, RuleToolArgsSchema } from "@agent/tools/flow/rule.ts";

let root = "";

const ruleEntry = (name: string): Rule => ({
  name,
  description: `${name} description`,
  path: join(root, `${name}.md`),
});

beforeAll(async () => {
  root = join(tmpdir(), `picobu-rule-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "testing.md"),
    "---\nname: testing\ndescription: Rules applied when generating tests\n---\n\n# Testing\n\nWrite tests first.\n",
  );
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe("rule tool", () => {
  test("loads the rule body stripped of frontmatter", async () => {
    const tool = createRuleTool(() => [ruleEntry("testing")]);
    const out = await tool.handler({ name: "testing" } satisfies z.infer<typeof RuleToolArgsSchema>);
    expect(out.name).toBe("testing");
    expect(out.description).toBe("testing description");
    expect(out.ruleFile).toBe(join(root, "testing.md"));
    expect(out.content).not.toContain("name: testing");
    expect(out.content).toContain("# Testing");
  });

  test("matches names case-insensitively", async () => {
    const tool = createRuleTool(() => [ruleEntry("testing")]);
    const out = await tool.handler({ name: "  TESTING " } satisfies z.infer<typeof RuleToolArgsSchema>);
    expect(out.name).toBe("testing");
  });

  test("throws with the available rule names on an unknown name", async () => {
    const tool = createRuleTool(() => [ruleEntry("testing"), ruleEntry("other")]);
    try {
      await tool.handler({ name: "nope" } satisfies z.infer<typeof RuleToolArgsSchema>);
      throw new Error("expected unknown rule to throw");
    } catch (error) {
      expect((error as Error).message).toContain('Unknown rule: "nope"');
      expect((error as Error).message).toContain("testing, other");
    }
  });

  test("empty catalog produces a (none) listing in the error", async () => {
    const tool = createRuleTool(() => []);
    try {
      await tool.handler({ name: "testing" } satisfies z.infer<typeof RuleToolArgsSchema>);
      throw new Error("expected unknown rule to throw");
    } catch (error) {
      expect((error as Error).message).toContain("(none)");
    }
  });
});
