import { theme } from '@states/theme-state.ts'
import { type ToastKind, toastItem } from '@states/toast.state.ts'
import { icons } from '@tui/themes/icons.ts'
import { Show } from 'solid-js'

const toastColor = (kind: ToastKind) => {
  if (kind === 'success') return theme().success
  if (kind === 'error') return theme().error
  if (kind === 'warning') return theme().warning
  return theme().info
}

const toastIcon = (kind: ToastKind) => {
  if (kind === 'success') return icons.success
  if (kind === 'error') return icons.error
  if (kind === 'warning') return icons.warning
  return icons.bell
}

export const SessionToast = () => (
  <Show when={toastItem()}>
    <box flexDirection="row" gap={1} flexShrink={1} minWidth={0}>
      <text fg={toastColor((toastItem() as { kind: ToastKind }).kind)} flexShrink={0}>
        {toastIcon((toastItem() as { kind: ToastKind }).kind)}
      </text>
      <text fg={theme().text} flexShrink={1}>
        {(toastItem() as { message: string }).message}
      </text>
    </box>
  </Show>
)
