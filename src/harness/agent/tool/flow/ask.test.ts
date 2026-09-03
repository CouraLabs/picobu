import { describe, expect, test } from "bun:test";
import { AskToolArgsSchema, createAskTool } from "@harness/agent/tool/flow/ask.ts";

const q = (n: number) => ({
  title: `q${n}`,
  question: `question ${n}`,
  type: "single" as const,
  options: [{ answer: "yes", answerDescription: "" }],
});

describe("AskToolArgsSchema", () => {
  test("accepts 1..5 questions", () => {
    expect(AskToolArgsSchema.safeParse({ questions: [q(1), q(2)] }).success).toBe(true);
    expect(AskToolArgsSchema.safeParse({ questions: [q(1), q(2), q(3), q(4), q(5)] }).success).toBe(true);
  });

  test("rejects an empty list and more than 5 questions", () => {
    expect(AskToolArgsSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(AskToolArgsSchema.safeParse({ questions: [q(1), q(2), q(3), q(4), q(5), q(6)] }).success).toBe(false);
  });
});

describe("createAskTool handler", () => {
  const tool = createAskTool();

  test("returns the pending stub", () => {
    const questions = [q(1), q(2)];
    expect(tool.handler({ questions })).toEqual({
      status: "pending",
      message: "Asked 2 question(s); awaiting user answers",
    });
  });

  test("throws when handed more than 5 questions", () => {
    expect(() =>
      tool.handler({ questions: [q(1), q(2), q(3), q(4), q(5), q(6)] } as never),
    ).toThrow("ask supports at most 5 questions per call");
  });

  test("throws on an empty question list", () => {
    expect(() => tool.handler({ questions: [] } as never)).toThrow("ask requires at least one question");
  });
});
