import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
  COMPACT_THRESHOLD,
  compactedMessageText,
  serializeForCompaction,
  shouldCompact,
} from "./compactor";

const userMessage = (text: string): UIMessage => ({
  id: "u1",
  role: "user",
  parts: [{ type: "text", text }],
});

describe("shouldCompact", () => {
  test("triggers at exactly the threshold", () => {
    expect(shouldCompact(80, 100)).toBe(true);
  });

  test("does not trigger below the threshold", () => {
    expect(shouldCompact(79, 100)).toBe(false);
  });

  test("threshold is 80% of the context window", () => {
    expect(COMPACT_THRESHOLD).toBe(0.8);
    expect(shouldCompact(160_000, 200_000)).toBe(true);
    expect(shouldCompact(159_999, 200_000)).toBe(false);
  });

  test("never triggers with a zero window (avoids div-by-zero)", () => {
    expect(shouldCompact(10_000, 0)).toBe(false);
  });
});

describe("serializeForCompaction", () => {
  test("keeps user and assistant text verbatim, prefixed by role", () => {
    const transcript = serializeForCompaction([
      userMessage("fix the login bug"),
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Fixed in src/auth.ts" }],
      },
    ]);
    expect(transcript).toBe(
      "user: fix the login bug\nassistant: Fixed in src/auth.ts",
    );
  });

  test("summarizes tool parts on one abbreviated line", () => {
    const transcript = serializeForCompaction([
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-write",
            state: "output-available",
            input: { path: "/tmp/a.txt", content: "hello" },
            output: "ok",
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ]);
    expect(transcript).toContain("tool write (output-available):");
    expect(transcript).toContain("/tmp/a.txt");
    expect(transcript).toContain("-> ok");
  });

  test("abbreviates long tool output", () => {
    const transcript = serializeForCompaction([
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            state: "output-available",
            input: "ls",
            output: "x".repeat(1000),
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ]);
    expect(transcript.length).toBeLessThan(300);
    expect(transcript).toContain("…");
  });

  test("drops reasoning and blank parts", () => {
    const transcript = serializeForCompaction([
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thinking hard" } as unknown as UIMessage["parts"][number],
          { type: "text", text: "   " } as unknown as UIMessage["parts"][number],
        ],
      },
    ]);
    expect(transcript).toBe("");
  });

  test("reports tool errors", () => {
    const transcript = serializeForCompaction([
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-read",
            state: "output-error",
            input: { path: "/nope" },
            errorText: "file not found",
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ]);
    expect(transcript).toContain("tool read (output-error):");
    expect(transcript).toContain("-> file not found");
  });
});

describe("compactedMessageText", () => {
  test("wraps the summary with the compaction header", () => {
    const text = compactedMessageText("did the thing");
    expect(text).toContain("[Session compacted");
    expect(text.endsWith("did the thing")).toBe(true);
  });
});
