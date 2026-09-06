import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { options } from "@config/options.ts";
import { acquireLock } from "@shared/lock.ts";
import type { OAuthCredential } from "@auth/types.ts";



export type AuthFile = Record<string, OAuthCredential>;
const DEFAULT_PATH = join(options.app.systemDir, "auth.json");
let authFilePath = DEFAULT_PATH;
let cache: AuthFile | null = null;


export const initAuthFilePath = (path: string): void => {
  authFilePath = path;
  cache = null;
};


export const resetAuthCache = (): void => {
  cache = null;
};
export const authFilePathOf = (): string => authFilePath;


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


export const initAuth = async (): Promise<void> => {
  if (cache === null) cache = await readAuthFile(authFilePath);
};


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


export const setCredential = async (id: string, credential: OAuthCredential): Promise<void> => {
  await persist((current) => ({ ...current, [id]: credential }));
};


export const removeCredential = async (id: string): Promise<boolean> => {
  return (await persist((current) => {
    if (!current[id]) return null;
    const { [id]: _removed, ...rest } = current;
    return rest;
  })) !== null;
};