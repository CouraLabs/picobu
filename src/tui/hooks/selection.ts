export interface CopyableSelection {
  getSelectedText: () => string
  selectedRenderables: Array<unknown>
}

export interface SelectionRenderer {
  getSelection: () => CopyableSelection | null
  clearSelection: () => void
  currentFocusedRenderable?: { hasSelection?: () => boolean; getClipboardText?: (text: string) => string } | null
}

export const hasRendererSelection = (renderer: SelectionRenderer): boolean => {
  const selection = renderer.getSelection()
  if (!selection) return false
  return selection.getSelectedText().length > 0
}

export const rendererCopyText = (renderer: SelectionRenderer): string | undefined => {
  const selection = renderer.getSelection()
  if (!selection) return undefined
  const text = selection.getSelectedText()
  if (!text) return undefined
  const focus = renderer.currentFocusedRenderable
  if (focus?.getClipboardText !== undefined && selection.selectedRenderables.includes(focus)) return focus.getClipboardText(text)
  return text
}

export const focusedHandlesCopy = (renderer: SelectionRenderer): boolean => {
  const focus = renderer.currentFocusedRenderable
  return typeof focus?.hasSelection === 'function' && focus.hasSelection() === true
}
