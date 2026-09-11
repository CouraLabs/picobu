import { listCommands, listSkills } from '@agent/commands/index.ts'
import { SYSTEM_COMMANDS, toKebab, tokenizeCommandLine } from '@agent/commands/parse-command-line.ts'
import type { CommandKind } from '@agent/commands/types.ts'
import { addPrompt, clearDraft, loadDraft, loadPromptHistory, saveDraft } from '@agent/sessions/prompt-history.ts'
import type { MouseEvent, ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import { useKeyboard, useTerminalDimensions } from '@opentui/solid'
import { catalogVersion } from '@states/catalog-state.ts'
import { theme } from '@states/theme-state.ts'
import { pushToast } from '@states/toast.state.ts'
import { getClipboardService } from '@tui/hooks/clipboard.state.ts'
import { icons } from '@tui/themes/icons.ts'
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'

export type PromptMode = 'normal' | 'steer'

export type AttachedFile = {
  id: string
  seq: number
  mediaType: string
  filename: string
  size: number
  bytes: Uint8Array
}

export type PromptPayload = {
  text: string
  files: AttachedFile[]
}

export type EditRequest = {
  text: string
  files: AttachedFile[]
  nonce: number
}

export type SessionPromptProps = {
  onPrompt: (payload: PromptPayload) => void
  streaming?: boolean
  waiting?: boolean
  mode: PromptMode
  queueDepth: number
  onCommandOpenChange?: (open: boolean) => void
  commandExitNonce?: number
  editRequest?: EditRequest
  historyProjectKey: string
}

type CommandItem = {
  label: string
  description: string
  kind: CommandKind
}

const DRAFT_DEBOUNCE_MS = 450
const MAX_FILES = 5
const MAX_FILE_BYTES = 10 * 1024 * 1024

const fmtSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export const fileToken = (seq: number, mediaType: string, size: number): string => `[${seq} ${mediaType} ${fmtSize(size)}]`

const tokenPattern = /\[(\d+) ([^\s\]]+) ([^\]]+)\]/g

export const parseTokenSeqs = (text: string): number[] => {
  const out: number[] = []
  for (const match of text.matchAll(tokenPattern)) out.push(Number(match[1]))
  return out
}

export const retainReferencedFiles = (staged: AttachedFile[], text: string): AttachedFile[] => {
  const seqs = new Set(parseTokenSeqs(text))
  return staged.filter((f) => seqs.has(f.seq))
}

export const nextFileSeq = (staged: AttachedFile[]): number => {
  const used = new Set(staged.map((f) => f.seq))
  let seq = 1
  while (used.has(seq)) seq += 1
  return seq
}

