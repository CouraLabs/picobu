import { describe, expect, test } from "bun:test";
import { matchSystemCommand, parseCommandLine, SYSTEM_COMMANDS, toKebab, tokenizeCommandLine } from "../../src/agent/commands/parse-command-line.ts";
import type { Command } from "../../src/agent/commands/types.ts";

const workflow = (name: string): Command => ({
  kind: "workflow",
  name,
  aliases: [],
  title: name,
  description: `${name} description`,
  path: `/tmp/${name}.md`,
});

const skill = (name: string): Command => ({
  kind: "skill",
  name,
  aliases: [],
  title: name,
  description: `${name} skill`,
  path: `/tmp/${name}/SKILL.md`,
});

describe("toKebab", () => {
  test("lowercases and dashes spaces", () => {
    expect(toKebab("My Workflow")).toBe("my-workflow");
    expect(toKebab("Some_Name")).toBe("some-name");
    expect(toKebab("  Compact  ")).toBe("compact");
  });
});

describe("matchSystemCommand", () => {
  test("matches names and aliases", () => {
    expect(matchSystemCommand("q")?.name).toBe("q");
    expect(matchSystemCommand("exit")?.name).toBe("q");
    expect(matchSystemCommand("leave")?.name).toBe("q");
    expect(matchSystemCommand("compact")?.name).toBe("compact");
    expect(matchSystemCommand("roles")?.name).toBe("roles");
    expect(matchSystemCommand("cd")?.name).toBe("cd");
  });
  test("rejects unknown names", () => {
    expect(matchSystemCommand("nope")).toBeUndefined();
  });
  test("every system command has usage and description", () => {
    for (const cmd of SYSTEM_COMMANDS) {
      expect(cmd.usage.startsWith("/")).toBe(true);
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });
});

describe("parseCommandLine", () => {
  test("returns null for non-command text", () => {
    expect(parseCommandLine("hello", [])).toBeNull();
  });
  test("parses a single skill with prompt", () => {
    const parsed = parseCommandLine("/skill:review check this diff", [skill("review")]);
    expect(parsed?.kind).toBe("skills");
    if (parsed?.kind !== "skills") throw new Error("unreachable");
    expect(parsed.skills).toEqual(["review"]);
    expect(parsed.prompt).toBe("check this diff");
  });
  test("chains multiple skills with prompt", () => {
    const parsed = parseCommandLine("/skill:review /skill:tests check this", [skill("review"), skill("tests")]);
    expect(parsed?.kind).toBe("skills");
    if (parsed?.kind !== "skills") throw new Error("unreachable");
    expect(parsed.skills).toEqual(["review", "tests"]);
    expect(parsed.prompt).toBe("check this");
  });
  test("allows load-only skill chains", () => {
    const parsed = parseCommandLine("/skill:review", [skill("review")]);
    expect(parsed?.kind).toBe("skills");
    if (parsed?.kind !== "skills") throw new Error("unreachable");
    expect(parsed.prompt).toBe("");
  });
  test("parses system commands with args", () => {
    const parsed = parseCommandLine("/cd ~/other", []);
    expect(parsed?.kind).toBe("system");
    if (parsed?.kind !== "system") throw new Error("unreachable");
    expect(parsed.command.name).toBe("cd");
    expect(parsed.args).toBe("~/other");
  });
  test("resolves aliases to system commands", () => {
    const parsed = parseCommandLine("/exit", []);
    expect(parsed?.kind).toBe("system");
    if (parsed?.kind !== "system") throw new Error("unreachable");
    expect(parsed.command.name).toBe("q");
  });
  test("resolves kebab workflow names", () => {
    const parsed = parseCommandLine("/my-workflow some arg", [workflow("My Workflow")]);
    expect(parsed?.kind).toBe("workflow");
    if (parsed?.kind !== "workflow") throw new Error("unreachable");
    expect(parsed.command.name).toBe("My Workflow");
    expect(parsed.args).toBe("some arg");
  });
  test("reports unknown commands", () => {
    const parsed = parseCommandLine("/nope", []);
    expect(parsed?.kind).toBe("unknown");
  });
});

describe("tokenizeCommandLine", () => {
  test("marks skill and command tokens", () => {
    const tokens = tokenizeCommandLine("/skill:review /compact check it");
    const kinds = tokens.filter((t) => t.text.trim().length > 0).map((t) => [t.text, t.kind]);
    expect(kinds).toEqual([
      ["/skill:review", "skill"],
      ["/compact", "command"],
      ["check", "text"],
      ["it", "text"],
    ]);
  });
  test("treats plain text as text", () => {
    expect(tokenizeCommandLine("hello")?.[0]?.kind).toBe("text");
  });
});
