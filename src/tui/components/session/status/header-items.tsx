import type { SessionHeaderItem } from '@config/session-layout.ts'
import { theme } from '@states/theme-state.ts'
import { toastItem } from '@states/toast.state.ts'
import { SessionToast } from '@tui/components/session/session-toast.tsx'
import { contextBar, contextIcon } from '@tui/components/shared/status-format.ts'
import { StatusSegment } from '@tui/components/shared/status-segment.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { icons } from '@tui/themes/icons.ts'
import { Show } from 'solid-js'
import type { SessionStatusData, SessionStatusProps } from './session-status-data.ts'

export interface HeaderRenderContext {
  status: SessionStatusProps
  data: SessionStatusData
  selectable?: boolean
}

const WorkspaceItem = (props: { ctx: HeaderRenderContext }) => (
  <box flexDirection="row" columnGap={1} flexShrink={0} flexWrap="wrap">
    <StatusSegment icon={icons.folderOpen} value={`/${props.ctx.data.folderLabel()}`} valueColor={theme().accent} selectable={props.ctx.selectable} />
    <Show when={props.ctx.status.git}>
      <StatusSegment icon={icons.gitBranch} value={props.ctx.data.gitLabel()} valueColor={theme().secondary} selectable={props.ctx.selectable} />
      <box flexDirection="row" columnGap={1} flexShrink={0} flexWrap="wrap">
        <text fg={theme().success}>{props.ctx.data.diffLabel().added}</text>
        <text fg={theme().error}>{props.ctx.data.diffLabel().removed}</text>
      </box>
    </Show>
  </box>
)

const ContextItem = (props: { ctx: HeaderRenderContext }) => (
  <StatusSegment
    icon={contextIcon(props.ctx.data.contextPercent())}
    value={`${props.ctx.data.contextLabel()} ${contextBar(props.ctx.data.contextPercent())} ${props.ctx.data.contextPercent() !== undefined ? `${props.ctx.data.contextPercent()}%` : ''}`}
    valueColor={props.ctx.data.contextColor()}
    selectable={props.ctx.selectable}
  />
)

const NotificationItem = () => <SessionToast />

export const HeaderItemView = (props: { item: SessionHeaderItem; ctx: HeaderRenderContext }) => (
  <box flexDirection="row" flexShrink={0} flexWrap="wrap">
    <Show when={props.item === 'workspace'}>
      <WorkspaceItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'context'}>
      <ContextItem ctx={props.ctx} />
    </Show>
    <Show when={props.item === 'notification'}>
      <NotificationItem />
    </Show>
    <Show when={props.item === 'separator'}>
      <StatusSeparator sep={icons.middleDot} selectable={props.ctx.selectable} />
    </Show>
  </box>
)

export const headerItemHasContent = (item: SessionHeaderItem): boolean => {
  switch (item) {
    case 'notification':
      return Boolean(toastItem())
    case 'separator':
      return true
    default:
      return true
  }
}
