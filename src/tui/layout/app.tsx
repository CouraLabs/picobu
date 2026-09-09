import { indexOfTheme, setTheme, theme, themeInfo, themes, toggleThemeVariant } from "@states/theme-state.ts"
import { Dialog } from "@tui/components/dialog.tsx"
import { Dropdown, DropdownLayer } from "@tui/components/dropdown.tsx"
import { createMemo, createSignal } from "solid-js"
import { Tab } from "./tab.tsx"
import { Button } from "@tui/components/button.tsx"
import { SessionPage } from "@tui/pages/session-page.tsx"
import { TextAttributes } from "@opentui/core"

export const App = () => {
  const [page, setPage] = createSignal("app-tab-session")

  const pages = [
    { id: 'app-tab-session', label: 'session' }
  ]

  const isSession = createMemo(() => page() === 'app-tab-session')

  return (
    <box id="app" width={"100%"} height={"100%"} backgroundColor={theme().background}>
      <box id="app-header" marginY={1} marginX={2} flexDirection="row" justifyContent="space-between" alignItems="center">
        <box id="app-header-left">
          <Tab tabs={pages} onChange={setPage} curr={page()} />
        </box>
        <box id="app-header-right" flexDirection="row" gap={1}>
          <Dropdown
            options={themes.map((name) => ({ name, value: name }))}
            onSelect={(option) => setTheme(String(option.value), "dark")}
            selected={indexOfTheme(themes)}
            placeholder="Select theme…"
          />
          <Button label={themeInfo().variant} onClick={() => toggleThemeVariant()} />
        </box>
      </box>
      <box id="app-content" flexDirection="column" flexGrow={1} flexShrink={1} marginX={2}>
        <SessionPage sessionId={undefined} visible={isSession()} />
      </box>
      <box id="app-footer" flexDirection="row" flexShrink={1} gap={1} marginX={2} marginY={1}>
        <text fg={theme().text}>ctrl + c</text>
        <text fg={theme().textMuted} attributes={TextAttributes.DIM}>(exit)</text>
        <text fg={theme().text} attributes={TextAttributes.DIM}>ctrl + h</text>
        <text fg={theme().textMuted}>(help)</text>
      </box>
      <Dialog />
      <DropdownLayer />
    </box>
  )
}
