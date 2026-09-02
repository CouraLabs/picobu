import { describe, expect, test } from "bun:test";
import { createPlanExitTool } from "./plan-exit";
import { loopStore } from "../../../../stores/loop-store";

describe("createPlanExitTool", () => {
  test("switches the global agent picker to coder like TAB", () => {
    // Seed the loop as if the Plan agent were active (via the same action the
    // TAB keybind uses, so role config resolution runs identically).
    loopStore.trigger.setAgent({ agentId: "ask" });
    try {
      const out = createPlanExitTool().handler();
      expect(out.switchedTo).toBe("coder");
      expect(out.message).toContain("implement the approved plan");
      expect(loopStore.getSnapshot().context.agentId).toBe("coder");
    } finally {
      loopStore.trigger.setAgent({ agentId: "coder" });
    }
  });
});
