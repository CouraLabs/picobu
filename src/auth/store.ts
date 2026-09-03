import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { options } from "@libs/options.ts";
import { acquireLock } from "@libs/lock.ts";
import type { OAuthCredential } from "@auth/types.ts";

/**
 * OAuth credential persistence: `<systemDir>/auth.json` keyed by provider id
 * (`openai`, `anthropic`, `github-copilot`). Reads/writes are lock-guarded
 * (cross-instance) and cached in-memory so the synchronous model-resolution
 * path (`provider-resolver.resolveAuth`) can read tokens without awaiting.
 */

export type AuthFile = Record<string, OAuthCredential>;

const DEFAULT_PATH = join(options.app.systemDir, "auth.json");

let authFilePath = DEFAULT_PATH;
let cache: AuthFile | null = null;

/** Override the auth.json path (tests). Clears the cache. */
export const initAuthFilePath = (path: string): void => {
  authFilePath = path;
  cache = null;
};

/** Drop the in-memory cache so the next read reloads from disk. */
export const resetAuthCache = (): void => {
  cache = null;
};

export const authFilePathOf = (): string => authFilePath;

/** Read the raw auth file at `path`; missing/broken files resolve to `{}`. */
export const readAuthFile = async (path: string): Promise<AuthFile> => {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return {};
    const parsed: unknown = await file.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as AuthFile;
  } catch {
    return {};
  }
};

/**
 * Load the auth file into the singleton cache (idempotent, best-effort).
 * Call once at startup (before the first sync read) and before mutations.
 */
export const initAuth = async (): Promise<void> => {
  if (cache === null) cache = await readAuthFile(authFilePath);
};

/** All stored credentials (sync; empty until `initAuth` has run). */
export const listCredentials = (): AuthFile => cache ?? {};

export const getCredential = (id: string): OAuthCredential | undefined => listCredentials()[id];

const persist = async (mutate: (current: AuthFile) => AuthFile | null): Promise<AuthFile | null> => {
  await initAuth();
  const lock = await acquireLock(authFilePath);
  try {
    const current = await readAuthFile(authFilePath);
    const updated = mutate(current);
    if (updated === null) return null;
    mkdirSync(options.app.systemDir, { recursive: true });
    await Bun.write(authFilePath, JSON.stringify(updated, null, 2));
    cache = updated;
    return updated;
  } finally {
    lock.release();
  }
};

/** Store (or replace) a credential for `id`; persists + syncs the cache. */
export const setCredential = async (id: string, credential: OAuthCredential): Promise<void> => {
  await persist((current) => ({ ...current, [id]: credential }));
};

/** Remove the credential for `id`; returns false when none was stored. */
export const removeCredential = async (id: string): Promise<boolean> => {
  return (await persist((current) => {
    if (!current[id]) return null;
    const { [id]: _removed, ...rest } = current;
    return rest;
  })) !== null;
};