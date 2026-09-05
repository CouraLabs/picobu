import { useTimeline } from "@opentui/solid";
import type { RGBA } from "@opentui/core";
import { theme } from "@states/theme-state.ts";
import { createEffect, createMemo, createSignal } from "solid-js";

export type MarqueeProps = {
  /** Full text to display. Text that overflows `maxWidth` scrolls. */
  content: string;
  /** Visible width in display cells. */
  maxWidth: number;
  /** Milliseconds for one full traverse of the overflow. Default 3000. */
  speed?: number;
  /** Text color. Defaults to the theme's primary. */
  fg?: string | RGBA;
  /**
   * Keep the renderable exactly `maxWidth` cells wide even when the text
   * fits (popup rows align left edge). Default: shrink-wrap the text.
   */
  fillWidth?: boolean;
  /** Force the scroll loop regardless of hover (e.g. a highlighted row). */
  scrolling?: boolean;
};

/**
 * A `<text>` that behaves like the HTML `<marquee>` tag.
 *
 * Text that fits `maxWidth` renders statically. Overflowing text scrolls
 * while hovered (or while `scrolling` is true): a `Timeline` animates a
 * numeric phase linearly over one full out-and-back cycle, mapped onto a
 * triangle wave so the text walks to the end, bounces back to the start,
 * and cycles forever. Per frame the visible window is sliced out of the
 * full text — slicing approximates one column per code point; wide
 * characters inside a scrolling label are an accepted edge case.
 */
export const Marquee = (props: MarqueeProps) => {
  const [hovered, setHovered] = createSignal(false);
  const [visible, setVisible] = createSignal(props.content);

  const speedMs = () => props.speed ?? 3000;
  /**
   * Animation phase in `[0, 2]`: 0→1 walks forward, 1→2 walks back.
   * A plain object so the timeline can interpolate a top-level number.
   */
  const driver = { phase: 0 };
  const timeline = useTimeline({ autoplay: false, duration: speedMs() * 2, loop: true });

  const chars = createMemo(() => Array.from(props.content));
  const overflowCols = createMemo(() =>
    Math.max(0, chars().length - props.maxWidth),
  );

  const sliceWindow = (start: number): string => {
    if (overflowCols() === 0) return props.content;
    return chars().slice(start, start + props.maxWidth).join("");
  };

  /** Reset the walk to the head of the text. */
  const resetToHead = (): void => {
    driver.phase = 0;
    setVisible(sliceWindow(0));
  };

  timeline.add(driver, {
    phase: 2,
    duration: speedMs() * 2,
    ease: "linear",
    loop: true,
    onUpdate: () => {
      // Triangle wave: 0→1 forward, 1→2 back.
      const tri = driver.phase <= 1 ? driver.phase : 2 - driver.phase;
      setVisible(sliceWindow(Math.min(Math.round(tri * overflowCols()), overflowCols())));
    },
  });

  // Hover (or an explicit `scrolling` prop) drives the scroll loop; a
  // content change resets the walk to the head of the new text. While the
  // loop is already playing, transient hover flickers must not restart it.
  createEffect(() => {
    props.content;
    const active = (hovered() || props.scrolling === true) && overflowCols() > 0;
    if (active && !timeline.isPlaying) {
      resetToHead();
      timeline.restart();
    } else if (!active) {
      timeline.pause();
      resetToHead();
    }
  });

  return (
    <text
      truncate
      selectable={false}
      wrapMode={"none"}
      fg={props.fg ?? theme().text}
      width={overflowCols() > 0 || props.fillWidth ? props.maxWidth : "auto"}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      {visible()}
    </text>
  );
};
