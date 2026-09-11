import { theme } from '@states/theme-state.ts'
import { contextBar, contextIcon } from '@tui/components/shared/status-format.ts'
import { StatusSegment } from '@tui/components/shared/status-segment.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { icons } from '@tui/themes/icons.ts'
import { Show } from 'solid-js'
import type { SessionStatusData } from './session-status-data.ts'

export const StatusContext = (props: { data: SessionStatusData }) => (
  <box flexDirection="row" columnGap={1} flexShrink={0} flexWrap="wrap">
    <StatusSegment
      icon={contextIcon(props.data.contextPercent())}
      value={`${props.data.contextLabel()} ${contextBar(props.data.contextPercent())} ${props.data.contextPercent() !== undefined ? `${props.data.contextPercent()}%` : ''}`}
      valueColor={props.data.contextColor()}
    />
  </box>
)

export const StatusMetrics = (props: { data: SessionStatusData }) => (
  <box flexDirection="row" columnGap={2} flexShrink={0} flexWrap="wrap">
    <StatusSegment icon={'TTFT'} value={props.data.ttftLabel()} valueColor={theme().primary} />
    <StatusSegment icon={'TPS'} value={props.data.tpsLabel()} valueColor={theme().primary} />
    {/* 
    <StatusSegment icon={icons.hourglass} value={props.data.stepTimeLabel()} valueColor={theme().primary} />
    <StatusSegment icon={icons.refresh} value={props.data.responseTimeLabel()} valueColor={theme().primary} /> 
    */}
    <StatusSegment icon={'TT'} value={props.data.toolExecLabel()} valueColor={theme().primary} />
    <StatusSeparator sep={icons.middleDot} />
    <StatusSegment icon={icons.arrowUp} value={props.data.inputLabel()} valueColor={theme().info} />
    <StatusSegment icon={icons.arrowDown} value={props.data.outputLabel()} valueColor={theme().success} />
    <StatusSegment icon={icons.cache} value={props.data.cacheSummary()} valueColor={theme().secondary} />
    <StatusSeparator sep={icons.middleDot} />
    <StatusSegment icon={icons.cost} value={props.data.costValue()} valueColor={theme().warning} />
    <Show when={props.data.costSplit()}>
      <StatusSegment icon={icons.info} value={props.data.costSplit() as string} />
    </Show>
  </box>
)
