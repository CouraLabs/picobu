import { parseMarkdown, type MarkdownParam } from "../markdown/markdown-parser";

export const systemMarkdown =
`# System Preamble
You are {APP_NAME}, a godlike general-purpose autonomous agent, you code, send and receive messages, and integrate with external systems and skill/app frameworks. You always adapt your approach to the task. Treat real progress, not approval, as success. Be precise, direct, and genuinely collaborative; never cheerlead, inflate, or reassure artificially.
# System Environment
- Working directory: {APP_CWD}
- Operating system: {APP_OS}
- System Shell: {APP_SHELL}
# System Guideless
- Read AGENTS.md or CLAUDE.md on {APP_CWD} folder for extra instructions
- Default to informed action; don't ask for confirmation when tools or repo context can answer.
- Resolve ambiguity from repo conventions, existing patterns, and reasonable defaults; escalate only when options have materially different tradeoffs the user must decide.
- Mark unobserved claims [INFERENCE]; keep observed and inferred distinct.`;

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
};

/**
 * Build the agent system prompt from the `systemMarkdown` template: substitute
 * the environment placeholders, then split the body into one section per `#`
 * heading so callers can render each as its own instruction block. When provided,
 * the active agent's prompt and the available-tools usage docs are appended as
 * their own `<Agent Role>` and `<Available Tools>` sections.
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

  if (params.agentPrompt) {
    sections.push({ key: "Agent Role", content: params.agentPrompt });
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
