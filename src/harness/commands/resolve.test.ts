import { afterEach, describe, expect, test } from "bun:test";
import { createSessionBindings, type SessionBindings } from "./bindings";
import { commandModeFor, resolveCommandPrompt } from "./index";
import { footerToastStore } from "../../stores/footer-toast-store";
import { loopStore } from "../../stores/loop-store";

// The catalog is process-static and this repo ships `.agents/skills`; these
// tests pin against two of its discovered skills.
const SKILL_A = "opentui";
const SKILL_B = "ai-sdk";

const bindings: SessionBindings = createSessionBindings({ sessionId: "resolve-test" });
const mode = commandModeFor("coding", false);

afterEach(() => {
  footerToastStore.trigger.hide();
  loopStore.trigger.closeModelPicker();
});

describe("resolveCommandPrompt passthrough", () => {
  test("plain text is not handled", async () => {
    expect(await resolveCommandPrompt("hello world", bindings, mode)).toEqual({ handled: false });
  });

  test("bare slash is consumed with no prompt", async () => {
    expect(await resolveCommandPrompt("/", bindings, mode)).toEqual({ handled: true });
    expect(await resolveCommandPrompt("  /  ", bindings, mode)).toEqual({ handled: true });
  });

  test("an unknown first token passes the raw text through", async () => {
    expect(await resolveCommandPrompt("/nope hello", bindings, mode)).toEqual({ handled: false });
    // ...even when a later token would match a command (strict compatibility).
    expect(await resolveCommandPrompt("/nope /models", bindings, mode)).toEqual({ handled: false });
  });
});

const skillPrompt = async (text: string): Promise<string> => {
  const res = await resolveCommandPrompt(text, bindings, mode);
  if (!res.handled || res.prompt === undefined) throw new Error(`expected a prompt for ${text}`);
  return res.prompt;
};

describe("resolveCommandPrompt skills", () => {
  test("a single skill builds its prompt with the user request tail", async () => {
    const prompt = await skillPrompt(`/${SKILL_A} list the box docs`);
    expect(prompt).toContain(`[Skill: ${SKILL_A}]`);
    expect(prompt).toContain("User request:");
    expect(prompt).toContain("list the box docs");
  });

  test("multiple skills concatenate with per-command args", async () => {
    const prompt = await skillPrompt(`/${SKILL_A} boxes first /${SKILL_B} then tools`);
    const a = prompt.indexOf(`[Skill: ${SKILL_A}]`);
    const tailA = prompt.indexOf("boxes first", a);
    const b = prompt.indexOf(`[Skill: ${SKILL_B}]`);
    const tailB = prompt.indexOf("then tools", b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(tailA).toBeGreaterThan(a);
    expect(b).toBeGreaterThan(tailA);
    expect(tailB).toBeGreaterThan(b);
  });

  test("unknown mid-prompt tokens stay literal in the owning command's args", async () => {
    const prompt = await skillPrompt(`/${SKILL_A} see /nope ok`);
    expect(prompt).toContain("see /nope ok");
  });
});

describe("resolveCommandPrompt system commands", () => {
  test("a system command runs and sends nothing", async () => {
    const res = await resolveCommandPrompt("/models", bindings, mode);
    expect(res).toEqual({ handled: true });
    expect(loopStore.getSnapshot().context.modelPickerOpen).toBe(true);
  });

  test("system commands run in order alongside a skill", async () => {
    const res = await resolveCommandPrompt(`/models /${SKILL_A}`, bindings, mode);
    // `/models` opened its picker; the skill part still produced a prompt.
    if (!res.handled || res.prompt === undefined) throw new Error("expected a prompt");
    expect(res.prompt).toContain(`[Skill: ${SKILL_A}]`);
  });

  test("idle-only commands are rejected with a toast while streaming", async () => {
    const res = await resolveCommandPrompt("/cd /tmp", bindings, {
      ...mode,
      streaming: true,
    });
    expect(res).toEqual({ handled: true });
    expect(footerToastStore.getSnapshot().context.message).toContain("/cd is not available");
  });
});
