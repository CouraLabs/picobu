import { describe, expect, test } from "bun:test";
import { marqueeMaxOffset, marqueeSegments, textCells } from "../ui/MarqueeText";

describe("textCells", () => {
  test("counts ASCII as one cell per char", () => {
    expect(textCells("abc")).toBe(3);
  });

  test("counts wide chars as two cells", () => {
    expect(textCells("ab漢c")).toBe(5);
  });
});

describe("marqueeSegments", () => {
  test("static start position: only the trailing edge is dimmed", () => {
    const segs = marqueeSegments("abcdefghij", 0, 4, 1);
    expect(segs).toEqual([
      { text: "abc", dim: false },
      { text: "d", dim: true },
    ]);
  });

  test("middle window: both edges are dimmed", () => {
    const segs = marqueeSegments("abcdefghij", 2, 4, 1);
    expect(segs).toEqual([
      { text: "c", dim: true },
      { text: "de", dim: false },
      { text: "f", dim: true },
    ]);
  });

  test("window at the end: only the leading edge is dimmed", () => {
    const segs = marqueeSegments("abcdefghij", 6, 4, 1);
    expect(segs).toEqual([
      { text: "g", dim: true },
      { text: "hij", dim: false },
    ]);
  });

  test("fade of three splits into eased runs on both edges", () => {
    const segs = marqueeSegments("abcdefghijklmno", 4, 10, 3);
    expect(segs).toEqual([
      { text: "efg", dim: true },
      { text: "hijk", dim: false },
      { text: "lmn", dim: true },
    ]);
  });

  test("a wide char straddling the leading edge is padded with a space", () => {
    // Cells: a(0) 漢(1-2) b(3) c(4) d(5); window [2,6) cuts 漢 in half.
    const segs = marqueeSegments("a漢bcd", 2, 4, 1);
    expect(segs).toEqual([
      { text: " ", dim: true },
      { text: "bcd", dim: false },
    ]);
  });

  test("zero-width graphemes do not consume cells", () => {
    const segs = marqueeSegments("a\u0301bcd", 0, 3, 1);
    expect(segs).toEqual([
      { text: "ab", dim: false },
      { text: "c", dim: true },
    ]);
  });

  test("zero width yields no segments", () => {
    expect(marqueeSegments("abc", 0, 0, 1)).toEqual([]);
  });
});

describe("marqueeMaxOffset", () => {
  test("is zero when the text fits", () => {
    expect(marqueeMaxOffset("abc", 10)).toBe(0);
  });

  test("is the overflow distance when it does not", () => {
    expect(marqueeMaxOffset("abcdefghij", 4)).toBe(6);
  });

  test("uses display cells for wide chars", () => {
    expect(marqueeMaxOffset("a漢b漢", 4)).toBe(2);
  });
});
