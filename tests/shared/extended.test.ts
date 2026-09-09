import { describe, expect, mock, test } from "bun:test";
import { clip, fmtCost, fmtDuration, fmtRunSummary, fmtTokens, relTime } from "../../src/shared/format.ts";
import { countOccurrences, extractWords, textStats } from "../../src/shared/text-stats.ts";
import { describeError, reportFromText, withSessionId, type ErrorReport } from "../../src/shared/error-report.ts";
import { notifyCompletion, notifyFailure } from "../../src/shared/notify.ts";
import { openInBrowser } from "../../src/shared/open-url.ts";

mock.module("node:child_process", () => {
  const calls: unknown[][] = [];
  (globalThis as unknown as { __picobuSpawnCalls?: unknown[][] }).__picobuSpawnCalls = calls;
  const spawn = (...args: unknown[]): unknown => {
    calls.push(args);
    return { on() {}, unref() {} };
  };
  return { spawn };
});

const childCalls = (): unknown[][] => {
  const store = globalThis as unknown as { __picobuSpawnCalls?: unknown[][] };
  if (!store.__picobuSpawnCalls) store.__picobuSpawnCalls = [];
  return store.__picobuSpawnCalls;
};

const takeWrites = async (fn: () => void): Promise<string[]> => {
  const out: string[] = [];
  const target = process.stdout as unknown as { write: unknown };
  const orig = target.write;
  target.write = (chunk: unknown): boolean => {
    out.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    target.write = orig;
  }
  return out;
};

const withBunSpawn = async (impl: () => unknown, fn: () => void): Promise<unknown[][]> => {
  const seen: unknown[][] = [];
  const runtime = Bun as unknown as { spawn: unknown };
  const orig = runtime.spawn;
  runtime.spawn = (...args: unknown[]): unknown => {
    seen.push(args);
    return impl();
  };
  try {
    fn();
  } finally {
    runtime.spawn = orig;
  }
  return seen;
};

describe("format edges", () => {
  test("fmtTokens boundaries", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(999)).toBe("999");
    expect(fmtTokens(1000)).toBe("1K");
    expect(fmtTokens(2500)).toBe("2.5K");
    expect(fmtTokens(1000000)).toBe("1M");
    expect(fmtTokens(2200000)).toBe("2.2M");
  });
  test("fmtCost empty and rounding", () => {
    expect(fmtCost(undefined)).toBe("");
    expect(fmtCost(0)).toBe("$0");
    expect(fmtCost(2)).toBe("$2");
    expect(fmtCost(2.5)).toBe("$2.50");
    expect(fmtCost(2.567)).toBe("$2.57");
  });
  test("fmtDuration clamps and rolls over", () => {
    expect(fmtDuration(-5)).toBe("0s");
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(59)).toBe("59s");
    expect(fmtDuration(60)).toBe("1m 00s");
    expect(fmtDuration(90)).toBe("1m 30s");
    expect(fmtDuration(3600)).toBe("1h 00m");
    expect(fmtDuration(3661)).toBe("1h 01m");
  });
  test("fmtRunSummary omits empty parts", () => {
    expect(fmtRunSummary(0, null, null)).toBeNull();
    expect(fmtRunSummary(0.2, null, null)).toBeNull();
    expect(fmtRunSummary(0, 0, null)).toBeNull();
    expect(fmtRunSummary(5, null, null)).toBe("5s");
    expect(fmtRunSummary(0, 2000, null)).toBe("2K out");
    expect(fmtRunSummary(0, null, 1.5)).toBe("$1.50");
    expect(fmtRunSummary(5, 2000, 1)).toBe("5s · 2K out · $1");
  });
  test("clip and relTime edges", () => {
    expect(clip("abc", 0)).toBe("");
    expect(clip("abc", 1)).toBe("…");
    expect(clip("ab", 5)).toBe("ab");
    expect(relTime(Date.now() - 30 * 60_000)).toBe("30m");
    expect(relTime(Date.now() - 5 * 60 * 60_000)).toBe("5h");
    expect(relTime(Date.now() - 3 * 24 * 60 * 60_000)).toBe("3d");
  });
});

describe("text stats extras", () => {
  test("extractWords handles empties and brackets", () => {
    expect(extractWords("")).toEqual([]);
    expect(extractWords("a/b(c)d")).toEqual(["a", "b", "c", "d"]);
  });
  test("countOccurrences misses and repeats", () => {
    expect(countOccurrences("abcabc", "abc")).toBe(2);
    expect(countOccurrences("hello", "z")).toBe(0);
  });
  test("textStats empty and multiline", () => {
    const empty = textStats("");
    expect(empty.words).toBe(0);
    expect(empty.chars).toBe(0);
    expect(empty.avgWordLength).toBe(0);
    expect(textStats("a\nb\nc").lines).toBe(3);
    expect(textStats("hi there").avgWordLength).toBeCloseTo(3.5, 10);
  });
});

