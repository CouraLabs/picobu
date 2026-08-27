import { homedir } from "node:os";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { rgPath } from "@vscode/ripgrep";

/**
 * File-backed, process-bound locking shared by every picobu instance (the app,
 * TUI and multiple sessions), coordinated through a single consumer lock file
 * under `app.systemDir`.
 *
 * Each lock records one `path\tpid` line. Before touching a file, callers check
 * that line (via ripgrep) and wait while a live foreign process holds it. A
 * stale lock — one whose owning PID is gone — is purged on a 30s cadence.
 */

const POLL_INTERVAL_MS = 100;
const STALE_CHECK_INTERVAL_MS = 30_000;
const FIELD_SEP = "\t";

// Default to the same global dir the options use; callers may override so the
// lock file always lands wherever `app.systemDir` points on this process.
let lockDir = `${homedir()}/.picobu`;

export const initLockDir = (systemDir: string): void => {
  lockDir = systemDir;
};

const lockFile = (): string => join(lockDir, ".locks");

const ourPid = process.pid;

export type LockHandle = {
  /** The locked file's absolute path. */
  path: string;
  /** Release the lock, removing the entry from the global lock file. */
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

/** ripgrep fast check for an exact path entry (`path\t`). */
async function hasEntry(path: string): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: [rgPath, "-F", "-q", "--", `${path}${FIELD_SEP}`, lockFile()],
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    // 0 = match, 1 = no match, 2 = error (e.g. file missing).
    return code === 0;
  } catch {
    return readEntries().some((entry) => entry.path === path);
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

/** Drop entries whose owner PID is no longer alive. */
function purgeStale(entries: Entry[]): Entry[] {
  return entries.filter((entry) => entry.pid === ourPid || isAlive(entry.pid));
}

function removeEntries(path: string, entries: Entry[]): Entry[] {
  return entries.filter((entry) => entry.path !== path || entry.pid !== ourPid);
}

/**
 * Acquire a process-bound lock on `filePath`. Blocks until no *live foreign*
 * process holds it, then grants the lock to this process. Every ~30s a liveness
 * pass releases stale (dead-owner) entries so a crashed process cannot wedge a
 * file forever. Returned handle's `release()` removes this process's entry.
 */
export async function acquireLock(filePath: string): Promise<LockHandle> {
  const path = resolve(filePath);
  mkdirSync(lockDir, { recursive: true });

  let lastStaleCheck = 0;
  for (;;) {
    const now = Date.now();
    if (now - lastStaleCheck >= STALE_CHECK_INTERVAL_MS) {
      writeEntries(purgeStale(readEntries()));
      lastStaleCheck = now;
    }

    // Fast path (ripgrep): no entry at all — take the lock immediately.
    if (!(await hasEntry(path))) {
      appendFileSync(lockFile(), `${path}${FIELD_SEP}${ourPid}\n`, "utf8");
      return {
        path,
        release: () => removeOurEntry(path),
      };
    }

    // Entry present: block only on live *foreign* holders. Our own (reentrant)
    // or dead entries do not block.
    const holders = readEntries().filter((entry) => entry.path === path);
    const foreignAlive = holders.some((entry) => entry.pid !== ourPid && isAlive(entry.pid));
    if (!foreignAlive) {
      appendFileSync(lockFile(), `${path}${FIELD_SEP}${ourPid}\n`, "utf8");
      return {
        path,
        release: () => removeOurEntry(path),
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

function removeOurEntry(path: string): void {
  writeEntries(removeEntries(path, readEntries()));
}

/**
 * Acquire the lock for `path`, run `fn` while holding it, and always release
 * before resolving/rejecting.
 */
export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lock = await acquireLock(filePath);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

/** When a lock is released/exhausted the entry is removed from this file. */
export { lockFile as lockFilePath };