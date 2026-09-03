import { describe, expect, test } from "bun:test";
import { PlanWriteToolArgsSchema, createPlanWriteTool } from "@harness/agent/tool/flow/plan-write.ts";

describe("PlanWriteToolArgsSchema", () => {
  test("requires a non-empty plan", () => {
    expect(PlanWriteToolArgsSchema.safeParse({ plan: "" }).success).toBe(false);
    expect(PlanWriteToolArgsSchema.safeParse({ plan: "# Plan\nEdit things\n" }).success).toBe(true);
  });
});

describe("createPlanWriteTool", () => {
  test("returns the pending stub with line count", () => {
    const out = createPlanWriteTool().handler({ plan: "# Plan\n- step one\n- step two" });
    expect(out.status).toBe("pending");
    expect(out.message).toContain("3 lines");
  });
});