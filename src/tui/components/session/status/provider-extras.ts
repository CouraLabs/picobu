import { resolveStatusLineValues } from '@agent/model/provider-status.ts'
import { resolveModelRef } from '@agent/model/resolver.ts'
import { options } from '@config/options.ts'
import { selectStatusLineItems } from '@config/provider-status-line.ts'
import type { SessionStatusProps } from '@tui/components/session/status/session-status-data.ts'

export type ProviderStatusExtra = { label: string; value: string }

export const getProviderStatusExtras = (status: SessionStatusProps): Array<ProviderStatusExtra> => {
  try {
    const resolved = resolveModelRef(status.modelKey)
    const raw = status.statsStatus?.rawUsage
    const items = selectStatusLineItems(options.statusLine, resolved.provider.id)
    return resolveStatusLineValues(items, { headers: status.statsStatus?.headers, raw, endpoints: status.statsStatus?.endpoints })
  } catch {
    return []
  }
}
