import {
  appendLayoutLine,
  cloneLayout,
  DEFAULT_SESSION_HEADER_LAYOUT,
  DEFAULT_SESSION_STATUS_LAYOUT,
  flattenLayoutLines,
  insertLayoutItem,
  moveLayoutItem,
  normalizeLayoutGap,
  removeLayoutItem,
  removeLayoutLine,
  SEPARATOR_ITEM,
  SESSION_HEADER_ITEM_LABELS,
  SESSION_STATUS_ITEM_LABELS,
  type SessionHeaderItem,
  type SessionLayoutConfig,
  type SessionStatusItem,
  setLayoutGaps,
  toLayoutConfig,
  unusedHeaderItems,
  unusedStatusItems,
} from '@config/session-layout.ts'
import { closeDialog, openDialog } from '@states/dialog.state.ts'
import { headerLayout, saveSessionLayout, statusLayout } from '@states/session-layout.state.ts'
import { theme } from '@states/theme-state.ts'
import { Button } from '@tui/components/button.tsx'
import { getProviderStatusExtras } from '@tui/components/session/status/provider-extras.ts'
import type { SessionStatusProps } from '@tui/components/session/status/session-status-data.ts'
import {
  createSessionStatusData,
  HeaderItemView,
  type HeaderRenderContext,
  headerItemHasContent,
  StatusItemView,
  type StatusRenderContext,
  statusItemHasContent,
} from '@tui/components/session/status/session-status-data.ts'
import { useAppKeyboard } from '@tui/hooks/keyboard-provider.tsx'
import { createMemo, createSignal, For, Show } from 'solid-js'

export type LayoutSurface = 'status' | 'header'

export interface OpenStatusLayoutDialogProps {
  surface: LayoutSurface
  getStatusProps: () => SessionStatusProps
  onModelOpen?: () => void
}

const PALETTE_ROW = -1
type AnyItem = SessionStatusItem | SessionHeaderItem
interface Carry {
  item: AnyItem
  from: { line: number; index: number }
  fromPalette: boolean
}
type Zone = 'lines' | 'gaps' | 'palette' | 'buttons'

