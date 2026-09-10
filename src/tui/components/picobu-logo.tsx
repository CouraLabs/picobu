import { theme } from '@states/theme-state.ts'
import { PICOBU_LOGO_LINES, PICOBU_LOGO_ROW_COLOR_KEYS } from '@tui/themes/logo.ts'
import { For } from 'solid-js'

export const PicobuLogo = () => {
  return (
    <box
      flexDirection="column"
      alignItems="center"
      flexShrink={0}>
      <For each={PICOBU_LOGO_LINES}>
        {(line, index) => {
          const key = PICOBU_LOGO_ROW_COLOR_KEYS[index()]
          return (
            <text
              fg={key ? theme()[key] : theme().text}
              selectable={false}>
              {line}
            </text>
          )
        }}
      </For>
    </box>
  )
}