describe("error report", () => {
  test("non-errors stringify without detail", () => {
    expect(describeError("boom")).toEqual({ message: "boom", detail: null });
    expect(describeError(42)).toEqual({ message: "42", detail: null });
  });
  test("plain errors keep message only", () => {
    const report = describeError(new Error("oops"));
    expect(report.message).toBe("oops");
    expect(report.detail).toBeNull();
    expect(describeError(new TypeError("bad")).message).toContain("TypeError");
  });
  test("status code prefixes message", () => {
    const err = new Error("bad") as Error & { statusCode?: number };
    err.statusCode = 500;
    expect(describeError(err).message).toContain("HTTP 500");
  });
  test("json response body extracts message", () => {
    const err = new Error("failed") as Error & { responseBody?: string };
    err.responseBody = JSON.stringify({ error: { message: "bad input" } });
    expect(describeError(err).detail).toBe("bad input");
  });
  test("long bodies clip", () => {
    const err = new Error("failed") as Error & { responseBody?: string };
    err.responseBody = "x".repeat(500);
    expect(describeError(err).detail?.length).toBe(401);
  });
  test("url joins detail", () => {
    const err = new Error("failed") as Error & { url?: string };
    err.url = "example.com/api";
    expect(describeError(err).detail).toContain("example.com/api");
  });
  test("cause chains only on differing messages", () => {
    expect(describeError(new Error("outer", { cause: new Error("inner") })).detail).toBe("cause: inner");
    expect(describeError(new Error("same", { cause: new Error("same") })).detail).toBeNull();
  });
  test("reportFromText splits head and body", () => {
    expect(reportFromText("only")).toEqual({ message: "only", detail: null });
    expect(reportFromText("first\nsecond\nthird")).toEqual({ message: "first", detail: "second\nthird" });
  });
  test("withSessionId appends session line", () => {
    const base: ErrorReport = { message: "m", detail: null };
    expect(withSessionId(base, undefined)).toBe(base);
    expect(withSessionId(base, "s1")).toEqual({ message: "m", detail: "session: s1" });
    expect(withSessionId({ message: "m", detail: "a" }, "s1").detail).toBe("a\nsession: s1");
  });
});

describe("notify exports", () => {
  test("export shape is functions", () => {
    expect(typeof notifyCompletion).toBe("function");
    expect(typeof notifyFailure).toBe("function");
    expect(typeof openInBrowser).toBe("function");
  });
  test("completion rings bell and notifies once", async () => {
    const calls = childCalls();
    calls.length = 0;
    const writes = await takeWrites(() => notifyCompletion("all good"));
    expect(writes).toContain("\x07");
    expect(calls.length).toBe(1);
    if (process.platform === "darwin") {
      const args = calls[0] ?? [];
      expect(args[0]).toBe("osascript");
      expect(String((args[1] as unknown[])[1])).toContain("display notification");
    }
  });
  test("failure uses error styling", async () => {
    const calls = childCalls();
    calls.length = 0;
    await takeWrites(() => notifyFailure("it broke"));
    expect(calls.length).toBe(1);
    if (process.platform === "darwin") {
      const args = calls[0] ?? [];
      expect(String((args[1] as unknown[])[1])).toContain("Basso");
    }
  });
});

describe("open-url exports", () => {
  test("uses Bun.spawn with platform command", async () => {
    const calls = childCalls();
    calls.length = 0;
    const seen = await withBunSpawn(() => ({ unref() {} }), () => openInBrowser("example.com/x"));
    expect(seen.length).toBe(1);
    if (process.platform === "darwin") {
      expect((seen[0]?.[0] as { cmd?: unknown }).cmd).toEqual(["open", "example.com/x"]);
    }
    expect(calls.length).toBe(0);
  });
  test("falls back to node spawn when Bun.spawn throws", async () => {
    const calls = childCalls();
    calls.length = 0;
    await withBunSpawn(() => {
      throw new Error("spawn unavailable");
    }, () => openInBrowser("example.com/y"));
    expect(calls.length).toBe(1);
    if (process.platform === "darwin") {
      const args = calls[0] ?? [];
      expect(args[0]).toBe("open");
      expect(args[1]).toContain("example.com/y");
    }
  });
});
