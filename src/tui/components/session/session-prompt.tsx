import { listCommands, listSkills } from '@agent/commands/index.ts'
import { SYSTEM_COMMANDS, toKebab, tokenizeCommandLine } from '@agent/commands/parse-command-line.ts'
import type { MouseEvent, TextareaRenderable } from '@opentui/core'
import { useKeyboard } from '@opentui/solid'
import { theme } from '@states/theme-state.ts'
import { icons } from '@tui/themes/icons.ts'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'

export type PromptMode = 'normal' | 'queue' | 'steer'

export type SessionPromptProps = {
  onPrompt: (text: string) => void
  streaming?: boolean
  waiting?: boolean
  mode: PromptMode
  queueDepth: number
  onCommandOpenChange?: (open: boolean) => void
  commandExitNonce?: number
}

type CommandItem = {
  label: string
  description: string
  kind: 'skill' | 'command'
}

const COMMAND_LIST_MAX = 8

export const SessionPrompt = (props: SessionPromptProps) => {
  let textareaRef: TextareaRenderable | null = null
  const [text, setText] = createSignal('')
  const [highlight, setHighlight] = createSignal(0)

  onMount(() => {
    textareaRef?.focus()
  })

  const queueMode = () => props.mode === 'queue' || props.streaming === true
  const waitingMode = () => props.waiting === true
  const steeringMode = () => props.mode === 'steer'
  const commandOpen = () => text().startsWith('/')

  createEffect(() => {
    props.onCommandOpenChange?.(commandOpen())
  })

  createEffect(() => {
    const nonce = props.commandExitNonce ?? 0
    if (nonce > 0 && commandOpen()) {
      const next = text().replace(/^\//, '')
      textareaRef?.setText(next)
      setText(next)
      setHighlight(0)
    }
  })

  const catalogItems = createMemo<CommandItem[]>(() => {
    try {
      const workflows = listCommands().filter((c) => c.kind === 'workflow')
      const skills = listSkills()
      return [
        ...SYSTEM_COMMANDS.map((c) => ({ label: `/${c.name}`, description: c.description, kind: 'command' as const })),
        ...workflows.map((w) => ({ label: `/${toKebab(w.name)}`, description: w.description || w.title, kind: 'command' as const })),
        ...skills.map((s) => ({ label: `/skill:${toKebab(s.name)}`, description: s.description, kind: 'skill' as const })),
      ]
    } catch {
      return SYSTEM_COMMANDS.map((c) => ({ label: `/${c.name}`, description: c.description, kind: 'command' as const }))
    }
  })

  const currentToken = (): string | null => {
    const value = text()
    if (!value.startsWith('/')) return null
    const parts = value.split(/\s+/)
    const last = parts[parts.length - 1] ?? ''
    return last.startsWith('/') ? last : null
  }

  const filteredItems = createMemo(() => {
    const token = currentToken()
    if (token === null) return []
    const query = token.slice(1).toLowerCase()
    const items = catalogItems().filter((item) => item.label.toLowerCase().includes(query))
    return items.slice(0, COMMAND_LIST_MAX)
  })

  createEffect(() => {
    void text()
    setHighlight(0)
  })

  const completeItem = (index: number) => {
    const item = filteredItems()[index]
    const token = currentToken()
    if (!item || token === null) return
    const value = text()
    const next = `${value.slice(0, value.length - token.length)}${item.label} `
    textareaRef?.setText(next)
    setText(next)
    textareaRef?.focus()
  }

  useKeyboard((key) => {
    if (!commandOpen()) return
    if (key.name === 'up') {
      key.preventDefault()
      key.stopPropagation()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (key.name === 'down') {
      key.preventDefault()
      key.stopPropagation()
      setHighlight((h) => Math.min(Math.max(0, filteredItems().length - 1), h + 1))
    } else if (key.name === 'tab') {
      key.preventDefault()
      key.stopPropagation()
      completeItem(highlight())
    }
  })

  const tokenPreview = createMemo(() => tokenizeCommandLine(text()))

  const tokenColor = (kind: string) => {
    if (kind === 'skill') return theme().accent
    if (kind === 'command') return theme().primary
    return theme().textMuted
  }

  const handleMouseDown = (e: MouseEvent) => {
    if (!textareaRef) return
    textareaRef.focus()
    const info = textareaRef.editorView.getLineInfo()
    const lineSources = info.lineSources
    const lineStartCols = info.lineStartCols
    const lineWidthCols = info.lineWidthCols
    if (!lineSources.length) return
    const localX = e.x - textareaRef.screenX
    const localY = e.y - textareaRef.screenY
    const visualRow = localY + textareaRef.scrollY
    const col = Math.max(0, localX)
    let sourceRow = 0
    let baseCol = 0
    let maxCol = 0
    let found = false
    for (let k = 0; k < lineSources.length; k++) {
      const start = lineStartCols[k] ?? 0
      const width = lineWidthCols[k] ?? 0
      if (visualRow === k) {
        sourceRow = lineSources[k] ?? 0
        baseCol = start
        maxCol = start + width
        found = true
        break
      }
    }
    if (!found) {
      const last = lineSources.length - 1
      sourceRow = lineSources[last] ?? 0
      baseCol = lineStartCols[last] ?? 0
      maxCol = (lineStartCols[last] ?? 0) + (lineWidthCols[last] ?? 0)
    }
    const targetCol = Math.min(Math.max(col, baseCol), Math.max(baseCol, maxCol))
    textareaRef.setCursor(sourceRow, targetCol)
  }

  const submit = () => {
    if (waitingMode()) return
    const value = textareaRef?.plainText ?? ''
    if (value.trim().length === 0) return
    if (value.trim() === '/') return
    props.onPrompt(value)
    textareaRef?.clear()
    setText('')
    setHighlight(0)
  }

  const queueSuffix = () => (props.queueDepth > 0 ? ` (${props.queueDepth})` : '')

  const borderColor = () => (waitingMode() ? theme().info : queueMode() ? theme().info : steeringMode() ? theme().error : commandOpen() ? theme().accent : theme().border)
  const titleColor = () => (waitingMode() ? theme().info : queueMode() ? theme().info : steeringMode() ? theme().error : commandOpen() ? theme().accent : theme().textMuted)
  const title = () => (waitingMode() ? ' Prompt - Waiting ' : queueMode() ? ` Prompt - Queue${queueSuffix()} ` : steeringMode() ? ' Prompt Steering ' : commandOpen() ? ' Command ' : ' Prompt ')
  const placeholder = () =>
    waitingMode() ? 'Answer the questions above…' : queueMode() ? 'Queued until the run finishes…' : steeringMode() ? 'Steer the running step…' : 'What are we going to build?'

  return (
    <box
      flexDirection="column"
      flexShrink={0}>
      <Show when={commandOpen()}>
        <box
          flexDirection="row"
          gap={0}
          flexShrink={0}
          paddingX={1}>
          <For each={tokenPreview()}>{(token) => <text fg={tokenColor(token.kind)}>{token.text}</text>}</For>
        </box>
        <Show when={filteredItems().length > 0}>
          <box
            flexDirection="column"
            flexShrink={0}
            border={['top']}
            borderColor={theme().border}>
            <For each={filteredItems()}>
              {(item, index) => (
                <box
                  flexDirection="row"
                  gap={1}
                  flexShrink={0}
                  paddingX={1}
                  backgroundColor={highlight() === index() ? theme().backgroundElement : undefined}
                  onMouseOver={() => setHighlight(index())}
                  onMouseUp={() => completeItem(index())}>
                  <text fg={item.kind === 'skill' ? theme().accent : theme().primary}>{item.label}</text>
                  <text fg={theme().textMuted}>{item.description}</text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </Show>
      <box
        flexDirection="row"
        gap={1}
        flexShrink={0}
        border={['top', 'bottom']}
        borderStyle={queueMode() || waitingMode() ? 'double' : steeringMode() ? 'heavy' : 'single'}
        borderColor={borderColor()}
        titleColor={titleColor()}
        title={title()}
        titleAlignment="right"
        onMouseDown={() => textareaRef?.focus()}>
        <text
          flexShrink={0}
          fg={waitingMode() ? theme().info : queueMode() ? theme().info : steeringMode() ? theme().error : commandOpen() ? theme().accent : theme().textMuted}>
          {icons.promptBig}
        </text>
        <box
          flexGrow={1}
          flexShrink={1}
          onMouseDown={handleMouseDown}>
          <textarea
            ref={(r) => (textareaRef = r)}
            id="prompt"
            maxHeight={10}
            placeholder={placeholder()}
            placeholderColor={theme().textMuted}
            cursorColor={theme().accent}
            textColor={theme().text}
            onSubmit={submit}
            onContentChange={() => setText(textareaRef?.plainText ?? '')}
            keyBindings={[
              { name: 'return', action: 'submit' },
              { name: 'return', shift: true, action: 'newline' },
            ]}
          />
        </box>
      </box>
    </box>
  )
}
