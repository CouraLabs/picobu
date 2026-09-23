import { lineHasVisibleItem } from '@config/session-layout.ts'
import { headerLayout } from '@states/session-layout.state.ts'
import { theme } from '@states/theme-state.ts'
import { type HeaderRenderContext, headerItemHasContent } from '@tui/components/session/status/header-items.tsx'
import { createSessionStatusData, type SessionStatusProps } from '@tui/components/session/status/session-status-data.ts'
import { HeaderLine } from '@tui/components/session/status/status-lines.tsx'
import { Show } from 'solid-js'

export const SessionHeader = (props: SessionStatusProps) => {
  const data = createSessionStatusData(props)
  const ctx = (): HeaderRenderContext => ({ status: props, data, selectable: true })
  const hasContent = () => lineHasVisibleItem(headerLayout().lines[0], (item) => item !== 'separator' && headerItemHasContent(item))
  return (
    <Show when={hasContent()}>
      <box flexDirection="row" columnGap={1} border={['bottom']} borderColor={theme().border} alignItems="center" flexShrink={0} flexWrap="wrap">
        <HeaderLine layout={headerLayout()} ctx={ctx()} />
      </box>
    </Show>
  )
}
