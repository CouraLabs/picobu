import { type Accessor, createContext, type ParentProps, useContext } from 'solid-js'

export interface TerminalDims {
  width: number
  height: number
}

export type TerminalDimsAccessor = Accessor<TerminalDims>

const TerminalDimsContext = createContext<TerminalDimsAccessor | undefined>(undefined)

const fallbackDims: TerminalDims = { width: 80, height: 24 }

const fallbackAccessor: TerminalDimsAccessor = () => fallbackDims

export const TerminalDimsProvider = (props: ParentProps<{ dims: TerminalDimsAccessor }>) => {
  return <TerminalDimsContext.Provider value={props.dims}>{props.children}</TerminalDimsContext.Provider>
}

export const useTerminalDims = (): TerminalDimsAccessor => {
  const dims = useContext(TerminalDimsContext)
  return dims ?? fallbackAccessor
}
