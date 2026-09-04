import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getMcpCredential,
  initMcpAuthFilePath,
  isMcpAuthActive,
  listMcpCredentials,
  removeMcpCredential,
  resetMcpAuthCache,
  setMcpCredential,
} from "@integrations/mcp/auth.ts";

/** Token store tests run against a temp-dir mcp-auth.json (path override). */
const dir = await mkdtemp(join(tmpdir(), "picobu-mcp-auth-"));
initMcpAuthFilePath(join(dir, "mcp-auth.json"));
afterAll(async () => {
  resetMcpAuthCache();
  await rm(dir, { recursive: true, force: true });
});

const TOKENS = (expiresIn?: number) => ({
  access_token: "at",
  token_type: "Bearer",
  ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
});

describe("mcp token store", () => {
  test("missing file reads as empty", () => {
    expect(listMcpCredentials()).toEqual({});
    expect(getMcpCredential("linear")).toBeUndefined();
  });

  test("set + get round-trips through disk", async () => {
    const expiresAt = Date.now() + 3600_000;
    await setMcpCredential("linear", { tokens: TOKENS(3600), expiresAt });
    // The singleton cache reflects the write.
    expect(getMcpCredential("linear")?.tokens.access_token).toBe("at");
    expect(getMcpCredential("linear")?.expiresAt).toBe(expiresAt);
  });

  test("concurrent writes do not corrupt the file (lock-guarded persist)", async () => {
    await Promise.all([
      setMcpCredential("a", { tokens: TOKENS() }),
      setMcpCredential("b", { tokens: TOKENS() }),
      setMcpCredential("c", { tokens: TOKENS() }),
    ]);
    expect(Object.keys(listMcpCredentials()).sort()).toEqual(["a", "b", "c", "linear"]);
  });

  test("remove drops one entry and reports misses", async () => {
    await setMcpCredential("gone", { tokens: TOKENS() });
    expect(await removeMcpCredential("gone")).toBe(true);
    expect(await removeMcpCredential("never-there")).toBe(false);
    expect(getMcpCredential("gone")).toBeUndefined();
  });
});

describe("isMcpAuthActive (flag matrix)", () => {
  const HOUR = 3600_000;

  test("no credential → false", () => {
    expect(isMcpAuthActive("matrix-none")).toBe(false);
  });

  test("fresh token → true", async () => {
    await setMcpCredential("matrix-fresh", { tokens: TOKENS(2 * HOUR), expiresAt: Date.now() + 2 * HOUR });
    expect(isMcpAuthActive("matrix-fresh")).toBe(true);
  });

  test("expired token → false", async () => {
    await setMcpCredential("matrix-expired", { tokens: TOKENS(0), expiresAt: Date.now() - HOUR });
    expect(isMcpAuthActive("matrix-expired")).toBe(false);
  });

  test("token within the 5-minute refresh grace counts as inactive", async () => {
    await setMcpCredential("matrix-grace", { tokens: TOKENS(60), expiresAt: Date.now() + 60_000 });
    expect(isMcpAuthActive("matrix-grace")).toBe(false);
  });

  test("non-expiring token (no expiresAt) → true", async () => {
    await setMcpCredential("matrix-forever", { tokens: TOKENS() });
    expect(isMcpAuthActive("matrix-forever")).toBe(true);
  });
});
