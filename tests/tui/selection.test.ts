import { describe, expect, test } from 'bun:test'
import { focusedHandlesCopy, hasRendererSelection, rendererCopyText, type SelectionRenderer } from '../../src/tui/hooks/selection.ts'

const renderer = (overrides: Partial<SelectionRenderer> & { text?: string | null } = {}): SelectionRenderer => ({
  getSelection: () => (overrides.text === null || overrides.text === undefined ? null : { getSelectedText: () => overrides.text as string, selectedRenderables: [] }),
  clearSelection: () => {},
  ...overrides,
})

describe('renderer selection copy', () => {
  test('no selection yields nothing to copy', () => {
    const r = renderer({ text: null })
    expect(hasRendererSelection(r)).toBe(false)
    expect(rendererCopyText(r)).toBeUndefined()
  })

  test('empty selection yields nothing to copy', () => {
    const r = renderer({ text: '' })
    expect(hasRendererSelection(r)).toBe(false)
    expect(rendererCopyText(r)).toBeUndefined()
  })

  test('plain selection copies verbatim', () => {
    const r = renderer({ text: 'hello' })
    expect(hasRendererSelection(r)).toBe(true)
    expect(rendererCopyText(r)).toBe('hello')
  })

  test('focused control transforms clipboard text when selected', () => {
    const focus = { getClipboardText: (text: string) => `clip:${text}` }
    const r = renderer({
      getSelection: () => ({ getSelectedText: () => 'hello', selectedRenderables: [focus] }),
      currentFocusedRenderable: focus,
    })
    expect(rendererCopyText(r)).toBe('clip:hello')
  })

  test('focused transform is skipped when focus is outside the selection', () => {
    const focus = { getClipboardText: (text: string) => `clip:${text}` }
    const r = renderer({
      getSelection: () => ({ getSelectedText: () => 'hello', selectedRenderables: [] }),
      currentFocusedRenderable: focus,
    })
    expect(rendererCopyText(r)).toBe('hello')
  })

  test('focusedHandlesCopy detects input-owned selection', () => {
    expect(focusedHandlesCopy(renderer({ currentFocusedRenderable: { hasSelection: () => true } }))).toBe(true)
    expect(focusedHandlesCopy(renderer({ currentFocusedRenderable: { hasSelection: () => false } }))).toBe(false)
    expect(focusedHandlesCopy(renderer())).toBe(false)
  })
})
