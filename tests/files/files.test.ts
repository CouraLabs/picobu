import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalSandboxSession } from "../../src/agent/tools/sandbox.ts";
import { EditToolArgsSchema } from "../../src/agent/tools/filesystem/edit.ts";
import { insideAgentDir } from "../../src/agent/tools/filesystem/agent-dirs.ts";
import { initLockDir } from "../../src/shared/lock.ts";

describe("sandbox containment", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "picobu-sandbox-"));
    initLockDir(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  test("blocks absolute escape on read", async () => {
    const session = createLocalSandboxSession(dir, "Darwin:Sh");
    expect(await session.readTextFile({ path: "/etc/passwd" })).toBeNull();
    expect(await session.readBinaryFile({ path: "/etc/passwd" })).toBeNull();
  });
  test("blocks relative escape on read and write", async () => {
    const session = createLocalSandboxSession(dir, "Darwin:Sh");
    expect(await session.readTextFile({ path: "../../etc/passwd" })).toBeNull();
    await expect(session.writeTextFile({ path: "../../evil.txt", content: "x" })).rejects.toThrow("escapes sandbox");
  });
  test("round trips inside root", async () => {
    const session = createLocalSandboxSession(dir, "Darwin:Sh");
    await session.writeTextFile({ path: "sub/note.txt", content: "hello" });
    expect(await session.readTextFile({ path: "sub/note.txt" })).toBe("hello");
  });
});

describe("edit guards", () => {
  test("schema rejects empty path and oldString", () => {
    expect(EditToolArgsSchema.safeParse({ path: "", oldString: "a", newString: "b" }).success).toBe(false);
    expect(EditToolArgsSchema.safeParse({ path: "f.txt", oldString: "", newString: "b" }).success).toBe(false);
  });
  test("schema accepts valid edit", () => {
    expect(EditToolArgsSchema.safeParse({ path: "f.txt", oldString: "a", newString: "b" }).success).toBe(true);
  });
});

describe("agent dirs", () => {
  test("detects .agents ancestry", () => {
    expect(insideAgentDir(join("proj", ".agents", "skills", "x.md"))).toBe(true);
  });
  test("does not confuse ..foo with parent", () => {
    expect(insideAgentDir(join("proj", ".agents", "..foo", "x.md"))).toBe(true);
  });
});
