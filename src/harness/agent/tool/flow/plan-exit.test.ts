import { describe, expect, test } from "bun:test";
import { createPlanExitTool } from "./plan-exit";

describe("createPlanExitTool", () => {
  test("returns the coder handoff message", () => {
    const out = createPlanExitTool().handler();
    expect(out.switchedTo).toBe("coder");
    expect(out.message).toContain("implement the approved plan");
  });
});
