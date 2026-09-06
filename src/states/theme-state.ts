import { options } from "@config/options.ts";
import type { RGBA, SyntaxStyle } from "@opentui/core";
import {
  allThemes,
  generateSubtleSyntax,
  generateSyntax,
  resolveTheme,
  selectedForeground,
  type Theme,
} from "@tui/themes/index.ts";
import { createMemo, createSignal } from "solid-js";
export type ThemeVariant = "dark" | "light";
export type ThemeState = {
  name: string;
  variant: ThemeVariant;
  theme: Theme;
  syntax: SyntaxStyle,
  syntaxMuted: SyntaxStyle,
}
function listEntries(): string[] {
  return Object.entries(allThemes())
    .map(([name]) => (name))
    .sort((a, b) => a.localeCompare(b));
}


function resolveEntry(name: string, variant: ThemeVariant): Theme {
  const json = allThemes()[name];
  if (!json) {
    const available = Object.keys(allThemes()).sort().join(", ");
    throw new Error(`Unknown theme "${name}". Available themes: ${available}`);
  }
  return resolveTheme(json, variant);
}
export const themes = listEntries();
const defaultName = options?.theme?.key ?? "tacos";
const defaultVariant = options?.theme?.variant ?? "dark";
const defaultTheme = resolveEntry(defaultName, defaultVariant);
const [themeState, setThemeState] = createSignal<ThemeState>({
  name: defaultName,
  variant: defaultVariant,
  theme: defaultTheme,
  syntax: generateSyntax(defaultTheme),
  syntaxMuted: generateSubtleSyntax(defaultTheme),
});
export const theme = createMemo(() => {
  const state = themeState();
  return {
    ...state.theme,
    syntax: state.syntax,
    syntaxMuted: state.syntaxMuted,
    selected: (bg?: RGBA) => selectedForeground(state.theme, bg)
  }
});
export const themeInfo = createMemo(() => {
  const state = themeState();
  return { name: state.name, variant: state.variant }
});
export const setTheme = (name: string, variant: ThemeVariant) => {
  const resolved = resolveEntry(name, variant);
  const syntax = generateSyntax(resolved);
  const syntaxMuted = generateSubtleSyntax(resolved);
  setThemeState(() => ({ name, variant, theme: resolved, syntax, syntaxMuted }))
};
export const toggleThemeVariant = () => {
  const info = themeInfo();
  setTheme(info.name, info.variant === 'dark' ? 'light' : 'dark')
};

