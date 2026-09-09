import { describe, expect, test } from "bun:test";
import { RGBA, type TerminalColors } from "@opentui/core";
import { EXTENSION_LANGUAGE, filetypeFromPath } from "../../src/tui/components/diff.tsx";
import { icons } from "../../src/tui/themes/icons.ts";
import { allThemes, generateSystem, hasTheme, isTheme, resolveTheme, terminalMode, tint, type ThemeJson } from "../../src/tui/themes/index.ts";
import {
  asToolPart,
  diffStats,
  flowOutputMessage,
  flowOutputStatus,
  isToolPart,
  planText,
  previewToolInput,
  rawToolName,
  summarizeToolInput,
  summarizeToolOutput,
  toolAskQuestions,
  toolDiff,
  toolDisplayName,
  toolProgress,
  toolStateView,
  type ToolPartLike,
} from "../../src/tui/components/session/tools/tool-summary.ts";

const part = (overrides: Partial<ToolPartLike> & Record<string, unknown> = {}): ToolPartLike => ({ type: "tool-read", ...overrides });

describe("isToolPart/asToolPart", () => {
  test("matches tool- prefix and dynamic-tool", () => {
    expect(isToolPart({ type: "tool-read" })).toBe(true);
    expect(isToolPart({ type: "tool-shell", state: "output-available" })).toBe(true);
    expect(isToolPart({ type: "dynamic-tool", toolName: "x" })).toBe(true);
  });
  test("rejects non-tool parts and malformed values", () => {
    expect(isToolPart({ type: "text" })).toBe(false);
    expect(isToolPart({ type: "reasoning" })).toBe(false);
    expect(isToolPart({})).toBe(false);
    expect(isToolPart({ type: 42 })).toBe(false);
    expect(isToolPart(null)).toBe(false);
    expect(isToolPart(undefined)).toBe(false);
    expect(isToolPart("tool-read")).toBe(false);
  });
  test("asToolPart narrows or returns undefined", () => {
    const p = { type: "tool-glob" };
    expect(asToolPart(p)).toBe(p);
    expect(asToolPart({ type: "text" })).toBeUndefined();
    expect(asToolPart(null)).toBeUndefined();
  });
});

describe("rawToolName/toolDisplayName", () => {
  test("strips tool- prefix", () => {
    expect(rawToolName(part({ type: "tool-shell" }))).toBe("shell");
    expect(rawToolName(part({ type: "tool-plan-write" }))).toBe("plan-write");
  });
  test("dynamic-tool uses toolName with fallback", () => {
    expect(rawToolName(part({ type: "dynamic-tool", toolName: "mcp__fetch" }))).toBe("mcp__fetch");
    expect(rawToolName(part({ type: "dynamic-tool" }))).toBe("tool");
  });
  test("display name capitalizes first letter", () => {
    expect(toolDisplayName(part({ type: "tool-read" }))).toBe("Read");
    expect(toolDisplayName(part({ type: "dynamic-tool", toolName: "fetch" }))).toBe("Fetch");
  });
});

describe("toolStateView/toolProgress", () => {
  test("maps every lifecycle state to icon and tone", () => {
    expect(toolStateView(part({ state: "input-streaming" }))).toEqual({ icon: icons.running, tone: "running" });
    expect(toolStateView(part({ state: "output-available" }))).toEqual({ icon: icons.success, tone: "success" });
    expect(toolStateView(part({ state: "output-error" }))).toEqual({ icon: icons.error, tone: "error" });
    expect(toolStateView(part({ state: "output-denied" }))).toEqual({ icon: icons.warning, tone: "warning" });
    expect(toolStateView(part({ state: "approval-requested" }))).toEqual({ icon: icons.question, tone: "pending" });
    expect(toolStateView(part({ state: "approval-responded" }))).toEqual({ icon: icons.info, tone: "info" });
  });
  test("preliminary output stays running and unknown stays pending", () => {
    expect(toolStateView(part({ state: "output-available", preliminary: true }))).toEqual({ icon: icons.running, tone: "running" });
    expect(toolStateView(part({}))).toEqual({ icon: icons.pending, tone: "pending" });
    expect(toolStateView(part({ state: "bogus" }))).toEqual({ icon: icons.pending, tone: "pending" });
  });
  test("progress only surfaces for preliminary results", () => {
    expect(toolProgress(part({ preliminary: true, output: { progress: "halfway" } }))).toBe("halfway");
    expect(toolProgress(part({ output: { progress: "halfway" } }))).toBeUndefined();
    expect(toolProgress(part({ preliminary: true, output: {} }))).toBeUndefined();
    expect(toolProgress(part({ preliminary: true, output: { progress: "" } }))).toBeUndefined();
    expect(toolProgress(part({ preliminary: true, output: { progress: 42 } }))).toBeUndefined();
  });
});

