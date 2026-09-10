import 'opentui-spinner/solid'
import { createSessionStatusData, type SessionStatusProps } from './status/session-status-data.ts'
import { StatusFooter } from './status/status-footer.tsx'
import { StatusHeader } from './status/status-header.tsx'
import { StatusMetrics } from './status/status-metrics.tsx'
import { THINKING_LEVELS } from './status/thinking.ts'

export type { SessionStatusProps }
export { THINKING_LEVELS }

export const SessionStatus = (props: SessionStatusProps) => {
  const data = createSessionStatusData(props)
  return (
    <box flexDirection="column" flexShrink={0}>
      <StatusHeader status={props} data={data} />
      <StatusMetrics data={data} />
      <StatusFooter status={props} data={data} />
    </box>
  )
}
