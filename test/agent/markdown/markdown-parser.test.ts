import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMarkdown, parseMarkdownFile } from "@agent/markdown/markdown-parser.ts";

describe("parseMarkdown", () => {
  test("files without frontmatter come back whole as content", () => {
    expect(parseMarkdown("just a body")).toEqual({ content: "just a body" });
  });

  test("frontmatter pairs are spread onto the result with the body as content", () => {
    const parsed = parseMarkdown(
      "---\nname: coder\ntools: read, write\n---\n\nBody here.\n",
    );
    expect(parsed.name).toBe("coder");
    expect(parsed.tools).toBe("read, write");
    expect(parsed.content).toBe("Body here.\n");
  });

  test("values are unquoted, coerced and kept verbatim when unsupported", () => {
    const parsed = parseMarkdown(
      '---\nquoted: "hello world"\nsingle: \'x\'\nflag: true\noff: false\ncount: 42\nnegative: -7\nnested: {a: 1}\n---\nbody',
    );
    expect(parsed.quoted).toBe("hello world");
    expect(parsed.single).toBe("x");
    expect(parsed.flag).toBe(true);
    expect(parsed.off).toBe(false);
    expect(parsed.count).toBe(42);
    expect(parsed.negative).toBe(-7);
    // Unsupported YAML shapes stay scalar strings.
    expect(parsed.nested).toBe("{a: 1}");
  });

  test("empty values, comments and keyless lines are handled", () => {
    const parsed = parseMarkdown("---\nname:\n# a comment\nno separator line\n: novalue\n---\nbody");
    expect(parsed.name).toBe("");
    expect(parsed).not.toHaveProperty("no separator line");
    expect(parsed.content).toBe("body");
  });

  test("values containing colons keep everything after the first colon", () => {
    const parsed = parseMarkdown("---\nurl: https://example.com:8080/x\n---\nbody");
    expect(parsed.url).toBe("https://example.com:8080/x");
  });

  test("a missing closing delimiter treats the whole file as content", () => {
    const raw = "---\nname: coder\nno closing delimiter here";
    expect(parseMarkdown(raw)).toEqual({ content: raw });
  });

  test("a `---` line inside the body does not close the frontmatter", () => {
    const parsed = parseMarkdown("---\nname: coder\n---\nbody\n\n---\nmore body");
    expect(parsed.name).toBe("coder");
    expect(parsed.content).toBe("body\n\n---\nmore body");
  });

  test("CRLF delimiters and BOM are tolerated", () => {
    const parsed = parseMarkdown("\uFEFF---\r\nname: coder\r\n---\r\n\r\nbody\r\n");
    expect(parsed.name).toBe("coder");
    expect(parsed.content).toBe("body\r\n");
  });

  test("params substitute placeholders in the content (but not the frontmatter)", () => {
    const parsed = parseMarkdown(
      "---\nroot: {CWD}\n---\nworkdir is {CWD} today",
      [{ param: "{CWD}", value: "/tmp/project" }],
    );
    expect(parsed.root).toBe("{CWD}");
    expect(parsed.content).toBe("workdir is /tmp/project today");
  });

  test("parseMarkdownFile reads and parses from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "markdown-parser-"));
    try {
      const path = join(dir, "agent.md");
      await writeFile(path, "---\nname: ask\n---\nAnswer the question.");

      const parsed = await parseMarkdownFile(path);
      expect(parsed.name).toBe("ask");
      expect(parsed.content).toBe("Answer the question.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
