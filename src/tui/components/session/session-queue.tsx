import type { QueuedPrompt } from '@agent/sessions/session.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { For, Show } from 'solid-js'

export interface SessionQueueProps {
  items: Array<QueuedPrompt>
  onRemove: (id: string) => void
}

const MAX_ROWS = 5
const PREVIEW_CHARS = 120

const singleLine = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line
}

export const SessionQueue = (props: SessionQueueProps) => (
  <Show when={props.items.length > 0}>
    <box flexDirection="column" flexShrink={0} border={['top']} borderColor={theme().border} paddingX={1}>
      <box flexDirection="row" gap={1} flexShrink={0} flexWrap="wrap">
        <text fg={theme().warning}>Queued ({props.items.length}) — oldest runs next</text>
        <text fg={theme().textMuted}>· double-ESC edits newest · flow answer first, then queue, then stop</text>
      </box>
      <For each={props.items.slice(0, MAX_ROWS)}>
        {(item, index) => (
          <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
            <text fg={theme().textMuted} flexShrink={0}>
              {index() + 1}.
            </text>
            <Show when={item.steered}>
              <text fg={theme().error} flexShrink={0}>
                STEER
              </text>
            </Show>
            <box flexGrow={1} flexShrink={1} minWidth={0}>
              <text fg={theme().text}>{singleLine(item.text) || '(empty)'}</text>
            </box>
            <Show when={item.files.length > 0}>
              <text fg={theme().textMuted} flexShrink={0}>
                +{item.files.length} file{item.files.length === 1 ? '' : 's'}
              </text>
            </Show>
            <Button label="Remove" onClick={() => props.onRemove(item.id)} />
          </box>
        )}
      </For>
      <Show when={props.items.length > MAX_ROWS}>
        <box flexShrink={0}>
          <text fg={theme().textMuted}>+{props.items.length - MAX_ROWS} more</text>
        </box>
      </Show>
    </box>
  </Show>
)
