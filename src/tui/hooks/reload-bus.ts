type ReloadListener = () => Promise<void> | void

const listeners = new Set<ReloadListener>()

export const onAppReload = (listener: ReloadListener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const requestAppReload = async (): Promise<void> => {
  await Promise.all([...listeners].map((listener) => listener()))
}

let lastSessionId: string | undefined

export const setLastSessionId = (id: string | undefined): void => {
  lastSessionId = id
}

export const getLastSessionId = (): string | undefined => lastSessionId
