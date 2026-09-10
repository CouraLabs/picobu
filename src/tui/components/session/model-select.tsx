import { options } from '@config/options.ts'
import type { InputRenderable, ScrollBoxRenderable } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { fmtRate, fmtTokens, tableCell } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { icons } from '@tui/themes/icons.ts'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'

export type ModelSelectProps = {
  currentModelKey: string | undefined
  onSelect: (modelKey: string) => void
}

type ModelRow = {
  key: string
  provider: string
  model: string
  context: number
  inputRate: string
  outputRate: string
}

const LIST_HEIGHT = 14
const PROVIDER_WIDTH = 14

export const ModelSelect = (props: ModelSelectProps) => {
  let inputRef: InputRenderable | null = null
  let listRef: ScrollBoxRenderable | null = null
  const [query, setQuery] = createSignal('')
  const [highlight, setHighlight] = createSignal(0)
  const dims = useTerminalDimensions()
  const containerWidth = () => Math.max(32, Math.min(84, dims().width - 4))
  const showProvider = () => containerWidth() >= 58
  const showContext = () => containerWidth() >= 68
  const showRates = () => containerWidth() >= 76
  const modelWidth = () => {
    let used = 2 + 1 + 1 + 3
    if (showProvider()) used += PROVIDER_WIDTH + 1
    if (showContext()) used += 8 + 1
    if (showRates()) used += 14 + 1
    return Math.max(10, containerWidth() - used - 4)
  }

  onMount(() => inputRef?.focus())

  const models = createMemo<ModelRow[]>(() =>
    options.providers.flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.id}/${model.id}`,
        provider: provider.name,
        model: model.name ?? model.id,
        context: model.context,
        inputRate: fmtRate(model.billing?.input),
        outputRate: fmtRate(model.billing?.output),
      })),
    ),
  )

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return models()
    return models().filter((m) => `${m.provider} ${m.model} ${m.key}`.toLowerCase().includes(q))
  })

  createEffect(() => {
    const count = filtered().length
    if (highlight() >= count) setHighlight(Math.max(0, count - 1))
  })

  createEffect(() => {
    listRef?.scrollTo(Math.max(0, highlight() - 3))
  })

  const select = (index: number) => {
    const row = filtered()[index]
    if (!row) return
    props.onSelect(row.key)
  }

  useKeyboard((key) => {
    if (key.name === 'up') {
      key.preventDefault()
      key.stopPropagation()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (key.name === 'down') {
      key.preventDefault()
      key.stopPropagation()
      setHighlight((h) => Math.min(filtered().length - 1, h + 1))
    } else if (key.name === 'return') {
      key.preventDefault()
      key.stopPropagation()
      select(highlight())
    } else if (key.name === 'tab') {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  return (
    <box flexDirection="column" width={containerWidth()} paddingY={1} paddingX={2} gap={1}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme().textMuted} selectable={false}>
          {icons.search}
        </text>
        <input
          ref={(r) => (inputRef = r)}
          placeholder="Search models…"
          placeholderColor={theme().textMuted}
          textColor={theme().text}
          cursorColor={theme().accent}
          backgroundColor={theme().backgroundElement}
          flexGrow={1}
          onInput={(value) => {
            setQuery(value)
            setHighlight(0)
          }}
        />
      </box>
      <scrollbox ref={(r) => (listRef = r)} flexGrow={1} height={LIST_HEIGHT} scrollY overflow="hidden">
        <For each={filtered()}>
          {(row, index) => (
            <box
              flexDirection="row"
              gap={1}
              height={1}
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={highlight() === index() ? theme().textMuted : undefined}
              onMouseOver={() => setHighlight(index())}
              onMouseUp={() => select(index())}
              onMouseScroll={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}>
              <Show when={row.key === props.currentModelKey}>
                <text fg={theme().success} selectable={false}>
                  {icons.success}
                </text>
              </Show>
              <Show when={row.key !== props.currentModelKey}>
                <text fg={theme().backgroundPanel} selectable={false}>
                  {' '}
                </text>
              </Show>
              <text fg={row.key === props.currentModelKey ? theme().success : theme().text}>{tableCell(row.model, modelWidth())}</text>
              <Show when={showProvider()}>
                <text fg={theme().textMuted}>{tableCell(row.provider, PROVIDER_WIDTH)}</text>
              </Show>
              <Show when={showContext()}>
                <text fg={theme().textMuted}>{tableCell(fmtTokens(row.context), 8)}</text>
              </Show>
              <Show when={showRates()}>
                <text fg={theme().textMuted}>
                  {row.inputRate} → {row.outputRate}
                </text>
              </Show>
            </box>
          )}
        </For>
      </scrollbox>
      <text fg={theme().textMuted} flexShrink={0}>
        (type to search · ↑↓ navigate · enter select · esc close)
      </text>
    </box>
  )
}
