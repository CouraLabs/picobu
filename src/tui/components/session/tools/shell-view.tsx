import { clip } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { ToolStatusIcon } from '@tui/components/shared/tool-status-icon.tsx'
import { toneColor } from '@tui/components/shared/tool-tone.ts'
import { useTerminalDims } from '@tui/hooks/terminal-dims.tsx'
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import {
  detailClipWidth,
  EXPANDED_MAX_LINES,
  isErroredTool,
  isPreliminaryToolResult,
  isToolRunning,
  shellBodyText,
  shellErrorLabel,
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
  const active = createMemo(() => isToolRunning(props.part) || isPreliminaryToolResult(props.part))
  const errored = createMemo(() => isErroredTool(props.part))
  const command = createMemo(() => summarizeToolInput('shell', props.part.input))
  const successSummary = createMemo(() => summarizeToolOutput('shell', props.part.output))
  const errorLabel = createMemo(() => shellErrorLabel(props.part.errorText ?? ''))
  const errorText = createMemo(() => {
    const text = props.part.errorText
    if (text === undefined || text.trim().length === 0) return ''
    return truncateLines(text, EXPANDED_MAX_LINES).text
  })
  const progress = createMemo(() => toolProgress(props.part))
  const output = createMemo(() => toolOutputText('shell', props.part.output))
  const startAt = Date.now()
  const [tick, setTick] = createSignal(Date.now())
  onMount(() => {
    const timer = setInterval(() => {
      if (!active()) {
        clearInterval(timer)
        return
      }
      setTick(Date.now())
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })
  const elapsed = createMemo(() => {
    if (!active()) return ''
    const seconds = Math.max(0, Math.floor((tick() - startAt) / 1000))
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  })
  const body = createMemo(() => shellBodyText(active(), progress(), output()))
  const dims = useTerminalDims()
  const summaryText = createMemo(() => {
    if (errored()) return errorLabel()
    const value = successSummary()
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
        <ToolStatusIcon running={active()} color={color()} />
        <text fg={color()} flexShrink={0} selectable={false}>
          SHELL
        </text>
        <Show when={active()}>
          <text fg={color()} flexShrink={0} selectable={false}>
            {`· running… ${elapsed()}`}
          </text>
        </Show>
        <Show when={!active() && summaryText().length > 0}>
          <text fg={errored() ? theme().error : theme().textMuted} flexShrink={1} selectable={false}>
            {`· ${clip(summaryText(), detailClipWidth(dims().width, false, 5))}`}
          </text>
        </Show>
      </box>
      <Show when={expanded()}>
        <box flexDirection="column" marginTop={1}>
          <text fg={theme().text}>{`$ ${command()}`}</text>
          <Show when={errored() && errorText().length > 0}>
            <text fg={theme().error}>{errorText()}</text>
          </Show>
          <Show when={body().length > 0}>
            <text fg={theme().textMuted}>{body()}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
