export type CommandKind = "system" | "workflow" | "skill";

export type Command = {
  kind: CommandKind;
  /** Canonical invocation token, without the leading '/'. */
  name: string;
  /** Extra invocation tokens (system-only today), e.g. ["q","exit"] for quit. */
  aliases: string[];
  /** Display label (name, or skill/workflow frontmatter name). */
  title: string;
  /** Display blurb in the picker. Skills are skipped when empty. */
  description: string;
  /** SKILL.md / workflow .md path; "" for system commands. */
  path: string;
  /** System-only; receives the raw params string (e.g. "high" for /effort high). */
  handler?: (args: string) => void | Promise<void>;
};