import { useState } from "react";
import type { ColorInput } from "@opentui/core";
import { useSelector } from "@xstate/store-react";
import { themeStore } from "../stores/theme-store";
import { useCopyToClipboard } from "./useCopyToClipboard";

export type CopyableMessageHandlers = {
  backgroundColor: ColorInput;
  onMouseOver: () => void;
  onMouseOut: () => void;
  onMouseDown: () => void;
};

/**
 * Hover/click-to-copy behavior for a message's root container. Spread the
 * returned props onto the box that renders a message: hovering swaps its
 * background to `theme.backgroundElement`, clicking copies `copyText`, and
 * leaving restores the default background.
 */
export const useCopyableMessage = (copyText: string): CopyableMessageHandlers => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const [hovered, setHovered] = useState(false);
  const copy = useCopyToClipboard();

  return {
    backgroundColor: hovered ? theme.backgroundElement : theme.background,
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
    onMouseDown: () => copy(copyText),
  };
};