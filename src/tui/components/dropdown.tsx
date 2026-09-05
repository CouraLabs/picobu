import { RGBA, type BoxRenderable, type MouseEvent } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { theme } from "@states/theme-state.ts";
import { Marquee } from "@tui/components/marquee.tsx";
import { For, createMemo, createSignal } from "solid-js";

export type DropdownOption = {
  name: string;
  value?: unknown;
};

export type DropdownProps = {
  options: DropdownOption[];
  /** Called with the picked option when the user selects one. */
  onSelect: (option: DropdownOption, index: number) => void;
  /** Initially selected index. Default 0. */
  selected?: number;
  /** Popup and label width in characters. Default 20. */
  maxWidth?: number;
  /** Maximum visible rows before the list scrolls. Default 6. */
  maxVisible?: number;
  /** Label while nothing is selected. Default "Select…". */
  placeholder?: string;
};

const POPUP_Z = 1000;
// The catcher sits BELOW the popup: rows own their own hover/pick events,
// and the catcher only closes the popup when a click lands outside it.
// (A catcher above the popup steals the hit grid: the native grid is
// rebuilt on every highlight change and moves stop flowing to it.)
const CATCHER_Z = POPUP_Z - 1;

/**
 * A button-like selector. Closed, it looks like a one-row button whose label
 * is a `Marquee` (long selections scroll when hovered). Clicking it opens a
 * placement-aware popup list as an absolute overlay: below the button
 * when it fits, above when it does not, clamped to stay inside the terminal.
 * The list shows at most `maxVisible` rows and scrolls, with a scrollbar
 * while options exceed the visible window; each row is a marquee, so long
 * option names scroll while highlighted.
 *
 * While open: `Up`/`Down` move the highlight, `Enter` selects, `Esc` closes,
 * and a click outside (caught by a transparent full-screen catcher below
 * the popup) closes too.
 */
