import { describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentDirsUnder, insideAgentDir } from "./agent-dirs";
import { options } from "../../../../libs/options";

const makeTemp = async (): Promise<string> => {
  const dir = join(tmpdir(), `picobu-agent-dirs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
};

describe("agentDirsUnder", () => {
  test("finds the base's own .agents when it exists", async () => {
    const base = await makeTemp();
    try {
      const agentDir = join(base, ".agents");
      await mkdir(join(agentDir, "skills", "demo"), { recursive: true });
      const dirs = await agentDirsUnder(base);
      expect(dirs).toEqual([agentDir]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("ignores missing dirs and candidates outside the base", async () => {
    const base = await makeTemp();
    try {
      // No .agents here; the cwd/home/systemDir-derived candidates all point
      // outside the temp base and must be filtered out.
      expect(await agentDirsUnder(base)).toEqual([]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test("dedupes repeated candidates", async () => {
    const base = await makeTemp();
    try {
      // When the base IS the cwd, `base/.agents` and `cwd/.agents` collapse
      // into one entry.
      const savedCwd = process.cwd();
      process.chdir(base);
      try {
        await mkdir(join(base, ".agents"), { recursive: true });
        expect(await agentDirsUnder(base)).toEqual([join(base, ".agents")]);
      } finally {
        process.chdir(savedCwd);
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("insideAgentDir", () => {
  test("any .agents ancestor counts, including the dir itself", () => {
    expect(insideAgentDir("/tmp/x/.agents")).toBe(true);
    expect(insideAgentDir("/tmp/x/.agents/skills/demo/SKILL.md")).toBe(true);
    expect(insideAgentDir("/tmp/x/.agents/skills/.hidden.md")).toBe(true);
  });

  test("regular project paths do not", () => {
    expect(insideAgentDir("/tmp/x/src/cli.ts")).toBe(false);
    expect(insideAgentDir("/tmp/x/agents")).toBe(false); // not dot-prefixed
  });

  test("picobu systemDir agent subdirs count, their parent does not", () => {
    expect(insideAgentDir(join(options.app.systemDir, "skills", "demo", "SKILL.md"))).toBe(true);
    expect(insideAgentDir(join(options.app.systemDir, "rules", "testing.md"))).toBe(true);
    expect(insideAgentDir(join(options.app.systemDir, "options.json"))).toBe(false);
    expect(insideAgentDir(join(process.cwd(), "src/cli.ts"))).toBe(false);
  });
});