describe("summarizeToolInput", () => {
  test("read carries optional line range", () => {
    expect(summarizeToolInput("read", { path: "a.ts", fromLine: 2, toLine: 9 })).toBe("a.ts:2-9");
    expect(summarizeToolInput("read", { path: "a.ts" })).toBe("a.ts");
    expect(summarizeToolInput("read", {})).toBe("?");
  });
  test("path, pattern, command, query, url, name tools", () => {
    expect(summarizeToolInput("write", { path: "b.ts" })).toBe("b.ts");
    expect(summarizeToolInput("edit", {})).toBe("?");
    expect(summarizeToolInput("glob", { pattern: "*.ts" })).toBe("*.ts");
    expect(summarizeToolInput("grep", {})).toBe("?");
    expect(summarizeToolInput("shell", { command: "ls" })).toBe("ls");
    expect(summarizeToolInput("websearch", { query: "q" })).toBe("q");
    expect(summarizeToolInput("webfetch", { url: "https://x" })).toBe("https://x");
    expect(summarizeToolInput("skill", { name: "n" })).toBe("n");
    expect(summarizeToolInput("rule", {})).toBe("?");
  });
  test("ask uses first question title", () => {
    expect(summarizeToolInput("ask", { questions: [{ title: "Pick one" }] })).toBe("Pick one");
    expect(summarizeToolInput("ask", { questions: [] })).toBe("?");
    expect(summarizeToolInput("ask", {})).toBe("?");
  });
  test("plan-write counts lines", () => {
    expect(summarizeToolInput("plan-write", { plan: "a\nb\nc" })).toBe("3 lines");
    expect(summarizeToolInput("plan-write", { plan: "" })).toBe("0 lines");
    expect(summarizeToolInput("plan-write", {})).toBe("?");
  });
  test("todo summarizes mutations", () => {
    expect(summarizeToolInput("todo", { actionType: "ins", action: { ins: [1, 2] } })).toBe("+2");
    expect(summarizeToolInput("todo", { actionType: "del" })).toBe("remove");
    expect(summarizeToolInput("todo", { actionType: "upd" })).toBe("update");
    expect(summarizeToolInput("todo", {})).toBe("?");
  });
  test("names are case-insensitive with ? fallback", () => {
    expect(summarizeToolInput("READ", { path: "x" })).toBe("x");
    expect(summarizeToolInput("mystery", { path: "x" })).toBe("?");
  });
});

