import { theme } from '@states/theme-state.ts'
import { StatusSegment } from '@tui/components/shared/status-segment.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { icons } from '@tui/themes/icons.ts'
import { Show } from 'solid-js'
import type { SessionStatusData, SessionStatusProps } from './session-status-data.ts'

export const StatusFooter = (props: { status: SessionStatusProps; data: SessionStatusData }) => (
  <box flexDirection="row" columnGap={2} flexShrink={0} flexWrap="wrap">
    <StatusSegment icon={icons.fileText} value={`${props.data.stats().total} msgs`} />
    <StatusSegment icon={icons.tool} value={`${props.data.stats().tools} tools`} />
    <Show when={props.status.mcp && props.status.mcp.total > 0}>
      <StatusSeparator sep={icons.middleDot} />
      <StatusSegment icon={icons.plug} value={`${props.status.mcp?.connected}/${props.status.mcp?.total} mcp · ${props.status.mcp?.tools} tools`} />
    </Show>
    <Show when={props.data.queueLabel()}>
      <StatusSeparator sep={icons.middleDot} />
      <StatusSegment icon={icons.bell} value={props.data.queueLabel() as string} valueColor={theme().warning} />
    </Show>
  </box>
)
