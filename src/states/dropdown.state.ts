import type { DropdownOption } from '@tui/components/dropdown.tsx'
import { createSignal } from 'solid-js'
export type DropdownPlacement = {
  x: number
  y: number
  width: number
  height: number
}
export type DropdownOpenState = {
  options: DropdownOption[]
  onSelect: (option: DropdownOption, index: number) => void
  placement: DropdownPlacement
  maxWidth: number
  maxVisible: number
  selected: number
}

const [state, setState] = createSignal<DropdownOpenState | null>(null)
export const dropdownState = state
export const openDropdown = (next: DropdownOpenState) => setState(next)
export const closeDropdown = () => setState(null)
