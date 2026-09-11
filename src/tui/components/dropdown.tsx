import { type BoxRenderable, RGBA } from '@opentui/core'
import { useKeyboard, useRenderer } from '@opentui/solid'
import { closeDropdown, dropdownState, openDropdown } from '@states/dropdown.state.ts'
import { theme } from '@states/theme-state.ts'
import { Marquee } from '@tui/components/marquee.tsx'
import { createComputed, createMemo, createSignal, For, mergeProps, on } from 'solid-js'
export interface DropdownOption {
  name: string
  value?: unknown
}
export interface DropdownProps {
  options: Array<DropdownOption>
  onSelect: (option: DropdownOption, index: number) => void
  selected?: number
  maxWidth?: number
  maxVisible?: number
  placeholder?: string
}
const POPUP_Z = 1000
const CATCHER_Z = POPUP_Z - 1
export const Dropdown = (props: DropdownProps) => {
  const merged = mergeProps({ selected: 0, maxWidth: 20, maxVisible: 6 }, props)
  const maxWidth = () => merged.maxWidth
  const [hovered, setHovered] = createSignal(false)
  const [selectedIndex, setSelectedIndex] = createSignal(merged.selected)
  createComputed(
    on(
      () => merged.selected,
      (v) => setSelectedIndex(v),
    ),
  )
  let buttonRef: BoxRenderable | null = null
  const labelText = () => merged.options[selectedIndex()]?.name ?? merged.placeholder ?? 'Select…'
  const background = () => (hovered() ? theme().accent : theme().backgroundElement)
  const labelFg = () => (hovered() ? theme().selected(background()) : theme().accent)
  const openPopup = () => {
    const btn = buttonRef
    openDropdown({
      options: merged.options,
      onSelect: (option, index) => {
        setSelectedIndex(index)
        merged.onSelect(option, index)
      },
      placement: {
        x: btn?.screenX ?? 0,
        y: btn?.screenY ?? 0,
        width: btn?.width ?? 1,
        height: btn?.height ?? 1,
      },
      maxWidth: maxWidth(),
      maxVisible: merged.maxVisible,
      selected: selectedIndex(),
    })
  }
  return (
    <box
      ref={(r) => (buttonRef = r)}
      width={'auto'}
      alignSelf={'flex-start'}
      height={1}
      paddingX={1}
      flexDirection={'row'}
      alignItems={'center'}
      gap={1}
      backgroundColor={background()}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => openPopup()}>
      <Marquee content={labelText()} maxWidth={maxWidth()} scrolling={hovered()} fg={labelFg()} />
      <text fg={labelFg()}>▾</text>
    </box>
  )
}
export const DropdownLayer = () => {
  const renderer = useRenderer()
  const [highlighted, setHighlighted] = createSignal(0)
  const [scrollOffset, setScrollOffset] = createSignal(0)
  let popupRef: BoxRenderable | null = null
  const state = createMemo(() => dropdownState())
  const open = () => state() !== null
  const options = () => state()?.options ?? []
  const maxVisible = () => state()?.maxVisible ?? 6
  const maxWidth = () => state()?.maxWidth ?? 20
  const visibleRows = () => Math.min(options().length, maxVisible())
  const hasOverflow = () => options().length > visibleRows()
  const popupWidth = () => maxWidth() + 2 + (hasOverflow() ? 1 : 0)
  const popupHeight = () => visibleRows() + 2
  const visibleOptions = createMemo(() => options().slice(scrollOffset(), scrollOffset() + visibleRows()))
  const scrollbarCells = createMemo(() => Array.from({ length: visibleRows() }, (_, i) => i))
  const thumbRows = () => Math.max(1, Math.round((visibleRows() / options().length) * visibleRows()))
  const thumbStart = () => {
    const travel = visibleRows() - thumbRows()
    return Math.round((scrollOffset() / Math.max(1, options().length - visibleRows())) * travel)
  }
  const popupPos = () => {
    const s = state()
    if (!s) return { x: 0, y: 0 }
    let y = s.placement.y + s.placement.height
    if (y + popupHeight() > renderer.height) {
      const above = s.placement.y - popupHeight()
      y = above >= 0 ? above : Math.max(0, renderer.height - popupHeight())
    }
    const x = Math.min(Math.max(0, s.placement.x), Math.max(0, renderer.width - popupWidth()))
    return { x, y }
  }
  createComputed(
    on(state, (s) => {
      if (!s) return
      setHighlighted(Math.min(s.selected, Math.max(0, s.options.length - 1)))
      setScrollOffset(Math.min(Math.max(0, s.selected - visibleRows() + 1), Math.max(0, s.options.length - visibleRows())))
    }),
  )
  const move = (delta: number) => {
    const next = Math.min(Math.max(0, highlighted() + delta), options().length - 1)
    if (next === highlighted()) return
    setHighlighted(next)
    if (next < scrollOffset()) setScrollOffset(next)
    if (next >= scrollOffset() + visibleRows()) setScrollOffset(next - visibleRows() + 1)
  }
  const scrollBy = (delta: number) => {
    const next = Math.min(Math.max(0, scrollOffset() + delta), Math.max(0, options().length - visibleRows()))
    if (next === scrollOffset()) return
    setScrollOffset(next)
    setHighlighted(Math.min(Math.max(highlighted(), next), next + visibleRows() - 1))
  }
  const pick = (index: number) => {
    const s = state()
    const option = s?.options[index]
    if (!s || !option) return
    closeDropdown()
    s.onSelect(option, index)
  }
  useKeyboard((key) => {
    if (!open()) return false
    if (popupRef && !popupRef.focused && !popupRef.hasFocusedDescendant) return false
    if (key.name === 'escape') {
      closeDropdown()
      return true
    }
    if (key.name === 'up') {
      move(-1)
      return true
    }
    if (key.name === 'down') {
      move(1)
      return true
    }
    if (key.name === 'return' || key.name === 'enter') {
      pick(highlighted())
      return true
    }
    return false
  })
  return (
    <>
      <box
        position={'absolute'}
        left={0}
        top={0}
        width={renderer.width}
        height={renderer.height}
        zIndex={CATCHER_Z}
        visible={open()}
        backgroundColor={RGBA.fromValues(0, 0, 0, 0)}
        onMouseUp={() => closeDropdown()}
      />
      <box
        position={'absolute'}
        left={popupPos().x}
        top={popupPos().y}
        width={popupWidth()}
        height={popupHeight()}
        borderStyle={'rounded'}
        focusable
        focused={open()}
        flexDirection={'row'}
        overflow={'hidden'}
        zIndex={POPUP_Z}
        visible={open()}
        borderColor={theme().border}
        focusedBorderColor={theme().borderActive}
        backgroundColor={theme().backgroundElement}
        ref={(r) => (popupRef = r)}
        onMouseScroll={(event) => {
          const direction = event.scroll?.direction
          if (direction === 'down') scrollBy(1)
          else if (direction === 'up') scrollBy(-1)
        }}>
        <box flexDirection={'column'}>
          <For each={visibleOptions()}>
            {(option, row) => {
              const optionIndex = () => scrollOffset() + row()
              const isHighlighted = () => optionIndex() === highlighted()
              return (
                <box
                  height={1}
                  paddingX={1}
                  backgroundColor={isHighlighted() ? theme().accent : theme().backgroundElement}
                  onMouseOver={() => setHighlighted(optionIndex())}
                  onMouseUp={(event) => {
                    if (event.button === 0) pick(optionIndex())
                  }}>
                  <Marquee content={option.name} maxWidth={maxWidth()} fillWidth scrolling={open() && isHighlighted()} fg={isHighlighted() ? theme().selected(theme().accent) : theme().accent} />
                </box>
              )
            }}
          </For>
        </box>
        <box flexDirection={'column'} visible={hasOverflow()}>
          <For each={scrollbarCells()}>
            {(cell) => (
              <box height={1}>
                <text fg={cell >= thumbStart() && cell < thumbStart() + thumbRows() ? theme().accent : theme().borderSubtle}>
                  {cell >= thumbStart() && cell < thumbStart() + thumbRows() ? '█' : '│'}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
    </>
  )
}
