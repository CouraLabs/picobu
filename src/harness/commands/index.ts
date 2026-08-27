import { buildCommandPrompt, loadCommandCatalog } from "./discovery";
import type { Command } from "./types";

export type { Command, CommandKind } from "./types";

// Re-exported here as the public API surface.
export { acceptCommand, bindCommandAccept, bindExit } from "./bindings";

const catalog: Command[] = await loadCommandCatalog();

export const listCommands = (): Command[] => catalog;

const sortKey = (c: Command): string => {
  const kind = c.kind === "system" ? "0" : c.kind === "workflow" ? "1" : "2";
  return `${kind}:${c.name.toLowerCase()}`;
};

/** Commands matching `query`, grouped system -> workflow -> skill, alphabetical within. */
export const filterCommands = (query: string): Command[] => {
  const q = query.trim().toLowerCase();
  return catalog
    .filter(
      (c) =>
        !q ||
        c.name.toLowerCase().startsWith(q) ||
        c.aliases.some((a) => a.toLowerCase().startsWith(q)),
    )
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
};

export type ResolveResult = { handled: true; prompt?: string } | { handled: false };

const COMMAND_RE = /^\/(\S+)(?:\s+([\s\S]*))?$/;

/** Find the catalog entry whose name or alias equals `token`. */
const findCommand = (token: string): Command | undefined =>
  catalog.find(
    (c) => c.name.toLowerCase() === token || c.aliases.some((a) => a.toLowerCase() === token),
  );

/**
 * Resolve a submitted prompt into a system action, a rewritten skill/workflow
 * prompt, or a passthrough (unknown command / `/ ` prompts / plain text).
 */
export const resolveCommandPrompt = async (text: string): Promise<ResolveResult> => {
  if (text.trim() === "/") return { handled: true }; // bare slash: consumed, nothing sent
  const m = COMMAND_RE.exec(text);
  if (!m) return { handled: false };
  const token = m[1]?.toLowerCase() ?? "";
  const args = m[2] ?? "";
  const cmd = findCommand(token);
  if (!cmd) return { handled: false };
  if (cmd.kind === "system") {
    await cmd.handler?.(args);
    return { handled: true };
  }
  return { handled: true, prompt: await buildCommandPrompt(cmd, args) };
};