export const SessionPrompt = (props: SessionPromptProps) => {
  let textareaRef: TextareaRenderable | null = null
  const [text, setText] = createSignal('')
  const [highlight, setHighlight] = createSignal(0)
  const [history, setHistory] = createSignal<string[]>([])
  const [navIndex, setNavIndex] = createSignal(-1)
  const [files, setFiles] = createSignal<AttachedFile[]>([])
  let draftStash = ''
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let prevKey = ''
  let lastEditNonce = 0

  onMount(() => {
    textareaRef?.focus()
    prevKey = props.historyProjectKey
    setHistory(loadPromptHistory(prevKey))
    const draft = loadDraft(prevKey)
    if (draft && (textareaRef?.plainText ?? '').length === 0) {
      textareaRef?.setText(draft)
      setText(draft)
    }
  })

  onCleanup(() => {
    if (draftTimer !== undefined) clearTimeout(draftTimer)
  })

  createEffect(() => {
    const key = props.historyProjectKey
    if (!key || key === prevKey) return
    const current = textareaRef?.plainText ?? ''
    if (current.trim().length > 0 && navIndex() === -1) saveDraft(current, prevKey)
    prevKey = key
    setNavIndex(-1)
    draftStash = ''
    setHistory(loadPromptHistory(key))
    setFiles([])
    const draft = loadDraft(key)
    textareaRef?.setText(draft)
    setText(draft)
  })

  const scheduleDraft = () => {
    if (draftTimer !== undefined) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      if (navIndex() !== -1) return
      saveDraft(textareaRef?.plainText ?? '', props.historyProjectKey)
    }, DRAFT_DEBOUNCE_MS)
  }

  const pruneStaleFiles = (next: string) => {
    const staged = files()
    if (staged.length === 0) return
    const kept = retainReferencedFiles(staged, next)
    if (kept.length !== staged.length) setFiles(kept)
  }

  const queueMode = () => props.streaming === true
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

  createEffect(() => {
    const request = props.editRequest
    if (!request || request.nonce <= 0 || request.nonce === lastEditNonce) return
    lastEditNonce = request.nonce
    const current = textareaRef?.plainText ?? ''
    const currentFiles = files()
    if (current.trim().length === 0) {
      textareaRef?.setText(request.text)
      setText(request.text)
      setFiles(request.files)
    } else if (request.text.trim().length === 0) {
      return
    } else {
      textareaRef?.setText(`${current}\n${request.text}`)
      setText(`${current}\n${request.text}`)
      setFiles([...currentFiles, ...request.files])
    }
    setNavIndex(-1)
    textareaRef?.focus()
    scheduleDraft()
  })

  const catalogItems = createMemo<CommandItem[]>(() => {
    void catalogVersion()
    try {
      const workflows = listCommands().filter((c) => c.kind === 'workflow')
      const skills = listSkills()
      return [
        ...SYSTEM_COMMANDS.map((c) => ({ label: `/${c.name}`, description: c.description, kind: 'system' as const })),
        ...workflows.map((w) => ({ label: `/${toKebab(w.name)}`, description: w.description || w.title, kind: 'workflow' as const })),
        ...skills.map((s) => ({ label: `/skill:${toKebab(s.name)}`, description: s.description, kind: 'skill' as const })),
      ]
    } catch {
      return SYSTEM_COMMANDS.map((c) => ({ label: `/${c.name}`, description: c.description, kind: 'system' as const }))
    }
  })

  const catalogKind = createMemo(() => {
    const map = new Map<string, CommandKind>()
    for (const item of catalogItems()) map.set(item.label, item.kind)
    return map
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
    return catalogItems().filter((item) => item.label.toLowerCase().includes(query))
  })

  const isFlyoutOpen = () => commandOpen() && filteredItems().length > 0

  const dims = useTerminalDimensions()
  let flyoutListRef: ScrollBoxRenderable | null = null
  const flyoutHeight = createMemo(() => {
    const items = filteredItems().length
    if (items === 0) return 1
    const cap = Math.max(4, Math.floor(dims().height * 0.4))
    return Math.min(items, cap)
  })

  createEffect(() => {
    const index = highlight()
    void filteredItems().length
    flyoutListRef?.scrollTo(Math.max(0, index - 2))
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
      const len = filteredItems().length
      setHighlight((h) => (h - 1 + len) % Math.max(1, len))
    } else if (key.name === 'down') {
      key.preventDefault()
      key.stopPropagation()
      const len = filteredItems().length
      setHighlight((h) => (h + 1) % Math.max(1, len))
    } else if (key.name === 'tab') {
      key.preventDefault()
      key.stopPropagation()
      completeItem(highlight())
    }
  })

  const cycleBack = () => {
    const items = history()
    if (items.length === 0) return
    if (navIndex() === -1) {
      draftStash = textareaRef?.plainText ?? ''
      const idx = items.length - 1
      setNavIndex(idx)
      textareaRef?.setText(items[idx] ?? '')
      setText(items[idx] ?? '')
    } else if (navIndex() > 0) {
      const idx = navIndex() - 1
      setNavIndex(idx)
      textareaRef?.setText(items[idx] ?? '')
      setText(items[idx] ?? '')
    }
    textareaRef?.gotoBufferEnd()
  }

  const cycleForward = () => {
    const items = history()
    if (navIndex() === -1) return
    if (navIndex() >= items.length - 1) {
      setNavIndex(-1)
      textareaRef?.setText(draftStash)
      setText(draftStash)
    } else {
      const idx = navIndex() + 1
      setNavIndex(idx)
      textareaRef?.setText(items[idx] ?? '')
      setText(items[idx] ?? '')
    }
    textareaRef?.gotoBufferEnd()
  }

  useKeyboard((key) => {
    if (key.name !== 'up' && key.name !== 'down') return
    if (key.ctrl || key.meta || key.super) return
    if (!textareaRef?.focused) return
    if (isFlyoutOpen()) return
    const row = textareaRef.logicalCursor?.row ?? 0
    const total = textareaRef.lineCount ?? 1
    if (key.name === 'up' && row === 0) {
      key.preventDefault()
      key.stopPropagation()
      cycleBack()
    } else if (key.name === 'down' && row >= total - 1) {
      key.preventDefault()
      key.stopPropagation()
      cycleForward()
    } else if (navIndex() !== -1) {
      setNavIndex(-1)
    }
  })

  const mod = (key: { ctrl: boolean; meta: boolean; super?: boolean }): boolean => key.ctrl || key.meta || (key.super ?? false)

  useKeyboard((key) => {
    if (!textareaRef?.focused) return
    const name = key.name.toLowerCase()
    if (mod(key) && name === 'a') {
      key.preventDefault()
      key.stopPropagation()
      textareaRef?.selectAll()
    }
  })

  const tokenPreview = createMemo(() => tokenizeCommandLine(text()))

  const tokenColor = (kind: string, value: string) => {
    if (kind === 'skill') return theme().warning
    if (kind === 'command') return catalogKind().get(value) === 'workflow' ? theme().info : theme().text
    return theme().textMuted
  }

  const labelColor = (kind: CommandKind) => {
    if (kind === 'skill') return theme().warning
    if (kind === 'workflow') return theme().info
    return theme().text
  }

  const copySelection = () => {
    const service = getClipboardService()
    if (!service) {
      pushToast('Copy failed: no clipboard service available', 'error')
      return
    }
    if (!textareaRef?.hasSelection()) return
    const selected = textareaRef.getSelectedText()
    if (!selected) return
    service.writeText(selected, { destination: 'best-available' }).catch((error) => {
      pushToast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
    })
  }

  const guessExt = (mediaType: string): string => {
    const sub = mediaType.split('/')[1] ?? 'bin'
    return sub.split('+')[0] ?? 'bin'
  }

  const attachFiles = (entries: { mediaType: string; filename?: string; bytes: Uint8Array }[]) => {
    const current = files()
    for (const entry of entries) {
      if (current.length >= MAX_FILES) {
        pushToast(`Too many files: keeping first ${MAX_FILES}`, 'warning')
        break
      }
      if (entry.bytes.byteLength > MAX_FILE_BYTES) {
        pushToast(`File too large: ${entry.filename ?? entry.mediaType} skipped`, 'warning')
        continue
      }
      const seq = nextFileSeq(current)
      const filename = entry.filename ?? `pasted-${seq}.${guessExt(entry.mediaType)}`
      const file: AttachedFile = { id: `f${Date.now()}-${seq}`, seq, mediaType: entry.mediaType, filename, size: entry.bytes.byteLength, bytes: entry.bytes }
      current.push(file)
      textareaRef?.insertText(`${fileToken(seq, file.mediaType, file.size)} `)
    }
    setFiles([...current])
    setText(textareaRef?.plainText ?? '')
    textareaRef?.focus()
    scheduleDraft()
  }

  const pasteClipboard = () => {
    const service = getClipboardService()
    if (!service) {
      pushToast('Paste failed: no clipboard service available', 'error')
      return
    }
    service
      .read({ preferredTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain'] })
      .then((result) => {
        if (result.status !== 'read') {
          if (result.status === 'failed') pushToast(`Paste failed: ${result.error.message}`, 'warning')
          return
        }
        if (!textareaRef) return
        if (result.representation.mimeType === 'text/plain') {
          const pasted = new TextDecoder().decode(result.representation.bytes)
          if (!pasted) return
          textareaRef.insertText(pasted)
          const next = textareaRef.plainText ?? ''
          pruneStaleFiles(next)
          setText(next)
          textareaRef.focus()
          scheduleDraft()
          return
        }
        const bytes = result.representation.bytes
        if (bytes.byteLength === 0) return
        attachFiles([{ mediaType: result.representation.mimeType, bytes }])
      })
      .catch((error) => {
        pushToast(`Paste failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
      })
  }

  useKeyboard((key) => {
    if (!mod(key)) return
    if (!textareaRef?.focused) return
    const name = key.name.toLowerCase()
    if (name === 'c') {
      if (!textareaRef?.hasSelection()) return
      key.preventDefault()
      key.stopPropagation()
      copySelection()
    } else if (name === 'v') {
      key.preventDefault()
      key.stopPropagation()
      pasteClipboard()
    }
  })

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
    const staged = files()
    const seqs = parseTokenSeqs(value)
    const bySeq = new Map(staged.map((f) => [f.seq, f]))
    const referenced = seqs.map((seq) => bySeq.get(seq)).filter((f): f is AttachedFile => f !== undefined)
    if (staged.length > 0 && (referenced.length !== staged.length || seqs.length !== referenced.length)) {
      pushToast(`Sending ${referenced.length} of ${staged.length} file(s); pasted markers may have been edited`, 'warning')
    }
    const key = props.historyProjectKey
    addPrompt(value, key)
    clearDraft(key)
    setNavIndex(-1)
    draftStash = ''
    props.onPrompt({ text: value, files: referenced })
    textareaRef?.clear()
    setText('')
    setFiles([])
    setHighlight(0)
  }

  const queueSuffix = () => (props.queueDepth > 0 ? ` (${props.queueDepth})` : '')

  const borderColor = () => (waitingMode() ? theme().info : queueMode() ? theme().info : steeringMode() ? theme().error : commandOpen() ? theme().accent : theme().border)
  const titleColor = () => (waitingMode() ? theme().info : queueMode() ? theme().info : steeringMode() ? theme().error : commandOpen() ? theme().accent : theme().textMuted)
  const title = () => (waitingMode() ? ' Prompt - Waiting ' : queueMode() ? ` Prompt - Enqueue${queueSuffix()} ` : steeringMode() ? ' Prompt Steering ' : commandOpen() ? ' Command ' : ' Prompt ')
  const placeholder = () =>
    waitingMode() ? 'Answer the questions above…' : queueMode() ? 'Enqueued until the run finishes…' : steeringMode() ? 'Steer the running step…' : 'What are we going to build?'

  return (
    <box flexDirection="column" flexShrink={0}>
      <Show when={commandOpen()}>
        <box flexDirection="row" gap={0} flexShrink={0} paddingX={1}>
          <For each={tokenPreview()}>{(token) => <text fg={tokenColor(token.kind, token.text)}>{token.text}</text>}</For>
        </box>
        <Show when={filteredItems().length > 0}>
          <box flexDirection="column" flexShrink={0} border={['top']} borderColor={theme().border}>
            <scrollbox ref={(r) => (flyoutListRef = r)} height={flyoutHeight()} scrollY overflow="hidden" flexShrink={0}>
              <box flexDirection="column" flexShrink={0}>
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
                      <box flexDirection="row" gap={1} flexShrink={0}>
                        <text fg={labelColor(item.kind)}>{item.label}</text>
                        <text fg={theme().textMuted}>({item.kind})</text>
                      </box>
                      <box flexGrow={1} flexShrink={1} minWidth={0}>
                        <text fg={theme().textMuted}>{item.description}</text>
                      </box>
                    </box>
                  )}
                </For>
              </box>
            </scrollbox>
            <box flexShrink={0} paddingX={1}>
              <text fg={theme().textMuted}>
                {highlight() + 1}/{filteredItems().length} — arrows to navigate, TAB to complete
              </text>
            </box>
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
        <text flexShrink={0} fg={waitingMode() ? theme().info : queueMode() ? theme().info : steeringMode() ? theme().error : commandOpen() ? theme().accent : theme().textMuted}>
          {icons.promptBig}
        </text>
        <box flexGrow={1} flexShrink={1} onMouseDown={handleMouseDown}>
          <textarea
            ref={(r) => (textareaRef = r)}
            id="prompt"
            maxHeight={10}
            placeholder={placeholder()}
            placeholderColor={theme().textMuted}
            cursorColor={theme().accent}
            textColor={theme().text}
            onSubmit={submit}
            onContentChange={() => {
              const next = textareaRef?.plainText ?? ''
              if (navIndex() !== -1 && next !== (history()[navIndex()] ?? '')) setNavIndex(-1)
              if (navIndex() === -1) pruneStaleFiles(next)
              setText(next)
              scheduleDraft()
            }}
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
