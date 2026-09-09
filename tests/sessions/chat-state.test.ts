import { describe, expect, test } from "bun:test";
import type { LoopMessage } from "../../src/agent/loop/create-loop.ts";
import { createHeadlessChatState } from "../../src/agent/sessions/session-headless-chat.ts";

const toolPart = () => ({
  type: "tool-ask",
  state: "input-available",
  toolCallId: "call-1",
  input: { questions: [{ title: "Task", question: "Q?", type: "single", options: [{ answer: "a" }] }] },
});

const assistantMessage = (): LoopMessage => ({ id: "a1", role: "assistant", parts: [toolPart()] }) as unknown as LoopMessage;

describe("createHeadlessChatState snapshots", () => {
  test("stored messages get fresh identities on every write", () => {
    const seen: LoopMessage[][] = [];
    const state = createHeadlessChatState([], (s) => seen.push(s.messages));
    const produced: LoopMessage[] = [assistantMessage()];
    state.messages = produced;
    const first = state.messages;
    (produced[0]!.parts[0] as Record<string, unknown>).output = { status: "pending" };
    (produced[0]!.parts[0] as Record<string, unknown>).state = "output-available";
    state.messages = produced;
    const second = state.messages;
    expect(second[0]!.parts[0]).toMatchObject({ state: "output-available" });
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.parts[0]).not.toBe(first[0]!.parts[0]);
    expect(seen.length).toBe(2);
  });
  test("later producer mutations do not leak into stored state", () => {
    const state = createHeadlessChatState([]);
    const message = assistantMessage();
    state.pushMessage(message);
    message.parts.push({ type: "text", text: "late" });
    (message.parts[0] as Record<string, unknown>).state = "output-available";
    expect(state.messages[0]!.parts).toHaveLength(1);
    expect((state.messages[0]!.parts[0] as Record<string, unknown>).state).toBe("input-available");
  });
  test("replaceMessage stores an isolated copy", () => {
    const state = createHeadlessChatState([assistantMessage()]);
    const next = assistantMessage();
    state.replaceMessage(0, next);
    (next.parts[0] as Record<string, unknown>).output = { status: "pending" };
    expect((state.messages[0]!.parts[0] as Record<string, unknown>).output).toBeUndefined();
  });
});
