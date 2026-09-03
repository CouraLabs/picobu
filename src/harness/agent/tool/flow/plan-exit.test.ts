import { describe, expect, test } from "bun:test";
import { createPlanExitTool } from "@harness/agent/tool/flow/plan-exit.ts";

describe("createPlanExitTool", () => {
  test("returns the coder handoff message", () => {
    const out = createPlanExitTool().handler();
    expect(out.switchedTo).toBe("coder");
    expect(out.message).toContain("implement the approved plan");
  });
});
