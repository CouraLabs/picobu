import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitInfo } from "../../src/shared/git-info.ts";

describe("getGitInfo", () => {
  test("reads branch and numeric stats inside a repo", () => {
    const info = getGitInfo(join(import.meta.dir, "..", ".."));
    expect(info).not.toBeNull();
    expect(typeof info?.branch).toBe("string");
    expect(Number.isFinite(info?.additions)).toBe(true);
    expect(Number.isFinite(info?.deletions)).toBe(true);
  });
  test("returns null outside a repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "picobu-norepo-"));
    expect(getGitInfo(dir)).toBeNull();
  });
});
