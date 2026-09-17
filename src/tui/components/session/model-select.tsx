import { listProviders } from '@auth/oauth-providers.ts'
import type { InputRenderable, ScrollBoxRenderable } from '@opentui/core'
import { theme } from '@states/theme-state.ts'
import { useAppKeyboard } from '@tui/hooks/keyboard-provider.tsx'
import { useTerminalDims } from '@tui/hooks/terminal-dims.tsx'
import { icons } from '@tui/themes/icons.ts'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'

export interface ModelSelectProps {
  currentModelKey: string | undefined
  onSelect: (modelKey: string) => void
}

interface ModelRow {
  key: string
  provider: string
  model: string
  input: string
  output: string
  cacheRead: string
  cacheWrite: string
}

interface GroupEntry {
  row: ModelRow
  flatIndex: number
}

interface ProviderGroup {
  provider: string
  entries: Array<GroupEntry>
}

const fmtPerM = (rate: number | undefined): string => `$${(rate ?? 0).toFixed(2)}/M`

export const ModelSelect = (props: ModelSelectProps) => {
  let inputRef: InputRenderable | null = null
  let listRef: ScrollBoxRenderable | null = null
  const [query, setQuery] = createSignal('')
  const [highlight, setHighlight] = createSignal(0)
  const dims = useTerminalDims()
  const dialogWidth = () => Math.max(20, Math.min(Math.floor(dims().width * 0.7), dims().width - 2))
  const dialogHeight = () => Math.max(10, Math.min(Math.floor(dims().height * 0.9), dims().height - 2))

  onMount(() => inputRef?.focus())

  const models = createMemo<Array<ModelRow>>(() =>
    listProviders().flatMap((provider) =>
      [...provider.models]
        .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, { sensitivity: 'base' }))
        .map((model) => ({
          key: `${provider.id}/${model.id}`,
          provider: provider.name,
          model: model.name ?? model.id,
          input: fmtPerM(model.billing?.input),
          output: fmtPerM(model.billing?.output),
          cacheRead: fmtPerM(model.billing?.cacheRead),
          cacheWrite: fmtPerM(model.billing?.cacheWrite),
        })),
    ),
  )

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase()
    if (!q) return models()
    return models().filter((m) => `${m.provider} ${m.model} ${m.key}`.toLowerCase().includes(q))
  })

  const grouped = createMemo<Array<ProviderGroup>>(() => {
    const groups: Array<ProviderGroup> = []
    const byProvider = new Map<string, ProviderGroup>()
    filtered().forEach((row, flatIndex) => {
      let group = byProvider.get(row.provider)
      if (!group) {
        group = { provider: row.provider, entries: [] }
        byProvider.set(row.provider, group)
        groups.push(group)
      }
      group.entries.push({ row, flatIndex })
    })
    return groups
  })

  const clampedHighlight = createMemo(() => Math.min(highlight(), Math.max(0, filtered().length - 1)))

  const scrollTarget = createMemo(() => {
    const current = clampedHighlight()
    let extraBefore = 0
    for (const group of grouped()) {
      const first = group.entries[0]?.flatIndex
      if (first !== undefined && first <= current) extraBefore += 2
      else break
    }
    return current + extraBefore
  })

  createEffect(() => {
    listRef?.scrollTo(Math.max(0, scrollTarget() - 3))
  })

  const select = (index: number) => {
    const row = filtered()[index]
    if (!row) return
    props.onSelect(row.key)
  }

  useAppKeyboard((key) => {
    if (key.name === 'up') {
      key.preventDefault()
      key.stopPropagation()
      setHighlight(Math.max(0, clampedHighlight() - 1))
    } else if (key.name === 'down') {
      key.preventDefault()
      key.stopPropagation()
      setHighlight(Math.min(Math.max(0, filtered().length - 1), clampedHighlight() + 1))
    } else if (key.name === 'return') {
      key.preventDefault()
      key.stopPropagation()
      select(clampedHighlight())
    } else if (key.name === 'tab') {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  return (
    <box flexDirection="column" width={dialogWidth()} height={dialogHeight()} paddingY={1} paddingX={2} gap={1}>
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
      <scrollbox ref={(r) => (listRef = r)} flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} scrollY overflow="hidden">
        <For each={grouped()}>
          {(group) => (
            <box flexDirection="column" flexShrink={0}>
              <box marginTop={1} flexShrink={0}>
                <text fg={theme().textMuted} selectable={false}>
                  {group.provider}
                </text>
              </box>
              <For each={group.entries}>
                {(entry) => (
                  <box flexDirection="row" gap={1} height={1} flexShrink={0} paddingLeft={1} paddingRight={1} backgroundColor={clampedHighlight() === entry.flatIndex ? theme().textMuted : undefined}>
                    <Show
                      when={entry.row.key === props.currentModelKey}
                      fallback={
                        <text fg={theme().backgroundPanel} selectable={false}>
                          {' '}
                        </text>
                      }>
                      <text fg={theme().success} selectable={false}>
                        {icons.success}
                      </text>
                    </Show>
                    <text fg={entry.row.key === props.currentModelKey ? theme().success : theme().text} selectable={false}>
                      {entry.row.model}
                    </text>
                    <text fg={theme().textMuted} selectable={false}>
                      {`· I/O ${entry.row.input} ${entry.row.output} · R/W ${entry.row.cacheRead} ${entry.row.cacheWrite}`}
                    </text>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
        <Show when={filtered().length === 0}>
          <text fg={theme().textMuted} selectable={false}>
            (no matches)
          </text>
        </Show>
      </scrollbox>
      <text fg={theme().textMuted} flexShrink={0} selectable={false}>
        (type to search · ↑↓ navigate · enter select · esc close)
      </text>
    </box>
  )
}