describe("previewToolInput/summarizeToolOutput", () => {
  test("preview collapses whitespace and truncates", () => {
    expect(previewToolInput("hi")).toBe("hi");
    expect(previewToolInput("a\n\nb")).toBe("a b");
    expect(previewToolInput(undefined)).toBe("");
    const long = previewToolInput("a".repeat(500));
    expect(long.length).toBe(120);
    expect(long.endsWith("…")).toBe(true);
  });
  test("error text wins and empties vanish", () => {
    expect(summarizeToolOutput("read", { content: "x" }, "boom")).toBe("boom");
    expect(summarizeToolOutput("read", undefined)).toBeUndefined();
    expect(summarizeToolOutput("read", null)).toBeUndefined();
    expect(summarizeToolOutput("read", "")).toBeUndefined();
  });
  test("read/grep/glob counts", () => {
    expect(summarizeToolOutput("read", { content: "a\nb\nc", filetype: "ts" })).toBe("3 lines · ts");
    expect(summarizeToolOutput("read", { content: "a" })).toBe("1 lines");
    expect(summarizeToolOutput("grep", { content: "x\ny" })).toBe("2 lines");
    expect(summarizeToolOutput("read", {})).toBeUndefined();
    expect(summarizeToolOutput("glob", "a\nb\nc")).toBe("3 matches");
    expect(summarizeToolOutput("glob", { matches: 2 })).toBeUndefined();
  });
  test("write/edit surface line counts or diff stats", () => {
    expect(summarizeToolOutput("write", "a\nb")).toBe("2 lines written");
    expect(summarizeToolOutput("write", { content: "a" })).toBe("1 lines written");
    expect(summarizeToolOutput("write", { diff: "+a\n-b\n c" })).toBe("1+ 1−");
    expect(summarizeToolOutput("write", {})).toBeUndefined();
    expect(summarizeToolOutput("edit", { diff: "+a\n+b" })).toBe("2+ 0−");
    expect(summarizeToolOutput("edit", {})).toBeUndefined();
  });
  test("shell shows last meaningful line for multiline output", () => {
    expect(summarizeToolOutput("shell", "ok")).toBe("ok");
    expect(summarizeToolOutput("shell", "l1\nl2\nl3")).toBe("3 lines · l3");
    expect(summarizeToolOutput("shell", { exit: 0 })).toBeUndefined();
  });
  test("search/ask/plan/todo/fetch summaries", () => {
    expect(summarizeToolOutput("websearch", { results: [1, 2, 3] })).toBe("3 results");
    expect(summarizeToolOutput("websearch", {})).toBeUndefined();
    expect(summarizeToolOutput("ask", { message: "hello" })).toBe("hello");
    expect(summarizeToolOutput("ask", { message: "" })).toBeUndefined();
    expect(summarizeToolOutput("plan-write", { message: "m", status: "done" })).toBe("done · m");
    expect(summarizeToolOutput("plan-write", { message: "m", status: "pending" })).toBe("m");
    expect(summarizeToolOutput("plan-write", { status: "done" })).toBe("done ·");
    expect(summarizeToolOutput("plan-write", {})).toBeUndefined();
    expect(summarizeToolOutput("todo", { items: [{ done: true }, { done: false }] })).toBe("1 of 2 done");
    expect(summarizeToolOutput("todo", {})).toBeUndefined();
    expect(summarizeToolOutput("webfetch", { content: "a\nb" })).toBe("2 lines");
    expect(summarizeToolOutput("webfetch", {})).toBeUndefined();
    expect(summarizeToolOutput("mystery", { a: 1 })).toBe('{"a":1}');
  });
});

describe("diffStats/toolDiff", () => {
  test("counts added and removed lines", () => {
    expect(diffStats("+a\n-b\n c")).toEqual({ added: 1, removed: 1 });
    expect(diffStats("")).toEqual({ added: 0, removed: 0 });
    expect(diffStats(" context\n")).toEqual({ added: 0, removed: 0 });
  });
  test("skips +++ and --- headers in every form", () => {
    expect(diffStats("+++ b/f\n--- a/f\n+a")).toEqual({ added: 1, removed: 0 });
    expect(diffStats("+++\n---\n-a")).toEqual({ added: 0, removed: 1 });
    expect(diffStats("+++\tb/f\n---\ta/f\n+a\n-b")).toEqual({ added: 1, removed: 1 });
    expect(diffStats("@@ -1 +1 @@\n+a")).toEqual({ added: 1, removed: 0 });
  });
  test("toolDiff extracts non-empty diffs", () => {
    expect(toolDiff({ diff: "d" })).toBe("d");
    expect(toolDiff({ diff: "" })).toBeUndefined();
    expect(toolDiff({})).toBeUndefined();
    expect(toolDiff("x")).toBeUndefined();
    expect(toolDiff(null)).toBeUndefined();
  });
});

