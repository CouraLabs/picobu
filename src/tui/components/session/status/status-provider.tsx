import { resolveStatusLineValues } from '@agent/model/provider-status.ts'
import { resolveModelRef } from '@agent/model/resolver.ts'
import { options } from '@config/options.ts'
import { selectStatusLineItems } from '@config/provider-status-line.ts'
import { theme } from '@states/theme-state.ts'
import { StatusSegment } from '@tui/components/shared/status-segment.tsx'
import { For } from 'solid-js'
import type { SessionStatusData, SessionStatusProps } from './session-status-data.ts'

export interface SessionProviderStatusInfo {
  id: string
  name?: string
  detail?: string
}

const getStatusLineValues = (props: { status: SessionStatusProps }): Array<{ label: string; value: string }> => {
  try {
    const resolved = resolveModelRef(props.status.modelKey)
    const steps = props.status.statsStatus?.steps ?? []
    const raw = steps.length > 0 ? steps[steps.length - 1]?.usage.raw : undefined
    const items = selectStatusLineItems(options.statusLine, resolved.provider.id)
    return resolveStatusLineValues(items, { headers: props.status.statsStatus?.headers, raw, endpoints: props.status.statsStatus?.endpoints })
  } catch {
    return []
  }
}

export const SessionProviderStatus = (props: { status: SessionStatusProps; data: SessionStatusData }) => {
  const extras = () => getStatusLineValues(props)
  return (
    <box flexDirection="row" columnGap={1} flexShrink={0} flexWrap="wrap">
      <For each={extras()}>{(extra) => <StatusSegment label={`${extra.label}`} labelColor={theme().text} value={extra.value} valueColor={theme().textMuted} />}</For>
    </box>
  )
}
