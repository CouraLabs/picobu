import { TextAttributes } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { dialogStatus } from '@states/dialog.state.ts'
import { indexOfTheme, setTheme, theme, themeInfo, themes, toggleThemeVariant } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { Dialog } from '@tui/components/dialog.tsx'
import { Dropdown, DropdownLayer } from '@tui/components/dropdown.tsx'
import { openHelpDialog } from '@tui/components/session/help-dialog.tsx'
import { StatusSeparator } from '@tui/components/shared/status-separator.tsx'
import { SessionPage } from '@tui/pages/session-page.tsx'
import { icons } from '@tui/themes/icons.ts'
import { createMemo, createSignal } from 'solid-js'
import { Tab } from './tab.tsx'

export const App = (props: { sessionId?: string } = {}) => {
  const [page, setPage] = createSignal('app-tab-session')

  useKeyboard((key) => {
    if (!key.ctrl || key.meta || key.super) return
    if (key.name.toLowerCase() !== 'h') return
    if (dialogStatus().status === 'open') return
    key.preventDefault()
    key.stopPropagation()
    openHelpDialog()
  })

  const pages = [{ id: 'app-tab-session', label: 'session' }]

  const isSession = createMemo(() => page() === 'app-tab-session')

  return (
    <box id="app" width={'100%'} height={'100%'} backgroundColor={theme().background}>
      <box id="app-content" flexDirection="column" flexGrow={1} flexShrink={1} marginX={2}>
        <SessionPage sessionId={props.sessionId} visible={isSession()} />
      </box>
      <box
        id="app-footer"
        border={['top']}
        marginBottom={1}
        borderColor={theme().borderSubtle}
        flexDirection="row"
        flexShrink={0}
        columnGap={1}
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        marginX={2}>
        <box id="app-footer-left" flexDirection="row" flexWrap="wrap-reverse" columnGap={1}>
          <box flexDirection="row" columnGap={1} flexShrink={0}>
            <Dropdown
              options={themes.map((name) => ({ name, value: name }))}
              onSelect={(option) => setTheme(String(option.value), themeInfo().variant)}
              selected={indexOfTheme(themes)}
              placeholder="Select theme…"
            />
            <Button label={themeInfo().variant} onClick={() => toggleThemeVariant()} />
            <StatusSeparator sep={icons.middleDot} />
            <text fg={theme().text} attributes={TextAttributes.DIM}>
              {icons.control}H
            </text>
            <text fg={theme().textMuted} attributes={TextAttributes.DIM}>
              (help)
            </text>
            <StatusSeparator sep={icons.middleDot} />
            <text fg={theme().text} attributes={TextAttributes.DIM}>
              {icons.control}D {icons.control}D
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
    </box>
  )
}
