import type { BoxRenderable, TextareaRenderable } from '@opentui/core'
import { clip } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { pushToast } from '@states/toast.state.ts'
import { Button } from '@tui/components/button.tsx'
import { approvalBodyLines, fenceFiletype, type PlanSegment, planSegments } from '@tui/components/session/tools/plan-blocks.ts'
import { COMMENT_TEXTAREA_KEY_BINDINGS } from '@tui/components/shared/textarea-keybindings.ts'
import { getClipboardService } from '@tui/hooks/clipboard.state.ts'
import { useAppKeyboard } from '@tui/hooks/keyboard-provider.tsx'
import { icons } from '@tui/themes/icons.ts'
import { getSharedTreeSitterClientSync } from '@wrappers/treesitter-wrapper.ts'
import { createSignal, For, Show } from 'solid-js'

export type PlanVerdict = 'approved' | 'rejected'

export interface PlanReviewProps {
  plan: string
  status?: string
  outputMessage?: string
  interactive: boolean
  onVerdict: (status: PlanVerdict, message: string) => void | Promise<void>
  onCancel: () => void | Promise<void>
}

interface PlanSegmentViewProps {
  segment: PlanSegment
  open: boolean
  comment: string
  onToggle: () => void
  registerEditor: (el: TextareaRenderable | null) => void
  onEditorSubmit: () => void
  onEditorChange: () => void
}

const PlanSegmentView = (props: PlanSegmentViewProps) => {
  let rowRef: BoxRenderable | null = null
  let editorRef: TextareaRenderable | null = null
  const commented = () => props.comment.trim().length > 0
  return (
    <box
      ref={(el) => {
        rowRef = el
      }}
      flexDirection="column"
      onMouseOver={() => {
        if (rowRef) rowRef.backgroundColor = theme().backgroundElement
      }}
      onMouseOut={() => {
        if (rowRef) rowRef.backgroundColor = undefined
      }}>
      <box flexDirection="row" columnGap={1} onMouseUp={props.onToggle}>
        <box flexDirection="row" columnGap={1} flexShrink={0} paddingLeft={1}>
          <text fg={commented() || props.open ? theme().accent : theme().primary} selectable={false}>
            {icons.pencil}
          </text>
        </box>
        <box flexShrink={1} minWidth={0} overflow="hidden" border={['left']} borderColor={theme().borderSubtle} paddingX={1}>
          <Show when={props.segment.kind === 'code'} fallback={<markdown syntaxStyle={theme().syntax} conceal content={props.segment.text.trim()} />}>
            <code content={props.segment.text} filetype={fenceFiletype(props.segment.lang)} syntaxStyle={theme().syntax} treeSitterClient={getSharedTreeSitterClientSync()} conceal />
          </Show>
        </box>
      </box>
      <Show when={commented() && !props.open}>
        <text fg={theme().accent}>{` ${icons.boxBottomLeft}${icons.boxHorizontal}${icons.boxHorizontal} Comment: ${props.comment.trim()} `}</text>
      </Show>
      <Show when={props.open}>
        <box
          flexDirection="row"
          marginTop={0}
          onMouseUp={() =>
            queueMicrotask(() => {
              if (editorRef && !editorRef.isDestroyed) editorRef.focus()
            })
          }>
          <box flexBasis={5} flexShrink={1}>
            <text fg={theme().accent}>{` ${icons.boxBottomLeft}${icons.boxHorizontal}${icons.boxHorizontal}`}</text>
          </box>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <textarea
              ref={(r) => {
                editorRef = r
                props.registerEditor(r)
              }}
              maxHeight={3}
              placeholder={`Comment on block ${props.segment.index + 1} (optional, clear to remove)`}
              placeholderColor={theme().textMuted}
              textColor={theme().accent}
              cursorColor={theme().textMuted}
              backgroundColor={theme().backgroundElement}
              keyBindings={COMMENT_TEXTAREA_KEY_BINDINGS}
              onSubmit={props.onEditorSubmit}
              onContentChange={props.onEditorChange}
            />
          </box>
        </box>
      </Show>
    </box>
  )
}

const firstNonBlankLine = (text: string): string => text.split('\n').find((line) => line.trim().length > 0) ?? ''

