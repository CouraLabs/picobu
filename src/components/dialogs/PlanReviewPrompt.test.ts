import { describe, expect, test } from "bun:test";
import { buildApprovePrompt, buildRevisionPrompt } from "./PlanReviewPrompt";
import type { PlanComment } from "../../stores/interaction-store";

const comments: PlanComment[] = [
  { line: 3, text: "add the cache eviction", comment: "consider LRU" },
  { line: 12, text: "auth middleware", comment: "reuse existing helper" },
];

describe("buildRevisionPrompt", () => {
  test("includes every comment with line + clipped text", () => {
    const out = buildRevisionPrompt(comments);
    expect(out).toContain("[Plan not approved — revise]");
    expect(out).toContain('Line comments:');
    expect(out).toContain('- L3 · "add the cache eviction": consider LRU');
    expect(out).toContain('- L12 · "auth middleware": reuse existing helper');
  });

  test("no-comments variant says to revise without listing comments", () => {
    const out = buildRevisionPrompt([]);
    expect(out).toContain("submit the updated plan again with plan-write");
    expect(out).not.toContain("Line comments:");
  });
});

describe("buildApprovePrompt", () => {
  test("asks for the plan-exit handoff", () => {
    const out = buildApprovePrompt([]);
    expect(out).toContain("[Plan approved — start implementation]");
    expect(out).toContain("Call plan-exit to hand off to the Coder agent");
  });

  test("attaches comments when present", () => {
    const out = buildApprovePrompt(comments);
    expect(out).toContain("Line comments to address during implementation:");
    expect(out).toContain("- L3 · \"add the cache eviction\": consider LRU");
  });
});