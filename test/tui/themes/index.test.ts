import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  allThemes,
  generateSubtleSyntax,
  generateSyntax,
  resolveTheme,
  type Theme,
} from "@tui/themes/index.ts"

const THEME_KEYS = [
  "primary", "secondary", "accent", "error", "warning", "success", "info",
  "text", "textMuted", "selectedListItemText", "background", "backgroundPanel",
  "backgroundElement", "border", "borderActive", "borderSubtle",
  "diffAdded", "diffRemoved", "diffContext", "diffHunkHeader",
  "diffHighlightAdded", "diffHighlightRemoved", "diffAddedBg", "diffRemovedBg",
  "diffContextBg", "diffLineNumber", "diffAddedLineNumberBg", "diffRemovedLineNumberBg",
  "markdownText", "markdownHeading", "markdownLink", "markdownLinkText",
  "markdownCode", "markdownBlockQuote", "markdownEmph", "markdownStrong",
  "markdownHorizontalRule", "markdownListItem", "markdownListEnumeration",
  "markdownImage", "markdownImageText", "markdownCodeBlock",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
] as const satisfies readonly (keyof Theme)[]

type Rgba = { r: number; g: number; b: number; a: number }

/** Composite `fg` over `bg` (RGBA stores channels as 0..1 floats). */
function blend(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  }
}

