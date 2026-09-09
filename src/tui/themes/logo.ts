import type { RGBA } from "@opentui/core";
import type { Theme } from "@tui/themes/index.ts";

export const PICOBU_LOGO_LINES = [
  "┌╦═══╦┐┌═╤╦╤═┐┌╦═══╦┐┌╦═══╦┐┌╦══╦┐ ┌╦   ╦┐",
  "│╠═══╩┘  │║│  │║     │║   ║││╠══╩╗┐│║   ║│",
  "└╩     └═╧╩╧═┘└╩═══╩┘└╩═══╩┘└╩═══╩┘└╩═══╩┘",
];

export const PICOBU_LOGO_ROW_COLOR_KEYS = ["text", "syntaxType", "primary"] as const;

export type PicobuLogoColorKey = (typeof PICOBU_LOGO_ROW_COLOR_KEYS)[number];

export type PicobuLogoTheme = Pick<Theme, PicobuLogoColorKey>;

export const PICOBU_ANSI = PICOBU_LOGO_LINES.join("\n");

export const logoColorsFromTheme = (theme: PicobuLogoTheme): RGBA[] => PICOBU_LOGO_ROW_COLOR_KEYS.map((key) => theme[key]);

const ansiForeground = (color: RGBA): string => {
  const [r, g, b] = color.toInts();
  return `\x1b[38;2;${r};${g};${b}m`;
};

export const colorizeLogo = (colors: RGBA[]): string => {
  const reset = "\x1b[0m";
  return PICOBU_LOGO_LINES.map((line, index) => {
    const color = colors[index];
    if (!color) return line;
    return `${ansiForeground(color)}${line}${reset}`;
  }).join("\n");
};

export const colorizeLogoWithTheme = (theme: PicobuLogoTheme): string => colorizeLogo(logoColorsFromTheme(theme));

export const closeMessage = (sessionId: string, theme?: PicobuLogoTheme): string => {
  const logo = theme ? colorizeLogoWithTheme(theme) : PICOBU_ANSI;
  return `${logo}\nTo continue this session:\n  $ picobu --session ${sessionId}`;
};
