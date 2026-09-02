import { describe, expect, test } from "bun:test";
import { clip } from "../../../libs/format";
import { windowStart, MAX_VISIBLE } from "./CommandPicker";

describe("windowStart", () => {
  test("keeps the whole list visible when it fits the viewport", () => {
    expect(windowStart(0, 3, MAX_VISIBLE)).toBe(0);
    expect(windowStart(4, 4, MAX_VISIBLE)).toBe(0);
  });

  test("slides only after the selection passes the bottom edge", () => {
    expect(windowStart(0, 12, MAX_VISIBLE)).toBe(0);
    expect(windowStart(3, 10, 5)).toBe(0); // selection rides the bottom edge
    expect(windowStart(4, 10, 5)).toBe(0); // still the bottom row of window 0..4
    expect(windowStart(5, 10, 5)).toBe(1);
    expect(windowStart(9, 10, 5)).toBe(5); // last window: 5..9
  });

  test("slides back up when the selection moves back up", () => {
    expect(windowStart(1, 10, 5)).toBe(0);
    expect(windowStart(4, 10, 5)).toBe(0);
  });

  test("never scrolls past the end of the list", () => {
    const start = windowStart(10, 11, MAX_VISIBLE);
    expect(start).toBe(6); // shows 6..10
  });
});

describe("clip", () => {
  test("keeps values that fit", () => {
    expect(clip("short", 10)).toBe("short");
  });

  test("ellipsizes overflowing values to exactly max chars", () => {
    const clipped = clip("Create the model picker", 12);
    expect(clipped.length).toBe(12);
    expect(clipped.startsWith("Create the ")).toBe(true);
    expect(clipped.endsWith("…")).toBe(true);
    expect(clip("Create the model picker", 4)).toBe("Cre…");
    expect(clip("x", -1)).toBe("");
  });
});