const StatusLayoutDialog = (props: { surface: LayoutSurface; getStatusProps: () => SessionStatusProps; onModelOpen?: () => void }) => {
  const statusProps = () => props.getStatusProps()
  const data = createSessionStatusData(statusProps())
  const ctx = () => {
    if (props.surface === 'status') {
      const statusCtx: StatusRenderContext = { status: statusProps(), data, providerExtras: () => getProviderStatusExtras(statusProps()), onModelOpen: props.onModelOpen, selectable: false }
      return statusCtx
    }
    const headerCtx: HeaderRenderContext = { status: statusProps(), data, selectable: false }
    return headerCtx
  }
  const isVisible = (item: AnyItem): boolean => {
    if (item === SEPARATOR_ITEM) return true
    if (props.surface === 'status') return statusItemHasContent(item as SessionStatusItem, ctx() as StatusRenderContext)
    return headerItemHasContent(item as SessionHeaderItem)
  }

  const initialDraft = (): SessionLayoutConfig<AnyItem> => {
    if (props.surface === 'status') return cloneLayout(statusLayout() as never) as SessionLayoutConfig<AnyItem>
    return toLayoutConfig(flattenLayoutLines(headerLayout() as never) as Array<AnyItem>)
  }
  const [draft, setDraft] = createSignal<SessionLayoutConfig<AnyItem>>(initialDraft())
  const [cursor, setCursor] = createSignal<{ line: number; index: number }>({ line: 0, index: 0 })
  const [carrying, setCarrying] = createSignal<Carry | undefined>(undefined)
  const [zone, setZone] = createSignal<Zone>('lines')
  const [buttonIndex, setButtonIndex] = createSignal(0)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)

  const isHeader = () => props.surface === 'header'
  const lines = () => draft().lines

  const available = createMemo<Array<AnyItem>>(() => (isHeader() ? (unusedHeaderItems(draft() as never) as Array<AnyItem>) : (unusedStatusItems(draft() as never) as Array<AnyItem>)))
  const paletteItems = createMemo<Array<AnyItem | typeof SEPARATOR_ITEM>>(() => [...available(), SEPARATOR_ITEM])

  const defaultLayout = (): SessionLayoutConfig<AnyItem> => {
    if (props.surface === 'status') return cloneLayout(DEFAULT_SESSION_STATUS_LAYOUT as never) as SessionLayoutConfig<AnyItem>
    return toLayoutConfig(flattenLayoutLines(DEFAULT_SESSION_HEADER_LAYOUT) as Array<AnyItem>)
  }
  const resetDraft = () => {
    setDraft(defaultLayout())
    setCursor({ line: 0, index: 0 })
    setCarrying(undefined)
    setZone('lines')
  }

  const buttons = createMemo<Array<{ label: string; action: () => void | Promise<void> }>>(() => {
    const row: Array<{ label: string; action: () => void | Promise<void> }> = []
    if (!isHeader())
      row.push({
        label: '+ Line',
        action: () => {
          setDraft(appendLayoutLine<AnyItem>(draft()))
        },
      })
    row.push({ label: 'Reset', action: resetDraft })
    row.push({ label: 'Cancel', action: closeDialog })
    row.push({ label: saving() ? 'Saving…' : 'Save', action: () => save() })
    return row
  })

  const renderedEntries = (lineIndex: number): Array<{ item: AnyItem; index: number }> => {
    const line = lines()[lineIndex] ?? []
    const result: Array<{ item: AnyItem; index: number }> = []
    for (let i = 0; i < line.length; i += 1) {
      const item = line[i] as AnyItem
      if (item === undefined || !isVisible(item)) continue
      if (item === SEPARATOR_ITEM) {
        const previous = result[result.length - 1]
        if (!previous || previous.item === SEPARATOR_ITEM) continue
        let hasAfter = false
        for (let j = i + 1; j < line.length; j += 1) {
          const upcoming = line[j] as AnyItem
          if (upcoming !== undefined && upcoming !== SEPARATOR_ITEM && isVisible(upcoming)) {
            hasAfter = true
            break
          }
        }
        if (!hasAfter) continue
      }
      result.push({ item, index: i })
    }
    return result
  }

  const snapToRendered = (lineIndex: number, desiredIndex: number): number => {
    const rendered = renderedEntries(lineIndex)
    if (rendered.length === 0) return 0
    let best = rendered[0]
    if (best === undefined) return 0
    for (const entry of rendered) {
      if (Math.abs(entry.index - desiredIndex) < Math.abs(best.index - desiredIndex)) best = entry
    }
    return best.index
  }

  const clampCursor = (next: { line: number; index: number }) => {
    if (next.line === PALETTE_ROW) return { line: PALETTE_ROW, index: Math.min(Math.max(next.index, 0), Math.max(0, paletteItems().length - 1)) }
    const lineCount = lines().length
    const line = Math.min(Math.max(next.line, 0), Math.max(0, lineCount - 1))
    const lineItems = lines()[line] ?? []
    return { line, index: snapToRendered(line, Math.min(Math.max(next.index, 0), Math.max(0, lineItems.length - 1))) }
  }

  const itemAt = (at: { line: number; index: number }): AnyItem | undefined => {
    if (at.line === PALETTE_ROW) return paletteItems()[at.index]
    return lines()[at.line]?.[at.index]
  }

  const itemLabel = (item: AnyItem): string => (isHeader() ? SESSION_HEADER_ITEM_LABELS[item as SessionHeaderItem] : SESSION_STATUS_ITEM_LABELS[item as SessionStatusItem])

  const drop = () => {
    const carried = carrying()
    if (!carried) return
    const at = cursor()
    if (at.line === PALETTE_ROW) {
      if (!carried.fromPalette) {
        const result = removeLayoutItem<AnyItem>(draft(), carried.from)
        setDraft(result.layout)
      }
      setCarrying(undefined)
      return
    }
    if (!carried.fromPalette && carried.from.line === at.line && carried.from.index === at.index) {
      setCarrying(undefined)
      return
    }
    if (carried.fromPalette) {
      setDraft(insertLayoutItem<AnyItem>(draft(), at, carried.item))
      setCarrying(undefined)
      setCursor(clampCursor(at))
      return
    }
    setDraft(moveLayoutItem<AnyItem>(draft(), carried.from, at))
    setCarrying(undefined)
    setCursor(clampCursor(at))
  }

  const pickUp = () => {
    if (carrying()) {
      drop()
      return
    }
    const at = cursor()
    const item = itemAt(at)
    if (item === undefined) return
    setCarrying({ item, from: { ...at }, fromPalette: at.line === PALETTE_ROW })
  }

  const removeAtCursor = () => {
    const at = cursor()
    if (at.line === PALETTE_ROW || carrying()) return
    const result = removeLayoutItem<AnyItem>(draft(), at)
    setDraft(result.layout)
    setCursor(clampCursor(at))
  }

  const save = async () => {
    setError(undefined)
    setSaving(true)
    try {
      if (props.surface === 'status') await saveSessionLayout({ status: draft() as never })
      else await saveSessionLayout({ header: { ...draft(), lines: [flattenLayoutLines(draft() as never)] } as never })
      closeDialog()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const moveVertical = (delta: number) => {
    if (zone() === 'palette') {
      setCursor((c) => clampCursor({ line: PALETTE_ROW, index: c.index + delta }))
      return
    }
    if (zone() === 'gaps') {
      setDraft(setLayoutGaps<AnyItem>(draft(), { rowGap: normalizeLayoutGap(draft().rowGap + delta, draft().rowGap) }))
      return
    }
    if (zone() === 'buttons') {
      setButtonIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(0, buttons().length - 1)))
      return
    }
    const current = cursor()
    if (current.line === PALETTE_ROW && delta > 0) {
      setZone('lines')
      setCursor({ line: 0, index: 0 })
      return
    }
    if (current.line === 0 && delta < 0) {
      setZone('palette')
      setCursor({ line: PALETTE_ROW, index: 0 })
      return
    }
    setCursor(clampCursor({ line: current.line + delta, index: 0 }))
  }

  const moveHorizontal = (delta: number) => {
    if (zone() === 'gaps') {
      setDraft(setLayoutGaps<AnyItem>(draft(), { columnGap: normalizeLayoutGap(draft().columnGap + delta, draft().columnGap) }))
      return
    }
    if (zone() === 'palette') {
      moveVertical(delta)
      return
    }
    if (zone() === 'buttons') {
      setButtonIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(0, buttons().length - 1)))
      return
    }
    const current = cursor()
    if (current.line === PALETTE_ROW) {
      moveVertical(delta)
      return
    }
    setCursor(clampCursor({ line: current.line, index: current.index + delta }))
  }

  const cycleZone = (delta: number) => {
    const zones: Array<Zone> = isHeader() ? ['lines', 'palette', 'buttons'] : ['lines', 'gaps', 'palette', 'buttons']
    const index = zones.indexOf(zone())
    const next = zones[(index + delta + zones.length) % zones.length] ?? 'lines'
    setZone(next)
    if (next === 'palette') setCursor({ line: PALETTE_ROW, index: 0 })
    if (next === 'lines') setCursor(clampCursor({ line: Math.max(0, cursor().line), index: cursor().index }))
  }

  useAppKeyboard(
    (key) => {
      switch (key.name) {
        case 'up':
          key.preventDefault()
          key.stopPropagation()
          moveVertical(-1)
          break
        case 'down':
          key.preventDefault()
          key.stopPropagation()
          moveVertical(1)
          break
        case 'left':
          key.preventDefault()
          key.stopPropagation()
          moveHorizontal(-1)
          break
        case 'right':
          key.preventDefault()
          key.stopPropagation()
          moveHorizontal(1)
          break
        case 'tab':
          key.preventDefault()
          key.stopPropagation()
          cycleZone(key.shift ? -1 : 1)
          break
        case 'return':
          key.preventDefault()
          key.stopPropagation()
          if (zone() === 'buttons') {
            const button = buttons()[buttonIndex()]
            if (button) void button.action()
          } else {
            pickUp()
          }
          break
        case 'backspace':
        case 'delete':
          key.preventDefault()
          key.stopPropagation()
          removeAtCursor()
          break
        default:
          break
      }
    },
    { release: false },
  )

  const boxBackground = (isCursor: boolean, isCarried: boolean) => {
    if (isCarried) return theme().primary
    if (isCursor) return theme().backgroundElement
    return undefined
  }

  const carryingLabel = () => {
    const carried = carrying()
    if (!carried) return undefined
    return `Carrying: ${itemLabel(carried.item)} — move the cursor and press enter to drop${carried.fromPalette ? '' : ', enter on Unused to park it'}`
  }

  return (
    <box flexDirection="column" width={96} paddingX={2} paddingY={1} gap={1}>
      <box border={['bottom']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().text}>{isHeader() ? 'Session header layout' : 'Session status layout'}</text>
      </box>
      <box flexDirection="column" flexShrink={0} rowGap={draft().rowGap}>
        <For each={lines()}>
          {(line, lineIndex) => {
            const rendered = (): Array<{ item: AnyItem; index: number }> => renderedEntries(lineIndex())
            return (
              <box flexDirection="row" columnGap={draft().columnGap} flexShrink={0} flexWrap="wrap" minHeight={1}>
                <For each={rendered()}>
                  {(entry) => {
                    const location = () => ({ line: lineIndex(), index: entry.index })
                    const isCursor = () => zone() === 'lines' && cursor().line === location().line && cursor().index === location().index
                    const isCarried = () => {
                      const carried = carrying()
                      return Boolean(carried && !carried.fromPalette && carried.from.line === location().line && carried.from.index === location().index)
                    }
                    return (
                      <box flexShrink={0} backgroundColor={boxBackground(isCursor(), isCarried())}>
                        <Show when={props.surface === 'status'} fallback={<HeaderItemView item={entry.item as SessionHeaderItem} ctx={ctx() as HeaderRenderContext} />}>
                          <StatusItemView item={entry.item as SessionStatusItem} ctx={ctx() as StatusRenderContext} />
                        </Show>
                      </box>
                    )
                  }}
                </For>
                <Show when={line.length === 0}>
                  <text fg={theme().textMuted} selectable={false}>
                    (empty line)
                  </text>
                </Show>
                <Show when={!isHeader()}>
                  <box flexShrink={0} marginLeft={1}>
                    <Button label="✕ Line" onClick={() => setDraft(removeLayoutLine<AnyItem>(draft(), lineIndex()))} />
                  </box>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={lines().length === 0}>
          <text fg={theme().textMuted} selectable={false}>
            (no lines — add items from Unused or press + Line)
          </text>
        </Show>
      </box>
      <Show when={!isHeader()}>
        <box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
          <text fg={theme().textMuted} selectable={false}>
            {`gap column ${draft().columnGap} row ${draft().rowGap}`}
          </text>
          <Button label="− Column" onClick={() => setDraft(setLayoutGaps<AnyItem>(draft(), { columnGap: draft().columnGap - 1 }))} />
          <Button label="+ Column" onClick={() => setDraft(setLayoutGaps<AnyItem>(draft(), { columnGap: draft().columnGap + 1 }))} />
          <Button label="− Row" onClick={() => setDraft(setLayoutGaps<AnyItem>(draft(), { rowGap: draft().rowGap - 1 }))} />
          <Button label="+ Row" onClick={() => setDraft(setLayoutGaps<AnyItem>(draft(), { rowGap: draft().rowGap + 1 }))} />
        </box>
      </Show>
      <box border={['top']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().textMuted} selectable={false}>
          Unused items
        </text>
      </box>
      <box flexDirection="row" columnGap={1} flexShrink={0} flexWrap="wrap">
        <For each={paletteItems()}>
          {(item, index) => {
            const isCursor = () => zone() === 'palette' && cursor().line === PALETTE_ROW && cursor().index === index()
            return (
              <box flexShrink={0} backgroundColor={boxBackground(isCursor(), false)}>
                <text fg={theme().text} selectable={false}>
                  {`[${itemLabel(item as AnyItem)}]`}
                </text>
              </box>
            )
          }}
        </For>
        <Show when={paletteItems().length === 0}>
          <text fg={theme().textMuted} selectable={false}>
            (all items in use)
          </text>
        </Show>
      </box>
      <Show when={error()}>
        <text fg={theme().error}>{error()}</text>
      </Show>
      <Show when={carryingLabel()}>
        <text fg={theme().primary} selectable={false}>
          {carryingLabel()}
        </text>
      </Show>
      <box flexDirection="row" gap={1} justifyContent="flex-end" flexShrink={0}>
        <For each={buttons()}>{(button, index) => <Button label={`${zone() === 'buttons' && buttonIndex() === index() ? '▸ ' : ''}${button.label}`} onClick={() => void button.action()} />}</For>
      </box>
      <box border={['top']} borderColor={theme().border} flexShrink={0}>
        <text fg={theme().textMuted} selectable={false}>
          (arrows move · enter pick up / drop · del moves to Unused · esc close)
        </text>
      </box>
    </box>
  )
}

export const openStatusLayoutDialog = (config: OpenStatusLayoutDialogProps) => {
  openDialog(() => <StatusLayoutDialog surface={config.surface} getStatusProps={config.getStatusProps} onModelOpen={config.onModelOpen} />)
}
