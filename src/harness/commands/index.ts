import { buildCommandPrompt, loadCommandCatalog } from "./discovery";
import type { Command } from "./types";
import type { SessionBindings } from "./bindings";
import { footerToastStore } from "../../stores/footer-toast-store";

export type { Command, CommandKind, CommandFlag } from "./types";


const catalog: Command[] = await loadCommandCatalog();

export const listCommands = (): Command[] => catalog;

/** Discovered skills (`kind: "skill"`), shared by the `skill` flow tool and the system prompt. */
export const listSkills = (): Command[] => catalog.filter((c) => c.kind === "skill");

/**
 * The session mode a command is resolved in: which tab (`kind`), which
 * surface (`web`), and whether a run is currently streaming. Commands without
 * the matching flags are unavailable.
 */
export type CommandMode = { kind: "code" | "persitent"; web: boolean; streaming?: boolean };

/** True when `command` may run in `mode` (no flags = everywhere). */
export const commandAvailable = (c: Command, mode?: CommandMode): boolean => {
  if (!mode) return true;
  if (mode.streaming && c.requiresIdle) return false;
  const flags = c.flags ?? ["code", "web", "persitent"];
  return flags.includes(mode.kind) && (!mode.web || flags.includes("web"));
};

/** Map an agent/session tab category onto command flags vocabulary. */
export const commandModeFor = (
  tab: "coding" | "persistent",
  web: boolean,
  streaming = false,
): CommandMode => ({
  kind: tab === "coding" ? "code" : "persitent",
  web,
  streaming,
});

const sortKey = (c: Command): string => {
  const kind = c.kind === "system" ? "0" : c.kind === "workflow" ? "1" : "2";
  return `${kind}:${c.name.toLowerCase()}`;
};

/** Commands matching `query`, grouped system -> workflow -> skill, alphabetical within. */
export const filterCommands = (query: string, mode?: CommandMode): Command[] => {
  const q = query.trim().toLowerCase();
  return catalog
    .filter(
      (c) =>
        !q ||
        c.name.toLowerCase().startsWith(q) ||
        c.aliases.some((a) => a.toLowerCase().startsWith(q)),
    )
    .filter((c) => commandAvailable(c, mode))
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
};

export type ResolveResult = { handled: true; prompt?: string } | { handled: false };

/**
 * A "/"-prefixed word at the start of the text or right after whitespace.
 * Used both while typing (the picker's query) and on submit (segment parsing).
 */
export const lastCommandWord = (text: string): string => /(\S+)$/.exec(text)?.[1] ?? "";

/** Find the catalog entry whose name or alias equals `token`. */
const findCommand = (token: string): Command | undefined =>
  catalog.find(
    (c) => c.name.toLowerCase() === token || c.aliases.some((a) => a.toLowerCase() === token),
  );

/** One piece of a command-mode prompt: a resolved command with its args. */
type Segment = { cmd: Command; args: string };

/**
 * Split a command-mode prompt into ordered command segments. Each word-boundary
 * "/token" that matches a catalog command starts a segment owning the text up
 * to the next command token (its args); text attached to unknown tokens stays
 * literal inside the preceding command's args.
 */
const parseSegments = (text: string): Segment[] => {
  const segments: Segment[] = [];
  const tokenRe = /(^|\s)\/(\S+)/g;
  let cursor = 0;
  for (let m = tokenRe.exec(text); m; m = tokenRe.exec(text)) {
    const cmd = findCommand(m[2]!.toLowerCase());
    if (!cmd) continue;
    const tokenStart = m.index + m[1]!.length;
    if (segments.length)
      segments[segments.length - 1]!.args = text.slice(cursor, tokenStart).trimStart();
    segments.push({ cmd, args: "" });
    cursor = tokenStart + m[0].length - m[1]!.length;
  }
  if (segments.length) segments[segments.length - 1]!.args = text.slice(cursor).trimStart();
  return segments;
};

/**
 * Resolve a submitted prompt into a system action, a rewritten skill/workflow
 * prompt, or a passthrough (unknown command / `/ ` prompts / plain text).
 *
 * Command-mode prompts (starting with "/") may carry multiple commands: every
 * word-boundary "/token" whose first occurrence opens the prompt is resolved
 * too, so `/skill-a then /skill-b now` loads both skills, each with its own
 * args. System commands run in order; skill/workflow segments are built via
 * `buildCommandPrompt` and the results are concatenated (blank-line separated)
 * into the outgoing prompt. Validation is all-or-nothing: any command that is
 * unavailable (or idle-only while streaming) consumes the whole prompt with a
 * toast instead of running (e.g. `/quit` on web, `/new` on the persistent tab).
 */
export const resolveCommandPrompt = async (
  text: string,
  bindings: SessionBindings,
  mode?: CommandMode,
): Promise<ResolveResult> => {

  if (text.trim() === "/") return { handled: true }; // bare slash: consumed, nothing sent
  if (!text.startsWith("/")) return { handled: false };
  // Strict passthrough: an unknown first token sends the raw text, exactly the
  // single-command behavior (mid-prompt tokens are only parsed once the first
  // one is a known command).
  const firstToken = /^\/(\S+)/.exec(text)?.[1] ?? "";
  if (!findCommand(firstToken.toLowerCase())) return { handled: false };
  const segments = parseSegments(text);
  for (const { cmd } of segments) {
    if (mode?.streaming && cmd.requiresIdle) {
      footerToastStore.trigger.show({
        message: `/${cmd.name} is not available while the agent is streaming`,
      });
      return { handled: true };
    }
    if (!commandAvailable(cmd, mode)) {
      footerToastStore.trigger.show({
        message: `/${cmd.name} is not available in this session mode`,
      });
      return { handled: true };
    }
  }
  const parts: string[] = [];
  for (const { cmd, args } of segments) {
    if (cmd.kind === "system") {
      await cmd.handler?.(args, bindings);
      continue;
    }
    parts.push(await buildCommandPrompt(cmd, args));
  }
  return { handled: true, prompt: parts.length ? parts.join("\n\n") : undefined };
};