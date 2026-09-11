import { useTerminalDimensions } from '@opentui/solid'
import { clip } from '@shared/format.ts'
import { dialogJustClosed } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { toneColor } from '@tui/components/shared/tool-tone.ts'
import { icons } from '@tui/themes/icons.ts'
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import 'opentui-spinner/solid'
import { spawnSessionId, spawnSubagentName, type ToolPartLike, toolStateView } from './tool-summary.ts'

export const SpawnView = (props: { part: ToolPartLike; onOpen?: (sessionId: string, label: string) => void }) => {
  const [hovered, setHovered] = createSignal(false)
  const view = createMemo(() => toolStateView(props.part))
  const color = createMemo(() => toneColor(view().tone))
  const subagent = createMemo(() => spawnSubagentName(props.part.input) ?? 'Spawn')
  const sessionId = createMemo(() => spawnSessionId(props.part.output))
  const running = createMemo(() => props.part.state !== 'output-available' && props.part.state !== 'output-error')
  const failed = createMemo(() => props.part.state === 'output-error')
  const startAt = Date.now()
  const [tick, setTick] = createSignal(Date.now())
  onMount(() => {
    const timer = setInterval(() => {
      if (!running()) {
        clearInterval(timer)
        return
      }
      setTick(Date.now())
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })
  const elapsed = createMemo(() => {
    if (!running()) return ''
    const seconds = Math.max(0, Math.floor((tick() - startAt) / 1000))
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  })
  const inputLabel = () => '0'
  const outputLabel = () => '0'
  const cacheLabel = () => '0 (0%)'
  const costLabel = () => '0'
  const open = () => {
    if (dialogJustClosed()) return
    const id = sessionId()
    if (id) props.onOpen?.(id, subagent())
  }
  const dims = useTerminalDimensions()
  const usageLine = () => `${icons.arrowUp} ${inputLabel()} · ${icons.arrowDown} ${outputLabel()} · ${icons.cache} ${cacheLabel()} · ${icons.cost} ${costLabel()}`
  const clipRest = (line: string): string => {
    const max = Math.max(8, dims().width - 12 - subagent().length)
    return clip(line, max)
  }
  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      border={['left']}
      bottomTitle={` Spawn: ${subagent()} `}
      bottomTitleAlignment="right"
      borderStyle={hovered() ? 'heavy' : 'single'}
      borderColor={color()}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        open()
      }}>
      <box flexDirection="row" gap={1} flexWrap="no-wrap" alignItems="center">
        <box flexShrink={0}>
          <text fg={color()} selectable={false}>
            {view().icon}
          </text>
        </box>
        <text fg={color()} flexShrink={0}>
          {subagent()}
        </text>
        <Show when={running()}>
          <spinner name="dots8Bit" color={theme().accent} />
          <text fg={color()} flexShrink={0}>
            · running… {elapsed()}
          </text>
        </Show>
        <Show when={failed()}>
          <text fg={theme().error} flexShrink={0}>
            · failed
          </text>
        </Show>
        <Show when={!running() && !failed()}>
          <text fg={theme().textMuted} flexShrink={1}>
            {clipRest(`· ${usageLine()}`)}
          </text>
        </Show>
        <Show when={!running() && sessionId()}>
          <text fg={hovered() ? theme().accent : theme().textMuted} flexShrink={0} selectable={false}>
            · open →
          </text>
        </Show>
      </box>
    </box>
  )
}
