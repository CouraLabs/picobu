import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClipboardService } from "@opentui/core";
import { getClipboardService, setClipboardService } from "../../src/tui/hooks/clipboard.state.ts";

type StateSnapshot = {
  home: string;
  dialog: { closed: boolean; opened: boolean; replaced: boolean; cleared: boolean; toggles: string[] };
  dropdown: { null: boolean; opened: boolean; reselected: boolean; cleared: boolean };
  clipboard: { null: boolean; stored: boolean; replaced: boolean; cleared: boolean };
  theme: {
    initial: { name: string; variant: string };
    count: number;
    hasTacos: boolean;
    sorted: boolean;
    syntax: boolean;
    indexHit: number;
    indexMiss: number;
    afterSet: { name: string; variant: string };
    persisted: { theme: { key: string; variant: string }; maxMessages: number };
    afterToggle: { name: string; variant: string };
    afterToggleBack: { name: string; variant: string };
    unknownThemeError: string;
  };
};

const root = join(fileURLToPath(new URL("../..", import.meta.url)));
const home = mkdtempSync(join(tmpdir(), "picobu-tui-home-"));

const runIsolated = (script: string[], extraArgs: string[] = []): { code: number | null; out: string } => {
  const proc = Bun.spawnSync([process.execPath, join(root, ...script), ...extraArgs], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home },
  });
  return { code: proc.exitCode, out: proc.stdout.toString().trim() };
};

const stateRun = runIsolated(["tests", "tui", "state-check.ts"]);
if (stateRun.code !== 0) throw new Error(`state-check failed: ${stateRun.out}`);
const snapshot = JSON.parse(stateRun.out) as StateSnapshot;

describe("dialog state", () => {
  test("starts closed and opens with content", () => {
    expect(snapshot.dialog.closed).toBe(true);
    expect(snapshot.dialog.opened).toBe(true);
  });
  test("reopening replaces content and closing clears it", () => {
    expect(snapshot.dialog.replaced).toBe(true);
    expect(snapshot.dialog.cleared).toBe(true);
  });
  test("supports open/close toggle sequences", () => {
    expect(snapshot.dialog.toggles).toEqual(["open", "close", "open"]);
  });
});

describe("dropdown state", () => {
  test("starts closed and opens with placement", () => {
    expect(snapshot.dropdown.null).toBe(true);
    expect(snapshot.dropdown.opened).toBe(true);
  });
  test("reopening replaces selection and closing clears", () => {
    expect(snapshot.dropdown.reselected).toBe(true);
    expect(snapshot.dropdown.cleared).toBe(true);
  });
});

describe("clipboard state", () => {
  const fake = (id: string): ClipboardService => ({ id }) as unknown as ClipboardService;
  test("stores service by reference in isolation", () => {
    expect(snapshot.clipboard.null).toBe(true);
    expect(snapshot.clipboard.stored).toBe(true);
    expect(snapshot.clipboard.replaced).toBe(true);
    expect(snapshot.clipboard.cleared).toBe(true);
  });
  test("set/get/clear locally without globals", () => {
    setClipboardService(null);
    expect(getClipboardService()).toBeNull();
    const service = fake("one");
    setClipboardService(service);
    expect(getClipboardService()).toBe(service);
    const next = fake("two");
    setClipboardService(next);
    expect(getClipboardService()).toBe(next);
    setClipboardService(null);
    expect(getClipboardService()).toBeNull();
  });
  test("uses isolated home dir", () => {
    expect(snapshot.home.startsWith(tmpdir())).toBe(true);
    expect(snapshot.home).toBe(home);
  });
});

describe("theme state", () => {
  test("lists sorted themes with seeded default", () => {
    expect(snapshot.theme.count).toBeGreaterThan(20);
    expect(snapshot.theme.hasTacos).toBe(true);
    expect(snapshot.theme.sorted).toBe(true);
    expect(snapshot.theme.initial).toEqual({ name: "tacos", variant: "dark" });
  });
  test("exposes syntax styles and selection helper", () => {
    expect(snapshot.theme.syntax).toBe(true);
  });
  test("indexOfTheme falls back to zero", () => {
    expect(snapshot.theme.indexHit).toBe(1);
    expect(snapshot.theme.indexMiss).toBe(0);
  });
  test("setTheme persists key/variant shape and updates state", () => {
    expect(snapshot.theme.afterSet).toEqual({ name: "dracula", variant: "light" });
    expect(snapshot.theme.persisted.theme).toEqual({ key: "dracula", variant: "light" });
    expect(typeof snapshot.theme.persisted.maxMessages).toBe("number");
  });
  test("toggleThemeVariant flips dark and light", () => {
    expect(snapshot.theme.afterToggle).toEqual({ name: "dracula", variant: "dark" });
    expect(snapshot.theme.afterToggleBack).toEqual({ name: "dracula", variant: "light" });
  });
  test("setTheme falls back to tacos for unknown themes", () => {
    expect(snapshot.theme.unknownThemeError).toBe("tacos");
  });
});

describe("cli help", () => {
  test("root help names picobu with sessions and mcp", () => {
    const { code, out } = runIsolated(["src", "cli.ts"], ["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("picobu");
    expect(out).toContain("sessions");
    expect(out).toContain("mcp");
  });
  test("sessions help names delete/rename/tree and --dir", () => {
    const { code, out } = runIsolated(["src", "cli.ts"], ["sessions", "--help"]);
    expect(code).toBe(0);
    expect(out).toContain("delete");
    expect(out).toContain("rename");
    expect(out).toContain("tree");
    expect(out).toContain("--dir");
  });
  test("mcp help names login/logout", () => {
    const { code, out } = runIsolated(["src", "cli.ts"], ["mcp", "--help"]);
    expect(code).toBe(0);
    expect(out).toContain("login");
    expect(out).toContain("logout");
  });
});
