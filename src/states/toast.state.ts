import { createSignal } from 'solid-js'

export type ToastKind = 'info' | 'success' | 'error' | 'warning'

export type ToastItem = {
  id: number
  kind: ToastKind
  message: string
}

export const TOAST_TTL_MS = 5000

const [currentToast, setCurrentToast] = createSignal<ToastItem | null>(null)

let nextToastId = 1
let toastTimer: ReturnType<typeof setTimeout> | undefined

export const toastItem = () => currentToast()

export const clearToast = (id?: number): void => {
  if (id !== undefined && currentToast()?.id !== id) return
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer)
    toastTimer = undefined
  }
  setCurrentToast(null)
}

export const pushToast = (message: string, kind: ToastKind = 'info'): ToastItem => {
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer)
    toastTimer = undefined
  }
  const item: ToastItem = { id: nextToastId++, kind, message }
  setCurrentToast(item)
  toastTimer = setTimeout(() => {
    if (currentToast()?.id === item.id) setCurrentToast(null)
    toastTimer = undefined
  }, TOAST_TTL_MS)
  return item
}
