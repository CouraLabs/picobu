import { RGBA } from "@opentui/core";
import type { Theme } from "../../../../themes";
import type { AgentType } from "../../types/agent-type";

/** Theme color keys an agent `color:` may reference (in addition to raw HEX). */
const THEME_COLOR_KEYS = new Set<keyof Theme>([
  "primary",
  "secondary",
  "accent",
  "error",
  "warning",
  "success",
  "info",
  "text",
  "textMuted",
  "selectedListItemText",
]);

/**
 * Resolve the color an agent should display on the TUI. The agent `color:` may
 * be a HEX (`#RRGGBB`) or a theme key (e.g. `accent`). Falls back to
 * `theme.text` when no color is set or the value isn't recognized.
 */
export function resolveAgentColor(agent: AgentType, theme: Theme): RGBA {
  const color = agent.color?.trim();
  if (color) {
    if (color.startsWith("#")) {
      try {
        return RGBA.fromHex(color);
      } catch {
        /* unrecognized hex -> fall through to theme.text */
      }
    } else if (THEME_COLOR_KEYS.has(color as keyof Theme)) {
      return theme[color as keyof Theme] as RGBA;
    }
  }
  return theme.text;
}