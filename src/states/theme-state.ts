import { options, updateSettings } from '@config/options.ts'
import type { RGBA, SyntaxStyle } from '@opentui/core'
import { allThemes, generateSubtleSyntax, generateSyntax, resolveTheme, selectedForeground, type Theme } from '@tui/themes/index.ts'
import { createMemo, createSignal } from 'solid-js'
export type ThemeVariant = 'dark' | 'light'
export type ThemeState = {
  name: string
  variant: ThemeVariant
  theme: Theme
  syntax: SyntaxStyle
  syntaxMuted: SyntaxStyle
}
function listEntries(): string[] {
  return Object.entries(allThemes())
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))
}

const LEGACY_THEME_NAMES: Record<string, string> = {
  tacos: 'monochrome',
  vesper: 'picobu',
}

function resolveEntry(name: string, variant: ThemeVariant): Theme {
  const json = allThemes()[name]
  if (!json) {
    const fallback = allThemes().picobu ?? Object.values(allThemes())[0]
    if (!fallback) {
      throw new Error(`Unknown theme "${name}". No themes available`)
    }
    return resolveTheme(fallback, variant)
  }
  return resolveTheme(json, variant)
}
function resolveEntryName(name: string): string {
  if (allThemes()[name]) return name
  const legacy = LEGACY_THEME_NAMES[name]
  if (legacy && allThemes()[legacy]) return legacy
  return 'picobu'
}
export const themes = listEntries()
const defaultName = resolveEntryName(options?.tui?.theme?.key ?? 'picobu')
const defaultVariant = options?.tui?.theme?.variant ?? 'dark'
const defaultTheme = resolveEntry(defaultName, defaultVariant)
const [themeState, setThemeState] = createSignal<ThemeState>({
  name: defaultName,
  variant: defaultVariant,
  theme: defaultTheme,
  syntax: generateSyntax(defaultTheme),
  syntaxMuted: generateSubtleSyntax(defaultTheme),
})
export const theme = createMemo(() => {
  const state = themeState()
  return {
    ...state.theme,
    syntax: state.syntax,
    syntaxMuted: state.syntaxMuted,
    selected: (bg?: RGBA) => selectedForeground(state.theme, bg),
  }
})
export const themeInfo = createMemo(() => {
  const state = themeState()
  return { name: state.name, variant: state.variant }
})
let pendingSave: Promise<void> | undefined
export const flushThemeSave = (): Promise<void> => pendingSave ?? Promise.resolve()
export const setTheme = (name: string, variant: ThemeVariant) => {
  const safeName = resolveEntryName(name)
  const resolved = resolveEntry(safeName, variant)
  const syntax = generateSyntax(resolved)
  const syntaxMuted = generateSubtleSyntax(resolved)
  setThemeState(() => ({ name: safeName, variant, theme: resolved, syntax, syntaxMuted }))
  pendingSave = updateSettings({ tui: { theme: { key: safeName, variant } } })
    .then(() => undefined)
    .catch((error) => {
      console.error(`picobu: failed to persist theme: ${error instanceof Error ? error.message : String(error)}`)
    })
}
export const toggleThemeVariant = () => {
  const info = themeInfo()
  setTheme(info.name, info.variant === 'dark' ? 'light' : 'dark')
}
export const indexOfTheme = (names: string[]): number => {
  const index = names.indexOf(themeInfo().name)
  return index < 0 ? 0 : index
}
