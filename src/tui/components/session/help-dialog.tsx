import { listSubagents } from '@agent/agents/subagents.ts'
import type { AgentType } from '@agent/agents/types.ts'
import { listCommands, listSkills } from '@agent/commands/index.ts'
import { SYSTEM_COMMANDS, toKebab } from '@agent/commands/parse-command-line.ts'
import { listRules } from '@agent/rules/rules.ts'
import { useTerminalDimensions } from '@opentui/solid'
import { catalogVersion } from '@states/catalog-state.ts'
import { closeDialog, openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { getSharedTreeSitterClientSync } from '@wrappers/treesitter-wrapper.ts'
import { createMemo, createSignal, onMount } from 'solid-js'

const shortcuts: Array<{ keys: string; what: string }> = [
  { keys: 'CTRL + H', what: 'Open this help' },
  { keys: 'CTRL + D CTRL + D', what: 'Exit the app' },
  { keys: 'ESC ESC', what: 'Answer flow first, then move newest queued prompt back to edit, then stop the run' },
  { keys: 'CTRL + C / CMD + C', what: 'Copy selected text' },
  { keys: 'CTRL + V / CMD + V', what: 'Paste into the prompt' },
  { keys: 'CTRL + M', what: 'Change model' },
  { keys: 'CTRL + J', what: 'Subagent jobs' },
  { keys: 'CTRL + W', what: 'Toggle steer mode (steer never clears the queue)' },
  { keys: 'TAB', what: 'Cycle agent' },
  { keys: 'SHIFT + TAB', what: 'Cycle thinking level' },
  { keys: 'UP / DOWN', what: 'Prompt history on first / last line (disabled while the command flyout is open)' },
  { keys: 'TAB (in command flyout)', what: 'Complete command in the flyout' },
  { keys: 'CTRL + A', what: 'Select all text in the prompt' },
]

const footerLines: Array<string> = [
  'The footer under the prompt shows the session at a glance. Token and cost segments always show `0`.',
  '',
  '- **Agent row**: agent, model, thinking level, finish reason or live activity (`Prompting`, `Reasoning`, `Tooling`, `Delegating`, `Answering`), session title.',
  '- **Metrics row**: `⧖` time to first output, `↯` output tokens/sec, `⯿` tool execution time, `↑` input `0`, `↓` output `0`, `⛁` cache `0 (0%)`, `$` cost `0`.',
  '- **Session row**: message count (`u`ser / `a`ssistant), tool calls, MCP connections, queue state.',
]

export const HelpDialog = () => {
  const dims = useTerminalDimensions()
  const dialogWidth = () => Math.max(20, Math.min(Math.floor(dims().width * 0.7), dims().width - 2))
  const dialogHeight = () => Math.max(10, Math.min(Math.floor(dims().height * 0.9), dims().height - 2))
  const workflows = createMemo(() => {
    void catalogVersion()
    try {
      return listCommands().filter((c) => c.kind === 'workflow')
    } catch {
      return []
    }
  })
  const skills = createMemo(() => {
    void catalogVersion()
    try {
      return listSkills()
    } catch {
      return []
    }
  })
  const rules = createMemo(() => {
    void catalogVersion()
    try {
      return listRules()
    } catch {
      return []
    }
  })
  const [subagents, setSubagents] = createSignal<Array<AgentType>>([])
  onMount(() => {
    listSubagents()
      .then(setSubagents)
      .catch(() => {})
  })
  const helpMarkdown = createMemo(() => {
    const lines: Array<string> = ['## Keyboard', '']
    for (const row of shortcuts) lines.push(`- \`${row.keys}\` — ${row.what}`)
    lines.push('', '## Commands', '')
    const commandRows = [
      ...SYSTEM_COMMANDS.map((c) => `- \`/${c.name}\` — ${c.description}`),
      ...workflows().map((w) => `- \`/${toKebab(w.name)}\` — ${w.description || w.title}`),
      ...skills().map((s) => `- \`/skill:${toKebab(s.name)}\` — ${s.description}`),
    ]
    if (commandRows.length > 0) lines.push(...commandRows)
    else lines.push('No workflows or skills configured.')
    lines.push('', '## Rules', '')
    const ruleList = rules()
    if (ruleList.length > 0) for (const r of ruleList) lines.push(`- **${r.name}** — ${r.description}`)
    else lines.push('No rules configured.')
    lines.push('', '## Subagents', '')
    const subList = subagents()
    if (subList.length > 0) for (const a of subList) lines.push(`- **${a.name}** — ${a.description}`)
    else lines.push('No subagents configured.')
    lines.push('', '## Session footer', '', ...footerLines)
    return lines.join('\n')
  })
  return (
    <box flexDirection="column" width={dialogWidth()} height={dialogHeight()} paddingX={2} paddingY={1} gap={1}>
      <box border={['bottom']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().text}>Help</text>
      </box>
      <scrollbox flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} scrollY overflow="hidden">
        <markdown syntaxStyle={theme().syntax} treeSitterClient={getSharedTreeSitterClientSync()} conceal content={helpMarkdown()} />
      </scrollbox>
      <box flexDirection="row" gap={1} justifyContent="flex-end" flexShrink={0} border={['top']} borderColor={theme().border}>
        <Button label="Close" onClick={closeDialog} />
      </box>
    </box>
  )
}

export const openHelpDialog = () => {
  openDialog(() => <HelpDialog />)
}
