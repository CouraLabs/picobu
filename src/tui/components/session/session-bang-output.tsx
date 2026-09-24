import { options } from '@config/options.ts'
import { collapseHome } from '@shared/path.ts'
import { type BangOutput, bangOutput } from '@states/bang-output.state.ts'
import { theme } from '@states/theme-state.ts'
import { createMemo, Show } from 'solid-js'

const MAX_OUTPUT_LINES = 12

export const SessionBangOutput = () => {
  const item = () => bangOutput()
  const command = () => item()?.command.slice(1).trim() ?? ''
  const exitColor = createMemo(() => {
    const current = item()
    if (!current) return theme().textMuted
    if (current.exitCode === 0) return theme().success
    if (current.exitCode === 124) return theme().warning
    return theme().error
  })
  const showStderr = createMemo(() => {
    const current = item()
    if (!current) return false
    return current.stderr.trim().length > 0 && !current.stdout.includes(current.stderr)
  })
  return (
    <Show when={item()}>
      {(current: () => BangOutput) => (
        <box flexDirection="column" flexShrink={0} border borderColor={theme().border} paddingX={1}>
          <box flexDirection="row" gap={1} flexShrink={0} flexWrap="wrap">
            <text fg={theme().text}>! {command()}</text>
            <text fg={exitColor()}>· exit {current().exitCode}</text>
            <text fg={theme().textMuted}>
              · {current().durationMs}ms · {collapseHome(current().cwd, options.app.homeDir)}
            </text>
          </box>
          <scrollbox
            maxHeight={MAX_OUTPUT_LINES}
            flexShrink={1}
            scrollY
            overflow="hidden"
            scrollbarOptions={{
              trackOptions: {
                foregroundColor: theme().primary,
                backgroundColor: theme().background,
              },
            }}>
            <text fg={theme().text}>{current().stdout}</text>
            <Show when={showStderr()}>
              <text fg={theme().textMuted}>stderr:</text>
              <text fg={theme().error}>{current().stderr}</text>
            </Show>
          </scrollbox>
          <Show when={current().truncated && current().outputPath}>
            <text fg={theme().textMuted}>Full output saved to: {current().outputPath}</text>
          </Show>
          <text fg={theme().textMuted}>Press Esc or send a new prompt to dismiss</text>
        </box>
      )}
    </Show>
  )
}
