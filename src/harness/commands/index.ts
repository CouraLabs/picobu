import { buildCommandPrompt, loadCommandCatalog } from "./discovery";
import type { Command } from "./types";
import type { SessionBindings } from "./bindings";
import { footerToastStore } from "../../stores/footer-toast-store";

export type { Command, CommandKind, CommandFlag } from "./types";


const catalog: Command[] = await loadCommandCatalog();

export const listCommands = (): Command[] => catalog;

/**
 * The session mode a command is resolved in: which tab (`kind`) and which
 * surface (`web`). Commands without the matching flag are unavailable.
 */
export type CommandMode = { kind: "code" | "persitent"; web: boolean };

/** True when `command` may run in `mode` (no flags = everywhere). */
export const commandAvailable = (c: Command, mode?: CommandMode): boolean => {
  if (!mode) return true;
  const flags = c.flags ?? ["code", "web", "persitent"];
  return flags.includes(mode.kind) && (!mode.web || flags.includes("web"));
};

/** Map an agent/session tab category onto command flags vocabulary. */
export const commandModeFor = (tab: "coding" | "persistent", web: boolean): CommandMode => ({
  kind: tab === "coding" ? "code" : "persitent",
  web,
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

const COMMAND_RE = /^\/(\S+)(?:\s+([\s\S]*))?$/;

/** Find the catalog entry whose name or alias equals `token`. */
const findCommand = (token: string): Command | undefined =>
  catalog.find(
    (c) => c.name.toLowerCase() === token || c.aliases.some((a) => a.toLowerCase() === token),
  );

/**
 * Resolve a submitted prompt into a system action, a rewritten skill/workflow
 * prompt, or a passthrough (unknown command / `/ ` prompts / plain text).
 * Commands whose flags exclude the current mode are consumed with a toast
 * instead of running (e.g. `/quit` on web, `/new` on the persistent tab).
 */
export const resolveCommandPrompt = async (
  text: string,
  bindings: SessionBindings,
  mode?: CommandMode,
): Promise<ResolveResult> => {

  if (text.trim() === "/") return { handled: true }; // bare slash: consumed, nothing sent
  const m = COMMAND_RE.exec(text);
  if (!m) return { handled: false };
  const token = m[1]?.toLowerCase() ?? "";
  const args = m[2] ?? "";
  const cmd = findCommand(token);
  if (!cmd) return { handled: false };
  if (!commandAvailable(cmd, mode)) {
    footerToastStore.trigger.show({
      message: `/${cmd.name} is not available in this session mode`,
    });
    return { handled: true };
  }
  if (cmd.kind === "system") {
    await cmd.handler?.(args, bindings);
    return { handled: true };
  }
  return { handled: true, prompt: await buildCommandPrompt(cmd, args) };
};