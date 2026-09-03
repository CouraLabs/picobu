import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addPrompt,
  flushPromptHistory,
  loadPromptHistory,
  PROMPT_HISTORY_LIMIT,
  promptHistoryPath,
  resetPromptHistoryCache,
} from "@libs/prompt-history.ts";
import { options } from "@libs/options.ts";

/**
 * Run `fn` with the system dir redirected to a fresh temp dir (and the prompt
 * history cache dropped), restoring the real dir and cleaning up afterwards.
 * bun:test runs each file in its own process, so the swap cannot leak into
 * other test files.
 */
async function withHistoryDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "picobu-history-"));
  const originalSystemDir = options.app.systemDir;
  options.app.systemDir = dir;
  resetPromptHistoryCache();
  try {
    await fn(dir);
  } finally {
    options.app.systemDir = originalSystemDir;
    resetPromptHistoryCache();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("prompt history", () => {
  test("persists submitted prompts to <systemDir>/prompt-history.json", async () => {
    await withHistoryDir(async () => {
      const list = addPrompt("first prompt");
      expect(list).toEqual(["first prompt"]);
      await flushPromptHistory();

      const raw = JSON.parse(await readFile(promptHistoryPath(), "utf8")) as { prompts: string[] };
      expect(raw.prompts).toEqual(["first prompt"]);
      // A fresh load reads the persisted file.
      resetPromptHistoryCache();
      expect(loadPromptHistory()).toEqual(["first prompt"]);
    });
  });

  test("re-adding a prompt moves it to the end (most recent last)", async () => {
    await withHistoryDir(async () => {
      addPrompt("one");
      addPrompt("two");
      const list = addPrompt("one");
      expect(list).toEqual(["two", "one"]);
      await flushPromptHistory();

      const raw = JSON.parse(await readFile(promptHistoryPath(), "utf8")) as { prompts: string[] };
      expect(raw.prompts).toEqual(["two", "one"]);
    });
  });

  test("caps the history at the last 10 prompts", async () => {
    await withHistoryDir(async () => {
      let list: string[] = [];
      for (let i = 0; i < PROMPT_HISTORY_LIMIT + 5; i++) {
        list = addPrompt(`prompt ${i}`);
      }
      expect(list).toHaveLength(PROMPT_HISTORY_LIMIT);
      expect(list[0]).toBe(`prompt 5`);
      expect(list[list.length - 1]).toBe(`prompt ${PROMPT_HISTORY_LIMIT + 4}`);
      await flushPromptHistory();

      const raw = JSON.parse(await readFile(promptHistoryPath(), "utf8")) as { prompts: string[] };
      expect(raw.prompts).toHaveLength(PROMPT_HISTORY_LIMIT);
    });
  });

  test("missing file loads as empty and blank prompts are ignored", async () => {
    await withHistoryDir(async () => {
      expect(loadPromptHistory()).toEqual([]);
      expect(addPrompt("   ")).toEqual([]);
      await flushPromptHistory();
      await expect(readFile(promptHistoryPath(), "utf8")).rejects.toThrow();
    });
  });

  test("malformed file loads as empty", async () => {
    await withHistoryDir(async (dir) => {
      await writeFile(promptHistoryPath(), "{ not json", "utf8");
      expect(loadPromptHistory()).toEqual([]);
      // And a bad shape is equally ignored.
      await writeFile(promptHistoryPath(), JSON.stringify({ prompts: "nope" }), "utf8");
      expect(loadPromptHistory()).toEqual([]);
      void dir;
    });
  });

  test("the persisted file survives a reload round-trip", async () => {
    await withHistoryDir(async () => {
      addPrompt("alpha");
      addPrompt("beta");
      await flushPromptHistory();
      resetPromptHistoryCache();
      expect(loadPromptHistory()).toEqual(["alpha", "beta"]);
      void mkdir;
    });
  });
});
