export type CommandKind = "system" | "workflow" | "skill";

export type Command = {
  kind: CommandKind;
  /** Canonical invocation token, without the leading '/'. */
  name: string;
  /** Extra invocation tokens, e.g. ["q","exit"] for quit. */
  aliases: string[];
  /** Display label (name, or skill/workflow frontmatter name). */
  title: string;
  /** Display blurb. Skills are skipped when empty. */
  description: string;
  /** SKILL.md / workflow .md path; "" for system commands. */
  path: string;
};