describe("toolAskQuestions/flow/planText", () => {
  test("parses questions with typed options", () => {
    const out = toolAskQuestions({
      questions: [
        { title: "T", question: "Q?", type: "multiple", options: [{ answer: "A", answerDescription: "desc" }, { answer: "" }] },
        { title: "", question: "skip", options: [{ answer: "A" }] },
        { title: "NoOpts", options: [] },
        "junk",
      ],
    });
    expect(out).toEqual([{ title: "T", question: "Q?", type: "multiple", options: [{ answer: "A", answerDescription: "desc" }] }]);
  });
  test("defaults question text and single type", () => {
    expect(toolAskQuestions({ questions: [{ title: "T", options: [{ answer: "A" }] }] })).toEqual([
      { title: "T", question: "", type: "single", options: [{ answer: "A", answerDescription: undefined }] },
    ]);
    expect(toolAskQuestions({})).toEqual([]);
    expect(toolAskQuestions(null)).toEqual([]);
  });
  test("flow status/message and plan text", () => {
    expect(flowOutputStatus(part({ output: { status: "done" } }))).toBe("done");
    expect(flowOutputStatus(part({}))).toBeUndefined();
    expect(flowOutputStatus(part({ output: "x" }))).toBeUndefined();
    expect(flowOutputMessage(part({ output: { message: "m" } }))).toBe("m");
    expect(flowOutputMessage(part({}))).toBe("");
    expect(planText({ plan: "p" })).toBe("p");
    expect(planText({ plan: "" })).toBeUndefined();
    expect(planText({})).toBeUndefined();
  });
});

describe("filetypeFromPath", () => {
  test("maps known extensions", () => {
    expect(filetypeFromPath("src/app.ts")).toBe("typescript");
    expect(filetypeFromPath("a.tsx")).toBe("typescriptreact");
    expect(filetypeFromPath("a.jsx")).toBe("javascriptreact");
    expect(filetypeFromPath("a.js")).toBe("javascript");
    expect(filetypeFromPath("a.mjs")).toBe("javascript");
    expect(filetypeFromPath("a.cjs")).toBe("javascript");
    expect(filetypeFromPath("s.py")).toBe("python");
    expect(filetypeFromPath("r.rb")).toBe("ruby");
    expect(filetypeFromPath("m.rs")).toBe("rust");
    expect(filetypeFromPath("x.sh")).toBe("bash");
    expect(filetypeFromPath("d.md")).toBe("markdown");
    expect(filetypeFromPath("d.mdx")).toBe("markdown");
    expect(filetypeFromPath("c.yml")).toBe("yaml");
    expect(filetypeFromPath("j.jsonc")).toBe("json");
    expect(filetypeFromPath("p.ps1")).toBe("powershell");
    expect(filetypeFromPath("c.svelte")).toBe("svelte");
    expect(filetypeFromPath("o.m")).toBe("objc");
  });
  test("handles dotfiles, missing and unknown extensions", () => {
    expect(filetypeFromPath(".gitignore")).toBe("plaintext");
    expect(filetypeFromPath(".bashrc")).toBe("plaintext");
    expect(filetypeFromPath("README")).toBe("plaintext");
    expect(filetypeFromPath("foo.")).toBe("plaintext");
    expect(filetypeFromPath(".config.json")).toBe("json");
    expect(filetypeFromPath("a.json")).toBe("json");
    expect(filetypeFromPath("archive.UNKNOWNEXT")).toBe("unknownext");
    expect(filetypeFromPath("App.TS")).toBe("typescript");
    expect(filetypeFromPath("a/b/c.py")).toBe("python");
  });
  test("language map is non-empty with plaintext fallback", () => {
    expect(Object.keys(EXTENSION_LANGUAGE).length).toBeGreaterThan(10);
    expect(EXTENSION_LANGUAGE[""]).toBe("plaintext");
  });
});

describe("icons", () => {
  test("map is non-empty with non-blank glyphs", () => {
    const entries = Object.entries(icons);
    expect(entries.length).toBeGreaterThan(50);
    for (const [, value] of entries) expect(value.length).toBeGreaterThan(0);
  });
  test("status glyphs match tool-state views", () => {
    expect(icons.success).toBe("✓");
    expect(icons.error).toBe("✘");
    expect(icons.warning).toBe("▲");
    expect(icons.info).toBe("ℹ");
    expect(icons.question).toBe("?");
    expect(icons.pending).toBe("◌");
    expect(icons.running).toBe("◐");
  });
});

describe("theme registry", () => {
  test("allThemes is non-empty and sorted-friendly", () => {
    const names = Object.keys(allThemes());
    expect(names.length).toBeGreaterThan(20);
    expect(names).toContain("tacos");
    expect(names).toContain("dracula");
  });
  test("hasTheme guards blank and unknown names", () => {
    expect(hasTheme("tacos")).toBe(true);
    expect(hasTheme("")).toBe(false);
    expect(hasTheme("no-such-theme")).toBe(false);
  });
  test("isTheme validates shape", () => {
    expect(isTheme({ theme: {} })).toBe(true);
    expect(isTheme(null)).toBe(false);
    expect(isTheme([])).toBe(false);
    expect(isTheme({})).toBe(false);
    expect(isTheme({ theme: [] })).toBe(false);
    expect(isTheme("x")).toBe(false);
  });
});

