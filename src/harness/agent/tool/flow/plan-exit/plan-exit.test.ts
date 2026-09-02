import { describe, expect, test } from "bun:test";
import { createPlanExitTool } from "./plan-exit";
import { getAgentOverride, interactionStore } from "../../../../../stores/interaction-store";

describe("createPlanExitTool", () => {
  test("writes a session-scoped coder override and returns the handoff output", () => {
    const sessionId = "plan-exit-test-session";
    try {
      const out = createPlanExitTool(sessionId).handler();
      expect(out.switchedTo).toBe("coder");
      expect(out.message).toContain("implement the approved plan");

      // The override is session-scoped and carries the coder's role config.
      const override = getAgentOverride(sessionId);
      expect(override?.agentId).toBe("coder");
      expect(override?.modelKey).toBeDefined();
    } finally {
      interactionStore.trigger.clearSession({ sessionId });
    }
  });

  test("refuses a second handoff for the same session", () => {
    const sessionId = "plan-exit-test-session";
    try {
      createPlanExitTool(sessionId).handler();
      expect(() => createPlanExitTool(sessionId).handler()).toThrow("already called");
    } finally {
      interactionStore.trigger.clearSession({ sessionId });
    }
  });
});
