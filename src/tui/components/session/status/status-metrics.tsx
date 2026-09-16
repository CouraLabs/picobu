import { theme } from '@states/theme-state.ts'
import { contextBar, contextIcon } from '@tui/components/shared/status-format.ts'
import { StatusSegment } from '@tui/components/shared/status-segment.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { icons } from '@tui/themes/icons.ts'
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
  <box flexDirection="row" columnGap={1} flexShrink={0} flexWrap="wrap">
    <StatusSegment icon={'TTFT'} value={props.data.ttftLabel()} labelColor={theme().primary} valueColor={theme().textMuted} />
    <StatusSegment icon={'TPS'} value={props.data.tpsLabel()} labelColor={theme().primary} valueColor={theme().textMuted} />
    <StatusSegment icon={'TT'} value={props.data.toolExecLabel()} labelColor={theme().primary} valueColor={theme().textMuted} />
    <StatusSeparator sep={icons.middleDot} />
    <StatusSegment icon={icons.arrowUp} value={props.data.inputLabel()} labelColor={theme().info} valueColor={theme().textMuted} />
    <StatusSegment icon={icons.arrowDown} value={props.data.outputLabel()} labelColor={theme().success} valueColor={theme().textMuted} />
    <StatusSegment icon={icons.cache} value={props.data.cacheSummary()} labelColor={theme().secondary} valueColor={theme().textMuted} />
    <StatusSeparator sep={icons.middleDot} />
    <StatusSegment icon={icons.cost} value={props.data.costValue()} labelColor={theme().warning} valueColor={theme().textMuted} />
  </box>
)
