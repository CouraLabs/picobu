import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { type Accessor, createContext, createSignal, onCleanup, type ParentProps, useContext } from 'solid-js'

export interface UseAppKeyboardOptions {
  release?: boolean
}

interface KeyboardEntry {
  handler: (key: KeyEvent) => void
  release: boolean
}

interface KeyboardRegistry {
  entries: Accessor<ReadonlySet<KeyboardEntry>>
  add: (entry: KeyboardEntry) => void
  remove: (entry: KeyboardEntry) => void
}

const KeyboardContext = createContext<KeyboardRegistry | undefined>(undefined)

export const KeyboardProvider = (props: ParentProps) => {
  const [entries, setEntries] = createSignal<ReadonlySet<KeyboardEntry>>(new Set())
  const registry: KeyboardRegistry = {
    entries,
    add: (entry) => setEntries((prev) => new Set(prev).add(entry)),
    remove: (entry) =>
      setEntries((prev) => {
        const next = new Set(prev)
        next.delete(entry)
        return next
      }),
  }
  useKeyboard(
    (key: KeyEvent) => {
      const isRelease = key.eventType === 'release'
      for (const entry of entries()) {
        if (isRelease && !entry.release) continue
        try {
          entry.handler(key)
        } catch (error) {
          console.error('picobu: keyboard handler failed:', error)
        }
        if (key.propagationStopped) break
      }
    },
    { release: true },
  )
  return <KeyboardContext.Provider value={registry}>{props.children}</KeyboardContext.Provider>
}

export const useAppKeyboard = (handler: (key: KeyEvent) => void, options?: UseAppKeyboardOptions): void => {
  const registry = useContext(KeyboardContext)
  if (!registry) throw new Error('useAppKeyboard must be used within a KeyboardProvider')
  const entry: KeyboardEntry = { handler, release: options?.release ?? false }
  registry.add(entry)
  onCleanup(() => registry.remove(entry))
}
