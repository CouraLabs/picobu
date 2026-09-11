import type { RGBA } from '@opentui/core'
import type { Theme } from '@tui/themes/index.ts'

export const PICOBU_LOGO_LINES = ['┌╦═══╦┐┌═╤╦╤═┐┌╦═══╦┐┌╦═══╦┐┌╦══╦┐ ┌╦   ╦┐', '│╠═══╩┘  │║│  │║     │║   ║││╠══╩╗┐│║   ║│', '└╩     └═╧╩╧═┘└╩═══╩┘└╩═══╩┘└╩═══╩┘└╩═══╩┘']

export const PICOBU_LOGO_ROW_COLOR_KEYS = ['text', 'syntaxType', 'primary'] as const

export type PicobuLogoColorKey = (typeof PICOBU_LOGO_ROW_COLOR_KEYS)[number]

export type PicobuLogoTheme = Pick<Theme, PicobuLogoColorKey>

export type CloseMessageStatus = {
  messageCount?: number
  inputTokens?: number
  outputTokens?: number
  cost?: number
}

export type CloseMessageTheme = Pick<Theme, PicobuLogoColorKey | 'textMuted' | 'success' | 'info' | 'warning'>

export const PICOBU_ANSI = PICOBU_LOGO_LINES.join('\n')

export const logoColorsFromTheme = (theme: PicobuLogoTheme): RGBA[] => PICOBU_LOGO_ROW_COLOR_KEYS.map((key) => theme[key])

const ansiForeground = (color: RGBA): string => {
  const [r, g, b] = color.toInts()
  return `\x1b[38;2;${r};${g};${b}m`
}

export const colorizeLogo = (colors: RGBA[]): string => {
  const reset = '\x1b[0m'
  return PICOBU_LOGO_LINES.map((line, index) => {
    const color = colors[index]
    if (!color) return line
    return `${ansiForeground(color)}${line}${reset}`
  }).join('\n')
}

export const colorizeLogoWithTheme = (theme: PicobuLogoTheme): string => colorizeLogo(logoColorsFromTheme(theme))

const paint = (value: string, color?: RGBA): string => {
  if (!color) return value
  return `${ansiForeground(color)}${value}\x1b[0m`
}

const statusSummary = (status: CloseMessageStatus | undefined, theme?: CloseMessageTheme): string | undefined => {
  if (!status) return undefined
  const segments: string[] = []
  if (status.messageCount !== undefined && status.messageCount > 0) {
    segments.push(paint(`${status.messageCount} msgs`, theme?.text))
  }
  segments.push(paint('↑ 0 ↓ 0', theme?.info))
  segments.push(paint('$0', theme?.warning))
  if (segments.length === 0) return undefined
  return segments.join(paint(' · ', theme?.textMuted))
}

export const closeMessage = (sessionId: string, theme?: CloseMessageTheme, status?: CloseMessageStatus): string => {
  const logo = theme ? colorizeLogoWithTheme(theme) : PICOBU_ANSI
  const lines: string[] = [logo]
  const summary = statusSummary(status, theme)
  if (summary) lines.push(summary)
  lines.push(paint('To continue this session:', theme?.textMuted))
  lines.push(`${paint('$', theme?.success)} ${paint(`picobu --session ${sessionId}`, theme?.text)}`)
  return lines.join('\n')
}
