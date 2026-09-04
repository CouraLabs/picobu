import { describe, expect, test } from "bun:test";
import { buildRulesSection, buildSkillsSection, buildSubagentsSection, generateSystemMessage } from "@agent/prompts/system.ts";

const skills = [
  { name: "demo", description: "Demo skill" },
  { name: "other", description: "Other skill" },
];

const rules = [
  { name: "testing", description: "Rules applied when generating tests" },
  { name: "commits", description: "Conventional commit rules" },
];

describe("generateSystemMessage", () => {
  test("builds the template sections without optional content", () => {
    const sections = generateSystemMessage({
      appName: "picobu",
      cwd: "/tmp",
      os: "darwin",
      shell: "/bin/zsh",
    });
    const keys = sections.map((s) => s.key);
    expect(keys).toContain("System Preamble");
    expect(keys).toContain("System Environment");
    expect(keys).not.toContain("Skills");
    expect(keys).not.toContain("Rules");
    expect(keys).not.toContain("Available Tools");
    // The AGENTS.md hint is gone: the file loads automatically instead.
    const guidelines = sections.find((s) => s.key === "System Guideless")!;
    expect(guidelines.content).not.toContain("AGENTS.md");
  });

  test("appends Agent Role, Skills, Rules, and Available Tools in order", () => {
    const sections = generateSystemMessage({
      appName: "picobu",
      cwd: "/tmp",
      os: "darwin",
      shell: "/bin/zsh",
      agentPrompt: "You are the coder.",
      skillsInfo: buildSkillsSection(skills),
      rulesInfo: buildRulesSection(rules),
      toolsInfo: "### read\nReads a file.",
    });
    const keys = sections.map((s) => s.key);
    expect(keys.indexOf("Agent Role")).toBeLessThan(keys.indexOf("Skills"));
    expect(keys.indexOf("Skills")).toBeLessThan(keys.indexOf("Rules"));
    expect(keys.indexOf("Rules")).toBeLessThan(keys.indexOf("Available Tools"));
    expect(sections.find((s) => s.key === "Skills")!.content).toContain("- demo: Demo skill");
    expect(sections.find((s) => s.key === "Rules")!.content).toContain(
      "- testing: Rules applied when generating tests",
    );
  });

  test("concatenates the agents appendix at the end of the guidelines section", () => {
    const sections = generateSystemMessage({
      appName: "picobu",
      cwd: "/tmp",
      os: "darwin",
      shell: "/bin/zsh",
      agentsAppendix: "# Project Conventions\n\nUse bun.",
    });
    const guidelines = sections.find((s) => s.key === "System Guideless")!;
    expect(guidelines.content.endsWith("Use bun.")).toBe(true);
    expect(guidelines.content).toContain("# Project Conventions");
    // Still a single guidelines section (no new section was introduced).
    expect(sections.filter((s) => s.key === "System Guideless")).toHaveLength(1);
  });
});

describe("buildSkillsSection", () => {
  test("guides toward the skill tool and lists every skill", () => {
    const content = buildSkillsSection(skills);
    expect(content).toContain("`skill` tool");
    expect(content).toContain("- demo: Demo skill");
    expect(content).toContain("- other: Other skill");
  });
});

describe("buildRulesSection", () => {
  test("guides toward the rule tool and lists every rule", () => {
    const content = buildRulesSection(rules);
    expect(content).toContain("`rule` tool");
    expect(content).toContain("- testing: Rules applied when generating tests");
    expect(content).toContain("- commits: Conventional commit rules");
  });
});

describe("buildSubagentsSection", () => {
  test("guides toward the spawn tool, lists subagents, and states the concurrency cap", () => {
    const content = buildSubagentsSection(
      [
        { name: "executor", description: "Executes multi-step tasks" },
        { name: "explorer", description: "Explores codebases" },
      ],
      4,
    );
    expect(content).toContain("`spawn` tool");
    expect(content).toContain("self-contained prompt");
    expect(content).toContain("up to 4 sub agents concurrently");
    expect(content).toContain("- executor: Executes multi-step tasks");
    expect(content).toContain("- explorer: Explores codebases");
  });

  test("reports spawning as disabled when maxAgents is 0", () => {
    const content = buildSubagentsSection([{ name: "executor", description: "x" }], 0);
    expect(content).toContain("spawning is disabled (maxAgents is 0)");
  });
});
