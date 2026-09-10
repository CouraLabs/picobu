import { theme } from '@states/theme-state.ts'
import { StatusSegment } from '@tui/components/shared/status-segment.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { icons } from '@tui/themes/icons.ts'
import { Show } from 'solid-js'
import type { SessionStatusData, SessionStatusProps } from './session-status-data.ts'

export const StatusFooter = (props: { status: SessionStatusProps; data: SessionStatusData }) => (
  <box flexDirection="row" columnGap={2} flexShrink={0} flexWrap="wrap">
    <StatusSegment icon={icons.fileText} label="msgs" value={`${props.data.stats().total} (u${props.data.stats().user}/a${props.data.stats().assistant})`} />
    <StatusSegment icon={icons.tool} label="tools" value={`${props.data.stats().tools}`} />
    <Show when={props.data.runAttribution()}>
      <StatusSeparator sep={icons.middleDot} />
      <StatusSegment icon={icons.star} value={props.data.runAttribution() as string} />
    </Show>
    <Show when={props.data.stats().compacted}>
      <StatusSeparator sep={icons.middleDot} />
      <StatusSegment icon={icons.fileArchive} value="compacted" valueColor={theme().warning} />
    </Show>
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
