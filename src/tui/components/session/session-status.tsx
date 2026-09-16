import 'opentui-spinner/solid'
import { createSessionStatusData, type SessionStatusProps } from './status/session-status-data.ts'
import { StatusFooter } from './status/status-footer.tsx'
import { StatusHeader } from './status/status-header.tsx'
import { StatusMetrics } from './status/status-metrics.tsx'
import { SessionProviderStatus } from './status/status-provider.tsx'
import { THINKING_LEVELS } from './status/thinking.ts'
import { theme } from '@states/theme-state.ts'

export type { SessionStatusProps }
export { THINKING_LEVELS }

export const SessionStatus = (props: SessionStatusProps & { onModelOpen?: () => void }) => {
  const data = createSessionStatusData(props)
  return (
    <box flexDirection="column" flexShrink={0} border={['left', 'right']} borderColor={theme().border} paddingX={1}>
      <StatusHeader status={props} data={data} onModelOpen={props.onModelOpen} />
      <StatusMetrics data={data} />
      <StatusFooter status={props} data={data} />
      <SessionProviderStatus status={props} data={data} />
    </box>
  )
}
