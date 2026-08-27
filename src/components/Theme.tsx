import {
  TextAttributes,
  TextRenderable,
  type MouseEventType,
} from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../stores/theme-store";
import { icons } from "./symbols/icons";

export const Theme = () => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const themKey = useSelector(themeStore, (s) => s.context.key);
  const variant = useSelector(themeStore, (s) => s.context.variant);

  const onArrowMouse = (target: TextRenderable, e: MouseEventType, side: string) => {
    switch (e) {
      case "down":
        side === "left" ? themeStore.trigger.prev() : themeStore.trigger.next();
        target.fg = theme.accent;
        break;
      case "out":
        target.fg = theme.text;
        break;
      case "over":
        target.fg = theme.accent;
        break;
    }
  };

  // Clicking the theme name advances to the next theme; hover highlights it.
  const onNameMouse = (target: TextRenderable, e: MouseEventType) => {
    switch (e) {
      case "down":
        themeStore.trigger.next();
        target.fg = theme.accent;
        break;
      case "out":
        target.fg = theme.text;
        break;
      case "over":
        target.fg = theme.accent;
        break;
    }
  };

  // Light/dark toggle: muted by default, accents on hover/click.
  const onVariantMouse = (target: TextRenderable, e: MouseEventType) => {
    switch (e) {
      case "down":
        themeStore.trigger.variant();
        target.fg = theme.accent;
        break;
      case "out":
        target.fg = theme.textMuted;
        break;
      case "over":
        target.fg = theme.accent;
        break;
    }
  };

  return (
    <box flexDirection="row" gap={1}>
      <text
        selectable={false}
        fg={theme.text}
        onMouse={(e) => onArrowMouse(e.target as TextRenderable, e.type, "left")}
      >
        {icons.arrows.blockLeft}
      </text>
      <text
        selectable={false}
        fg={theme.text}
        attributes={TextAttributes.DIM}
        onMouse={(e) => onNameMouse(e.target as TextRenderable, e.type)}
      >
        {themKey}
      </text>
      <text
        selectable={false}
        fg={theme.text}
        onMouse={(e) => onArrowMouse(e.target as TextRenderable, e.type, "right")}
      >
        {icons.arrows.blockRight}
      </text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>
        |
      </text>
      <text
        selectable={false}
        fg={theme.textMuted}
        onMouse={(e) => onVariantMouse(e.target as TextRenderable, e.type)}
      >
        {variant}
      </text>
    </box>
  );
};