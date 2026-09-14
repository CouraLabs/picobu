import { theme } from '@states/theme-state.ts'
import { StatusSegment } from '@tui/components/shared/status-segment.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { icons } from '@tui/themes/icons.ts'
import { Show } from 'solid-js'
import type { SessionStatusData, SessionStatusProps } from './session-status-data.ts'

export interface SessionProviderStatusInfo {
  id: string
  name?: string
  detail?: string
}

export const getProviderStatusLabel = (provider: SessionProviderStatusInfo | undefined): string | undefined => {
  if (!provider) return undefined
  if (provider.detail) return `${provider.name ?? provider.id} · ${provider.detail}`
  return provider.name ?? provider.id
}

export const SessionProviderStatus = (props: { status: SessionStatusProps; data: SessionStatusData }) => {
  const provider = (): SessionProviderStatusInfo | undefined => props.status.provider
  return (
    <box flexDirection="row" columnGap={2} flexShrink={0} flexWrap="wrap">
      <Show when={getProviderStatusLabel(provider())} fallback={<StatusSegment icon={icons.plug} value="provider —" valueColor={theme().textMuted} />}>
        {(label: string) => <StatusSegment icon={icons.plug} value={label} />}
      </Show>
      <Show when={provider()?.detail}>
        <StatusSeparator sep={icons.middleDot} />
        <StatusSegment icon={icons.info} value={provider()?.detail as string} valueColor={theme().textMuted} />
      </Show>
    </box>
  )
}
