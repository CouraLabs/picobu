import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const POLL_INTERVAL_MS = 100;
const STALE_CHECK_INTERVAL_MS = 30_000;
const FIELD_SEP = "\t";

let lockDir = `${homedir()}/.picobu`;
export const initLockDir = (systemDir: string): void => {
  lockDir = systemDir;
};
const lockFile = (): string => join(lockDir, ".locks");
const ourPid = process.pid;
export type LockHandle = {
  path: string;
  release: () => void;
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
type Entry = { path: string; pid: number };
function assertSafeLockPath(path: string): void {
  if (path.includes("\t") || path.includes("\n") || path.includes("\r")) {
    throw new Error(`Refusing to lock path with control characters: ${JSON.stringify(path)}`);
  }
}
function readEntries(): Entry[] {
  try {
    const raw = readFileSync(lockFile(), "utf8");
    const entries: Entry[] = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const sep = line.indexOf(FIELD_SEP);
      if (sep <= 0) continue;
      const path = line.slice(0, sep);
      const pid = Number(line.slice(sep + 1));
      if (Number.isInteger(pid) && pid > 0) entries.push({ path, pid });
    }
    return entries;
  } catch {
    return [];
  }
}
function writeEntries(entries: Entry[]): void {
  mkdirSync(lockDir, { recursive: true });
  const body = entries.map((e) => `${e.path}${FIELD_SEP}${e.pid}`).join("\n") + (entries.length ? "\n" : "");
  writeFileSync(lockFile(), body, "utf8");
}
function purgeStale(entries: Entry[]): Entry[] {
  return entries.filter((entry) => entry.pid === ourPid || isAlive(entry.pid));
}
function removeEntries(path: string, entries: Entry[]): Entry[] {
  return entries.filter((entry) => entry.path !== path || entry.pid !== ourPid);
}
const inProcessGates = new Map<string, Promise<void>>();
async function waitForInProcessTurn(path: string): Promise<() => void> {
  const previous = inProcessGates.get(path) ?? Promise.resolve();
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((gateResolve) => (releaseGate = gateResolve));
  const current = previous.then(() => gate);
  inProcessGates.set(path, current);
  await previous;
  return () => {
    releaseGate();
    if (inProcessGates.get(path) === current) {
      inProcessGates.delete(path);
    }
  };
}
const lockNesting = new AsyncLocalStorage<Set<string>>();
export async function acquireLock(filePath: string): Promise<LockHandle> {
  assertSafeLockPath(filePath);
  const path = resolve(filePath);
  assertSafeLockPath(path);
  const releaseInProcess = await waitForInProcessTurn(path);
  mkdirSync(lockDir, { recursive: true });
  let lastStaleCheck = 0;
  let settled = false;
  const guardedRelease = () => {
    if (settled) return;
    settled = true;
    removeOurEntry(path);
    releaseInProcess();
  };
  try {
    for (;;) {
      const now = Date.now();
      if (now - lastStaleCheck >= STALE_CHECK_INTERVAL_MS) {
        const snapshot = readEntries();
        const purged = purgeStale(snapshot);
        if (purged.length !== snapshot.length) writeEntries(purged);
        lastStaleCheck = now;
      }
      const snapshot = readEntries();
      const holders = snapshot.filter((entry) => entry.path === path);
      const foreignAlive = holders.some((entry) => entry.pid !== ourPid && isAlive(entry.pid));
      if (holders.length === 0) {
        appendFileSync(lockFile(), `${path}${FIELD_SEP}${ourPid}\n`, "utf8");
        const after = readEntries().filter((entry) => entry.path === path);
        if (after.length === 1 && after[0]?.pid === ourPid) {
          settled = false;
          return {
            path,
            release: guardedRelease,
          };
        }
        const winner = after[0];
        if (winner && winner.pid === ourPid) {
          const full = readEntries();
          const winnerIndex = full.findIndex((entry) => entry.path === path && entry.pid === ourPid);
          const cleaned = full.filter((entry, index) => entry.path !== path || index === winnerIndex);
          writeEntries(cleaned);
          settled = false;
          return {
            path,
            release: guardedRelease,
          };
        }
        writeEntries(removeEntries(path, readEntries()));
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (!foreignAlive) {
        const withoutDead = snapshot.filter((entry) => !(entry.path === path && entry.pid !== ourPid && !isAlive(entry.pid)));
        if (withoutDead.length !== snapshot.length) {
          writeEntries(withoutDead);
          continue;
        }
        appendFileSync(lockFile(), `${path}${FIELD_SEP}${ourPid}\n`, "utf8");
        const after = readEntries().filter((entry) => entry.path === path);
        const winner = after[0];
        if (winner && winner.pid === ourPid) {
          const full = readEntries();
          const winnerIndex = full.findIndex((entry) => entry.path === path && entry.pid === ourPid);
          const cleaned = full.filter((entry, index) => entry.path !== path || index === winnerIndex);
          writeEntries(cleaned);
          settled = false;
          return {
            path,
            release: guardedRelease,
          };
        }
        writeEntries(removeEntries(path, readEntries()));
      }
      await sleep(POLL_INTERVAL_MS);
    }
  } catch (error) {
    guardedRelease();
    throw error;
  }
}
function removeOurEntry(path: string): void {
  writeEntries(removeEntries(path, readEntries()));
}
export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const path = resolve(filePath);
  assertSafeLockPath(path);
  const nesting = lockNesting.getStore();
  if (nesting?.has(path)) {
    return await fn();
  }
  const lock = await acquireLock(path);
  try {
    const active = lockNesting.getStore();
    if (active) {
      active.add(path);
      try {
        return await fn();
      } finally {
        active.delete(path);
      }
    }
    return await lockNesting.run(new Set([path]), () => fn());
  } finally {
    lock.release();
  }
}
export { lockFile as lockFilePath };
