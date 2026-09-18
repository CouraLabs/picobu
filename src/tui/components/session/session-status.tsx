import 'opentui-spinner/solid'
import { statusLayout } from '@states/session-layout.state.ts'
import { theme } from '@states/theme-state.ts'
import { createSessionStatusData, getProviderStatusExtras, type SessionStatusProps, StatusLines } from './status/session-status-data.ts'
import { THINKING_LEVELS } from './status/thinking.ts'

export type { SessionStatusProps }
export { THINKING_LEVELS }

export const SessionStatus = (props: SessionStatusProps & { onModelOpen?: () => void }) => {
  const data = createSessionStatusData(props)
  return (
    <box flexDirection="column" flexShrink={0} border={['left', 'right']} borderColor={theme().border} paddingX={1}>
      <StatusLines layout={statusLayout()} ctx={{ status: props, data, providerExtras: () => getProviderStatusExtras(props), onModelOpen: props.onModelOpen, selectable: true }} />
    </box>
  )
}
