import { createStore } from "@xstate/store-react";
import { allThemes, generateSubtleSyntax, generateSyntax, resolveTheme } from "../themes";
import type { SyntaxStyle } from "@opentui/core";
import { options, updateSettings, type ThemePrefs } from "../libs/options";

const themes = allThemes();
const themeKeys = Object.keys(themes);
const themesLength = themeKeys.length;

// Load the persisted theme + variant from options.json (defaults to the first
// theme in dark mode when unset or the stored key is unknown).
const saved = options.theme;
const initialVariant: "dark" | "light" = saved?.variant === "light" ? "light" : "dark";
const savedKey = typeof saved?.key === "string" && themeKeys.includes(saved.key) ? saved.key : undefined;
const initialKey = savedKey ?? (themeKeys[0] ?? "");
const theme = resolveTheme(themes[initialKey]!, initialVariant);
const syntax = generateSyntax(theme);
const syntaxMuted = generateSubtleSyntax(theme);

export type ThemeState = {
  key: string | number,
  prev: string,
  next: string,
  syntax: SyntaxStyle,
  syntaxMuted: SyntaxStyle,
  theme: typeof theme,
  variant: 'dark' | 'light',
  themes: typeof themes
}

/** Persist the selected theme pref to options.json (fire-and-forget). */
const persistTheme = (key: string | number, variant: "dark" | "light") => {
  void updateSettings({ theme: { key: String(key), variant } }).catch(() => {
    // Non-fatal: theme still applies for the session even if persistence fails.
  });
};

export const themeStore = createStore({
  context: {
    key: initialKey,
    prev: themeKeys[themesLength - 1],
    next: themeKeys[themeKeys.indexOf(initialKey) + 1] ?? themeKeys[0],
    theme,
    syntax,
    syntaxMuted,
    themes,
    variant: initialVariant
  } as ThemeState,
  on: {
    prev: (state, event) => {
      const prevKey = themeKeys[themeKeys.indexOf(state.prev) - 1];
      const nextKey = themeKeys[themeKeys.indexOf(state.prev) + 1];
      const nextTheme = resolveTheme(themes[state.prev]!, state.variant);

      persistTheme(state.prev, state.variant);
      return {
        ...state,
        prev: prevKey ?? themeKeys[themesLength - 1],
        key: state.prev,
        next: nextKey ?? themeKeys[0],
        theme: nextTheme,
        syntax: generateSyntax(nextTheme),
        syntaxMuted: generateSubtleSyntax(nextTheme)
      } as ThemeState
    },
    next: (state, event) => {
      const prevKey = themeKeys[themeKeys.indexOf(state.next) - 1];
      const nextKey = themeKeys[themeKeys.indexOf(state.next) + 1];
      const nextTheme = resolveTheme(themes[state.next]!, state.variant);

      persistTheme(state.next, state.variant);
      return {
        ...state,
        prev: prevKey ?? themeKeys[themesLength - 1],
        key: state.next,
        next: nextKey ?? themeKeys[0],
        theme: nextTheme,
        syntax: generateSyntax(nextTheme),
        syntaxMuted: generateSubtleSyntax(nextTheme)
      } as ThemeState
    },
    variant: (state, event) => {
      const nextVariant: "dark" | "light" = state.variant === "dark" ? "light" : "dark";
      const nextTheme = resolveTheme(themes[state.key]!, nextVariant);

      persistTheme(state.key, nextVariant);
      return {
        ...state,
        theme: nextTheme,
        syntax: generateSyntax(nextTheme),
        syntaxMuted: generateSubtleSyntax(nextTheme),
        variant: nextVariant
      } as ThemeState
    },
  }
});