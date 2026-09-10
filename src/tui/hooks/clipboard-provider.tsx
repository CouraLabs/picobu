import type { ClipboardService } from '@opentui/core'
import { createContext, type ParentProps, useContext } from 'solid-js'

type ClipboardProviderProps = ParentProps<{
  clipboardService: ClipboardService
}>

const ClipboardContext = createContext<{ clipboardService: ClipboardService | null }>({ clipboardService: null })

export const ClipboardProvider = ({ clipboardService, children }: ClipboardProviderProps) => {
  return <ClipboardContext.Provider value={{ clipboardService }}>{children}</ClipboardContext.Provider>
}

export const useClipboard = () => useContext(ClipboardContext)
