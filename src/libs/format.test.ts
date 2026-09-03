import { describe, expect, test } from "bun:test";
import { fmtDuration, fmtRunSummary } from "./format";

describe("format", () => {
  test("fmtDuration renders seconds, minutes and hours", () => {
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(42)).toBe("42s");
    expect(fmtDuration(62)).toBe("1m 02s");
    expect(fmtDuration(3725)).toBe("1h 02m");
    expect(fmtDuration(-5)).toBe("0s");
  });

  test("fmtRunSummary joins the available metrics", () => {
    expect(fmtRunSummary(62, 12_500, 0.0321)).toBe("1m 02s · 12.5K out · $0.03");
    expect(fmtRunSummary(5, null, null)).toBe("5s");
  });

  test("fmtRunSummary omits empty parts and is null without data", () => {
    expect(fmtRunSummary(0, 1_000, null)).toBe("1K out");
    expect(fmtRunSummary(0, null, 1)).toBe("$1");
    expect(fmtRunSummary(0, null, null)).toBe(null);
  });
});
