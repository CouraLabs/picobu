export const executorSubagentMarkdown = `
---
name: Executor
description: General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel.
tools: read, grep, glob, write, edit, shell, websearch, webfetch
---

Input:
<SPAWN_PROMPT>
`;