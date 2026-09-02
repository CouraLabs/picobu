import { describe, expect, test } from "bun:test";
import { interactionStore, type AskQuestion } from "./interaction-store";

const sessionId = "interaction-test-session";
const questions: AskQuestion[] = [
  { title: "t", question: "q", type: "single", options: [{ answer: "a", answerDescription: "" }] },
];

describe("interactionStore", () => {
  test("markAskAnswered stores per-session/per-partKey summaries", () => {
    const partKey = "m-1-ask-2";
    interactionStore.trigger.markAskAnswered({
      sessionId,
      partKey,
      answers: [{ title: "t", question: "q", type: "single", selections: ["a"] }],
      summaryText: "[The user answered your questions]\n1. t — q\n  - a",
    });
    expect(interactionStore.getSnapshot().context.answeredAsk[sessionId]?.[partKey]?.summaryText).toContain(
      "1. t — q",
    );
    interactionStore.trigger.clearSession({ sessionId });
  });

  test("planWriteStatus transitions open -> approved", () => {
    const partKey = "m-2-plan-write-0";
    interactionStore.trigger.markPlanWriteOpen({ sessionId, partKey });
    expect(interactionStore.getSnapshot().context.planWriteStatus[sessionId]?.[partKey]).toBe("open");
    interactionStore.trigger.markPlanWriteStatus({ sessionId, partKey, status: "approved" });
    expect(interactionStore.getSnapshot().context.planWriteStatus[sessionId]?.[partKey]).toBe("approved");
    interactionStore.trigger.clearSession({ sessionId });
  });

  test("planWriteComments sort by line and replace on save", () => {
    const partKey = "m-3-plan-write-0";
    interactionStore.trigger.setPlanWriteComments({
      sessionId,
      partKey,
      comments: [
        { line: 5, text: "b", comment: "second" },
        { line: 2, text: "a", comment: "first" },
      ],
    });
    const saved = interactionStore.getSnapshot().context.planWriteComments[sessionId]?.[partKey];
    expect(saved?.map((c) => c.line)).toEqual([2, 5]);
    interactionStore.trigger.setPlanWriteComments({
      sessionId,
      partKey,
      comments: [{ line: 2, text: "a", comment: "updated" }],
    });
    const updated = interactionStore.getSnapshot().context.planWriteComments[sessionId]?.[partKey];
    expect(updated).toHaveLength(1);
    expect(updated?.[0]?.comment).toBe("updated");
    interactionStore.trigger.clearSession({ sessionId });
  });

  test("clearSession drops every record for the session but keeps others", () => {
    const other = "interaction-test-other";
    interactionStore.trigger.markAskAnswered({ sessionId: other, partKey: "k", answers: [], summaryText: "s" });
    interactionStore.trigger.markAskAnswered({ sessionId, partKey: "k", answers: [], summaryText: "s" });
    interactionStore.trigger.markPlanWriteOpen({ sessionId, partKey: "k" });
    interactionStore.trigger.setPlanWriteComments({ sessionId, partKey: "k", comments: [] });

    interactionStore.trigger.clearSession({ sessionId });

    const ctx = interactionStore.getSnapshot().context;
    expect(ctx.answeredAsk[sessionId]).toBeUndefined();
    expect(ctx.planWriteStatus[sessionId]).toBeUndefined();
    expect(ctx.planWriteComments[sessionId]).toBeUndefined();
    expect(ctx.answeredAsk[other]?.["k"]?.summaryText).toBe("s");
    interactionStore.trigger.clearSession({ sessionId: other });
  });
});
