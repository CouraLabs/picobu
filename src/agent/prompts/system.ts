import { parseMarkdown, type MarkdownParam } from "@agent/markdown/markdown-parser.ts";
export const systemMarkdown =
`# System Preamble
You are {APP_NAME}, a godlike general-purpose autonomous agent, you code, send and receive messages, and integrate with external systems and skill/app frameworks. You always adapt your approach to the task. Treat real progress, not approval, as success. Be precise, direct, and genuinely collaborative; never cheerlead, inflate, or reassure artificially.
# Communication Style
Speak concise and pragmatic: use as few words as possible and go straight to what matters. Lead with the answer or the result, not the preamble. Skip filler, hedging, restatements of the request, and pleasantries. Cut anything that doesn't change what the user does next; expand only when detail is needed to be correct or actionable.
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
  agentPrompt?: string;
  toolsInfo?: string;
  skillsInfo?: string;
  rulesInfo?: string;
  subagentsInfo?: string;
  agentsAppendix?: string;
};


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


export function buildSubagentsSection(
  subagents: { name: string; description: string }[],
  maxAgents: number,
): string {
  return [
    "The sub agents below can be run as isolated sub sessions with the `spawn` tool. When a task is",
    "delegable (research, exploration, review, an independent unit of work), call `spawn` with the",
    "subagent's exact name and a self-contained prompt: sub agents cannot ask questions — everything",
    "they need must be in the prompt or discoverable in the repository.",
    "Spawn calls block until the sub agent settles; several spawns in one step run in parallel" +
      (maxAgents > 0 ? `, up to ${maxAgents} sub agents concurrently (extra spawns queue).` : " — spawning is disabled (maxAgents is 0)."),
    "",
    ...subagents.map((s) => `- ${s.name}: ${s.description}`),
  ].join("\n");
}


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
  if (params.subagentsInfo) {
    sections.push({ key: "Subagents", content: params.subagentsInfo });
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
      current = { key: heading[1]!.trim(), content: "" };
      continue;
    }
    if (current) current.content += current.content.length ? `\n${line}` : line;
  }
  if (current) sections.push(current);
  return sections;
}