function luminance(c: Rgba): number {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

/** WCAG contrast ratio between `fg` and `over`, compositing any translucency. */
function contrast(fg: Rgba, over: Rgba): number {
  const a = blend(fg, over)
  const b = { r: over.r, g: over.g, b: over.b, a: 1 }
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** All bundled default themes. */
const themes = allThemes()

describe("theme resolution", () => {
  test("bundles 44 default themes without -dark/-light pairs", () => {
    const names = Object.keys(themes)
    for (const expected of [
      "one",
      "one-darker",
      "catppuccin-latte",
      "rose-pine-moon",
      "rose-pine-dawn",
      "tokyo-night-storm",
      "ayu-light",
      "doom-one",
      "vitesse",
      "vitesse-darker",
      "horizon",
      "horizon-darker",
      "bluloco-dark",
    ]) {
      expect(names).toContain(expected)
    }
    // The -light/-dark pair naming is retired: the base name is the theme and
    // "…-darker" is its distinct companion.
    for (const retired of ["one-light", "one-dark", "vitesse-light", "vitesse-dark", "horizon-light", "horizon-dark"]) {
      expect(names, retired).not.toContain(retired)
    }
    expect(names).toHaveLength(44)
  })

  test("resolves every field and generates syntax in both variants", () => {
    for (const [name, json] of Object.entries(themes)) {
      for (const variant of ["dark", "light"] as const) {
        const theme = resolveTheme(json, variant)
        for (const key of THEME_KEYS) {
          expect(theme[key], `${name}/${variant}/${key}`).toBeInstanceOf(RGBA)
        }
        expect(theme.thinkingOpacity, `${name}/${variant}/thinkingOpacity`).toBeGreaterThan(0)
        expect(theme.thinkingOpacity, `${name}/${variant}/thinkingOpacity`).toBeLessThanOrEqual(1)
        expect(() => generateSyntax(theme), `${name}/${variant}/generateSyntax`).not.toThrow()
        expect(() => generateSubtleSyntax(theme), `${name}/${variant}/subtleSyntax`).not.toThrow()
      }
    }
  })
describe("theme contrast (no invisible overlap)", () => {
  // Thresholds are intentionally lenient: they catch text that collapses into
  // its backdrop (the reported "colors don't overlap" issue) without forcing a
  // WCAG AA style guide onto deliberately soft palettes (solarized, catppuccin).
  function checkSurfaces(
    name: string,
    variant: "dark" | "light",
    theme: Theme,
    pairs: { fg: keyof Theme; bg: keyof Theme; min: number; name: string }[],
  ) {
    const background = theme.background as unknown as Rgba
    for (const { fg, bg: bgKey, min, name: pairName } of pairs) {
      const surfaces = [] as { label: string; over: Rgba }[]
      // Translucent diff backgrounds composite over the app background.
      if (bgKey === "diffAddedBg" || bgKey === "diffRemovedBg" || bgKey === "diffContextBg") {
        surfaces.push({ label: "on-background", over: background })
      } else {
        surfaces.push({ label: "", over: theme[bgKey] as unknown as Rgba })
      }
      for (const { label, over } of surfaces) {
        if (over.a === 0) continue // transparent surface: terminal-controlled
        const fgColor = (theme[fg] as unknown as Rgba) ?? over
        const c = contrast(fgColor, over)
        expect(
          c,
          `${name}/${variant} ${pairName} (${fg}) ${label} contrast ${c.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(min)
      }
    }
  }

  for (const [name, json] of Object.entries(themes)) {
    test(`${name} has readable selection + body text in both variants`, () => {
      for (const variant of ["dark", "light"] as const) {
        const theme = resolveTheme(json, variant)
        checkSurfaces(name, variant, theme, [
          // The select highlight is a transparent row, so selectedListItemText
          // is plain text on the panel — it must be legible, never the bg color.
          { fg: "selectedListItemText", bg: "backgroundPanel", min: 3.0, name: "sel/panel" },
          { fg: "selectedListItemText", bg: "backgroundElement", min: 2.5, name: "sel/element" },
          // Body copy never collapses into the surfaces it is drawn on.
          { fg: "text", bg: "background", min: 3.0, name: "text/bg" },
          { fg: "text", bg: "backgroundPanel", min: 2.5, name: "text/panel" },
          { fg: "textMuted", bg: "backgroundPanel", min: 1.8, name: "muted/panel" },
          // Borders and status/token colors stay perceivable.
          { fg: "border", bg: "background", min: 1.2, name: "border/bg" },
          { fg: "borderActive", bg: "background", min: 1.4, name: "borderActive/bg" },
          { fg: "primary", bg: "background", min: 2.0, name: "primary/bg" },
          { fg: "accent", bg: "background", min: 2.0, name: "accent/bg" },
          { fg: "error", bg: "background", min: 2.0, name: "error/bg" },
          { fg: "warning", bg: "background", min: 2.0, name: "warning/bg" },
          { fg: "success", bg: "background", min: 2.0, name: "success/bg" },
          { fg: "info", bg: "background", min: 2.0, name: "info/bg" },
          // Bright syntax tokens must not vanish on code panels.
          { fg: "syntaxKeyword", bg: "backgroundPanel", min: 2.0, name: "syntaxKeyword/panel" },
          { fg: "syntaxFunction", bg: "backgroundPanel", min: 2.0, name: "syntaxFunction/panel" },
          { fg: "syntaxVariable", bg: "backgroundPanel", min: 2.0, name: "syntaxVariable/panel" },
          { fg: "syntaxString", bg: "backgroundPanel", min: 2.0, name: "syntaxString/panel" },
          { fg: "syntaxNumber", bg: "backgroundPanel", min: 2.0, name: "syntaxNumber/panel" },
          { fg: "syntaxType", bg: "backgroundPanel", min: 2.0, name: "syntaxType/panel" },
          { fg: "syntaxOperator", bg: "backgroundPanel", min: 2.0, name: "syntaxOperator/panel" },
          { fg: "syntaxPunctuation", bg: "backgroundPanel", min: 2.0, name: "syntaxPunctuation/panel" },
          // Diff ink stays readable on its tinted line background.
          { fg: "diffAdded", bg: "diffAddedBg", min: 1.4, name: "diffAdded/bg" },
          { fg: "diffRemoved", bg: "diffRemovedBg", min: 1.4, name: "diffRemoved/bg" },
        ])
      }
    })
  }
})
})