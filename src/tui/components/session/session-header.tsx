import { theme } from '@states/theme-state.ts'
import { SessionToast } from '@tui/components/session/session-toast.tsx'
import { createSessionStatusData, type SessionStatusProps } from '@tui/components/session/status/session-status-data.ts'
import { StatusContext } from '@tui/components/session/status/status-metrics.tsx'
import { StatusSegment } from '@tui/components/shared/status-segment.tsx'
import { icons } from '@tui/themes/icons.ts'
import { Show } from 'solid-js'
import { StatusSeparator } from '../shared/status-separator.tsx'

export const SessionHeader = (props: SessionStatusProps) => {
  const data = createSessionStatusData(props)
  return (
    <box flexDirection="row" columnGap={1} marginY={1} justifyContent="space-between" alignItems="center" flexShrink={0} flexWrap="wrap">
      <box flexDirection="row" columnGap={1} flexShrink={0} flexWrap="wrap">
        <StatusSegment icon={icons.folderOpen} value={data.folderLabel()} valueColor={theme().accent} />
        <Show when={props.git}>
          <StatusSeparator sep={icons.middleDot} />
          <StatusSegment icon={icons.gitBranch} value={data.gitLabel()} valueColor={theme().secondary} />
          <box flexDirection="row" columnGap={1} flexShrink={0} flexWrap="wrap">
            <text fg={theme().success}>{data.diffLabel().added}</text>
            <text fg={theme().error}>{data.diffLabel().removed}</text>
          </box>
        </Show>
      </box>
      <box flexDirection="row" flexWrap="wrap" justifyContent="center">
        <SessionToast />
      </box>
      <box flexDirection="row" flexShrink={0} justifyContent="flex-end">
        <StatusContext data={data} />
      </box>
    </box>
  )
}
