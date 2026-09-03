import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRules } from "./rules";
import { options } from "../../libs/options";

let root = "";
const original = {
  cwd: options.app.cwd,
  systemDir: options.app.systemDir,
  homeDir: options.app.homeDir,
};

beforeAll(async () => {
  root = join(tmpdir(), `picobu-rules-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // Point every root at the temp tree, like sessions.test.ts does for systemDir.
  options.app.cwd = join(root, "project");
  options.app.systemDir = join(root, "picobu-home");
  options.app.homeDir = join(root, "home");
  await mkdir(join(options.app.cwd, ".agents", "rules"), { recursive: true });
  await mkdir(join(options.app.systemDir, "rules"), { recursive: true });
  await mkdir(join(options.app.homeDir, ".agents", "rules"), { recursive: true });
});

afterAll(() => {
  Object.assign(options.app, original);
  return rm(root, { recursive: true, force: true });
});

describe("loadRules", () => {
  test("discovers rules with frontmatter name/description and filename fallback", async () => {
    const projectRoot = join(options.app.cwd, ".agents", "rules");
    await writeFile(
      join(projectRoot, "testing.md"),
      "---\nname: testing\ndescription: Rules applied when generating tests\n---\n\n# Testing\n\nWrite tests.\n",
    );
    await writeFile(
      join(projectRoot, "commits.md"),
      "---\ndescription: Conventional commit rules\n---\n\nUse conventional commits.\n",
    );

    const rules = await loadRules();
    const testing = rules.find((r) => r.name === "testing");
    expect(testing).toBeDefined();
    expect(testing!.description).toBe("Rules applied when generating tests");
    expect(testing!.path).toBe(join(projectRoot, "testing.md"));
    // No `name` in frontmatter -> file basename.
    expect(rules.find((r) => r.name === "commits")).toBeDefined();
  });

  test("skips rules with an empty description", async () => {
    const projectRoot = join(options.app.cwd, ".agents", "rules");
    await writeFile(join(projectRoot, "no-desc.md"), "---\nname: no-desc\n---\n\nBody only.\n");
    const rules = await loadRules();
    expect(rules.find((r) => r.name === "no-desc")).toBeUndefined();
  });

  test("first root wins on a name collision (project over systemDir over home)", async () => {
    await writeFile(
      join(options.app.cwd, ".agents", "rules", "dup.md"),
      "---\nname: dup\ndescription: from project\n---\n\nproject body\n",
    );
    await writeFile(
      join(options.app.systemDir, "rules", "dup.md"),
      "---\nname: dup\ndescription: from systemDir\n---\n\nsystem body\n",
    );

    const rules = await loadRules();
    expect(rules.filter((r) => r.name === "dup")).toHaveLength(1);
    expect(rules.find((r) => r.name === "dup")!.description).toBe("from project");
  });

  test("picks up systemDir and home .agents roots, ignoring missing dirs", async () => {
    await writeFile(
      join(options.app.systemDir, "rules", "system-only.md"),
      "---\nname: system-only\ndescription: From the picobu systemDir\n---\n\nbody\n",
    );
    await writeFile(
      join(options.app.homeDir, ".agents", "rules", "home-only.md"),
      "---\nname: home-only\ndescription: From the home .agents dir\n---\n\nbody\n",
    );

    const rules = await loadRules();
    expect(rules.find((r) => r.name === "system-only")).toBeDefined();
    expect(rules.find((r) => r.name === "home-only")).toBeDefined();
    // A root that does not exist contributes nothing and never throws.
    expect(rules.find((r) => r.name === "missing")).toBeUndefined();
  });
});