export const Dropdown = (props: DropdownProps) => {
  const renderer = useRenderer();
  const maxWidth = () => props.maxWidth ?? 20;
  const maxVisible = () => props.maxVisible ?? 6;
  const visibleRows = () => Math.min(props.options.length, maxVisible());
  const hasOverflow = () => props.options.length > visibleRows();
  /** Popup width: border columns plus a scrollbar column when it overflows. */
  const popupWidth = () => maxWidth() + 2 + (hasOverflow() ? 1 : 0);

  const [hovered, setHovered] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(props.selected ?? 0);
  const [highlighted, setHighlighted] = createSignal(0);
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [popupPos, setPopupPos] = createSignal({ x: 0, y: 0 });

  let buttonRef: BoxRenderable | null = null;
  let popupRef: BoxRenderable | null = null;

  const labelText = () => props.options[selectedIndex()]?.name ?? props.placeholder ?? "Select…";
  const labelFg = () => (hovered() ? theme().selected(theme().accent) : theme().accent);
  const visibleOptions = createMemo(() =>
    props.options.slice(scrollOffset(), scrollOffset() + visibleRows()),
  );

  // Scrollbar geometry: a thumb of `thumbRows` cells inside a track of
  // `visibleRows` cells, positioned by the scroll offset.
  const thumbRows = () => Math.max(1, Math.round((visibleRows() / props.options.length) * visibleRows()));
  const thumbStart = () => {
    const travel = visibleRows() - thumbRows();
    return Math.round((scrollOffset() / (props.options.length - visibleRows())) * travel);
  };
  const scrollbarCells = createMemo(() => Array.from({ length: visibleRows() }, (_, i) => i));

  const closePopup = () => setOpen(false);

  const openPopup = () => {
    if (open()) return;
    const popupHeight = visibleRows() + 2;

    setHighlighted(Math.min(selectedIndex(), Math.max(0, props.options.length - 1)));
    setScrollOffset(
      Math.min(
        Math.max(0, highlighted() - visibleRows() + 1),
        Math.max(0, props.options.length - visibleRows()),
      ),
    );

    // Below the button when it fits, otherwise above; horizontally clamped
    // so the popup never leaves the terminal.
    let y = (buttonRef?.screenY ?? 0) + (buttonRef?.height ?? 1);
    if (y + popupHeight > renderer.height) {
      const above = (buttonRef?.screenY ?? 0) - popupHeight;
      y = above >= 0 ? above : Math.max(0, renderer.height - popupHeight);
    }
    const x = Math.min(Math.max(0, buttonRef?.screenX ?? 0), Math.max(0, renderer.width - popupWidth()));
    setPopupPos({ x, y });
    setOpen(true);
  };

  const move = (delta: number) => {
    const next = Math.min(Math.max(0, highlighted() + delta), props.options.length - 1);
    if (next === highlighted()) return;
    setHighlighted(next);
    // Keep the highlight inside the visible window.
    if (next < scrollOffset()) setScrollOffset(next);
    if (next >= scrollOffset() + visibleRows()) setScrollOffset(next - visibleRows() + 1);
  };

  /** Wheel scrolling: shift the visible window without moving the highlight. */
  const scrollBy = (delta: number) => {
    const next = Math.min(
      Math.max(0, scrollOffset() + delta),
      Math.max(0, props.options.length - visibleRows()),
    );
    if (next === scrollOffset()) return;
    setScrollOffset(next);
    // If the highlight scrolled out of view, pull it to the window edge.
    setHighlighted(Math.min(Math.max(highlighted(), next), next + visibleRows() - 1));
  };

  const pick = (index: number) => {
    const option = props.options[index];
    if (!option) return;
    setSelectedIndex(index);
    closePopup();
    props.onSelect(option, index);
  };

  useKeyboard((key) => {
    if (!open()) return false;
    if (key.name === "escape") {
      closePopup();
      return true;
    }
    if (key.name === "up") {
      move(-1);
      return true;
    }
    if (key.name === "down") {
      move(1);
      return true;
    }
    if (key.name === "return" || key.name === "enter") {
      pick(highlighted());
      return true;
    }
    return false;
  });

  return (
    <>
      <box
        ref={(r) => (buttonRef = r)}
        width={"auto"}
        alignSelf={"flex-start"}
        height={1}
        paddingX={2}
        flexDirection={"row"}
        alignItems={"center"}
        gap={1}
        backgroundColor={hovered() ? theme().accent : theme().backgroundElement}
        onMouseOver={() => setHovered(true)}
        onMouseOut={() => setHovered(false)}
        onMouseUp={() => openPopup()}
      >
        <Marquee content={labelText()} maxWidth={maxWidth()} scrolling={hovered()} fg={labelFg()} />
        <text fg={labelFg()}>▾</text>
      </box>
      {/* The popup is an in-place absolute overlay (the dialog.tsx pattern):
          it toggles via `visible`, and the fragment flattens into the
          parent's full-screen box, so `left`/`top` line up with the terminal
          coordinates used by `place()`. An always/conditionally mounted
          <Portal> never paints its content, and Solid's server-mode <Show>
          returns "" when closed, which the OpenTUI reconciler rejects as an
          orphan text node. Invisible renderables get display: none, so the
          catcher only owns the mouse while the popup is open. */}
      <box
        position={"absolute"}
        width={"100%"}
        height={"100%"}
        zIndex={CATCHER_Z}
        visible={open()}
        backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
        onMouseUp={() => closePopup()}
      />
      <box
        ref={(r) => (popupRef = r)}
        position={"absolute"}
        left={popupPos().x}
        top={popupPos().y}
        width={popupWidth()}
        height={visibleRows() + 2}
        borderStyle={"rounded"}
        focusable
        focused={open()}
        flexDirection={"row"}
        overflow={"hidden"}
        zIndex={POPUP_Z}
        visible={open()}
        borderColor={theme().border}
        focusedBorderColor={theme().borderActive}
        backgroundColor={theme().backgroundElement}
        onMouseOver={() => popupRef?.focus()}
        onMouseScroll={(event) => {
          const direction = event.scroll?.direction;
          if (direction === "down") scrollBy(1);
          else if (direction === "up") scrollBy(-1);
        }}
      >
        <box flexDirection={"column"}>
          <For each={visibleOptions()}>
            {(option, row) => {
              const optionIndex = () => scrollOffset() + row();
              const isHighlighted = () => optionIndex() === highlighted();
              return (
                <box
                  height={1}
                  paddingX={1}
                  backgroundColor={isHighlighted() ? theme().accent : theme().backgroundElement}
                  onMouseOver={() => setHighlighted(optionIndex())}
                  onMouseUp={(event) => {
                    if (event.button === 0) pick(optionIndex());
                  }}
                >
                  <Marquee
                    content={option.name}
                    maxWidth={maxWidth()}
                    fillWidth
                    scrolling={open() && isHighlighted()}
                    fg={isHighlighted() ? theme().selected(theme().accent) : theme().accent}
                  />
                </box>
              );
            }}
          </For>
        </box>
        <box flexDirection={"column"} visible={hasOverflow()}>
          <For each={scrollbarCells()}>
            {(cell) => (
              <box height={1}>
                <text
                  fg={
                    cell >= thumbStart() && cell < thumbStart() + thumbRows()
                      ? theme().accent
                      : theme().borderSubtle
                  }
                >
                  {cell >= thumbStart() && cell < thumbStart() + thumbRows() ? "█" : "│"}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
    </>
  );
};
