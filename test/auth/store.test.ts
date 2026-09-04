import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLockDir } from "@shared/lock.ts";
import {
  authFilePathOf,
  getCredential,
  initAuth,
  initAuthFilePath,
  listCredentials,
  readAuthFile,
  removeCredential,
  resetAuthCache,
  setCredential,
} from "@auth/store.ts";
import type { OAuthCredential } from "@auth/types.ts";

const credential = (overrides: Partial<OAuthCredential> = {}): OAuthCredential => ({
  type: "oauth",
  access: "acc",
  refresh: "ref",
  expires: Date.now() + 60_000,
  ...overrides,
});

describe("auth store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "picobu-auth-"));
    initLockDir(dir); // keep lock registrations out of the real ~/.picobu
    initAuthFilePath(join(dir, "auth.json"));
    resetAuthCache();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("is empty before anything is stored", async () => {
    expect(await readAuthFile(authFilePathOf())).toEqual({});
    expect(listCredentials()).toEqual({});
    expect(getCredential("openai")).toBeUndefined();
  });

  test("round-trips a credential through auth.json", async () => {
    await initAuth();
    const c = credential({ accountId: "user-1" });
    await setCredential("openai", c);

    expect(await readAuthFile(authFilePathOf())).toEqual({ openai: c });
    expect(getCredential("openai")).toMatchObject({ type: "oauth", accountId: "user-1" });
    expect(Object.keys(listCredentials())).toEqual(["openai"]);
  });

  test("setCredential overwrites an existing entry", async () => {
    await setCredential("anthropic", credential({ access: "v1" }));
    await setCredential("anthropic", credential({ access: "v2" }));
    expect(getCredential("anthropic")?.access).toBe("v2");
  });

  test("removeCredential deletes only the requested id", async () => {
    await setCredential("openai", credential());
    await setCredential("anthropic", credential());
    expect(await removeCredential("openai")).toBe(true);
    expect(getCredential("openai")).toBeUndefined();
    expect(getCredential("anthropic")).toBeDefined();
    expect(await removeCredential("openai")).toBe(false);
  });

  test("readAuthFile tolerates missing and malformed files", async () => {
    expect(await readAuthFile(join(dir, "missing.json"))).toEqual({});
    const malformed = join(dir, "auth.json");
    await Bun.write(malformed, "not json");
    expect(await readAuthFile(malformed)).toEqual({});
  });

  test("initAuth loads the persisted file into the sync cache", async () => {
    await setCredential("openai", credential());
    resetAuthCache();
    await initAuth();
    expect(getCredential("openai")).toBeDefined();
  });
});