describe("resolveTheme", () => {
  const tacos = (): ThemeJson => {
    const found = allThemes()["tacos"];
    if (!found) throw new Error("tacos theme missing");
    return found;
  };
  test("preserves dark/light variants", () => {
    const variant: ThemeJson = { ...tacos(), theme: { ...tacos().theme, primary: { dark: "#000000", light: "#ffffff" } } };
    expect(resolveTheme(variant, "dark").primary.r).toBe(0);
    expect(resolveTheme(variant, "light").primary.r).toBe(1);
  });
  test("resolves defs references", () => {
    const ref: ThemeJson = { defs: { ...tacos().defs, brand: "#ff0000" }, theme: { ...tacos().theme, primary: "brand" } };
    const resolved = resolveTheme(ref, "dark");
    expect(resolved.primary.r).toBe(1);
    expect(resolved.primary.g).toBe(0);
  });
  test("rejects circular and missing references", () => {
    const circular: ThemeJson = { defs: { a: "b", b: "a" }, theme: { ...tacos().theme, primary: "a" } };
    expect(() => resolveTheme(circular, "dark")).toThrow("Circular color reference");
    const missing: ThemeJson = { theme: { ...tacos().theme, primary: "missing-color" } };
    expect(() => resolveTheme(missing, "dark")).toThrow('Color reference "missing-color" not found');
  });
  test("supports transparency and opacity defaults", () => {
    const clear: ThemeJson = { ...tacos(), theme: { ...tacos().theme, background: "transparent" } };
    expect(resolveTheme(clear, "dark").background.a).toBe(0);
    expect(resolveTheme(tacos(), "dark").thinkingOpacity).toBe(0.6);
    const custom: ThemeJson = { ...tacos(), theme: { ...tacos().theme, thinkingOpacity: 0.9 } };
    expect(resolveTheme(custom, "dark").thinkingOpacity).toBe(0.9);
  });
  test("falls back backgroundMenu to backgroundElement", () => {
    const base = tacos().theme;
    const { backgroundMenu: _dropped, ...rest } = base;
    void _dropped;
    const resolved = resolveTheme({ ...tacos(), theme: rest }, "dark");
    expect(resolved.backgroundMenu.r).toBe(resolved.backgroundElement.r);
    expect(resolved.backgroundMenu.g).toBe(resolved.backgroundElement.g);
    expect(resolved.selectedListItemText).toBeDefined();
  });
});

describe("theme color helpers", () => {
  const palette = (): TerminalColors["palette"] => Array(16).fill("#000000") as TerminalColors["palette"];
  const colors = (bg: string): TerminalColors => ({
    palette: palette(),
    defaultForeground: "#ffffff",
    defaultBackground: bg as TerminalColors["defaultBackground"],
    cursorColor: "#ffffff",
    mouseForeground: "#ffffff",
    mouseBackground: "#000000",
    tekForeground: "#ffffff",
    tekBackground: "#000000",
    highlightBackground: "#333333",
    highlightForeground: "#ffffff",
  });
  test("tint blends toward overlay", () => {
    const gray = tint(RGBA.fromHex("#000000"), RGBA.fromHex("#ffffff"), 0.5);
    expect(gray.r).toBe(128 / 255);
    expect(gray.g).toBe(128 / 255);
    expect(gray.b).toBe(128 / 255);
  });
  test("terminalMode follows background luminance", () => {
    expect(terminalMode(colors("#000000"))).toBe("dark");
    expect(terminalMode(colors("#ffffff"))).toBe("light");
  });
  test("generateSystem round-trips through resolveTheme", () => {
    const system = generateSystem(colors("#101014"), "dark");
    expect(isTheme(system)).toBe(true);
    const resolved = resolveTheme(system, "dark");
    expect(resolved.thinkingOpacity).toBe(0.6);
    expect(typeof resolved.primary.r).toBe("number");
  });
});
