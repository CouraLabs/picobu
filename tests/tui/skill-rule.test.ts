import { describe, expect, test } from "bun:test";
import { knowledgeDetail, summarizeToolError, summarizeToolOutput } from "../../src/tui/components/session/tools/tool-summary.ts";

const skillOutput = {
  name: "opentui",
  description: "Build terminal UIs with OpenTUI.",
  skillFile: "/repo/.agents/skills/opentui/SKILL.md",
  skillDir: "/repo/.agents/skills/opentui",
  files: ["SKILL.md", "docs/a.mdx", "docs/b.mdx"],
  content: `# OpenTUI Skill\n${"body line\n".repeat(500)}`,
};

const ruleOutput = {
  name: "testing",
  description: "Applies when generating tests.",
  ruleFile: "/repo/.agents/rules/testing.md",
  content: "# Testing\nBe thorough.",
};

describe("skill/rule output summaries", () => {
  test("collapsed preview shows the description, never raw JSON", () => {
    const skill = summarizeToolOutput("skill", skillOutput);
    expect(skill).toBe("Build terminal UIs with OpenTUI.");
    expect(skill).not.toContain("skillFile");
    const rule = summarizeToolOutput("rule", ruleOutput);
    expect(rule).toBe("Applies when generating tests.");
    expect(rule).not.toContain("ruleFile");
  });
  test("missing description falls back to undefined instead of JSON", () => {
    expect(summarizeToolOutput("skill", { name: "x" })).toBeUndefined();
  });
});

describe("summarizeToolError", () => {
  test("humanizes invalid tool input rejections", () => {
    expect(summarizeToolError("AI_InvalidToolInputError: Invalid input for tool ask: boom")).toBe("rejected: invalid input");
    expect(summarizeToolOutput("ask", null, "AI_InvalidToolInputError: Invalid input for tool ask: boom")).toBe("rejected: invalid input");
  });
  test("passes other errors through single-lined", () => {
    expect(summarizeToolError("plain\nmultiline  failure")).toBe("plain multiline failure");
  });
});

describe("knowledgeDetail", () => {
  test("extracts skill source info", () => {
    const detail = knowledgeDetail({ type: "tool-skill", input: { name: "opentui" }, output: skillOutput });
    expect(detail?.kind).toBe("skill");
    expect(detail?.name).toBe("opentui");
    expect(detail?.file).toBe("/repo/.agents/skills/opentui/SKILL.md");
    expect(detail?.relatedFiles).toBe(3);
  });
  test("extracts rule source info", () => {
    const detail = knowledgeDetail({ type: "tool-rule", input: { name: "testing" }, output: ruleOutput });
    expect(detail?.kind).toBe("rule");
    expect(detail?.file).toBe("/repo/.agents/rules/testing.md");
    expect(detail?.relatedFiles).toBe(0);
  });
  test("rejects other tools and missing outputs", () => {
    expect(knowledgeDetail({ type: "tool-read", output: skillOutput })).toBeUndefined();
    expect(knowledgeDetail({ type: "tool-skill", input: { name: "x" } })).toBeUndefined();
    expect(knowledgeDetail({ type: "tool-skill", input: {}, output: {} })).toBeUndefined();
  });
});
