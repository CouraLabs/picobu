import { useSelector } from "@xstate/store-react";
import { useRef, useState, type ReactNode } from "react";
import { themeStore } from "../../stores/theme-store";
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core";

type ScrollableOutputProps = {
  children: ReactNode;
};

/**
 * Bordered, scrollable container for a tool's result. Capped at 5 rows so a
 * large output scrolls inside its own box instead of spraying over the next
 * message; callers provide either plain lines or a `<code>` renderable.
 *
 * The underlying `scrollbox` is a row layout on the root (viewport + vertical
 * scrollbar side by side), so we must not override `flexDirection` — doing so
 * stacks the scrollbar below the box and breaks the `maxHeight` cap. Wheel
 * events bubble to the surrounding message list, so we consume them here while
 * this box actually has scrollable content; otherwise they fall through so the
 * page itself can still scroll.
 */
export const ScrollableOutput = ({ children }: ScrollableOutputProps) => {
  const [focused, setFocused] = useState(false);
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const boxRef = useRef<ScrollBoxRenderable | null>(null);

  const onScroll = (event: MouseEvent) => {
    if (event.type !== "scroll") return;
    // Only claim the wheel while this box has vertically scrollable content;
    // otherwise let it bubble to the page so the outer list still scrolls.
    const box = boxRef.current;
    if (box && box.scrollHeight > box.viewport.height) {
      event.stopPropagation();
    }
  };

  return (
    <scrollbox
      ref={boxRef}
      focusable={true}
      focused={focused}
      maxHeight={5}
      backgroundColor={focused ? theme.backgroundPanel : theme.background}
      onMouseOut={() => setFocused(false)}
      onMouseOver={() => setFocused(true)}
      onMouseScroll={onScroll}
      scrollbarOptions={{ showArrows: false }}
    >
      {children}
    </scrollbox>
  );
};