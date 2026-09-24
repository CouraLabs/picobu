import { clip } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { ToolStatusIcon } from '@tui/components/shared/tool-status-icon.tsx'
import { toneColor } from '@tui/components/shared/tool-tone.ts'
import { useTerminalDims } from '@tui/hooks/terminal-dims.tsx'
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import {
  detailClipWidth,
  EXPANDED_MAX_LINES,
  isToolRunning,
  summarizeToolInput,
  summarizeToolOutput,
  type ToolPartLike,
  toolOutputText,
  toolProgress,
  toolStateView,
  truncateLines,
} from './tool-summary.ts'

export const ShellView = (props: { part: ToolPartLike }) => {
  const [hovered, setHovered] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  const view = createMemo(() => toolStateView(props.part))
  const color = createMemo(() => toneColor(view().tone))
  const running = createMemo(() => isToolRunning(props.part))
  const command = createMemo(() => summarizeToolInput('shell', props.part.input))
  const summary = createMemo(() => summarizeToolOutput('shell', props.part.output, props.part.errorText))
  const progress = createMemo(() => toolProgress(props.part))
  const output = createMemo(() => toolOutputText('shell', props.part.output))
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
  const body = createMemo(() => {
    if (running()) return progress() ?? ''
    const text = output()
    if (text === undefined || text.trim().length === 0) return ''
    return truncateLines(text, EXPANDED_MAX_LINES).text
  })
  const dims = useTerminalDims()
  const summaryText = createMemo(() => {
    const value = summary()
    return value === undefined || value.length === 0 ? '' : value
  })
  const toggle = () => setExpanded((current) => !current)
  return (
    <box flexDirection="column" backgroundColor={hovered() ? theme().backgroundElement : undefined}>
      <box
        flexDirection="row"
        columnGap={1}
        alignItems="center"
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={(event) => {
          event.stopPropagation()
          toggle()
        }}>
        <ToolStatusIcon running={running()} color={color()} />
        <text fg={color()} flexShrink={0} selectable={false}>
          SHELL
        </text>
        <Show when={running()}>
          <text fg={color()} flexShrink={0} selectable={false}>
            {`· running… ${elapsed()}`}
          </text>
        </Show>
        <Show when={!running() && summaryText().length > 0}>
          <text fg={theme().textMuted} flexShrink={1} selectable={false}>
            {`· ${clip(summaryText(), detailClipWidth(dims().width, false, 5))}`}
          </text>
        </Show>
      </box>
      <Show when={expanded()}>
        <box flexDirection="column" marginTop={1}>
          <text fg={theme().text}>{`$ ${command()}`}</text>
          <Show when={body().length > 0}>
            <text fg={theme().textMuted}>{body()}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
