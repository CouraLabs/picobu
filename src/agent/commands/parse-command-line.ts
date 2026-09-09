import type { Command } from "@agent/commands/types.ts";

export type SystemCommandName = "q" | "compact" | "models" | "fork" | "summarize" | "roles" | "cd" | "new";

export type SystemCommandDef = {
  name: SystemCommandName;
  aliases: string[];
  description: string;
  usage: string;
};

export const SYSTEM_COMMANDS: SystemCommandDef[] = [
  { name: "q", aliases: ["exit", "leave"], description: "Quit the app", usage: "/q" },
  { name: "compact", aliases: [], description: "Compact the session context", usage: "/compact" },
  { name: "models", aliases: [], description: "Switch model", usage: "/models" },
  { name: "fork", aliases: [], description: "Fork the session at the last message", usage: "/fork" },
  { name: "summarize", aliases: [], description: "Summarize the session", usage: "/summarize" },
  { name: "roles", aliases: [], description: "Assign models and thinking levels to roles", usage: "/roles" },
  { name: "cd", aliases: [], description: "Change project folder (starts a new session)", usage: "/cd <path>" },
  { name: "new", aliases: ["clear", "cls"], description: "Start a new session", usage: "/new" },
];

export const toKebab = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-.]/g, "")
    .replace(/-+/g, "-");

export const matchSystemCommand = (name: string): SystemCommandDef | undefined => {
  const kebab = toKebab(name);
  return SYSTEM_COMMANDS.find((c) => c.name === kebab || c.aliases.includes(kebab));
};

export type ParsedCommandLine =
  | { kind: "skills"; skills: string[]; prompt: string }
  | { kind: "system"; command: SystemCommandDef; args: string }
  | { kind: "workflow"; command: Command; args: string }
  | { kind: "unknown"; name: string };

export const parseCommandLine = (text: string, catalog: Command[]): ParsedCommandLine | null => {
  if (!text.startsWith("/")) return null;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const first = tokens[0]!;
  if (first.toLowerCase().startsWith("/skill:")) {
    const skills: string[] = [];
    let consumed = 0;
    for (const token of tokens) {
      const match = token.match(/^\/skill:([A-Za-z0-9][A-Za-z0-9._-]*)$/);
      if (!match) break;
      skills.push(match[1]!.toLowerCase());
      consumed += 1;
    }
    if (skills.length === 0) return { kind: "unknown", name: first };
    const prompt = tokens.slice(consumed).join(" ");
    return { kind: "skills", skills, prompt };
  }
  const name = first.slice(1);
  const system = matchSystemCommand(name);
  if (system) return { kind: "system", command: system, args: tokens.slice(1).join(" ") };
  const kebab = toKebab(name);
  const workflow = catalog.filter((c) => c.kind === "workflow").find((c) => toKebab(c.name) === kebab || c.aliases.some((a) => toKebab(a) === kebab));
  if (workflow) return { kind: "workflow", command: workflow, args: tokens.slice(1).join(" ") };
  return { kind: "unknown", name: first };
};

export type CommandTokenKind = "skill" | "command" | "text";

export type CommandToken = {
  text: string;
  kind: CommandTokenKind;
};

export const tokenizeCommandLine = (text: string): CommandToken[] => {
  if (!text.startsWith("/")) return [{ text, kind: "text" }];
  return text
    .split(/(\s+)/)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (/^\s+$/.test(part)) return { text: part, kind: "text" as const };
      if (/^\/skill:[A-Za-z0-9][A-Za-z0-9._-]*$/i.test(part)) return { text: part, kind: "skill" as const };
      if (/^\//.test(part)) return { text: part, kind: "command" as const };
      return { text: part, kind: "text" as const };
    });
};
