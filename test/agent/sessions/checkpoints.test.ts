import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointStore } from "@agent/sessions/checkpoints.ts";

describe("CheckpointStore", () => {
  test("undo and redo replay write/edit changes end-to-end on real files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-checkpoints-"));
    const logPath = join(dir, "checkpoints.jsonl");
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    try {
      const store = new CheckpointStore(logPath);
      await writeFile(a, "one");
      await writeFile(b, "keep");

      // edit a: one -> two; create c; overwrite b
      await store.record({ tool: "edit", path: a, before: "one", after: "two" });
      await store.record({ tool: "write", path: join(dir, "c.txt"), before: null, after: "new" });
      await store.record({ tool: "write", path: b, before: "keep", after: "replaced" });

      expect(await store.undo()).toEqual({ applied: 1, paths: [b] });
      expect(await readFile(b, "utf8")).toBe("keep");
      expect(await store.undo()).toEqual({ applied: 1, paths: [join(dir, "c.txt")] });
      // Undoing a creation deletes the file.
      expect(await readFile(join(dir, "c.txt"), "utf8").catch(() => "gone")).toBe("gone");
      expect(await store.undo()).toEqual({ applied: 1, paths: [a] });
      expect(await readFile(a, "utf8")).toBe("one");
      expect(store.canUndo).toBe(false);

      // Redo walks forward again.
      expect(await store.redo()).toEqual({ applied: 1, paths: [a] });
      expect(await readFile(a, "utf8")).toBe("two");
      expect(await store.redo()).toEqual({ applied: 1, paths: [join(dir, "c.txt")] });
      expect(await readFile(join(dir, "c.txt"), "utf8")).toBe("new");
      expect(await store.redo()).toEqual({ applied: 1, paths: [b] });
      expect(await readFile(b, "utf8")).toBe("replaced");
      expect(store.canRedo).toBe(false);
      // Exhausted redo is a no-op.
      expect(await store.redo()).toEqual({ applied: 0, paths: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a new record truncates the redo tail, and the log survives a reload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-checkpoints-"));
    const logPath = join(dir, "checkpoints.jsonl");
    const a = join(dir, "a.txt");
    try {
      await writeFile(a, "v1");
      const store = new CheckpointStore(logPath);
      await store.record({ tool: "write", path: a, before: "v1", after: "v2" });
      await store.record({ tool: "write", path: a, before: "v2", after: "v3" });

      await store.undo(); // back to v2
      expect(await readFile(a, "utf8")).toBe("v2");
      expect(store.canRedo).toBe(true);

      // A fresh edit after an undo discards the redo tail.
      await store.record({ tool: "write", path: a, before: "v2", after: "v4" });
      expect(store.canRedo).toBe(false);
      expect(await store.undo()).toEqual({ applied: 1, paths: [a] });
      expect(await readFile(a, "utf8")).toBe("v2");

      // Reload: the pointer starts at the last record (undoable, not redoable).
      const reloaded = new CheckpointStore(logPath);
      await reloaded.load();
      expect(reloaded.canUndo).toBe(true);
      expect(reloaded.canRedo).toBe(false);
      await reloaded.undo();
      expect(await readFile(a, "utf8")).toBe("v2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("undo/redo on an empty log are no-ops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picobu-checkpoints-"));
    try {
      const store = new CheckpointStore(join(dir, "none.jsonl"));
      expect(await store.undo()).toEqual({ applied: 0, paths: [] });
      expect(await store.redo()).toEqual({ applied: 0, paths: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
