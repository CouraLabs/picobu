import { parseMarkdown, type MarkdownParam } from "@harness/agent/markdown/markdown-parser.ts";

export const systemMarkdown =
`# System Preamble
You are {APP_NAME}, a godlike general-purpose autonomous agent, you code, send and receive messages, and integrate with external systems and skill/app frameworks. You always adapt your approach to the task. Treat real progress, not approval, as success. Be precise, direct, and genuinely collaborative; never cheerlead, inflate, or reassure artificially.
# System Environment
- Working directory: {APP_CWD}
- Operating system: {APP_OS}
- System Shell: {APP_SHELL}
# System Guideless
- Default to informed action; don't ask for confirmation when tools or repo context can answer.
- Resolve ambiguity from repo conventions, existing patterns, and reasonable defaults; escalate only when options have materially different tradeoffs the user must decide.
- Mark unobserved claims [INFERENCE]; keep observed and inferred distinct.
- Always reply in the same language the user wrote in: if the user's prompt is in Portuguese, answer in Portuguese; if in Spanish, answer in Spanish, and so on — regardless of the language of the code, tools, or this prompt.`;

export type SystemPromptSection = {
  key: string;
  content: string;
};

export type GenerateSystemMessageParams = {
  appName: string;
  cwd: string;
  os: string;
  shell: string;
  /** The active agent's instructions (e.g. the Ask prompt content). */
  agentPrompt?: string;
  /** Concatenated LLM-facing tool usage docs emitted by `toolsInfo`. */
  toolsInfo?: string;
  /** Installed-skills catalog rendered by `buildSkillsSection` (omitted when none). */
  skillsInfo?: string;
  /** Installed-rules catalog rendered by `buildRulesSection` (omitted when none). */
  rulesInfo?: string;
  /**
   * Project instructions loaded from AGENTS.md/CLAUDE.md at session creation,
   * concatenated at the end of the guidelines section (omitted when absent).
   */
  agentsAppendix?: string;
};

/**
 * Render the `<Skills>` section content: when to reach for the `skill` tool
 * plus one bulleted entry per discovered skill (exact invocation name + the
 * frontmatter description the model matches the task against).
 */
export function buildSkillsSection(
  skills: { name: string; description: string }[],
): string {
  return [
    "The skills below are installed. When the user's request or the task's subject matches a skill's description,",
    "call the `skill` tool with that skill's exact name to load its full instructions, then follow them.",
    "The tool's output also lists the skill's related files; read them with the read tool as needed.",
    "",
    ...skills.map((s) => `- ${s.name}: ${s.description}`),
  ].join("\n");
}

/**
 * Render the `<Rules>` section content: when to reach for the `rule` tool plus
 * one bulleted entry per discovered rule (exact invocation name + the
 * frontmatter description the model matches the task against).
 */
export function buildRulesSection(
  rules: { name: string; description: string }[],
): string {
  return [
    "The rules below are installed. When the current task matches a rule's description,",
    "call the `rule` tool with that rule's exact name to load its instructions, then follow them.",
    "",
    ...rules.map((r) => `- ${r.name}: ${r.description}`),
  ].join("\n");
}

/**
 * Build the agent system prompt from the `systemMarkdown` template: substitute
 * the environment placeholders, then split the body into one section per `#`
 * heading so callers can render each as its own instruction block. When provided,
 * the active agent's prompt, the installed-skills and installed-rules catalogs
 * and the available-tools usage docs are appended as their own `<Agent Role>`,
 * `<Skills>`, `<Rules>` and `<Available Tools>` sections. `agentsAppendix`
 * (AGENTS.md/CLAUDE.md) is concatenated at the end of the guidelines section.
 */
export function generateSystemMessage(
  params: GenerateSystemMessageParams,
): SystemPromptSection[] {
  const paramsList: MarkdownParam[] = [
    { param: "{APP_NAME}", value: params.appName },
    { param: "{APP_CWD}", value: params.cwd },
    { param: "{APP_OS}", value: params.os },
    { param: "{APP_SHELL}", value: params.shell },
  ];

  const { content } = parseMarkdown(systemMarkdown, paramsList);

  const sections = splitIntoSections(content);

  if (params.agentsAppendix) {
    for (const section of sections) {
      if (section.key === "System Guideless") section.content += `\n\n${params.agentsAppendix}`;
    }
  }

  if (params.agentPrompt) {
    sections.push({ key: "Agent Role", content: params.agentPrompt });
  }
  if (params.skillsInfo) {
    sections.push({ key: "Skills", content: params.skillsInfo });
  }
  if (params.rulesInfo) {
    sections.push({ key: "Rules", content: params.rulesInfo });
  }
  if (params.toolsInfo) {
    sections.push({ key: "Available Tools", content: params.toolsInfo });
  }

  return sections;
}

function splitIntoSections(content: string): SystemPromptSection[] {
  const sections: SystemPromptSection[] = [];
  let current: SystemPromptSection | null = null;

  for (const line of content.split("\n")) {
    const heading = /^#\s+(.+)$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      // The regex guarantees capture group 1 exists for a heading line.
      current = { key: heading[1]!.trim(), content: "" };
      continue;
    }
    if (current) current.content += current.content.length ? `\n${line}` : line;
  }

  if (current) sections.push(current);

  return sections;
}
