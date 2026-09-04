import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, initLockDir, lockFilePath, withLock } from "@shared/lock.ts";

/** PID of a process that has already exited (a real, now-dead PID). */
function deadPid(): number {
  const proc = Bun.spawnSync(["true"]);
  return proc.pid;
}

describe("lock", () => {
  test("acquireLock records the holder and release removes the entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"));
    initLockDir(dir);
    try {
      const target = join(dir, "options.json");
      const lock = await acquireLock(target);

      const raw = readFileSync(lockFilePath(), "utf8");
      expect(raw).toContain(`${target}\t${process.pid}`);

      lock.release();
      expect(readFileSync(lockFilePath(), "utf8")).not.toContain(target);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("acquiring the same path twice in-process is reentrant", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"));
    initLockDir(dir);
    try {
      const target = join(dir, "file.json");
      const first = await acquireLock(target);
      const second = await acquireLock(target);
      expect(second.path).toBe(first.path);
      first.release();
      second.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("withLock releases the lock on success and after a throw", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"));
    initLockDir(dir);
    try {
      const target = join(dir, "file.json");
      const released = await withLock(target, async () => "value");
      expect(released).toBe("value");
      expect(readFileSync(lockFilePath(), "utf8")).not.toContain(target);

      await expect(withLock(target, async () => {
        throw new Error("boom");
      })).rejects.toThrow("boom");
      expect(readFileSync(lockFilePath(), "utf8")).not.toContain(target);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("same-process holders are reentrant and both release cleanly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"));
    initLockDir(dir);
    try {
      const target = join(dir, "file.json");
      // The lock is process-bound: concurrent same-process holders do not
      // block each other, and every release removes only its own entry once.
      await Promise.all([
        withLock(target, async () => Bun.sleep(10)),
        withLock(target, async () => Bun.sleep(10)),
      ]);
      const raw = readFileSync(lockFilePath(), "utf8");
      expect(raw).not.toContain(target);
      expect(raw.trim()).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a dead owner's stale entry is purged and does not block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"));
    initLockDir(dir);
    try {
      const target = join(dir, "file.json");
      writeFileSync(lockFilePath(), `${target}\t${deadPid()}\n`, "utf8");

      const lock = await acquireLock(target);
      expect(lock.path).toBe(target);
      lock.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a live foreign owner blocks acquisition until it goes away", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"));
    initLockDir(dir);
    try {
      const target = join(dir, "file.json");
      const holder = Bun.spawn(["sleep", "30"]);
      writeFileSync(lockFilePath(), `${target}\t${holder.pid}\n`, "utf8");

      let acquired = false;
      const pending = acquireLock(target).then((lock) => {
        acquired = true;
        return lock;
      });

      await Bun.sleep(300);
      expect(acquired).toBe(false);

      holder.kill();
      const lock = await pending;
      expect(acquired).toBe(true);
      lock.release();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 10_000);
});
