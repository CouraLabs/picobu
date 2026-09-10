import { TextAttributes } from '@opentui/core'
import { indexOfTheme, setTheme, theme, themeInfo, themes, toggleThemeVariant } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { Dialog } from '@tui/components/dialog.tsx'
import { Dropdown, DropdownLayer } from '@tui/components/dropdown.tsx'
import { SessionPage } from '@tui/pages/session-page.tsx'
import { createMemo, createSignal } from 'solid-js'
import { Tab } from './tab.tsx'

export const App = (props: { sessionId?: string } = {}) => {
  const [page, setPage] = createSignal('app-tab-session')

  const pages = [{ id: 'app-tab-session', label: 'session' }]

  const isSession = createMemo(() => page() === 'app-tab-session')

  return (
    <box
      id="app"
      width={'100%'}
      height={'100%'}
      backgroundColor={theme().background}>
      <box
        id="app-content"
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        marginX={2}>
        <SessionPage
          sessionId={props.sessionId}
          visible={isSession()}
        />
      </box>
      <box
        id="app-footer"
        border={['top']}
        marginBottom={1}
        borderColor={theme().borderSubtle}
        flexDirection="row"
        flexShrink={0}
        gap={1}
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        marginX={2}>
        <box
          id="app-footer-left"
          flexWrap="wrap"
          gap={1}>
          <box
            flexDirection="row"
            gap={1}
            flexShrink={0}>
            <text
              fg={theme().text}
              attributes={TextAttributes.DIM}>
              ^C
            </text>
            <text
              fg={theme().textMuted}
              attributes={TextAttributes.DIM}>
              (exit)
            </text>
          </box>
          <box
            flexDirection="row"
            gap={1}
            flexShrink={0}>
            <text
              fg={theme().text}
              attributes={TextAttributes.DIM}>
              ^M
            </text>
            <text
              fg={theme().textMuted}
              attributes={TextAttributes.DIM}>
              (model)
            </text>
          </box>
          <box
            flexDirection="row"
            gap={1}
            flexShrink={0}>
            <text
              fg={theme().text}
              attributes={TextAttributes.DIM}>
              ^J
            </text>
            <text
              fg={theme().textMuted}
              attributes={TextAttributes.DIM}>
              (jobs)
            </text>
          </box>
          <box
            flexDirection="row"
            gap={1}
            flexShrink={0}>
            <text
              fg={theme().text}
              attributes={TextAttributes.DIM}>
              ^Q
            </text>
            <text
              fg={theme().textMuted}
              attributes={TextAttributes.DIM}>
              (queue)
            </text>
          </box>
          <box
            flexDirection="row"
            gap={1}
            flexShrink={0}>
            <text
              fg={theme().text}
              attributes={TextAttributes.DIM}>
              ^W
            </text>
            <text
              fg={theme().textMuted}
              attributes={TextAttributes.DIM}>
              (steer)
            </text>
          </box>
          <box
            flexDirection="row"
            gap={1}
            flexShrink={0}>
            <text
              fg={theme().text}
              attributes={TextAttributes.DIM}>
              esc esc
            </text>
            <text
              fg={theme().textMuted}
              attributes={TextAttributes.DIM}>
              (stop)
            </text>
          </box>
        </box>
        <box
          id="app-footer-right"
          flexWrap="wrap"
          gap={1}>
          <Tab
            tabs={pages}
            onChange={setPage}
            curr={page()}
          />
          <Dropdown
            options={themes.map((name) => ({ name, value: name }))}
            onSelect={(option) => setTheme(String(option.value), themeInfo().variant)}
            selected={indexOfTheme(themes)}
            placeholder="Select theme…"
          />
          <Button
            label={themeInfo().variant}
            onClick={() => toggleThemeVariant()}
          />
        </box>
      </box>
      <Dialog />
      <DropdownLayer />
    </box>
  )
}
