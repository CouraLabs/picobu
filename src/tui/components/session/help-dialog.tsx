import { listCommands, listSkills } from '@agent/commands/index.ts'
import { SYSTEM_COMMANDS, toKebab } from '@agent/commands/parse-command-line.ts'
import { TextAttributes } from '@opentui/core'
import { useTerminalDimensions } from '@opentui/solid'
import { closeDialog, openDialog } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { createMemo, For, Show } from 'solid-js'

const shortcuts: { keys: string; what: string }[] = [
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

export const HelpDialog = () => {
  const dims = useTerminalDimensions()
  const dialogWidth = () => Math.max(20, Math.min(Math.floor(dims().width * 0.7), dims().width - 2))
  const dialogHeight = () => Math.max(10, Math.min(Math.floor(dims().height * 0.9), dims().height - 2))
  const workflows = createMemo(() => {
    try {
      return listCommands().filter((c) => c.kind === 'workflow')
    } catch {
      return []
    }
  })
  const skills = createMemo(() => {
    try {
      return listSkills()
    } catch {
      return []
    }
  })
  return (
    <box flexDirection="column" width={dialogWidth()} height={dialogHeight()} paddingX={2} paddingY={1} gap={1}>
      <box border={['bottom']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().text}>Help</text>
      </box>
      <text fg={theme().text} attributes={TextAttributes.BOLD}>
        Keyboard
      </text>
      <box flexDirection="column" flexShrink={0}>
        <For each={shortcuts}>
          {(row) => (
            <box flexDirection="row" gap={1} flexShrink={0}>
              <text fg={theme().accent} flexShrink={0}>
                {row.keys}
              </text>
              <box flexGrow={1} flexShrink={1} minWidth={0}>
                <text fg={theme().text}>{row.what}</text>
              </box>
            </box>
          )}
        </For>
      </box>
      <text fg={theme().text} attributes={TextAttributes.BOLD}>
        Commands
      </text>
      <scrollbox flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} scrollY overflow="hidden">
        <box flexDirection="column" flexShrink={0}>
          <For each={SYSTEM_COMMANDS}>
            {(c) => (
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={theme().text} flexShrink={0}>
                  /{c.name}
                </text>
                <text fg={theme().textMuted}>{c.description}</text>
              </box>
            )}
          </For>
          <For each={workflows()}>
            {(w) => (
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={theme().info} flexShrink={0}>
                  /{toKebab(w.name)}
                </text>
                <text fg={theme().textMuted}>{w.description || w.title}</text>
              </box>
            )}
          </For>
          <For each={skills()}>
            {(s) => (
              <box flexDirection="row" gap={1} flexShrink={0}>
                <text fg={theme().warning} flexShrink={0}>
                  /skill:{toKebab(s.name)}
                </text>
                <text fg={theme().textMuted}>{s.description}</text>
              </box>
            )}
          </For>
          <Show when={workflows().length === 0 && skills().length === 0}>
            <text fg={theme().textMuted}>No workflows or skills configured.</text>
          </Show>
        </box>
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
