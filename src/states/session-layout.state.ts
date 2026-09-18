import { options, updateSettings } from '@config/options.ts'
import { DEFAULT_SESSION_HEADER_LAYOUT, DEFAULT_SESSION_STATUS_LAYOUT, type SessionHeaderLayout, type SessionStatusLayout } from '@config/session-layout.ts'
import { batch, createSignal } from 'solid-js'

const [statusLayout, setStatusLayout] = createSignal<SessionStatusLayout>(options.sessionStatusLayout)
const [headerLayout, setHeaderLayout] = createSignal<SessionHeaderLayout>(options.sessionHeaderLayout)

export { headerLayout, statusLayout }

export const saveSessionLayout = async (patch: { status?: SessionStatusLayout; header?: SessionHeaderLayout }): Promise<void> => {
  const next = await updateSettings({
    ...(patch.status ? { sessionStatusLayout: patch.status } : {}),
    ...(patch.header ? { sessionHeaderLayout: patch.header } : {}),
  })
  batch(() => {
    if (next.sessionStatusLayout) {
      options.sessionStatusLayout = next.sessionStatusLayout
      setStatusLayout(next.sessionStatusLayout)
    }
    if (next.sessionHeaderLayout) {
      options.sessionHeaderLayout = next.sessionHeaderLayout
      setHeaderLayout(next.sessionHeaderLayout)
    }
  })
}

export const resetSessionLayout = async (surface: 'status' | 'header'): Promise<void> => {
  if (surface === 'status') await saveSessionLayout({ status: DEFAULT_SESSION_STATUS_LAYOUT })
  else await saveSessionLayout({ header: DEFAULT_SESSION_HEADER_LAYOUT })
}
