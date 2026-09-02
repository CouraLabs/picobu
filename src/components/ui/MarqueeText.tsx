import { memo, useEffect, useRef, useState } from "react";
import { stringWidth } from "bun";
import { TextAttributes, type ColorInput, type MouseEvent } from "@opentui/core";

/** Display-cell width of a single-line string (wide chars count as 2 cells). */
export const textCells = (text: string): number => stringWidth(text);

/** A run of marquee text sharing one style: lit (normal) or dim (eased edge). */
export type MarqueeSegment = {
  text: string;
  dim: boolean;
};

/**
 * Window into `text` for a marquee: returns the `width` display cells starting
 * at cell `offset`, split into consecutive lit/dim runs. Cells covered by a
 * wide grapheme straddling either edge are padded with spaces so the window is
 * always exactly `width` cells.
 *
 * Edges are eased: the first `fade` cells are dimmed when hidden text exists
 * before the window (`offset > 0`), the last `fade` cells when hidden text
 * remains after it — the static start position shows only a trailing fade.
 */
export const marqueeSegments = (text: string, offset: number, width: number, fade: number): MarqueeSegment[] => {
  if (width <= 0) return [];
  const chars = Array.from(text);
  const widths = chars.map((c) => stringWidth(c));

  // Total width, then place each grapheme iff it fits entirely inside the window.
  let total = 0;
  const placed: (string | null)[] = new Array(width).fill(null);
  for (let i = 0; i < chars.length; i++) {
    const w = widths[i]!;
    if (w === 0) continue; // zero-width graphemes attach to the previous cell
    if (total >= offset && total + w <= offset + width) {
      for (let k = 0; k < w; k++) placed[total - offset + k] = chars[i]!;
    }
    total += w;
  }

  const end = offset + width;
  const segments: MarqueeSegment[] = [];
  let current: MarqueeSegment | null = null;
  for (let k = 0; k < width; k++) {
    const dim = (offset > 0 && k < fade) || (end < total && k >= width - fade);
    const ch = placed[k] ?? " ";
    if (current && current.dim === dim) {
      current.text += ch;
    } else {
      current = { text: ch, dim };
      segments.push(current);
    }
  }
  return segments;
};

/** Cells the window must travel to reveal the end of the text (0 when it fits). */
export const marqueeMaxOffset = (text: string, width: number): number => Math.max(0, textCells(text) - width);

/** Default ms per scroll tick. */
const SCROLL_STEP_MS = 60;
/** Cells faded at each eased edge while text overflows. */
const FADE_CELLS = 3;
/** Half-width fraction around the center where the marquee stays frozen. */
const DEAD_ZONE = 0.15;
/** Cells moved per tick with the mouse fully at an edge. */
const MAX_STEP = 3;

export type MarqueeTextProps = {
  /** Single-line content; scrolled when wider than `width`. */
  text: string;
  /** Display cells the marquee may occupy before scrolling kicks in. */
  width: number;
  fg: ColorInput;
  /** Root text attributes (e.g. bold); preserved while scrolling. */
  attributes?: number;
  /** ms per scroll tick (default 60). */
  speed?: number;
};

/**
 * Terminal `<marquee>` for big single-line texts. Text that fits `width`
 * renders as a plain, static `<text>`. Once it overflows, the visible window
 * is clipped to `width` cells with dimmed (eased) edges.
 *
 * While hovered, the mouse steers the scroll: the window slides toward the
 * side the mouse is on, and speeds up the closer the mouse gets to that edge
 * (a dead zone around the center keeps it frozen). Moving the mouse out
 * freezes it in place. Hover colors work as with plain text: the parent row's
 * own `onMouseOver` still fires because events bubble.
 */
export const MarqueeText = memo(({ text, width, fg, attributes, speed = SCROLL_STEP_MS }: MarqueeTextProps) => {
  const cells = textCells(text);
  const scrolling = cells > width;
  const [hovered, setHovered] = useState(false);
  const [offset, setOffset] = useState(0);
  /** Signed cells moved per tick; 0 = frozen. Steered by mouse position. */
  const velocity = useRef(0);

  useEffect(() => {
    if (!scrolling || !hovered) return;
    const id = setInterval(() => {
      setOffset((prev) => {
        const next = Math.max(0, Math.min(cells - width, prev + velocity.current));
        return next;
      });
    }, speed);
    return () => clearInterval(id);
  }, [scrolling, hovered, cells, width, speed]);

  if (!scrolling) {
    return (
      <text selectable={false} fg={fg} attributes={attributes}>
        {text}
      </text>
    );
  }

  const fade = Math.min(FADE_CELLS, Math.floor(width / 3));
  const segments = marqueeSegments(text, offset, width, fade);

  const onMouseMove = (event: MouseEvent) => {
    const el = event.currentTarget;
    if (!el || el.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.x - el.screenX) / el.width));
    const fromCenter = ratio - 0.5;
    const overshoot = Math.abs(fromCenter) - DEAD_ZONE;
    velocity.current =
      overshoot <= 0
        ? 0
        : Math.sign(fromCenter) * Math.min(MAX_STEP, Math.max(1, Math.ceil((overshoot / (0.5 - DEAD_ZONE)) * MAX_STEP)));
  };

  return (
    <text
      selectable={false}
      fg={fg}
      attributes={attributes}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => {
        setHovered(false);
        velocity.current = 0;
      }}
      onMouseMove={onMouseMove}
    >
      {segments.map((s, i) =>
        s.dim ? (
          <span key={i} attributes={TextAttributes.DIM}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </text>
  );
});
