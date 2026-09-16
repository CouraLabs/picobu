import { TextAttributes } from '@opentui/core'
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/solid'
import { dialogStatus } from '@states/dialog.state.ts'
import { indexOfTheme, setTheme, theme, themeInfo, themeOptions, themes, toggleThemeVariant } from '@states/theme-state.ts'
import { pushToast } from '@states/toast.state.ts'
import { Button } from '@tui/components/button.tsx'
import { Dialog } from '@tui/components/dialog.tsx'
import { Dropdown, DropdownLayer } from '@tui/components/dropdown.tsx'
import { openHelpDialog } from '@tui/components/session/help-dialog.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { TooltipLayer } from '@tui/components/tooltip.tsx'
import { getClipboardService } from '@tui/hooks/clipboard.state.ts'
import { getLastSessionId } from '@tui/hooks/reload-bus.ts'
import { focusedHandlesCopy, hasRendererSelection, rendererCopyText } from '@tui/hooks/selection.ts'
import { TerminalDimsProvider } from '@tui/hooks/terminal-dims.tsx'
import { isCopyKey, isHelpKey } from '@tui/keybindings.ts'
import { SessionPage } from '@tui/pages/session-page.tsx'
import { icons } from '@tui/themes/icons.ts'
import { createMemo, createSignal } from 'solid-js'
import { Tab } from './tab.tsx'

export const App = (props: { sessionId?: string } = {}) => {
  const [page, setPage] = createSignal('app-tab-session')
  const dims = useTerminalDimensions()
  const renderer = useRenderer()

  const copyRendererSelection = (): boolean => {
    const text = rendererCopyText(renderer)
    if (text === undefined) return false
    const service = getClipboardService()
    if (!service) {
      pushToast('Copy failed: no clipboard service available', 'error')
      renderer.clearSelection()
      return true
    }
    service.writeText(text, { destination: 'all-available' }).then(
      () => pushToast('Copied to clipboard', 'info'),
      (error) => pushToast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, 'error'),
    )
    renderer.clearSelection()
    return true
  }

  useKeyboard((key) => {
    if (dialogStatus().status === 'open') return
    if (isCopyKey(key)) {
      if (focusedHandlesCopy(renderer)) return
      if (!hasRendererSelection(renderer)) return
      key.preventDefault()
      key.stopPropagation()
      copyRendererSelection()
      return
    }
    if (key.name === 'escape') {
      if (!hasRendererSelection(renderer)) return
      key.preventDefault()
      key.stopPropagation()
      renderer.clearSelection()
    }
  })

  useKeyboard((key) => {
    if (!isHelpKey(key)) return
    if (dialogStatus().status === 'open') return
    key.preventDefault()
    key.stopPropagation()
    openHelpDialog()
  })

  const pages = [{ id: 'app-tab-session', label: 'session' }]

  const isSession = createMemo(() => page() === 'app-tab-session')

  return (
    <TerminalDimsProvider dims={dims}>
      <box id="app" width={'100%'} height={'100%'} backgroundColor={theme().background} paddingX={1}>
        <box id="app-content" flexDirection="column" flexGrow={1} flexShrink={1}>
          <SessionPage sessionId={getLastSessionId() ?? props.sessionId} visible={isSession()} />
        </box>
        <box
          id="app-footer"
          border={['top', 'bottom']}
          borderColor={theme().border}
          flexDirection="row"
          flexShrink={0}
          columnGap={1}
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap">
          <box id="app-footer-left" flexDirection="row" flexWrap="wrap-reverse" columnGap={1}>
            <box flexDirection="row" columnGap={1} flexShrink={0}>
              <Dropdown options={themeOptions} onSelect={(option) => setTheme(String(option.value), themeInfo().variant)} selected={indexOfTheme(themes)} placeholder="Select theme…" />
              <Button label={themeInfo().variant} onClick={() => toggleThemeVariant()} />
              <StatusSeparator sep={icons.middleDot} />
              <text fg={theme().text} attributes={TextAttributes.DIM}>
                {icons.control}
                {icons.shift}H / F1
              </text>
              <text fg={theme().textMuted} attributes={TextAttributes.DIM}>
                (help)
              </text>
              <StatusSeparator sep={icons.middleDot} />
              <text fg={theme().text} attributes={TextAttributes.DIM}>
                {icons.control}
                {icons.shift}D {icons.control}
                {icons.shift}D / F10
              </text>
              <text fg={theme().textMuted} attributes={TextAttributes.DIM}>
                (exit)
              </text>
            </box>
            <box flexDirection="row" columnGap={1} flexShrink={0}>
              <text fg={theme().text} attributes={TextAttributes.DIM}>
                esc esc
              </text>
              <text fg={theme().textMuted} attributes={TextAttributes.DIM}>
                (stop)
              </text>
            </box>
          </box>
          <box id="app-footer-right" flexDirection="row" columnGap={1}>
            <Tab tabs={pages} onChange={setPage} curr={page()} />
          </box>
        </box>
        <Dialog />
        <DropdownLayer />
        <TooltipLayer />
      </box>
    </TerminalDimsProvider>
  )
}