export const PlanReview = (props: PlanReviewProps) => {
  const segments = () => planSegments(props.plan)
  const [blockComments, setBlockComments] = createSignal<Array<string>>(segments().map(() => ''))
  const [openBlock, setOpenBlock] = createSignal<number | undefined>(undefined)
  const [overall, setOverall] = createSignal('')
  const [responded, setResponded] = createSignal(false)
  const [dismissed, setDismissed] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  const blockRefs: Array<TextareaRenderable | null> = []
  let overallRef: TextareaRenderable | null = null

  const readonly = () => !props.interactive || sending() || responded() || (props.status !== undefined && props.status !== 'pending')
  const wasDismissed = () => props.status === 'cancelled' || (responded() && dismissed() && props.status !== 'approved' && props.status !== 'rejected')

  const setBlockComment = (index: number, value: string) => {
    if (readonly()) return
    setBlockComments((prev) => {
      const next = [...prev]
      while (next.length < segments().length) next.push('')
      next[index] = value
      return next
    })
  }

  const hasComment = () => blockComments().some((c) => c.trim().length > 0) || overall().trim().length > 0

  const buildMessage = (): string => {
    const parts: Array<string> = []
    segments().forEach((segment, index) => {
      const comment = (blockComments()[index] ?? '').trim()
      if (!comment) return
      const label = segment.kind === 'code' && segment.lang ? ` (${segment.lang})` : ''
      parts.push(`Block ${index + 1}${label} "${clip(firstNonBlankLine(segment.text).trim(), 80)}": ${comment}`)
    })
    const all = overall().trim()
    if (all) parts.push(`Overall: ${all}`)
    return parts.join('\n')
  }

  const verdict = async (status: PlanVerdict) => {
    if (readonly()) return
    if (status === 'rejected' && !hasComment()) return
    const message = buildMessage()
    setSending(true)
    try {
      await props.onVerdict(status, message.length > 0 ? message : 'Approved')
      setDismissed(false)
      setResponded(true)
    } catch {
    } finally {
      setSending(false)
    }
  }

  useAppKeyboard((key) => {
    if (key.name !== 'return' && key.name !== 'enter') return
    if (!key.meta && !key.ctrl) return
    const index = openBlock()
    if (index === undefined) return
    if (!blockRefs[index]?.focused) return
    key.preventDefault()
    key.stopPropagation()
    setOpenBlock(undefined)
  })

  const copy = async () => {
    const service = getClipboardService()
    if (!service) {
      pushToast('Copy failed: no clipboard service available', 'error')
      return
    }
    try {
      await service.writeText(props.plan, { destination: 'all-available' })
      pushToast('Copied to clipboard', 'info')
    } catch (error) {
      pushToast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  const cancel = async () => {
    if (readonly()) return
    setSending(true)
    try {
      await props.onCancel()
      setDismissed(true)
      setResponded(true)
    } catch {
    } finally {
      setSending(false)
    }
  }

  const registerEditor = (index: number) => (el: TextareaRenderable | null) => {
    blockRefs[index] = el
    if (!el) return
    const existing = blockComments()[index] ?? ''
    if (existing.length > 0 && el.plainText !== existing) el.setText(existing)
    el.focus()
  }

  const editorSubmit = (index: number) => () => {
    const ref = blockRefs[index]
    if (ref && !ref.isDestroyed) {
      setBlockComment(index, ref.plainText)
      ref.blur()
    }
    setOpenBlock(undefined)
  }

  const editorChange = (index: number) => () => {
    const ref = blockRefs[index]
    if (ref && !ref.isDestroyed) setBlockComment(index, ref.plainText)
  }

  return (
    <box flexDirection="column">
      <Show
        when={!readonly()}
        fallback={
          <box flexDirection="column" gap={1}>
            <Show
              when={wasDismissed()}
              fallback={
                <Show
                  when={props.status !== undefined && props.status !== 'pending' && props.outputMessage}
                  fallback={
                    <For each={segments()}>
                      {(segment, index) => (
                        <PlanSegmentView
                          segment={segment}
                          open={false}
                          comment={blockComments()[index()] ?? ''}
                          onToggle={() => {}}
                          registerEditor={() => {}}
                          onEditorSubmit={() => {}}
                          onEditorChange={() => {}}
                        />
                      )}
                    </For>
                  }>
                  <box flexDirection="column">
                    <text fg={props.status === 'rejected' ? theme().error : theme().success}>{props.status === 'rejected' ? `${icons.cross} Rejected` : `${icons.success} Approved`}</text>
                    <For each={approvalBodyLines(props.status, props.outputMessage)}>{(line) => <text fg={theme().textMuted}>{line}</text>}</For>
                  </box>
                </Show>
              }>
              <text fg={theme().warning}>{`${icons.cross} Review dismissed.`}</text>
            </Show>
          </box>
        }>
        <text fg={theme().textMuted} selectable={false} marginY={1}>
          {` Click on the pencil or block to add a comment`}
        </text>
        <For each={segments()}>
          {(segment, index) => (
            <PlanSegmentView
              segment={segment}
              open={openBlock() === index()}
              comment={blockComments()[index()] ?? ''}
              onToggle={() => setOpenBlock(openBlock() === index() ? undefined : index())}
              registerEditor={registerEditor(index())}
              onEditorSubmit={editorSubmit(index())}
              onEditorChange={editorChange(index())}
            />
          )}
        </For>
        <box
          marginTop={1}
          flexGrow={1}
          onMouseUp={() => {
            if (overallRef && !overallRef.isDestroyed) overallRef.focus()
          }}>
          <textarea
            ref={(r) => {
              overallRef = r
            }}
            placeholder="Overall comment (optional, required to request changes)"
            placeholderColor={theme().textMuted}
            textColor={theme().text}
            cursorColor={theme().accent}
            backgroundColor={theme().backgroundElement}
            maxHeight={4}
            keyBindings={COMMENT_TEXTAREA_KEY_BINDINGS}
            onSubmit={() => {
              if (overallRef && !overallRef.isDestroyed) overallRef.blur()
            }}
            onContentChange={() => {
              if (readonly()) return
              if (overallRef && !overallRef.isDestroyed) setOverall(overallRef.plainText)
            }}
          />
        </box>
        <box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
          <Button label={`${icons.success} Approve`} onClick={() => verdict('approved')} />
          <Show when={hasComment()}>
            <Button label={`${icons.edit} Request changes`} onClick={() => verdict('rejected')} />
          </Show>
          <Button label={`${icons.cross} Dismiss`} onClick={cancel} />
          <Button label={`${icons.messages} Copy`} onClick={copy} />
        </box>
      </Show>
    </box>
  )
}
