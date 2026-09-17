import { type BoxRenderable, type MouseEvent, RGBA } from '@opentui/core'
import { closeDialog, dialogStatus } from '@states/dialog.state.ts'
import { dropdownState } from '@states/dropdown.state.ts'
import { theme } from '@states/theme-state.ts'
import { useAppKeyboard } from '@tui/hooks/keyboard-provider.tsx'
import { requestPromptFocus } from '@tui/hooks/prompt-focus.ts'
import { createEffect } from 'solid-js'

export const Dialog = () => {
  let backdropRef: BoxRenderable | null = null
  let panelRef: BoxRenderable | null = null
  let wasOpen = false

  useAppKeyboard((key) => {
    if (dialogStatus().status !== 'open') return false
    if (key.name === 'escape') {
      closeDialog()
      return true
    }
    return false
  })

  const handleBackdropMouseUp = (event: MouseEvent) => {
    if (event.target === backdropRef) {
      event.stopPropagation()
      closeDialog()
    }
  }

  createEffect(() => {
    if (dialogStatus().status === 'open') panelRef?.focus()
  })

  createEffect(() => {
    const open = dialogStatus().status === 'open'
    if (wasOpen && !open)
      queueMicrotask(() => {
        if (dialogStatus().status === 'close' && dropdownState() === null) requestPromptFocus()
      })
    wasOpen = open
  })

  return (
    <box
      ref={(r) => (backdropRef = r)}
      position={'absolute'}
      width={'100%'}
      height={'100%'}
      justifyContent={'center'}
      alignItems={'center'}
      backgroundColor={RGBA.fromValues(0, 0, 0, 0.6)}
      visible={dialogStatus().status !== 'close'}
      zIndex={500}
      focusable={true}
      focused={dialogStatus().status === 'open'}
      onMouseUp={handleBackdropMouseUp}>
      <box
        ref={(r) => (panelRef = r)}
        backgroundColor={theme().backgroundPanel}
        focusable
        flexDirection={'column'}
        overflow={'hidden'}
        width={'auto'}
        height={'auto'}
        maxWidth={'90%'}
        maxHeight={'90%'}>
        {dialogStatus().content?.()}
      </box>
    </box>
  )
}
