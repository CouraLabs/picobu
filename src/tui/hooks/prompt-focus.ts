import { onCleanup } from 'solid-js'

type PromptFocusListener = () => void

const listeners = new Set<PromptFocusListener>()

export const onPromptFocusRequest = (listener: PromptFocusListener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const requestPromptFocus = (): void => {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('picobu: prompt focus request failed:', error)
    }
  }
}

export const usePromptFocus = (focus: () => void): void => {
  onCleanup(onPromptFocusRequest(focus))
}
