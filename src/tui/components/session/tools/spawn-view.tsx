import type { SessionManager } from '@agent/sessions/session-manager.ts'
import { clip, fmtCostPreciseBare, fmtTokens } from '@shared/format.ts'
import { dialogJustClosed } from '@states/dialog.state.ts'
import { theme } from '@states/theme-state.ts'
import { ToolStatusIcon } from '@tui/components/shared/tool-status-icon.tsx'
import { toneColor } from '@tui/components/shared/tool-tone.ts'
import { useTerminalDims } from '@tui/hooks/terminal-dims.tsx'
import { icons } from '@tui/themes/icons.ts'
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import { isPreliminaryToolResult, isToolRunning, spawnSessionId, spawnSubagentName, type ToolPartLike, toolStateView } from './tool-summary.ts'

export const SpawnView = (props: { part: ToolPartLike; onOpen?: (sessionId: string, label: string) => void; manager?: SessionManager }) => {
  const [hovered, setHovered] = createSignal(false)
  const view = createMemo(() => toolStateView(props.part))
  const color = createMemo(() => toneColor(view().tone))
  const subagent = createMemo(() => (spawnSubagentName(props.part.input) ?? 'Spawn').toUpperCase())
  const sessionId = createMemo(() => spawnSessionId(props.part.output))
  const [jobsVersion, setJobsVersion] = createSignal(0)
  const jobStats = createMemo(() => {
    const id = sessionId()
    if (id === undefined) return undefined
    jobsVersion()
    return props.manager?.jobs().find((job) => job.sessionId === id)?.stats
  })
  const running = createMemo(() => isToolRunning(props.part) || isPreliminaryToolResult(props.part))
  const failed = createMemo(() => props.part.state === 'output-error')
  const startAt = Date.now()
  const [tick, setTick] = createSignal(Date.now())
  onMount(() => {
    const off = props.manager?.onJobs(() => setJobsVersion((v) => v + 1))
    const timer = setInterval(() => {
      if (!running()) {
        clearInterval(timer)
        return
      }
      setTick(Date.now())
    }, 1000)
    onCleanup(() => {
      clearInterval(timer)
      off?.()
    })
  })
  const elapsed = createMemo(() => {
    if (!running()) return ''
    const seconds = Math.max(0, Math.floor((tick() - startAt) / 1000))
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
  })
  const inputLabel = () => fmtTokens(jobStats()?.usage.inputTokens ?? 0)
  const outputLabel = () => fmtTokens(jobStats()?.usage.outputTokens ?? 0)
  const cacheLabel = () => {
    const read = jobStats()?.usage.inputTokenDetails?.cacheReadTokens ?? 0
    const total = jobStats()?.usage.inputTokens ?? 0
    const percent = total > 0 ? Math.round((read / total) * 100) : 0
    return `${fmtTokens(read)} (${percent}%)`
  }
  const costLabel = () => fmtCostPreciseBare(jobStats()?.cost.total) || '0'
  const open = () => {
    if (dialogJustClosed()) return
    const id = sessionId()
    if (id) props.onOpen?.(id, subagent())
  }
  const dims = useTerminalDims()
  const usageLine = () => `${icons.arrowUp} ${inputLabel()} · ${icons.arrowDown} ${outputLabel()} · ${icons.cache} ${cacheLabel()} · ${icons.cost} ${costLabel()}`
  const clipRest = (line: string): string => {
    const max = Math.max(8, dims().width - 12 - subagent().length)
    return clip(line, max)
  }
  return (
    <box
      flexDirection="column"
      paddingLeft={1}
      backgroundColor={hovered() ? theme().backgroundElement : undefined}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        event.stopPropagation()
        open()
      }}>
      <box flexDirection="row" gap={1} flexWrap="no-wrap" alignItems="center">
        <ToolStatusIcon running={running()} color={color()} />
        <text fg={color()} flexShrink={0}>
          {subagent()}
        </text>
        <Show when={running()}>
          <text fg={color()} flexShrink={0}>
            · running… {elapsed()}
          </text>
        </Show>
        <Show when={failed()}>
          <text fg={theme().error} flexShrink={0}>
            · failed
          </text>
        </Show>
        <Show when={!running()}>
          <text fg={theme().textMuted} flexShrink={1}>
            {clipRest(`· ${usageLine()}`)}
          </text>
        </Show>
        <Show when={sessionId()}>
          <text fg={hovered() ? theme().accent : theme().textMuted} flexShrink={0} selectable={false}>
            · open →
          </text>
        </Show>
      </box>
    </box>
  )
}
